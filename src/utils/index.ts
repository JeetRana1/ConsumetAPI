import { FastifyInstance, RegisterOptions } from 'fastify';
import axios from 'axios';
import { getProxyCandidates, toAxiosProxyOptions } from './outboundProxy';

import Providers from './providers';
import * as cheerio from 'cheerio';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  await fastify.register(new Providers().getProviders);

  const normalizeTitleForMatch = (v: any): string =>
    String(v || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\(([^)]*)\)/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const toArrayPayload = (payload: any): any[] => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.results)) return payload.results;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  };

  const pickBestSearchResult = (title: string, results: any[]): any | null => {
    const norm = normalizeTitleForMatch(title);
    if (!norm) return null;
    const titleTokens = new Set(norm.split(' ').filter(Boolean));
    let best: { score: number; item: any | null } = { score: 0, item: null };

    for (const item of results || []) {
      const name = String(
        item?.title || item?.name || item?.title_english || item?.titleEnglish || item?.japanese_title || '',
      ).trim();
      const itemNorm = normalizeTitleForMatch(name);
      if (!itemNorm) continue;
      let score = 0;
      if (itemNorm === norm) score += 120;
      if (itemNorm.includes(norm) || norm.includes(itemNorm)) score += 30;
      const tokens = itemNorm.split(' ').filter(Boolean);
      let overlap = 0;
      tokens.forEach((t) => {
        if (titleTokens.has(t)) overlap += 1;
      });
      score += overlap * 8;
      if (score > best.score) best = { score, item };
    }
    return best.score > 0 ? best.item : null;
  };

  const parseStatusFromEpisode = (ep: any): 'manga' | 'mixed' | 'filler' | null => {
    const boolFiller = ep?.isFiller === true || ep?.filler === true;
    const boolMixed = ep?.isMixed === true || ep?.mixed === true;
    const boolCanon =
      ep?.isMangaCanon === true ||
      ep?.isCanon === true ||
      ep?.mangaCanon === true ||
      ep?.canon === true;

    const text = normalizeTitleForMatch(
      `${ep?.title || ''} ${ep?.description || ''} ${ep?.type || ''} ${ep?.category || ''}`,
    );
    const textFiller = text.includes('filler');
    const textMixed = text.includes('mixed canon filler') || text.includes('mixed canon');
    const textCanon = text.includes('manga canon') || text.includes('canon');

    if (boolFiller || textFiller) return 'filler';
    if (boolMixed || textMixed) return 'mixed';
    if (boolCanon || textCanon) return 'manga';
    return null;
  };

  const buildEpisodeStatusMap = (infoPayload: any): Record<string, 'manga' | 'mixed' | 'filler'> => {
    const map: Record<string, 'manga' | 'mixed' | 'filler'> = {};
    const episodes = toArrayPayload(infoPayload?.episodes ? infoPayload.episodes : infoPayload);
    episodes.forEach((ep, idx) => {
      const epNo = Number(ep?.number || ep?.episodeNumber || ep?.episode || idx + 1);
      if (!Number.isFinite(epNo) || epNo <= 0) return;
      const status = parseStatusFromEpisode(ep);
      if (!status) return;
      map[String(epNo)] = status;
    });
    return map;
  };

  const fetchFillerFromMetaProvider = async (provider: 'mal' | 'anilist', title: string) => {
    try {
      const searchRes = await fastify.inject({
        method: 'GET',
        url: `/meta/${provider}/${encodeURIComponent(title)}?page=1`,
      });
      if (searchRes.statusCode >= 400) return { provider, id: null, episodes: {} as Record<string, any> };
      const searchPayload = JSON.parse(searchRes.body || '{}');
      const best = pickBestSearchResult(title, toArrayPayload(searchPayload));
      const contentId = best?.id || best?.anilistId || best?.malId || best?._id;
      if (!contentId) return { provider, id: null, episodes: {} as Record<string, any> };

      const infoRes = await fastify.inject({
        method: 'GET',
        url: `/meta/${provider}/info/${encodeURIComponent(String(contentId))}?fetchFiller=true`,
      });
      if (infoRes.statusCode >= 400) return { provider, id: contentId, episodes: {} as Record<string, any> };
      const infoPayload = JSON.parse(infoRes.body || '{}');
      return {
        provider,
        id: contentId,
        episodes: buildEpisodeStatusMap(infoPayload),
      };
    } catch {
      return { provider, id: null, episodes: {} as Record<string, any> };
    }
  };

  let aflIndexCache: { name: string; slug: string; norm: string }[] | null = null;

  const fetchFillerFromAFL = async (title: string): Promise<{ id: string | null; episodes: Record<string, 'manga' | 'mixed' | 'filler'> }> => {
    try {
      const buildSlugCandidates = (t: string) => {
        const raw = normalizeTitleForMatch(t);
        if (!raw) return [];
        const cleaned = raw
          .replace(/\b(tv|season|part|cour|movie|ona|ova)\b/g, ' ')
          .replace(/[^\w\s-]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const tokens = cleaned.split(' ').filter(Boolean);
        if (!tokens.length) return [];
        return [
          tokens.join('-'),
          tokens.slice(0, 3).join('-'),
          tokens.slice(0, 2).join('-')
        ];
      };

      const slugCandidates = [...new Set(buildSlugCandidates(title))];
      if (!slugCandidates.length) return { id: null, episodes: {} };

      if (!aflIndexCache) {
        try {
          const { data } = await axios.get('https://www.animefillerlist.com/shows', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/121.0.0.0 Safari/537.36' },
            timeout: 10000,
          });
          const $ = cheerio.load(data);
          const entries: { name: string; slug: string; norm: string }[] = [];
          $('#ShowList .Group li a').each((_, el) => {
            const name = $(el).text().trim();
            const href = $(el).attr('href') || '';
            const slug = href.split('/').pop() || '';
            if (name && slug) {
              entries.push({ name, slug, norm: normalizeTitleForMatch(name) });
            }
          });
          if (entries.length > 0) aflIndexCache = entries;
        } catch { }
      }

      if (aflIndexCache && aflIndexCache.length > 0) {
        const titleTokens = new Set(normalizeTitleForMatch(title).split(' ').filter(Boolean));
        let best = { score: 0, slug: '' };
        for (const entry of aflIndexCache) {
          const entryNorm = entry.norm;
          let score = 0;
          if (entryNorm === normalizeTitleForMatch(title)) score += 100;
          if (entryNorm.includes(normalizeTitleForMatch(title)) || normalizeTitleForMatch(title).includes(entryNorm)) score += 35;
          const entryTokens = entryNorm.split(' ').filter(Boolean);
          let overlap = 0;
          entryTokens.forEach(t => { if (titleTokens.has(t)) overlap += 1; });
          score += overlap * 8;
          if (score > best.score) best = { score, slug: entry.slug };
        }
        if (best.score >= 16 && best.slug) {
          slugCandidates.unshift(best.slug);
        }
      }

      const uniqueSlugs = [...new Set(slugCandidates.filter(Boolean))];

      for (const slug of uniqueSlugs) {
        try {
          const { data } = await axios.get(`https://www.animefillerlist.com/shows/${slug}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/121.0.0.0 Safari/537.36' },
            timeout: 8000,
          });
          const $ = cheerio.load(data);
          const episodes: Record<string, 'manga' | 'mixed' | 'filler'> = {};
          let found = false;
          $('table.EpisodeList tbody tr').each((_, el) => {
            const epNumStr = $(el).find('td.Number').text().trim();
            const epNum = parseInt(epNumStr, 10);
            if (isNaN(epNum)) return;
            found = true;
            const typeStr = $(el).find('td.Type').text().trim().toLowerCase();
            let status: 'manga' | 'mixed' | 'filler' = 'manga';
            if (typeStr.includes('filler')) {
              if (typeStr.includes('mixed') || typeStr.includes('mostly')) status = 'mixed';
              else status = 'filler';
            } else if (typeStr.includes('canon')) {
              status = 'manga';
            }
            episodes[epNum] = status;
          });

          if (found) {
            return { id: slug, episodes };
          }
        } catch { }
      }
    } catch { }
    return { id: null, episodes: {} };
  };

  // Handle audio track requests - return minimal valid m3u8 with dummy segment to prevent HLS errors
  // The segment URL points to a valid location but will return empty content
  const dummySegmentUrl = 'data:application/octet-stream;';

  // Direct routes
  fastify.get('/audio_tam/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/audio_hin/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/audio_tel/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/audio_mal/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/audio_ben/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/audio_eng/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/audio_jpn/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  // Routes under /utils/ for proxied audio tracks
  fastify.get('/utils/audio_tam/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/utils/audio_hin/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/utils/audio_tel/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/utils/audio_mal/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/utils/audio_ben/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/utils/audio_eng/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/utils/audio_jpn/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });

  fastify.get('/proxy', async (request: any, reply: any) => {
    const url = String(request.query?.url || '');
    const referer = String(request.query?.referer || '');
    const incomingRange = String(request.headers?.range || '');
    if (!url) return reply.status(400).send({ message: 'url is required' });

    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return reply.status(400).send({ message: 'invalid url' });
    }

    if (!['http:', 'https:'].includes(target.protocol)) {
      return reply.status(400).send({ message: 'invalid protocol' });
    }

    try {
      const pathLower = target.pathname.toLowerCase();
      const queryLower = target.search.toLowerCase();
      const looksLikeM3u8 =
        pathLower.endsWith('.m3u8') ||
        pathLower.includes('playlist') ||
        queryLower.includes('.m3u8');

      const refererForRequest = referer || `${target.protocol}//${target.host}/`;
      const baseRequestConfig = {
        responseType: looksLikeM3u8 ? 'arraybuffer' : 'stream',
        timeout: looksLikeM3u8 ? 60000 : 90000,
        headers: {
          Referer: refererForRequest,
          Origin: (() => {
            try {
              const u = new URL(refererForRequest);
              return `${u.protocol}//${u.host}`;
            } catch {
              return `${target.protocol}//${target.host}`;
            }
          })(),
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          ...(incomingRange ? { Range: incomingRange } : {}),
        },
        maxRedirects: 5,
        validateStatus: () => true as const,
      };

      const proxyCandidates = await getProxyCandidates();
      const chain = [undefined, ...proxyCandidates];
      const fetchWithChain = async (targetUrl: string, requestConfig: any) => {
        let response: any = null;
        let lastErr: any = null;
        const host = (() => {
          try {
            return new URL(targetUrl).hostname.toLowerCase();
          } catch {
            return '';
          }
        })();
        const forceDirectOnly =
          /(^|\.)net20\.cc$/.test(host) || /(^|\.)nm-cdn\d+\.top$/.test(host);
        const effectiveChain = forceDirectOnly ? [undefined] : chain;

        for (const proxyUrl of effectiveChain) {
          try {
            const proxyOptions = toAxiosProxyOptions(proxyUrl);
            response = await axios.get(targetUrl, {
              // Prevent implicit HTTP(S)_PROXY env usage on direct attempts.
              proxy: false,
              ...requestConfig,
              ...proxyOptions,
            } as any);
            return response;
          } catch (err: any) {
            lastErr = err;
            continue;
          }
        }
        throw lastErr || new Error('proxy failed');
      };

      const upstream = await fetchWithChain(target.toString(), baseRequestConfig);

      if (upstream.status >= 400) {
        return reply.status(upstream.status).send({
          message: `upstream error ${upstream.status}`,
        });
      }

      const contentType = String(upstream.headers['content-type'] || '');
      const isM3u8 =
        looksLikeM3u8 ||
        contentType.includes('mpegurl') ||
        contentType.includes('application/x-mpegurl');

      if (isM3u8) {
        const raw = Buffer.from(upstream.data).toString('utf8');
        const base = target.toString();

        const normalizeManifestUri = (candidate: string) => {
          let c = String(candidate || '').trim();
          if (!c) return c;
          // Some providers emit malformed "https:///files/..." URIs.
          if (/^https?:\/\/\/+/i.test(c)) {
            c = c.replace(/^https?:\/\/\/+/i, '/');
          }
          // If parser produced "https://files/..." from malformed inputs, treat it as path.
          if (/^https?:\/\/files\//i.test(c)) {
            const u = new URL(c);
            c = `/files${u.pathname}`;
            if (u.search) c += u.search;
          }
          return c;
        };

        const rewriteUri = (candidate: string) => {
          try {
            const normalized = normalizeManifestUri(candidate);
            const abs = new URL(normalized, base).toString();
            const childReferer = referer || `${target.protocol}//${target.host}/`;
            const refererQuery = `&referer=${encodeURIComponent(childReferer)}`;
            return `/utils/proxy?url=${encodeURIComponent(abs)}${refererQuery}`;
          } catch {
            return candidate;
          }
        };

        const isMasterManifest = raw.includes('#EXT-X-STREAM-INF');
        const isNet20Manifest = /(\.|^)net20\.cc$/i.test(target.hostname || '');
        const lines = raw.split('\n');

        const reachabilityCache = new Map<string, boolean>();
        const isUriReachable = async (candidate: string): Promise<boolean> => {
          try {
            const normalized = normalizeManifestUri(candidate);
            const abs = new URL(normalized, base).toString();
            if (reachabilityCache.has(abs)) return reachabilityCache.get(abs) as boolean;

            const probeTarget = new URL(abs);
            const probeReferer = referer || `${target.protocol}//${target.host}/`;
            const probeConfig = {
              responseType: 'arraybuffer',
              timeout: 7000,
              headers: {
                Referer: probeReferer,
                Origin: `${new URL(probeReferer).protocol}//${new URL(probeReferer).host}`,
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              },
              maxRedirects: 3,
              validateStatus: () => true as const,
            };

            const probe = await fetchWithChain(probeTarget.toString(), probeConfig);
            const ok = Number(probe?.status || 0) >= 200 && Number(probe?.status || 0) < 400;
            reachabilityCache.set(abs, ok);
            return ok;
          } catch {
            return false;
          }
        };

        let filteredLines = [...lines];
        const shouldFilterMasterVariants = !isNet20Manifest;
        if (isMasterManifest && shouldFilterMasterVariants) {
          const droppedLines = new Set<number>();
          let keptVariantCount = 0;
          let totalVariantCount = 0;

          for (let i = 0; i < lines.length; i++) {
            if (droppedLines.has(i)) continue;
            const trimmed = String(lines[i] || '').trim();
            if (!trimmed) continue;

            if (trimmed.startsWith('#EXT-X-MEDIA:') && trimmed.includes('URI="')) {
              const match = /URI="([^"]+)"/.exec(trimmed);
              if (match?.[1]) {
                const ok = await isUriReachable(match[1]);
                if (!ok) droppedLines.add(i);
              }
              continue;
            }

            if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
              totalVariantCount += 1;
              let j = i + 1;
              while (j < lines.length && !String(lines[j] || '').trim()) j++;
              if (j >= lines.length) continue;
              const next = String(lines[j] || '').trim();
              if (!next || next.startsWith('#')) continue;

              const ok = await isUriReachable(next);
              if (!ok) {
                droppedLines.add(i);
                droppedLines.add(j);
              } else {
                keptVariantCount += 1;
              }
            }
          }

          if (totalVariantCount > 0 && keptVariantCount === 0) {
            return reply.status(502).send({ message: 'no live variants in master manifest' });
          }

          if (keptVariantCount > 0) {
            filteredLines = lines.filter((_, idx) => !droppedLines.has(idx));
          }
        }

        // Rewrite all URIs in the manifest, including audio tracks
        const rewritten = filteredLines
          .map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;
            if (trimmed.startsWith('#EXT-X-MEDIA:') && trimmed.includes('URI="')) {
              return line.replace(/URI="([^"]+)"/, (_m, uri) => `URI="${rewriteUri(uri)}"`);
            }
            if (trimmed.startsWith('#EXT-X-KEY') && trimmed.includes('URI="')) {
              return line.replace(/URI="([^"]+)"/, (_m, uri) => `URI="${rewriteUri(uri)}"`);
            }
            if (trimmed.startsWith('#')) return line;
            return rewriteUri(trimmed);
          })
          .join('\n');

        return reply
          .header('Content-Type', 'application/vnd.apple.mpegurl')
          .send(rewritten);
      }

      const statusCode = Number(upstream.status) || 200;
      if (statusCode === 206) {
        reply.status(206);
      }

      const passHeaders = [
        'accept-ranges',
        'content-range',
        'content-length',
        'cache-control',
        'etag',
        'last-modified',
      ];
      for (const h of passHeaders) {
        const v = upstream.headers?.[h];
        if (v != null) reply.header(h, String(v));
      }

      if (!isM3u8 && upstream.data && typeof (upstream.data as any).pipe === 'function') {
        return reply
          .header('Content-Type', contentType || 'application/octet-stream')
          .send(upstream.data);
      }

      return reply
        .header('Content-Type', contentType || 'application/octet-stream')
        .send(Buffer.from(upstream.data));
    } catch (err: any) {
      return reply.status(502).send({ message: err?.message || 'proxy failed' });
    }
  });

  fastify.get('/filler', async (request: any, reply: any) => {
    const title = String(request.query?.title || '').trim();
    if (!title) return reply.status(400).send({ message: 'title is required' });

    const mal = await fetchFillerFromMetaProvider('mal', title);
    if (Object.keys(mal.episodes).length > 0) {
      return reply.status(200).send({
        title,
        source: 'meta-mal',
        providerId: mal.id,
        episodes: mal.episodes,
      });
    }

    const anilist = await fetchFillerFromMetaProvider('anilist', title);
    if (Object.keys(anilist.episodes).length > 0) {
      return reply.status(200).send({
        title,
        source: 'meta-anilist',
        providerId: anilist.id,
        episodes: anilist.episodes,
      });
    }

    const afl = await fetchFillerFromAFL(title);
    if (Object.keys(afl.episodes).length > 0) {
      return reply.status(200).send({
        title,
        source: 'animefillerlist',
        providerId: afl.id,
        episodes: afl.episodes,
      });
    }

    return reply.status(200).send({
      title,
      source: 'none',
      episodes: {},
    });
  });

  fastify.get('/', async (request: any, reply: any) => {
    reply.status(200).send('Welcome to Consumet Utils!');
  });
};

export default routes;
