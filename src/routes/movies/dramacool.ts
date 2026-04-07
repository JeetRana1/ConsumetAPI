import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { MOVIES } from '@consumet/extensions';
import { StreamingServers } from '@consumet/extensions/dist/models';
import { load } from 'cheerio';

import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { Redis } from 'ioredis';
import { fetchWithServerFallback, MOVIE_SERVER_FALLBACKS, hasDirectPlayableSource } from '../../utils/streamable';
import { configureProvider } from '../../utils/provider';
import { getMovieEmbedFallbackSource } from '../../utils/movieServerFallback';

type EpisodeEntry = {
  id: string;
  title: string;
  url: string;
  episode?: number;
};

const WP_SITEMAP_CACHE_TTL_MS = 1000 * 60 * 15;

let sitemapCache: { fetchedAt: number; urls: string[] } | undefined;
const dramaEpisodesCache = new Map<string, { fetchedAt: number; episodes: EpisodeEntry[] }>();

const parseLocsFromXml = (xml: string): string[] => {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1].trim());
};

const toAbsoluteUrl = (base: string, maybeUrl: string): string => {
  if (maybeUrl.startsWith('http://') || maybeUrl.startsWith('https://')) return maybeUrl;
  return `${base.replace(/\/$/, '')}/${maybeUrl.replace(/^\//, '')}`;
};

const extractSlugFromUrl = (url: string): string => {
  const clean = url.split('?')[0].replace(/\/$/, '');
  const last = clean.split('/').pop() || '';
  return last.replace(/\.html$/i, '').trim();
};

const parseEpisodeNumber = (urlOrTitle: string): number | undefined => {
  const match = urlOrTitle.match(/episode-(\d+)/i) || urlOrTitle.match(/episode\s*(\d+)/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
};

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const normalizeSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\.html$/i, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const stripTrailingYear = (value: string): string => value.replace(/-(19|20)\d{2}$/i, '');

const buildDramaSlugVariants = (dramaSlug: string): string[] => {
  const base = normalizeSlug(dramaSlug);
  const set = new Set<string>();
  const push = (v?: string) => {
    const clean = v ? normalizeSlug(v) : '';
    if (clean) set.add(clean);
  };

  push(base);
  push(stripTrailingYear(base));
  push(base.replace(/-season-\d+$/i, ''));
  push(base.replace(/-s\d+$/i, ''));
  push(base.replace(/-part-\d+$/i, ''));
  push(stripTrailingYear(base.replace(/-season-\d+$/i, '')));

  return [...set];
};

const parseM3u8Attributes = (line: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  const [, payload = ''] = line.split(':', 2);
  const attrRegex = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let match: RegExpExecArray | null = null;
  while ((match = attrRegex.exec(payload)) !== null) {
    const key = match[1].toUpperCase();
    const value = String(match[2] || '').replace(/^"|"$/g, '');
    attrs[key] = value;
  }
  return attrs;
};

const resolveM3u8Uri = (baseUrl: string, maybeUri: string): string => {
  if (/^https?:\/\//i.test(maybeUri)) return maybeUri;
  return new URL(maybeUri, baseUrl).toString();
};

const dedupeSubtitles = (tracks: Array<{ url: string; lang: string }>): Array<{ url: string; lang: string }> => {
  const set = new Set<string>();
  const out: Array<{ url: string; lang: string }> = [];
  for (const track of tracks) {
    if (!track?.url) continue;
    const key = `${track.url}|${track.lang || ''}`.toLowerCase();
    if (set.has(key)) continue;
    set.add(key);
    out.push(track);
  }
  return out;
};

const isDirectMediaUrl = (value: string): boolean =>
  /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(value || '')) || /\/m3u8-proxy\?/i.test(String(value || ''));

const parseResolution = (value: string): number => {
  const text = String(value || '');
  const byP = text.match(/(?:^|\D)(\d{3,4})p(?:\D|$)/i);
  if (byP) return Number(byP[1]);
  const byX = text.match(/(?:^|\D)(\d{3,4})x\d{3,4}(?:\D|$)/i);
  if (byX) return Number(byX[1]);
  if (/4k|2160/i.test(text)) return 2160;
  return 0;
};

const sourceRank = (source: any, fastStart = true): number => {
  const url = String(source?.url || '').toLowerCase();
  const qualityText = String(source?.quality || '');
  const resolution = parseResolution(qualityText || url);

  let score = 0;
  if (/\.m3u8(\?|$)/.test(url) || /m3u8-proxy/.test(url)) score += 3000;
  else if (/\.mpd(\?|$)/.test(url)) score += 2000;
  else if (/\.mp4(\?|$)/.test(url)) score += 1000;

  if (fastStart) {
    if (resolution > 0) score += Math.max(0, 1200 - resolution);
  } else {
    score += resolution;
  }

  if (/backup|alt|mirror/.test(String(source?.server || '').toLowerCase())) score -= 100;
  return score;
};

const sortAndLimitSources = (rawSources: any[], fastStart = true): any[] => {
  const deduped = rawSources.filter(
    (item, idx, arr) => arr.findIndex((v) => String(v?.url || '') === String(item?.url || '')) === idx,
  );

  const direct = deduped.filter((s) => isDirectMediaUrl(String(s?.url || '')));
  const nonDirect = deduped.filter((s) => !isDirectMediaUrl(String(s?.url || '')));

  direct.sort((a, b) => sourceRank(b, fastStart) - sourceRank(a, fastStart));
  return [...direct.slice(0, 8), ...nonDirect.slice(0, 2)];
};

const extractSubtitleTracksFromEmbed = (
  embedHtml: string,
  baseUrl: string,
): Array<{ url: string; lang: string }> => {
  const tracks: Array<{ url: string; lang: string }> = [];
  const regex =
    /(?:file|src)\s*[:=]\s*['"]([^'"]+\.(?:vtt|srt|ass|ssa)[^'"]*)['"][\s\S]{0,140}?(?:label|lang|srclang)\s*[:=]\s*['"]([^'"]+)['"]/gi;

  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(embedHtml)) !== null) {
    const url = resolveM3u8Uri(baseUrl, String(match[1] || '').trim());
    const lang = normalizeText(String(match[2] || 'Default'));
    tracks.push({ url, lang });
  }

  return dedupeSubtitles(tracks);
};

