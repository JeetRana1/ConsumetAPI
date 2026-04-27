import axios from 'axios';
import * as cheerio from 'cheerio';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { extractDirectSourcesWithPlaywright } from '../../utils/browserRuntimeExtractor';

// Route player-domain requests through Shirna Proxy to bypass datacenter IP blocks.
const SHIRNA_PROXY_URL = process.env.SHIRNA_PROXY_URL || 'http://localhost:3000/proxy?src=';
console.log('[Vegamovies] Using Shirna Proxy:', SHIRNA_PROXY_URL);


const BASE_URL = 'https://vegamovies.nf';
const PLAYER_DOMAIN = 'https://loffe414wil.com';

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function fetchHtml(url: string, referer = BASE_URL + '/'): Promise<string> {
  const res = await axios.get(url, {
    headers: { ...FETCH_HEADERS, Referer: referer },
    timeout: 15000,
    maxRedirects: 5,
  });
  return String(res.data ?? '');
}

/** Parse the inline `let p3 = { ... };` player config from the player page HTML. */
function extractPlayerConfig(html: string): Record<string, any> | null {
  const p3Match = html.match(/let p3 = (\{.*?\});/s);
  if (p3Match) {
    const raw = p3Match[1];
    try {
      // Try direct parse first (modern DLE often uses valid JSON)
      const parsed = JSON.parse(raw);
      return parsed;
    } catch {
      try {
        // Fallback: carefully quote unquoted keys
        const fixed = raw
          .replace(/'/g, '"')
          .replace(/([{,]\s*)(\w+):/g, '$1"$2":');
        const parsed = JSON.parse(fixed);
        return parsed;
      } catch (e: any) {
        console.error('[Vegamovies] Player config parse failed:', e.message);
      }
    }
  }
  const hdvbMatch = html.match(/new HDVBPlayer\((\{.*?\})\)/s);
  if (hdvbMatch) {
    try {
      return JSON.parse(hdvbMatch[1]);
    } catch {}
  }
  return null;
}



/** Extract the IMDB ID from IndStreamPlayerConfigs on a Vegamovies post page. */
function extractImdbId(html: string): string | null {
  const match = html.match(/IndStreamPlayerConfigs\s*=\s*\{[^}]*src:\s*['"]([^'"]+)['"]/);
  if (match?.[1]) {
    const imdbMatch = match[1].match(/tt\d+/);
    return imdbMatch?.[0] ?? match[1];
  }
  return null;
}

/** Parse basic movie info from a Vegamovies post page. */
function parseMovieInfo(html: string, url: string) {
  const $ = cheerio.load(html);
  const title = $('h1.entry-title, .post-title h1, h1').first().text().trim()
    || $('title').text().replace('- Vegamovies', '').replace('Download', '').trim();
  const poster =
    $('meta[property="og:image"]').attr('content') ||
    $('.entry-content img, .post-content img').first().attr('src') ||
    '';
  const description =
    $('meta[property="og:description"]').attr('content') ||
    $('.entry-content p').first().text().trim().substring(0, 500) ||
    '';
  const imdbId = extractImdbId(html);

  return { title, poster, description, imdbId, url };
}

/** Parse search results from a Vegamovies search page. */
function parseSearchResults($: cheerio.CheerioAPI) {
  const results: any[] = [];
  $('article').each((_, el) => {
    const a = $(el)
      .find('.post-title a, h3 a, h2 a, a[rel="bookmark"]')
      .first();
    const title = a.text().trim();
    const href = a.attr('href') || '';
    if (!title || !href) return;
    const img =
      $(el).find('img').first().attr('src') ||
      $(el).find('img').first().attr('data-src') ||
      '';
    const id = href.replace(BASE_URL + '/', '').replace(/\.html$/, '');
    results.push({ id, title, url: href, image: img.startsWith('/') ? BASE_URL + img : img });
  });
  return results;
}

const DIRECT_MEDIA_REGEX = /(https?:\/\/[^\s"'<>]+(?:\.m3u8|\.mp4|\.mpd)(?:\?[^\s"'<>]*)?)/i;
const ANY_URL_REGEX = /(https?:\/\/[^\s"'<>]+)/gi;

const isDirectMediaUrl = (value: string): boolean => /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(value || ''));

const extractDirectMediaUrlFromText = (text: string): string => {
  const raw = String(text || '');
  if (!raw) return '';

  const direct = raw.match(DIRECT_MEDIA_REGEX);
  if (direct?.[1]) return direct[1];

  const urls = raw.match(ANY_URL_REGEX) || [];
  for (const candidate of urls) {
    if (isDirectMediaUrl(candidate)) return candidate;
  }

  return '';
};

async function resolvePlayableSourceUrl(candidateUrl: string, referer: string): Promise<string> {
  const normalized = String(candidateUrl || '').trim();
  if (!normalized) return '';
  if (isDirectMediaUrl(normalized)) return normalized;

  const looksLikeTokenizedPlaylist =
    /\/playlist\//i.test(normalized) ||
    /\.txt(\?|$)/i.test(normalized) ||
    /\/file\/stream\//i.test(normalized);

  if (!looksLikeTokenizedPlaylist) return '';

  try {
    const playlistRes = await axios.get(normalized, {
      headers: {
        ...FETCH_HEADERS,
        Referer: referer || `${PLAYER_DOMAIN}/`,
        Origin: PLAYER_DOMAIN,
      },
      timeout: 12000,
      responseType: 'text',
      transformResponse: (v) => v,
    });

    const body = String(playlistRes?.data ?? '').trim();
    if (!body) return '';

    if (/^#EXTM3U/i.test(body)) {
      // Some providers serve valid manifests from .txt URLs.
      return normalized;
    }

    if (body.startsWith('[')) {
      try {
        const parsed = JSON.parse(body) as Array<{ file?: string }>;
        for (const row of parsed) {
          const file = String(row?.file || '').trim();
          if (isDirectMediaUrl(file)) return file;
        }
      } catch {
        // fall through to regex extraction
      }
    }

    return extractDirectMediaUrlFromText(body);
  } catch {
    return '';
  }
}

export class VegamoviesProvider {
  static readonly baseUrl = BASE_URL;
  static readonly playerDomain = PLAYER_DOMAIN;
  static readonly providerName = 'vegamovies';

  // ──────────────────────────────────────────────
  // SEARCH
  // ──────────────────────────────────────────────
  static async search(query: string, page = 1) {
    if (!query) return { error: 'Query is required' };
    try {
      // Vegamovies (DLE) uses POST for search. 
      // GET ?s= query often just returns latest posts.
      const searchBody = new URLSearchParams();
      searchBody.append('do', 'search');
      searchBody.append('subaction', 'search');
      searchBody.append('search_start', String(page));
      searchBody.append('story', query);

      const res = await axios.post(`${BASE_URL}/`, searchBody.toString(), {
        headers: { 
          ...FETCH_HEADERS, 
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: `${BASE_URL}/` 
        },
        timeout: 15000,
      });

      const html = String(res?.data || '');
      const $ = cheerio.load(html);
      const results = parseSearchResults($);

      // Pagination in DLE usually involves 'search_start' or clicking next which has a hash.
      // For now, we'll detect the 'next' button to set hasNextPage.
      const hasNextPage = $('a.next.page-numbers, .navigation .next, a:contains("Next")').length > 0;

      return {
        currentPage: page,
        hasNextPage,
        totalPages: hasNextPage ? page + 1 : page,
        results,
      };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  // ──────────────────────────────────────────────
  // INFO
  // ──────────────────────────────────────────────
  static async getInfo(id: string) {
    if (!id) return { error: 'ID is required' };
    try {
      // id is the slug portion: e.g. "426-avengers-endgame-2019-hindi-dual-audio-720p"
      const url = id.startsWith('http') ? id : `${BASE_URL}/${id}.html`;
      const html = await fetchHtml(url);
      const info = parseMovieInfo(html, url);

      return {
        id,
        title: info.title,
        url: info.url,
        image: info.poster,
        description: info.description,
        imdbId: info.imdbId,
        hasSources: !!info.imdbId,
      };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  // ──────────────────────────────────────────────
  // SOURCES  (uses Playwright to intercept language variants)
  // ──────────────────────────────────────────────
  static async getSources(id: string, season?: number, episode?: number) {
    if (!id) return { error: 'ID is required' };

    try {
      // Resolve the IMDB ID — id might be a slug or an imdb id directly
      let playerImdbId: string | null = null;
      if (id.startsWith('tt')) {
        playerImdbId = id;
      } else {
        const url = id.startsWith('http') ? id : `${BASE_URL}/${id}.html`;
        const postHtml = await fetchHtml(url);
        playerImdbId = extractImdbId(postHtml);
      }

      if (!playerImdbId) {
        throw new Error('Unable to resolve IMDB ID for Vegamovies');
      }

      const playerUrl = `${PLAYER_DOMAIN}/play/${playerImdbId}${season ? `?s=${season}${episode ? `&e=${episode}` : ''}` : ''}`;

      // Fetch the player page, routing through the Shirna proxy
      const proxyPlayerUrl = `${SHIRNA_PROXY_URL}${encodeURIComponent(playerUrl)}`;
      const playerHtmlRes = await axios.get(proxyPlayerUrl, {
        headers: { ...FETCH_HEADERS, Referer: BASE_URL + '/' },
        timeout: 20000,
        maxRedirects: 5,
      });
      const playerHtml = typeof playerHtmlRes.data === 'string' ? playerHtmlRes.data : String(playerHtmlRes.data);

      const playerConfigFromHtml = extractPlayerConfig(playerHtml);

      let sources: Array<{ url: string; quality: string; isM3U8: boolean; isEmbed: boolean; referer?: string }> = [];

      if (playerConfigFromHtml?.file) {
        try {
          const fileUrl = playerConfigFromHtml.file.startsWith('http') ? playerConfigFromHtml.file : `${new URL(playerUrl).origin}${playerConfigFromHtml.file}`;
          const proxyFileUrl = `${SHIRNA_PROXY_URL}${encodeURIComponent(fileUrl)}`;
          const playlistRes = await axios.get(proxyFileUrl, {
            headers: { 
              ...FETCH_HEADERS, 
              ...(playerConfigFromHtml.key ? { 'X-Csrf-Token': playerConfigFromHtml.key } : {}),
              Referer: playerUrl 
            },
            timeout: 10000,
          });

          let playlistData = playlistRes.data;

          if (Array.isArray(playlistData)) {
            const extractFiles = (data: any[], targetSeason?: number, targetEpisode?: number, currentSeason?: number, currentEpisode?: number): any[] => {
              let files: any[] = [];
              const seasonRegex = /(?:\bseason\b|\bs\b|\bpart\b)\s*0*(\d+)|0*(\d+)\s*(?:\bseason\b|\bs\b|\bpart\b)/i;
              const epRegex = /(?:\bepisode\b|\bep\b|\be\b|s\d+e)\s*0*(\d+)|0*(\d+)\s*(?:\bepisode\b|\bep\b|\be\b)/i;

              for (const item of data) {
                const title = String(item.title || item.quality || '').toLowerCase();
                const id = String(item.id || '').toLowerCase();
                
                let itemSeason = currentSeason;
                let itemEpisode = currentEpisode;

                const sMatch = title.match(seasonRegex) || id.match(seasonRegex);
                if (sMatch) itemSeason = Number(sMatch[1] || sMatch[2]);
                
                const eMatch = title.match(epRegex) || id.match(epRegex);
                if (eMatch) itemEpisode = Number(eMatch[1] || eMatch[2]);
                
                if (item.folder) {
                  let shouldEnter = false;
                  if (!targetSeason && !targetEpisode) {
                    shouldEnter = true;
                  } else if (targetSeason && !itemSeason) {
                    shouldEnter = true;
                  } else if (targetSeason && itemSeason === targetSeason) {
                    if (!targetEpisode) {
                      shouldEnter = true;
                    } else if (!itemEpisode || itemEpisode === targetEpisode) {
                      shouldEnter = true;
                    }
                  } else if (!targetSeason && targetEpisode) {
                    if (!itemEpisode || itemEpisode === targetEpisode) shouldEnter = true;
                  }

                  if (shouldEnter) {
                    files = files.concat(extractFiles(item.folder, targetSeason, targetEpisode, itemSeason, itemEpisode));
                  }
                } else if (item.file) {
                  let matches = false;
                  if (!targetSeason && !targetEpisode) {
                    matches = true;
                  } else {
                    const seasonMatch = !targetSeason || itemSeason === targetSeason;
                    const episodeMatch = !targetEpisode || itemEpisode === targetEpisode;
                    matches = seasonMatch && episodeMatch;
                    
                    if (!matches && targetEpisode && !itemEpisode) {
                       const numMatch = title.match(new RegExp(`\\b${targetEpisode}\\b`));
                       if (numMatch) matches = seasonMatch;
                    }
                  }

                  if (matches) {
                    files.push(item);
                  }
                }
              }
              return files;
            };

            const filteredData = extractFiles(playlistData, season, episode);
            const playlistHost = new URL(fileUrl).origin;

            console.log(`[Vegamovies] Found ${filteredData.length} playlist items to resolve:`, filteredData.map((i: any) => i.title || i.quality || i.file));

            // Parallelize all .txt fetches so one slow/failed language track doesn't block others
            const resolveItem = async (item: any) => {
              if (!item.file) return null;
              const itemFile = item.file.startsWith('~') ? item.file.slice(1) : item.file;
              const label = item.title || item.quality || 'auto';

              // Build candidate URLs to try in order
              const candidateUrls: string[] = [];
              if (itemFile.startsWith('http')) {
                // item.file is already a full URL
                candidateUrls.push(itemFile);
              } else {
                // Standard pattern
                candidateUrls.push(`${playlistHost}/playlist/${itemFile}.txt`);
                // Alternate: without .txt extension
                candidateUrls.push(`${playlistHost}/playlist/${itemFile}`);
                // Alternate: file path may include subdirectory
                candidateUrls.push(`${playlistHost}/${itemFile}.txt`);
              }

              const hdrs: Record<string, string> = {
                ...FETCH_HEADERS,
                ...(playerConfigFromHtml.key ? { 'X-Csrf-Token': playerConfigFromHtml.key } : {}),
                Referer: playerUrl,
              };

              for (const candidateUrl of candidateUrls) {
                try {
                  const proxyCandidateUrl = `${SHIRNA_PROXY_URL}${encodeURIComponent(candidateUrl)}`;
                  const linkRes = await axios.get(proxyCandidateUrl, {
                    headers: hdrs,
                    timeout: 12000,
                    responseType: 'text',
                    transformResponse: (v) => v,
                  });
                  const body = String(linkRes.data ?? '').trim();
                  console.log(`[Vegamovies] Resolved "${label}" (${candidateUrl}):`, body.slice(0, 120));

                  // Accept .m3u8, .mp4, .mpd, or streaming CDN patterns
                  const isPlayable = /\.(m3u8|mp4|mpd)(\?|$)/i.test(body)
                    || /^https?:\/\//i.test(body) && body.split('\n').length === 1;

                  if (isPlayable) {
                    return {
                      url: body.split('\n')[0].trim(), // take first line if multiple
                      quality: label,
                      isM3U8: /\.m3u8/i.test(body) || !(/\.mp4|\.mpd/i.test(body)),
                      isEmbed: false,
                      referer: playerUrl,
                    };
                  }

                  // It might be a JSON array like [{file: "..."}]
                  if (body.startsWith('[')) {
                    try {
                      const parsed = JSON.parse(body) as Array<{ file?: string }>;
                      const first = parsed.find(r => /\.(m3u8|mp4|mpd)/i.test(String(r?.file || '')));
                      if (first?.file) {
                        return {
                          url: first.file,
                          quality: label,
                          isM3U8: /\.m3u8/i.test(first.file),
                          isEmbed: false,
                          referer: playerUrl,
                        };
                      }
                    } catch {}
                  }
                } catch (e: any) {
                  console.warn(`[Vegamovies] Failed to resolve "${label}" via ${candidateUrl}:`, e.message);
                }
              }

              console.error(`[Vegamovies] Could not resolve any playable URL for "${label}" (file: ${itemFile})`);
              return null;
            };

            const resolvedItems = await Promise.all(filteredData.map(resolveItem));
            for (const resolved of resolvedItems) {
              if (resolved) sources.push(resolved);
            }
          } else if (typeof playlistData === 'string' && playlistData.includes('.m3u8')) {
            sources.push({ url: playlistData.trim(), quality: 'auto', isM3U8: true, isEmbed: false, referer: playerUrl });
          }
        } catch (e) {}
      }

      if (sources.length === 0) {
        sources = await extractDirectSourcesWithPlaywright(playerUrl, BASE_URL + '/', 20000);
      }

      return {
        imdbId: playerImdbId,
        playerUrl,
        sources,
        playerConfig: playerConfigFromHtml
          ? {
              host: playerConfigFromHtml.host,
              masterId: playerConfigFromHtml.masterId,
              translator: playerConfigFromHtml.translator,
            }
          : null,
      };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  // ──────────────────────────────────────────────
  // RECENT / HOME
  // ──────────────────────────────────────────────
  static async getRecent(page = 1) {
    try {
      const url = page > 1 ? `${BASE_URL}/page/${page}/` : `${BASE_URL}/`;
      const html = await fetchHtml(url);
      const $ = cheerio.load(html);
      const results = parseSearchResults($);
      const hasNextPage = $('a.next.page-numbers, .navigation .next').length > 0;
      return { currentPage: page, hasNextPage, results };
    } catch (err: any) {
      return { error: err.message };
    }
  }
}