const pickBestDirectSource = (urls: string[]): string | undefined => {
  if (!urls.length) return undefined;
  const clean = urls
    .map((u) => String(u || '').trim())
    .filter((u) => /^https?:\/\//i.test(u));
  if (!clean.length) return undefined;

  const score = (url: string): number => {
    const lower = url.toLowerCase();
    let s = 0;
    if (lower.includes('.mp4')) s += 90;
    if (lower.includes('.m3u8')) s += 80;
    if (lower.includes('.mpd')) s += 70;
    if (lower.includes('googlevideo') || lower.includes('akamaized') || lower.includes('cloudfront')) s += 15;
    if (lower.includes('embed')) s -= 40;
    return s;
  };

  return clean.sort((a, b) => score(b) - score(a))[0];
};

const extractAllDirectSourcesFromEmbed = (embedHtml: string): string[] => {
  const patterns = [
    /sources\s*:\s*\[[\s\S]*?\]/gi,
    /["']file["']\s*:\s*["']([^"']+\.(?:m3u8|mp4|mpd)[^"']*)["']/gi,
    /["']src["']\s*:\s*["']([^"']+\.(?:m3u8|mp4|mpd)[^"']*)["']/gi,
    /(https?:\/\/[^\s'"<>]+\.(?:m3u8|mp4|mpd)[^\s'"<>]*)/gi,
  ];

  const out = new Set<string>();

  for (const pattern of patterns) {
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(embedHtml)) !== null) {
      if (match[1] && /^https?:\/\//i.test(match[1])) out.add(match[1]);
      if (!match[1] && match[0]) {
        const inner = [...match[0].matchAll(/https?:\/\/[^\s'"<>]+\.(?:m3u8|mp4|mpd)[^\s'"<>]*/gi)].map((m) =>
          String(m[0] || '').trim(),
        );
        for (const item of inner) out.add(item);
      }
    }
  }

  return [...out];
};

const extractDirectSourceFromEmbed = (embedHtml: string): string | undefined => {
  const candidates = extractAllDirectSourcesFromEmbed(embedHtml);
  return pickBestDirectSource(candidates);
};

const extractDecodeUrls = (payload: any): string[] => {
  const out = new Set<string>();
  const queue = [payload];
  while (queue.length) {
    const item = queue.shift();
    if (!item) continue;
    if (typeof item === 'string') {
      const text = String(item);
      const matches = [...text.matchAll(/https?:\/\/[^\s'"<>]+\.(?:m3u8|mp4|mpd)[^\s'"<>]*/gi)];
      for (const m of matches) out.add(String(m[0] || '').trim());
      continue;
    }
    if (Array.isArray(item)) {
      queue.push(...item);
      continue;
    }
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const keys = ['url', 'file', 'src', 'stream', 'source', 'link'];
      for (const key of keys) {
        const val = record[key];
        if (typeof val === 'string' && /^https?:\/\//i.test(val) && /\.(m3u8|mp4|mpd)(\?|$)/i.test(val)) {
          out.add(val);
        }
      }
      for (const value of Object.values(record)) queue.push(value);
    }
  }
  return [...out];
};

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  const dramacool = configureProvider(new MOVIES.DramaCool());
  const dramacoolAny = dramacool as any;

  const primaryBase = process.env.DRAMACOOL_BASE_URL || 'https://dramacool9.com.ro';
  const fallbackBase = process.env.DRAMACOOL_FALLBACK_BASE_URL || 'https://dramacool.bg';
  const decodePrimary = process.env.DECODE_BASE_URL || 'https://dec.eatmynerds.live';
  const decodeFallback = process.env.DECODE_FALLBACK_BASE_URL || 'https://dec2.eatmynerds.live';

  let resolvedBase: string | undefined;
  let useWpMode = false;

  const applyBase = (base: string) => {
    dramacoolAny.baseUrl = base;
    if (dramacool.toString) {
      dramacool.toString.baseUrl = base;
    }
  };

  applyBase(primaryBase);

  const isWpApiCompatible = async (base: string): Promise<boolean> => {
    try {
      const res = await dramacoolAny.client?.get?.(`${base.replace(/\/$/, '')}/wp-json/`);
      return Boolean(res?.data?.routes?.['/wp/v2/search']);
    } catch {
      return false;
    }
  };

  const isLegacyCompatible = async (base: string): Promise<boolean> => {
    try {
      const res = await dramacoolAny.client?.get?.(base);
      const body = String(res?.data || '').toLowerCase();
      return (
        body.includes('list-episode-item') ||
        body.includes('anime_muti_link') ||
        body.includes('linkserver')
      );
    } catch {
      return false;
    }
  };

  const ensureCompatibleBase = async () => {
    if (resolvedBase) return;

    const primaryWp = await isWpApiCompatible(primaryBase);
    if (primaryWp) {
      resolvedBase = primaryBase;
      useWpMode = true;
      applyBase(primaryBase);
      return;
    }

    if (await isLegacyCompatible(primaryBase)) {
      resolvedBase = primaryBase;
      useWpMode = false;
      applyBase(primaryBase);
      return;
    }

    const fallbackWp = await isWpApiCompatible(fallbackBase);
    if (fallbackWp) {
      resolvedBase = fallbackBase;
      useWpMode = true;
      applyBase(fallbackBase);
      return;
    }

    resolvedBase = fallbackBase;
    useWpMode = false;
    applyBase(fallbackBase);
  };

  const fetchWpSearchResults = async (query: string, page = 1) => {
    await ensureCompatibleBase();
    const base = resolvedBase || primaryBase;
    const endpoint = `${base.replace(/\/$/, '')}/wp-json/wp/v2/search?search=${encodeURIComponent(query)}&per_page=20&page=${page}`;
    const response = await dramacoolAny.client.get(endpoint);

    const raw = Array.isArray(response?.data) ? response.data : [];
    const results = raw
      .filter((item: any) => item && item.subtype === 'drama' && typeof item.url === 'string')
      .map((item: any) => ({
        id: extractSlugFromUrl(item.url),
        title: String(item.title || '').replace(/&#8217;/g, "'"),
        url: item.url,
        image: undefined,
      }));

    const totalPages = Number(response?.headers?.['x-wp-totalpages'] || page);

    return {
      currentPage: page,
      hasNextPage: Number.isFinite(totalPages) ? page < totalPages : false,
      totalPages: Number.isFinite(totalPages) ? totalPages : page,
      results,
    };
  };

  const getPostSitemapUrls = async (base: string): Promise<string[]> => {
    if (sitemapCache && Date.now() - sitemapCache.fetchedAt < WP_SITEMAP_CACHE_TTL_MS) {
      return sitemapCache.urls;
    }

    const sitemapIndexUrl = `${base.replace(/\/$/, '')}/sitemap_index.xml`;
    const sitemapIndex = String((await dramacoolAny.client.get(sitemapIndexUrl)).data || '');
    const urls = parseLocsFromXml(sitemapIndex).filter((url) => /\/post-sitemap\d*\.xml$/i.test(url));

    sitemapCache = {
      fetchedAt: Date.now(),
      urls,
    };

    return urls;
  };

  const fetchEpisodesFromSitemaps = async (base: string, dramaSlug: string): Promise<EpisodeEntry[]> => {
    const cached = dramaEpisodesCache.get(dramaSlug);
    if (cached && Date.now() - cached.fetchedAt < WP_SITEMAP_CACHE_TTL_MS) {
      return cached.episodes;
    }

    const sitemapUrls = await getPostSitemapUrls(base);
    const variants = buildDramaSlugVariants(dramaSlug);
    const set = new Set<string>();

    for (const sitemapUrl of sitemapUrls) {
      try {
        const xml = String((await dramacoolAny.client.get(sitemapUrl)).data || '');
        const locs = parseLocsFromXml(xml);
        for (const loc of locs) {
          const lower = loc.toLowerCase();
          const locSlug = extractSlugFromUrl(lower);
          const isEpisode = /(?:^|-)episode-\d+/i.test(locSlug);
          const matched = variants.some((variant) => locSlug.startsWith(`${variant}-episode-`));
          const looseMatched = variants.some((variant) => locSlug.includes(`${variant}-`));
          if (lower.endsWith('.html') && isEpisode && (matched || looseMatched)) {
            set.add(loc);
          }
        }
      } catch {
        continue;
      }
    }

    const episodes = [...set]
      .map((url) => {
        const slug = extractSlugFromUrl(url);
        const episode = parseEpisodeNumber(slug);
        const prettyTitle = slug
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (m) => m.toUpperCase());

        return {
          id: url,
          title: prettyTitle,
          url,
          episode,
        } satisfies EpisodeEntry;
      })
      .sort((a, b) => (a.episode || 0) - (b.episode || 0));

    dramaEpisodesCache.set(dramaSlug, {
      fetchedAt: Date.now(),
      episodes,
    });

    return episodes;
  };

  const fetchWpDramaInfo = async (id: string) => {
    await ensureCompatibleBase();
    const base = resolvedBase || primaryBase;
    const url = toAbsoluteUrl(base, id);

    const html = String((await dramacoolAny.client.get(url)).data || '');
    const $ = load(html);

    const title =
      normalizeText($('h1').first().text()) ||
      normalizeText($('title').first().text().replace(/\s*English.*$/i, '')) ||
      extractSlugFromUrl(url).replace(/-/g, ' ');

    const image =
      $('meta[property="og:image"]').attr('content') ||
      $('.drama-cover img').attr('src') ||
      $('img').first().attr('src') ||
      undefined;

    const description =
      normalizeText($('meta[name="description"]').attr('content') || '') ||
      normalizeText($('.text_above_player p').first().text()) ||
      normalizeText($('.description').first().text()) ||
      undefined;

    // Extract release date from various possible locations
    let releaseDate: string | undefined;
    const dateSelectors = [
      '.drama-info .year',
      '.drama-details .year',
      '.info .year',
      '.release-date',
      '.date',
      '.air-date',
      '.premiere-date',
      '[class*="release"]',
      '[class*="date"]',
      '[class*="year"]',
      '.drama-info span',
      '.drama-details span',
      '.info span',
      'meta[name="date"]',
      'meta[property="article:published_time"]',
    ];

    for (const selector of dateSelectors) {
      const dateText = normalizeText($(selector).first().text() || $(selector).attr('content') || '');
      if (dateText) {
        // Try to extract year from text like "2023" or "2023-2024" or "January 15, 2023"
        const yearMatch = dateText.match(/\b(20\d{2})\b/);
        if (yearMatch) {
          releaseDate = yearMatch[1];
          break;
        }
      }
    }

    // Extract rating from various possible locations
    let rating: number | undefined;
    const ratingSelectors = [
      '.rating',
      '.score',
      '.imdb-rating',
      '.user-rating',
      '.star-rating',
      '[class*="rating"]',
      '[class*="score"]',
      '.drama-info .rating',
      '.drama-details .rating',
      '.info .rating',
      '.rating-value',
      '.score-value',
      'span[class*="rating"]',
      'div[class*="rating"]',
    ];

    for (const selector of ratingSelectors) {
      const ratingText = normalizeText($(selector).first().text());
      if (ratingText) {
        // Try to extract rating like "8.5" or "8.5/10" or "8.5 out of 10"
        const ratingMatch = ratingText.match(/(\d+(?:\.\d+)?)/);
        if (ratingMatch) {
          const parsedRating = parseFloat(ratingMatch[1]);
          if (parsedRating >= 0 && parsedRating <= 10) {
            rating = parsedRating;
            break;
          }
        }
      }
    }

    const dramaSlug = extractSlugFromUrl(url);
    const episodes = await fetchEpisodesFromSitemaps(base, dramaSlug);

    return {
      id: dramaSlug,
      title,
      url,
      image,
      description,
      type: 'TV Series',
      releaseDate,
      rating,
      episodes,
    };
  };

  const selectServerUrl = (urls: string[], server?: StreamingServers): string | undefined => {
    if (!urls.length) return undefined;
    if (!server) return urls[0];

    const desired = String(server).toLowerCase();
    const exact = urls.find((u) => u.toLowerCase().includes(desired));
    if (exact) return exact;

    const hostHints: Record<string, string[]> = {
      vidmoly: ['vidmoly'],
      mixdrop: ['mixdrop'],
      streamwish: ['streamwish', 'wish'],
      streamtape: ['streamtape'],
      asianload: ['asian', 'asianload'],
    };

    const hints = hostHints[desired] || [desired];
    for (const hint of hints) {
      const match = urls.find((u) => u.toLowerCase().includes(hint));
      if (match) return match;
    }

    return urls[0];
  };

const extractEmbedUrls = (html: string): string[] => {
  const out = new Set<string>();
  const patterns = [
    /<(?:iframe|source|video)[^>]+(?:src|data-src)=["']([^"']+)["']/gi,
    /["'](?:src|file|url)["']\s*:\s*["'](https?:\/\/[^"']+)["']/gi,
    /(https?:\/\/[^\s"'<>]+(?:embed|player|stream|video)[^\s"'<>]*)/gi,
  ];

  for (const regex of patterns) {
    let match: RegExpExecArray | null = null;
    while ((match = regex.exec(html)) !== null) {
      const url = String(match[1] || '').trim();
      if (/^https?:\/\//i.test(url)) out.add(url);
    }
  }
  return [...out];
};

  const fetchWpEpisodeSource = async (episodeId: string, server?: StreamingServers) => {
    await ensureCompatibleBase();
    const base = resolvedBase || primaryBase;
    const episodeUrl = toAbsoluteUrl(base, episodeId);

    const pageHtml = String((await dramacoolAny.client.get(episodeUrl)).data || '');
    const $ = load(pageHtml);

    const embedCandidates = new Set<string>();
    
    // Try multiple selectors for video iframe/embed
    const iframeSelectors = [
      '#video-frame',
      '#player-frame',
      '#embed-frame',
      '.video-frame iframe',
      '.player iframe',
      '.embed iframe',
      'iframe[src*="embed"]',
      'iframe[src*="player"]',
      'iframe[src*="video"]',
    ];
    
    for (const selector of iframeSelectors) {
      const iframe = $(selector).first();
      if (iframe.length) {
        const src = iframe.attr('src') || iframe.attr('data-src');
        if (src) {
          embedCandidates.add(toAbsoluteUrl(base, src));
          break; // Use the first one found
        }
      }
    }
    
    // Also check for data-src attributes
    $('[data-src]').each((_, el) => {
      const dataSrc = $(el).attr('data-src');
      if (dataSrc && /^https?:\/\//i.test(dataSrc) && (dataSrc.includes('embed') || dataSrc.includes('player') || dataSrc.includes('video'))) {
        embedCandidates.add(dataSrc);
      }
    });

    const embedList = [...embedCandidates];
    const selectedEmbed = selectServerUrl(embedList, server);
    if (!selectedEmbed) {
      throw new Error('No embed source found for this episode.');
    }
    const orderedEmbeds = [
      selectedEmbed,
      ...embedList.filter((url) => url !== selectedEmbed),
    ];

    const tryDecodeService = async (
      targetUrl: string,
      referer: string,
    ): Promise<string | undefined> => {
      const decoderBases = [decodePrimary, decodeFallback].filter(Boolean);
      const endpointBuilders = [
        (base: string) => `${base.replace(/\/$/, '')}/extract?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}`,
        (base: string) => `${base.replace(/\/$/, '')}/decode?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}`,
        (base: string) => `${base.replace(/\/$/, '')}/?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}`,
      ];

      for (const decoderBase of decoderBases) {
        for (const build of endpointBuilders) {
          const endpoint = build(decoderBase);
          try {
            const res = await dramacoolAny.client.get(endpoint);
            const urls = extractDecodeUrls(res?.data);
            const best = pickBestDirectSource(urls);
            if (best) return best;
          } catch {
            continue;
          }
        }
      }

      return undefined;
    };

    const probeEmbedForStream = async (
      startUrl: string,
      initialReferer: string,
    ): Promise<{ directUrl?: string; subtitles: Array<{ url: string; lang: string }>; finalEmbedUrl: string }> => {
      const queue: Array<{ url: string; referer: string; depth: number }> = [
        { url: startUrl, referer: initialReferer, depth: 0 },
      ];
      const seen = new Set<string>();
      const subtitles: Array<{ url: string; lang: string }> = [];
      let finalEmbedUrl = startUrl;

      while (queue.length) {
        const current = queue.shift()!;
        if (seen.has(current.url) || current.depth > 3) continue;
        seen.add(current.url);
        finalEmbedUrl = current.url;

        let embedHtml = '';
        try {
          embedHtml = String(
            (
              await dramacoolAny.client.get(current.url, {
                headers: { Referer: current.referer },
              })
            ).data || '',
          );
        } catch {
          continue;
        }

        subtitles.push(...extractSubtitleTracksFromEmbed(embedHtml, current.url));
        const directUrl = extractDirectSourceFromEmbed(embedHtml);
        if (directUrl) {
          return {
            directUrl,
            subtitles: dedupeSubtitles(subtitles),
            finalEmbedUrl: current.url,
          };
        }

        const decoded = await tryDecodeService(current.url, current.referer);
        if (decoded) {
          return {
            directUrl: decoded,
            subtitles: dedupeSubtitles(subtitles),
            finalEmbedUrl: current.url,
          };
        }

        const nextEmbeds = extractEmbedUrls(embedHtml);
        for (const next of nextEmbeds) {
          if (!seen.has(next)) {
            queue.push({ url: next, referer: current.url, depth: current.depth + 1 });
          }
        }
      }

      return { subtitles: dedupeSubtitles(subtitles), finalEmbedUrl };
    };

    let directUrl: string | undefined;
    let extractedSubtitles: Array<{ url: string; lang: string }> = [];
    let finalEmbedUrl = selectedEmbed;

    for (const candidate of orderedEmbeds) {
      const probed = await probeEmbedForStream(candidate, episodeUrl);
      if (probed.subtitles.length) {
        extractedSubtitles.push(...probed.subtitles);
      }
      if (probed.directUrl) {
        directUrl = probed.directUrl;
        finalEmbedUrl = probed.finalEmbedUrl || candidate;
        break;
      }
      finalEmbedUrl = probed.finalEmbedUrl || candidate;
    }
    extractedSubtitles = dedupeSubtitles(extractedSubtitles);

    if (directUrl) {
      const subtitles = [...extractedSubtitles];
      if (directUrl.includes('.m3u8')) {
        try {
          const manifest = String(
            (
              await dramacoolAny.client.get(directUrl, {
                headers: { Referer: finalEmbedUrl },
              })
            ).data || '',
          );
          const lines = manifest.split('\n').map((line: string) => line.trim());
          for (const line of lines) {
            if (!line.startsWith('#EXT-X-MEDIA:')) continue;
            if (!/TYPE=SUBTITLES/i.test(line)) continue;
            const attrs = parseM3u8Attributes(line);
            if (!attrs.URI) continue;
            const subtitleUrl = resolveM3u8Uri(directUrl, attrs.URI);
            const lang = attrs.LANGUAGE || attrs.NAME || 'Default';
            subtitles.push({ url: subtitleUrl, lang });
          }
        } catch {
          // keep extracted subtitles from embed page
        }
      }

      return {
        headers: { Referer: finalEmbedUrl },
        sources: [
          {
            url: directUrl,
            quality: 'auto',
            isM3U8: directUrl.includes('.m3u8'),
            isDASH: directUrl.includes('.mpd'),
          },
        ],
        subtitles: dedupeSubtitles(subtitles),
      };
    }

    return {
      headers: { Referer: finalEmbedUrl },
      sources: [
        {
          url: finalEmbedUrl,
          quality: 'auto',
          isEmbed: true,
        },
      ],
      embedURL: finalEmbedUrl,
      subtitles: extractedSubtitles,
    };
  };

  const extractDramaUrl = (episodeUrl: string): string => {
    // Convert episode URL like https://dramacool.com/drama-name-episode-1.html
    // to drama URL like https://dramacool.com/drama-name.html
    const url = new URL(episodeUrl);
    const slug = extractSlugFromUrl(episodeUrl);
    // Remove episode suffix (e.g., -episode-1, -episode-2, etc.)
    const dramaSlug = slug.replace(/-episode-\d+$/i, '');
    return `${url.origin}/${dramaSlug}.html`;
  };

  const fetchWpRecentEpisodes = async () => {
    await ensureCompatibleBase();
    const base = resolvedBase || primaryBase;
    const html = String((await dramacoolAny.client.get(base)).data || '');
    const $ = load(html);

    const results: any[] = [];
    const seen = new Set<string>();

    $('div.tab-recent-episode a[href$=".html"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const episodeUrl = toAbsoluteUrl(base, href);
      const dramaUrl = extractDramaUrl(episodeUrl);
      if (seen.has(dramaUrl)) return;
      seen.add(dramaUrl);

      const title = normalizeText($(el).attr('title') || $(el).text() || extractSlugFromUrl(dramaUrl));
      results.push({
        id: dramaUrl,
        title,
        url: dramaUrl,
      });
    });

    return {
      currentPage: 1,
      hasNextPage: false,
      results,
    };
  };

  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro: `Welcome to the dramacool provider: check out the provider's website @ ${dramacool.toString.baseUrl}`,
      routes: [
        '/:query',
        '/info',
        '/watch',
        '/popular',
        '/recent-movies',
        '/recent-shows',
      ],
      documentation: 'https://docs.consumet.org/#tag/dramacool',
    });
  });

  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureCompatibleBase();
      const query = decodeURIComponent((request.params as { query: string }).query);
      const page = (request.query as { page: number }).page || 1;

      const cacheKey = `dramacool:${useWpMode ? 'wp' : 'legacy'}:${query}:${page}`;
      const res = redis
        ? await cache.fetch(
            redis as Redis,
            cacheKey,
            async () => (useWpMode ? await fetchWpSearchResults(query, page) : await dramacool.search(query, page)),
            REDIS_TTL,
          )
        : useWpMode
          ? await fetchWpSearchResults(query, page)
          : await dramacool.search(query, page);

      reply.status(200).send(res);
    } catch (err) {
      reply.status(500).send({
        message:
          'Something went wrong. Please try again later. or contact the developers.',
      });
    }
  });

  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureCompatibleBase();
    const id = (request.query as { id: string }).id;

    if (typeof id === 'undefined')
      return reply.status(400).send({
        message: 'id is required',
      });

    try {
      const cacheKey = `dramacool:${useWpMode ? 'wp' : 'legacy'}:info:${id}`;
      const res = redis
        ? await cache.fetch(
            redis as Redis,
            cacheKey,
            async () => (useWpMode ? await fetchWpDramaInfo(id) : await dramacool.fetchMediaInfo(id)),
            REDIS_TTL,
          )
        : useWpMode
          ? await fetchWpDramaInfo(id)
          : await dramacool.fetchMediaInfo(id);

      reply.status(200).send(res);
    } catch (err) {
      reply.status(500).send({
        message:
          'Something went wrong. Please try again later. or contact the developers.',
      });
    }
  });

  fastify.get('/watch', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureCompatibleBase();
    const episodeId = (request.query as { episodeId: string }).episodeId;
    const server = (request.query as { server: StreamingServers }).server;
    const directOnlyRaw = String((request.query as { directOnly?: string }).directOnly || '').toLowerCase();
    const directOnly = directOnlyRaw === '1' || directOnlyRaw === 'true' || directOnlyRaw === 'yes';
    const fastStartRaw = String((request.query as { fastStart?: string }).fastStart || 'true')
      .toLowerCase()
      .trim();
    const fastStart = fastStartRaw !== '0' && fastStartRaw !== 'false' && fastStartRaw !== 'no';

    if (typeof episodeId === 'undefined')
      return reply.status(400).send({ message: 'episodeId is required' });

    try {
      const cacheKey = `dramacool:${useWpMode ? 'wp' : 'legacy'}:watch:${episodeId}:${server}:direct:${directOnly}`;

      const res = redis
        ? await cache.fetch(
            redis as Redis,
            cacheKey,
            async () => {
              if (useWpMode) {
                const wpRes = await fetchWpEpisodeSource(episodeId, server);
                if (directOnly && !hasDirectPlayableSource(wpRes)) {
                  throw new Error('No direct playable stream found for dramacool (embed-only sources were skipped).');
                }
                return wpRes;
              }
              return await fetchWithServerFallback(
                async (selectedServer) =>
                  await dramacool.fetchEpisodeSources(episodeId, selectedServer),
                server,
                MOVIE_SERVER_FALLBACKS,
                { requireDirectPlayable: directOnly },
              );
            },
            REDIS_TTL,
          )
        : useWpMode
          ? await (async () => {
              const wpRes = await fetchWpEpisodeSource(episodeId, server);
              if (directOnly && !hasDirectPlayableSource(wpRes)) {
                throw new Error('No direct playable stream found for dramacool (embed-only sources were skipped).');
              }
              return wpRes;
            })()
          : await fetchWithServerFallback(
              async (selectedServer) =>
                await dramacool.fetchEpisodeSources(episodeId, selectedServer),
              server,
              MOVIE_SERVER_FALLBACKS,
              { requireDirectPlayable: directOnly },
            );

      if (Array.isArray((res as any)?.sources)) {
        (res as any).sources = sortAndLimitSources((res as any).sources, fastStart);
      }
      reply.status(200).send(res);
    } catch (err: any) {
      if (!useWpMode && !directOnly) {
        try {
          const fallback = await getMovieEmbedFallbackSource(
            dramacool as any,
            episodeId,
            undefined,
            server,
          );
          if (fallback) {
            if (Array.isArray((fallback as any)?.sources)) {
              (fallback as any).sources = sortAndLimitSources((fallback as any).sources, fastStart);
            }
            return reply.status(200).send(fallback);
          }
        } catch {
          // Ignore fallback errors and return the original extraction error below.
        }
      }

      const message = err instanceof Error ? err.message : String(err);
      reply.status(404).send({ message });
    }
  });

  fastify.get('/popular', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureCompatibleBase();
    const page = (request.query as { page: number }).page;
    try {
      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `dramacool:${useWpMode ? 'wp' : 'legacy'}:popular:${page}`,
            async () =>
              useWpMode
                ? await fetchWpRecentEpisodes()
                : await dramacool.fetchPopular(page ? page : 1),
            REDIS_TTL,
          )
        : useWpMode
          ? await fetchWpRecentEpisodes()
          : await dramacool.fetchPopular(page ? page : 1);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Please try again later.' });
    }
  });

  fastify.get('/recent-movies', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureCompatibleBase();
    const page = (request.query as { page: number }).page;
    try {
      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `dramacool:${useWpMode ? 'wp' : 'legacy'}:recent-movies:${page}`,
            async () =>
              useWpMode
                ? await fetchWpRecentEpisodes()
                : await dramacool.fetchRecentMovies(page ? page : 1),
            REDIS_TTL,
          )
        : useWpMode
          ? await fetchWpRecentEpisodes()
          : await dramacool.fetchRecentMovies(page ? page : 1);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Please try again later.' });
    }
  });

  fastify.get('/recent-shows', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureCompatibleBase();
    const page = (request.query as { page: number }).page;
    try {
      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `dramacool:${useWpMode ? 'wp' : 'legacy'}:recent-shows:${page}`,
            async () =>
              useWpMode
                ? await fetchWpRecentEpisodes()
                : await dramacool.fetchRecentTvShows(page ? page : 1),
            REDIS_TTL,
          )
        : useWpMode
          ? await fetchWpRecentEpisodes()
          : await dramacool.fetchRecentTvShows(page ? page : 1);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Please try again later.' });
    }
  });
};

export default routes;
