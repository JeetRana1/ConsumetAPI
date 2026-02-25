import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { ANIME } from '@consumet/extensions';
import { StreamingServers, SubOrSub } from '@consumet/extensions/dist/models';
import axios from 'axios';
import { load as loadHtml } from 'cheerio';

import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { Redis } from 'ioredis';
import { fetchWithServerFallback } from '../../utils/streamable';
import { configureProvider } from '../../utils/provider';
import { extractDirectSourcesWithPlaywright } from '../../utils/browserRuntimeExtractor';
import { proxyGet } from '../../utils/outboundProxy';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HIANIME_BASE_URLS = ['https://hianime.to', 'https://hianime.sx', 'https://9animetv.to'];
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const WATCH_ATTEMPT_TIMEOUT_MS = IS_PRODUCTION ? 8000 : 12000;
const EMBED_CHECK_TIMEOUT_MS = IS_PRODUCTION ? 8000 : 10000;
const SERVER_HTML_TIMEOUT_MS = IS_PRODUCTION ? 9000 : 12000;
const EMBED_EXTRACT_TIMEOUT_MS = IS_PRODUCTION ? 7000 : 9000;
const BROWSER_SUBTITLE_TIMEOUT_MS = IS_PRODUCTION ? 9000 : 13000;

const serverIdMap: Record<string, string> = {
  [StreamingServers.VidCloud]: '1',
  [StreamingServers.VidStreaming]: '4',
  [StreamingServers.StreamSB]: '5',
  [StreamingServers.StreamTape]: '3',
};

const getEpisodeNumberFromId = (episodeId: string) => {
  const after = episodeId.split('$episode$')[1] || '';
  return after.split('$')[0] || '';
};

const watchUrlFromEpisodeId = (baseUrl: string, episodeId: string) =>
  `${baseUrl}/watch/${episodeId.replace('$episode$', '?ep=').replace(/\$auto|\$sub|\$dub/gi, '')}`;

const subtitleUrlRegex = /https?:\/\/[^\s"'<>]+?\.(?:vtt|srt)(?:\?[^\s"'<>]*)?/gi;

const parseSubtitleUrlsFromText = (text: string): string[] => {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = subtitleUrlRegex.exec(String(text || ''))) !== null) {
    const url = String(m[0] || '').trim();
    if (url) out.add(url);
  }
  return [...out];
};

const subtitleLangFromUrl = (url: string): string => {
  const u = String(url || '').toLowerCase();
  if (/(^|[\/._-])(en|eng|english)([\/._-]|$)/i.test(u)) return 'English';
  if (/(^|[\/._-])(ja|jpn|japanese)([\/._-]|$)/i.test(u)) return 'Japanese';
  if (/(^|[\/._-])(es|spa|spanish)([\/._-]|$)/i.test(u)) return 'Spanish';
  if (/(^|[\/._-])(fr|fre|french)([\/._-]|$)/i.test(u)) return 'French';
  return 'Unknown';
};

const fetchHianimeSubtitlesViaBrowser = async (
  baseUrl: string,
  episodeId: string,
): Promise<Array<{ lang: string; url: string; kind: string }>> => {
  let chromium: any;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return [];
  }

  const watchUrl = watchUrlFromEpisodeId(baseUrl, episodeId);
  const found = new Set<string>();
  let browser: any;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({ userAgent: UA });
    const page = await context.newPage();

    page.on('request', (req: any) => {
      const u = String(req.url?.() || req.url || '').trim();
      if (!u) return;
      if (/\.vtt(\?|$)|\.srt(\?|$)/i.test(u)) found.add(u);
    });

    page.on('response', async (res: any) => {
      try {
        const u = String(res.url?.() || '').trim();
        if (u && /\.vtt(\?|$)|\.srt(\?|$)/i.test(u)) found.add(u);

        const ct = String((res.headers?.()['content-type'] || '')).toLowerCase();
        if (ct.includes('json') || ct.includes('javascript') || ct.includes('text')) {
          const body = String((await res.text()) || '');
          for (const sub of parseSubtitleUrlsFromText(body)) found.add(sub);
        }
      } catch {
        // ignore
      }
    });

    await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: BROWSER_SUBTITLE_TIMEOUT_MS });
    await page.waitForTimeout(3500);
    await context.close();
  } catch {
    // ignore browser failures
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
  }

  return [...found].map((url) => ({
    lang: subtitleLangFromUrl(url),
    url,
    kind: 'captions',
  }));
};

const extractServerDataIds = (
  serversHtml: string,
  server: StreamingServers,
  category: SubOrSub,
) => {
  const $ = loadHtml(serversHtml || '');
  // Prefer server-id 4 by default on HiAnime; server-id 1 often returns stale/dead embeds.
  const desiredServerId = serverIdMap[server] || serverIdMap[StreamingServers.VidStreaming];

  const collectForType = (type: 'sub' | 'dub') => {
    const scoped = $(`.ps_-block.ps_-block-sub.servers-${type} .server-item`);
    const all = scoped
      .map((_, el) => ({
        serverId: String($(el).attr('data-server-id') || ''),
        dataId: String($(el).attr('data-id') || ''),
      }))
      .get()
      .filter((entry) => !!entry.dataId);

    // Try preferred server first, then fall back to the rest for resilience.
    const preferred = all.filter((entry) => entry.serverId === desiredServerId).map((entry) => entry.dataId);
    const fallback = all.filter((entry) => entry.serverId !== desiredServerId).map((entry) => entry.dataId);
    return [...preferred, ...fallback];
  };

  if (category === SubOrSub.BOTH) {
    const ids = [...collectForType('sub'), ...collectForType('dub')];
    return [...new Set(ids)];
  }
  return category === SubOrSub.DUB ? collectForType('dub') : collectForType('sub');
};

const DEAD_EMBED_REGEX = /(file not found|we're sorry|can't find the file|copyright violation)/i;

const isEmbedAlive = async (embedLink: string, referer: string) => {
  try {
    const res = await proxyGet(embedLink, {
      headers: {
        'User-Agent': UA,
        Referer: referer,
      },
      timeout: EMBED_CHECK_TIMEOUT_MS,
      validateStatus: (status) => status >= 200 && status < 500,
    });

    if (res.status >= 400) return false;
    const body = typeof res.data === 'string' ? res.data : '';
    if (body && DEAD_EMBED_REGEX.test(body)) return false;
    return true;
  } catch (_) {
    return false;
  }
};

const fetchHianimeViaAjaxFallback = async (
  baseUrl: string,
  episodeId: string,
  server: StreamingServers,
  category: SubOrSub,
) => {
  if (!episodeId.includes('$episode$')) {
    throw new Error('Invalid episode id');
  }
  const epNum = getEpisodeNumberFromId(episodeId);
  if (!epNum) throw new Error('Invalid episode id');

  const referer = watchUrlFromEpisodeId(baseUrl, episodeId);
  const commonHeaders = {
    'User-Agent': UA,
    Referer: referer,
    'X-Requested-With': 'XMLHttpRequest',
  };

  const serversRes = await proxyGet(`${baseUrl}/ajax/v2/episode/servers?episodeId=${epNum}`, {
    headers: commonHeaders,
  });
  const dataIds = extractServerDataIds(serversRes?.data?.html || '', server, category);
  if (!dataIds.length) throw new Error('Could not resolve HiAnime server id');

  const sources: any[] = [];
  const subtitles: any[] = [];

  for (const dataId of dataIds) {
    const sourceMeta = await proxyGet(`${baseUrl}/ajax/v2/episode/sources?id=${encodeURIComponent(dataId)}`, {
      headers: commonHeaders,
    });
    const embedLink = sourceMeta?.data?.link;
    if (!embedLink) continue;

    let crawlrSources: any[] = [];
    let crawlrTracks: any[] = [];
    try {
      const crawlrUrl = `https://crawlr.cc/9D7F1B3E8?url=${encodeURIComponent(embedLink)}`;
      const crawlrRes = await proxyGet(crawlrUrl, { headers: { 'User-Agent': UA } });
      const crawlrData = crawlrRes?.data || {};
      crawlrSources = Array.isArray(crawlrData?.sources) ? crawlrData.sources : [];
      crawlrTracks = Array.isArray(crawlrData?.tracks) ? crawlrData.tracks : [];
    } catch (_) {
      // Continue to iframe fallback checks below.
    }

    crawlrSources.forEach((s: any) => {
      if (!s?.url) return;
      sources.push({
        url: s.url,
        quality: s.quality || 'auto',
        isM3U8: String(s.url).includes('.m3u8'),
      });
    });

    crawlrTracks.forEach((t: any) => {
      const url = t?.file || t?.url || t?.src;
      if (!url) return;
      subtitles.push({
        lang: t?.label || t?.language || 'Unknown',
        url,
        kind: t?.kind || 'captions',
      });
    });

    // Try extracting direct stream URLs from embed page before keeping embed fallback.
    if (!crawlrSources.length) {
      try {
        const extracted = await extractDirectSourcesWithPlaywright(embedLink, referer, EMBED_EXTRACT_TIMEOUT_MS);
        extracted.forEach((s: any) => {
          const u = String(s?.url || '').toLowerCase();
          if (!u || u.includes('.mpd')) return;
          if (!(Boolean(s?.isM3U8) || u.includes('.m3u8') || u.includes('m3u8-proxy') || u.includes('.mp4'))) return;
          sources.push({
            url: s.url,
            quality: s.quality || 'auto',
            isM3U8: Boolean(s?.isM3U8) || u.includes('.m3u8') || u.includes('m3u8-proxy'),
            isEmbed: false,
          });
        });
      } catch (_) {
        // Continue to iframe fallback checks below.
      }
    }

    // New HiAnime often returns iframe-only payloads. Keep it only if embed page is alive.
    if (!crawlrSources.length) {
      const alive = await isEmbedAlive(embedLink, referer);
      if (alive) {
        sources.push({
          url: embedLink,
          quality: 'auto',
          isM3U8: false,
          isEmbed: true,
        });
      }
    }
  }

  const dedupSources = [...new Map(sources.map((s) => [String(s.url), s])).values()];
  let dedupSubs = [...new Map(subtitles.map((s) => [String(s.url), s])).values()];
  if (!dedupSubs.length) {
    try {
      const browserSubs = await fetchHianimeSubtitlesViaBrowser(baseUrl, episodeId);
      if (browserSubs.length) {
        dedupSubs = [...new Map(browserSubs.map((s) => [String(s.url), s])).values()];
      }
    } catch {
      // ignore subtitle browser fallback failures
    }
  }
  if (!dedupSources.length && !dedupSubs.length) {
    throw new Error('HiAnime fallback returned no sources and no subtitles');
  }
  return {
    sources: dedupSources,
    subtitles: dedupSubs,
    headers: { Referer: referer },
  };
};

const hasSources = (payload: any): boolean =>
  !!payload && Array.isArray(payload.sources) && payload.sources.length > 0;

const mergeSubtitles = (primary: any, secondary: any) => {
  const p = Array.isArray(primary) ? primary : [];
  const s = Array.isArray(secondary) ? secondary : [];
  const merged = [...p, ...s].filter((row) => row && (row.url || row.file || row.src));
  return [...new Map(merged.map((row: any) => [String(row.url || row.file || row.src), row])).values()];
};

const withMergedSubtitles = (payload: any, subtitles: any[]) => {
  const merged = mergeSubtitles(payload?.subtitles, subtitles);
  return {
    ...(payload || {}),
    subtitles: merged,
  };
};

const hasDirectPlayableSource = (payload: any): boolean =>
  !!payload &&
  Array.isArray(payload.sources) &&
  payload.sources.some((s: any) => {
    const u = String(s?.url || '').toLowerCase();
    const isM3U8 = !!s?.isM3U8 || u.includes('.m3u8');
    const isMp4 = u.includes('.mp4');
    const isEmbed = !!s?.isEmbed;
    return (isM3U8 || isMp4) && !isEmbed;
  });

const resolveDirectFromEmbedPayload = async (payload: any, referer?: string) => {
  const sources = Array.isArray(payload?.sources) ? payload.sources : [];
  const embedUrls = sources
    .filter((s: any) => Boolean(s?.isEmbed))
    .map((s: any) => String(s?.url || '').trim())
    .filter((url: string) => /^https?:\/\//i.test(url))
    .slice(0, 2);

  if (!embedUrls.length) return payload;

  const directSources: any[] = [];
  for (const embedUrl of embedUrls) {
    try {
      const extracted = await extractDirectSourcesWithPlaywright(
        embedUrl,
        referer || embedUrl,
        EMBED_EXTRACT_TIMEOUT_MS,
      );
      extracted.forEach((s: any) => {
        const u = String(s?.url || '').toLowerCase();
        if (!u || u.includes('.mpd')) return;
        if (!(Boolean(s?.isM3U8) || u.includes('.m3u8') || u.includes('m3u8-proxy') || u.includes('.mp4'))) return;
        directSources.push({
          ...s,
          isEmbed: false,
          isM3U8: Boolean(s?.isM3U8) || u.includes('.m3u8') || u.includes('m3u8-proxy'),
        });
      });
    } catch {
      // ignore single embed extraction failure
    }
  }

  if (!directSources.length) return payload;

  const dedupDirect = [...new Map(directSources.map((s: any) => [String(s.url), s])).values()];
  return {
    ...payload,
    sources: dedupDirect,
  };
};

const getAnimeSearchNameFromEpisodeId = (episodeId: string) =>
  String(episodeId.split('$episode$')[0] || '')
    .replace(/-(tv|movie|ova|ona|special)(-\d+)?$/i, '')
    .replace(/-\d+$/, '')
    .replace(/-/g, ' ')
    .replace(/\b(tv|movie|ova|ona|special)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getEpisodeOrdinalFromServersHtml = async (baseUrl: string, episodeId: string) => {
  try {
    const epNum = getEpisodeNumberFromId(episodeId);
    if (!epNum) return null;
    const referer = `${baseUrl}/watch/${episodeId.replace('$episode$', '?ep=').replace(/\$auto|\$sub|\$dub/gi, '')}`;
    const res = await proxyGet(`${baseUrl}/ajax/v2/episode/servers?episodeId=${epNum}`, {
      headers: {
        'User-Agent': UA,
        Referer: referer,
        'X-Requested-With': 'XMLHttpRequest',
      },
      timeout: SERVER_HTML_TIMEOUT_MS,
    });
    const html = String(res?.data?.html || '');
    const m = html.match(/Episode\s*<\/b>\s*<\/strong>|Episode\s*<b>\s*(\d+)/i) || html.match(/Episode\s+(\d+)/i);
    const n = Number((m && (m[1] || m[0]?.match(/(\d+)/)?.[1])) || 0);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (_) {
    return null;
  }
};

const fallbackViaAnimeSaturn = async (
  animesaturn: any,
  episodeId: string,
  baseUrl: string,
) => {
  const searchName = getAnimeSearchNameFromEpisodeId(episodeId);
  if (!searchName) return null;

  const targetEpisode = await getEpisodeOrdinalFromServersHtml(baseUrl, episodeId);
  const searchRes = await animesaturn.search(searchName);
  const results = Array.isArray(searchRes?.results) ? searchRes.results : [];
  const first = results[0];
  if (!first?.id) return null;

  const info = await animesaturn.fetchAnimeInfo(first.id);
  const episodes = Array.isArray(info?.episodes) ? info.episodes : [];
  if (!episodes.length) return null;

  let picked = episodes[0];
  if (targetEpisode) {
    const exact = episodes.find((ep: any) => Number(ep?.number) === targetEpisode);
    if (exact) picked = exact;
  }

  if (!picked?.id) return null;
  const watch = await animesaturn.fetchEpisodeSources(picked.id);
  if (!hasSources(watch)) return null;
  return watch;
};

const extractSubtitleRows = (payload: any): Array<{ lang: string; url: string; kind: string }> => {
  const all = [
    ...(Array.isArray(payload?.subtitles) ? payload.subtitles : []),
    ...(Array.isArray(payload?.captions) ? payload.captions : []),
    ...(Array.isArray(payload?.tracks) ? payload.tracks : []),
  ];

  const rows = all
    .map((row: any) => {
      const url = row?.url || row?.file || row?.src;
      if (!url || typeof url !== 'string') return null;
      return {
        lang: String(row?.lang || row?.label || row?.language || 'Unknown'),
        url: String(url),
        kind: String(row?.kind || 'captions'),
      };
    })
    .filter(Boolean) as Array<{ lang: string; url: string; kind: string }>;

  return [...new Map(rows.map((row) => [String(row.url), row])).values()];
};

const fallbackViaAnimeKaiSubtitles = async (
  animekai: any,
  episodeId: string,
  baseUrl: string,
  category: SubOrSub,
) => {
  const searchName = getAnimeSearchNameFromEpisodeId(episodeId);
  if (!searchName) return [];
  const targetEpisode = await getEpisodeOrdinalFromServersHtml(baseUrl, episodeId);
  if (!targetEpisode) return [];

  const searchRes = await animekai.search(searchName, 1);
  const results = Array.isArray(searchRes?.results) ? searchRes.results : [];
  if (!results.length) return [];

  const normQuery = String(searchName).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const picked = results
    .map((row: any) => {
      const title = String(row?.title || row?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      let score = 0;
      if (title === normQuery) score += 100;
      else if (title.includes(normQuery) || normQuery.includes(title)) score += 70;
      score -= Math.abs(title.length - normQuery.length) * 0.1;
      return { row, score };
    })
    .sort((a: any, b: any) => b.score - a.score)[0]?.row;

  if (!picked?.id) return [];

  const info = await animekai.fetchAnimeInfo(String(picked.id));
  const episodes = Array.isArray(info?.episodes) ? info.episodes : [];
  if (!episodes.length) return [];

  const ep =
    episodes.find((e: any) => Number(e?.number || e?.episode || e?.episodeNum || 0) === targetEpisode) ||
    episodes[Math.max(0, Math.min(episodes.length - 1, targetEpisode - 1))];
  if (!ep?.id) return [];

  const collectFor = async (subOrDub: SubOrSub) => {
    try {
      const watch = await animekai.fetchEpisodeSources(String(ep.id), undefined, subOrDub);
      return extractSubtitleRows(watch);
    } catch {
      return [];
    }
  };

  if (category === SubOrSub.BOTH) {
    const [subRows, dubRows] = await Promise.all([collectFor(SubOrSub.SUB), collectFor(SubOrSub.DUB)]);
    return [...new Map([...subRows, ...dubRows].map((row) => [String(row.url), row])).values()];
  }

  return await collectFor(category === SubOrSub.DUB ? SubOrSub.DUB : SubOrSub.SUB);
};

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  const hianime = configureProvider(new ANIME.Hianime());
  const animesaturn = configureProvider(new ANIME.AnimeSaturn());
  const animekai = configureProvider(new ANIME.AnimeKai());
  const tryWithBaseUrlFallback = async <T>(
    worker: (baseUrl: string) => Promise<T>,
  ): Promise<T> => {
    const configured = String((hianime as any).baseUrl || '').trim();
    const candidates = [configured, ...HIANIME_BASE_URLS].filter(
      (url, idx, arr) => !!url && arr.indexOf(url) === idx,
    );

    let lastError: any = null;
    for (const baseUrl of candidates) {
      try {
        (hianime as any).baseUrl = baseUrl;
        return await worker(baseUrl);
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error('Failed to fetch sources from HiAnime domains.');
  };

  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro: `Welcome to the hianime provider: check out the provider's website @ ${hianime.toString.baseUrl}`,
      routes: [
        '/:query',
        '/info',
        '/watch/:episodeId',
        '/advanced-search',
        '/top-airing',
        '/most-popular',
        '/most-favorite',
        '/latest-completed',
        '/recently-updated',
        '/recently-added',
        '/top-upcoming',
        '/studio/:studio',
        '/subbed-anime',
        '/dubbed-anime',
        '/movie',
        '/tv',
        '/ova',
        '/ona',
        '/special',
        '/genres',
        '/genre/:genre',
        '/schedule',
        '/spotlight',
        '/search-suggestions/:query',
      ],
      documentation: 'https://docs.consumet.org/#tag/hianime',
    });
  });


  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.query as { id: string }).id;

    if (typeof id === 'undefined')
      return reply.status(400).send({ message: 'id is required' });

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `hianime:info:${id}`,
          async () => await hianime.fetchAnimeInfo(id),
          REDIS_TTL,
        )
        : await hianime.fetchAnimeInfo(id);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });

  fastify.get(
    '/watch/:episodeId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const episodeId = (request.params as { episodeId: string }).episodeId;
      const server = (request.query as { server: StreamingServers }).server;
      const category =
        ((request.query as { category?: SubOrSub }).category || SubOrSub.BOTH) as SubOrSub;

      if (typeof episodeId === 'undefined')
        return reply.status(400).send({ message: 'episodeId is required' });

      try {
        if (category === 'both') {
          let lastBaseUrl = (hianime as any).baseUrl || HIANIME_BASE_URLS[0];
          let res: any;
          let hianimeSubs: any[] = [];
          try {
            res = await tryWithBaseUrlFallback(async (baseUrl) => {
              lastBaseUrl = baseUrl;
              const [subRes, dubRes] = await Promise.allSettled([
                fetchWithServerFallback(
                  async (selectedServer) =>
                    await hianime.fetchEpisodeSources(
                      episodeId,
                      selectedServer,
                      SubOrSub.SUB,
                    ),
                  server,
                  undefined,
                  { attemptTimeoutMs: WATCH_ATTEMPT_TIMEOUT_MS },
                ),
                fetchWithServerFallback(
                  async (selectedServer) =>
                    await hianime.fetchEpisodeSources(
                      episodeId,
                      selectedServer,
                      SubOrSub.DUB,
                    ),
                  server,
                  undefined,
                  { attemptTimeoutMs: WATCH_ATTEMPT_TIMEOUT_MS },
                ),
              ]);

              const sources: any[] = [];
              const subtitles: any[] = [];

              if (subRes.status === 'fulfilled' && hasSources(subRes.value)) {
                sources.push(...subRes.value.sources.map((s) => ({ ...s, isDub: false })));
                subtitles.push(...(subRes.value.subtitles || []));
              }
              if (dubRes.status === 'fulfilled' && hasSources(dubRes.value)) {
                sources.push(...dubRes.value.sources.map((s) => ({ ...s, isDub: true })));
                subtitles.push(...(dubRes.value.subtitles || []));
              }

              if (sources.length > 0) {
                hianimeSubs = [...new Set(subtitles.map((s) => JSON.stringify(s)))].map((s) => JSON.parse(s));
                return {
                  sources,
                  subtitles: hianimeSubs,
                  intro:
                    subRes.status === 'fulfilled'
                      ? subRes.value.intro
                      : (dubRes.status === 'fulfilled' ? dubRes.value.intro : undefined),
                  outro:
                    subRes.status === 'fulfilled'
                      ? subRes.value.outro
                      : (dubRes.status === 'fulfilled' ? dubRes.value.outro : undefined),
                };
              }

              return await fetchHianimeViaAjaxFallback(
                baseUrl,
                episodeId,
                server || StreamingServers.VidStreaming,
                SubOrSub.BOTH,
              );
            });
            hianimeSubs = mergeSubtitles(hianimeSubs, res?.subtitles);
          } catch (_) {
            const saturn = await fallbackViaAnimeSaturn(animesaturn, episodeId, lastBaseUrl);
            if (!saturn || !hasSources(saturn)) {
              throw _;
            }
            res = withMergedSubtitles(saturn, hianimeSubs);
          }

          if (!hasDirectPlayableSource(res)) {
            res = await resolveDirectFromEmbedPayload(
              res,
              `${lastBaseUrl}/watch/${episodeId.replace('$episode$', '?ep=').replace(/\$auto|\$sub|\$dub/gi, '')}`,
            );
          }

          if (!Array.isArray(res?.subtitles) || !res.subtitles.length) {
            try {
              const anikaiSubs = await fallbackViaAnimeKaiSubtitles(animekai, episodeId, lastBaseUrl, SubOrSub.BOTH);
              if (anikaiSubs.length) {
                res = withMergedSubtitles(res, anikaiSubs);
              }
            } catch {
              // ignore anikai subtitle fallback errors
            }
          }

          if (!hasDirectPlayableSource(res)) {
            try {
              const saturn = await fallbackViaAnimeSaturn(animesaturn, episodeId, lastBaseUrl);
              if (saturn && hasSources(saturn)) {
                reply.status(200).send(withMergedSubtitles(saturn, res?.subtitles));
                return;
              }
            } catch (_) {
              // keep original response when fallback fails
            }
          }

          reply.status(200).send(res);
          return;
        }

        let res;
        let lastBaseUrl = (hianime as any).baseUrl || HIANIME_BASE_URLS[0];
        let hianimeSubs: any[] = [];
        const fetchWatch = async () =>
          await tryWithBaseUrlFallback(async (baseUrl) => {
            lastBaseUrl = baseUrl;
            try {
              const primary = await fetchWithServerFallback(
                async (selectedServer) =>
                  await hianime.fetchEpisodeSources(
                    episodeId,
                    selectedServer,
                    category as SubOrSub,
                  ),
                server,
                undefined,
                { attemptTimeoutMs: WATCH_ATTEMPT_TIMEOUT_MS },
              );
              if (hasSources(primary)) return primary;
            } catch (_) {
              // Ignore and try ajax fallback below.
            }

            const ajaxRes = await fetchHianimeViaAjaxFallback(
              baseUrl,
              episodeId,
              server || StreamingServers.VidStreaming,
              category as SubOrSub,
            );
            hianimeSubs = mergeSubtitles(hianimeSubs, ajaxRes?.subtitles);
            return ajaxRes;
          });

        try {
          res = redis
            ? await cache.fetch(
              redis as Redis,
              `hianime:watch:${episodeId}:${server}:${category}`,
              async () => await fetchWatch(),
              REDIS_TTL,
            )
            : await fetchWatch();
        } catch (_) {
          const saturn = await fallbackViaAnimeSaturn(animesaturn, episodeId, lastBaseUrl);
          if (!saturn || !hasSources(saturn)) {
            throw _;
          }
          res = withMergedSubtitles(saturn, hianimeSubs);
        }

        if (!hasDirectPlayableSource(res)) {
          res = await resolveDirectFromEmbedPayload(
            res,
            `${lastBaseUrl}/watch/${episodeId.replace('$episode$', '?ep=').replace(/\$auto|\$sub|\$dub/gi, '')}`,
          );
        }

        if (!Array.isArray(res?.subtitles) || !res.subtitles.length) {
          try {
            const anikaiSubs = await fallbackViaAnimeKaiSubtitles(
              animekai,
              episodeId,
              lastBaseUrl,
              category as SubOrSub,
            );
            if (anikaiSubs.length) {
              res = withMergedSubtitles(res, anikaiSubs);
            }
          } catch {
            // ignore anikai subtitle fallback errors
          }
        }

        if (!hasDirectPlayableSource(res)) {
          try {
            const saturn = await fallbackViaAnimeSaturn(animesaturn, episodeId, lastBaseUrl);
            if (saturn && hasSources(saturn)) {
              reply.status(200).send(withMergedSubtitles(saturn, mergeSubtitles(hianimeSubs, res?.subtitles)));
              return;
            }
          } catch (_) {
            // keep original response when fallback fails
          }
        }

        reply.status(200).send(res);
      } catch (err) {
        reply.status(500).send({
          message: 'Something went wrong. Contact developer for help.',
          error: (err as any).message,
        });
      }
    },
  );

  fastify.get('/genres', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `hianime:genres`,
          async () => await hianime.fetchGenres(),
          REDIS_TTL,
        )
        : await hianime.fetchGenres();

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });

  fastify.get('/schedule', async (request: FastifyRequest, reply: FastifyReply) => {
    const date = (request.query as { date: string }).date;

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `hianime:schedule:${date}`,
          async () => await hianime.fetchSchedule(date),
          REDIS_TTL,
        )
        : await hianime.fetchSchedule(date);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });

  fastify.get('/spotlight', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `hianime:spotlight`,
          async () => await hianime.fetchSpotlight(),
          REDIS_TTL,
        )
        : await hianime.fetchSpotlight();

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });

  fastify.get(
    '/search-suggestions/:query',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = (request.params as { query: string }).query;

      try {
        let res = redis
          ? await cache.fetch(
            redis as Redis,
            `hianime:suggestions:${query}`,
            async () => await hianime.fetchSearchSuggestions(query),
            REDIS_TTL,
          )
          : await hianime.fetchSearchSuggestions(query);

        reply.status(200).send(res);
      } catch (err) {
        reply
          .status(500)
          .send({ message: 'Something went wrong. Contact developer for help.' });
      }
    },
  );

  fastify.get(
    '/advanced-search',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const queryParams = request.query as {
        page?: number;
        type?: string;
        status?: string;
        rated?: string;
        score?: number;
        season?: string;
        language?: string;
        startDate?: string;
        endDate?: string;
        sort?: string;
        genres?: string;
      };

      const {
        page = 1,
        type,
        status,
        rated,
        score,
        season,
        language,
        startDate,
        endDate,
        sort,
        genres,
      } = queryParams;

      try {
        // Explicitly typed to avoid implicit any errors
        let parsedStartDate: { year: number; month: number; day: number } | undefined;
        let parsedEndDate: { year: number; month: number; day: number } | undefined;

        if (startDate) {
          const [year, month, day] = startDate.split('-').map(Number);
          parsedStartDate = { year, month, day };
        }
        if (endDate) {
          const [year, month, day] = endDate.split('-').map(Number);
          parsedEndDate = { year, month, day };
        }

        const genresArray = genres ? genres.split(',') : undefined;

        // Create a unique key based on all parameters
        const cacheKey = `hianime:advanced-search:${JSON.stringify(queryParams)}`;

        let res = redis
          ? await cache.fetch(
            redis as Redis,
            cacheKey,
            async () =>
              await hianime.fetchAdvancedSearch(
                page,
                type,
                status,
                rated,
                score,
                season,
                language,
                parsedStartDate,
                parsedEndDate,
                sort,
                genresArray,
              ),
            REDIS_TTL,
          )
          : await hianime.fetchAdvancedSearch(
            page,
            type,
            status,
            rated,
            score,
            season,
            language,
            parsedStartDate,
            parsedEndDate,
            sort,
            genresArray,
          );

        reply.status(200).send(res);
      } catch (err) {
        reply
          .status(500)
          .send({ message: 'Something went wrong. Contact developer for help.' });
      }
    },
  );

  fastify.get('/top-airing', async (request: FastifyRequest, reply: FastifyReply) => {
    const page = (request.query as { page: number }).page;

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `hianime:top-airing:${page}`,
          async () => await hianime.fetchTopAiring(page),
          REDIS_TTL,
        )
        : await hianime.fetchTopAiring(page);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });

  fastify.get('/most-popular', async (request: FastifyRequest, reply: FastifyReply) => {
    const page = (request.query as { page: number }).page;

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `hianime:most-popular:${page}`,
          async () => await hianime.fetchMostPopular(page),
          REDIS_TTL,
        )
        : await hianime.fetchMostPopular(page);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });

  fastify.get('/most-favorite', async (request: FastifyRequest, reply: FastifyReply) => {
    const page = (request.query as { page: number }).page;

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `hianime:most-favorite:${page}`,
          async () => await hianime.fetchMostFavorite(page),
          REDIS_TTL,
        )
        : await hianime.fetchMostFavorite(page);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });

  fastify.get(
    '/latest-completed',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const page = (request.query as { page: number }).page;

      try {
        let res = redis
          ? await cache.fetch(
            redis as Redis,
            `hianime:latest-completed:${page}`,
            async () => await hianime.fetchLatestCompleted(page),
            REDIS_TTL,
          )
          : await hianime.fetchLatestCompleted(page);

        reply.status(200).send(res);
      } catch (err) {
        reply
          .status(500)
          .send({ message: 'Something went wrong. Contact developer for help.' });
      }
    },
  );

  fastify.get(
    '/recently-updated',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const page = (request.query as { page: number }).page;

      try {
        let res = redis
          ? await cache.fetch(
            redis as Redis,
            `hianime:recently-updated:${page}`,
            async () => await hianime.fetchRecentlyUpdated(page),
            REDIS_TTL,
          )
          : await hianime.fetchRecentlyUpdated(page);

        reply.status(200).send(res);
      } catch (err) {
        reply
          .status(500)
          .send({ message: 'Something went wrong. Contact developer for help.' });
      }
    },
  );

  fastify.get('/recently-added', async (request: FastifyRequest, reply: FastifyReply) => {
    const page = (request.query as { page: number }).page;

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `hianime:recently-added:${page}`,
          async () => await hianime.fetchRecentlyAdded(page),
          REDIS_TTL,
        )
        : await hianime.fetchRecentlyAdded(page);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });

  fastify.get('/top-upcoming', async (request: FastifyRequest, reply: FastifyReply) => {
    const page = (request.query as { page: number }).page;

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `hianime:top-upcoming:${page}`,
          async () => await hianime.fetchTopUpcoming(page),
          REDIS_TTL,
        )
        : await hianime.fetchTopUpcoming(page);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });

  fastify.get('/studio/:studio', async (request: FastifyRequest, reply: FastifyReply) => {
    const studio = (request.params as { studio: string }).studio;
    const page = (request.query as { page: number }).page;

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `hianime:studio:${studio}:${page}`,
          async () => await hianime.fetchStudio(studio, page),
          REDIS_TTL,
        )
        : await hianime.fetchStudio(studio, page);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });

  fastify.get('/subbed-anime', async (request: FastifyRequest, reply: FastifyReply) => {
    const page = (request.query as { page: number }).page;

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `hianime:subbed:${page}`,
          async () => await hianime.fetchSubbedAnime(page),
          REDIS_TTL,
        )
        : await hianime.fetchSubbedAnime(page);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });

  fastify.get('/dubbed-anime', async (request: FastifyRequest, reply: FastifyReply) => {
    const page = (request.query as { page: number }).page;

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `hianime:dubbed:${page}`,
          async () => await hianime.fetchDubbedAnime(page),
          REDIS_TTL,
        )
        : await hianime.fetchDubbedAnime(page);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });

  fastify.get('/movie', async (request: FastifyRequest, reply: FastifyReply) => {
    const page = (request.query as { page: number }).page;

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `hianime:movie:${page}`,
          async () => await hianime.fetchMovie(page),
          REDIS_TTL,
        )
        : await hianime.fetchMovie(page);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });

  fastify.get('/tv', async (request: FastifyRequest, reply: FastifyReply) => {
    const page = (request.query as { page: number }).page;

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `hianime:tv:${page}`,
          async () => await hianime.fetchTV(page),
          REDIS_TTL,
        )
        : await hianime.fetchTV(page);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });

  fastify.get('/ova', async (request: FastifyRequest, reply: FastifyReply) => {
    const page = (request.query as { page: number }).page;

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `hianime:ova:${page}`,
          async () => await hianime.fetchOVA(page),
          REDIS_TTL,
        )
        : await hianime.fetchOVA(page);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });

  fastify.get('/ona', async (request: FastifyRequest, reply: FastifyReply) => {
    const page = (request.query as { page: number }).page;

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `hianime:ona:${page}`,
          async () => await hianime.fetchONA(page),
          REDIS_TTL,
        )
        : await hianime.fetchONA(page);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });

  fastify.get('/special', async (request: FastifyRequest, reply: FastifyReply) => {
    const page = (request.query as { page: number }).page;

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `hianime:special:${page}`,
          async () => await hianime.fetchSpecial(page),
          REDIS_TTL,
        )
        : await hianime.fetchSpecial(page);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });

  fastify.get('/genre/:genre', async (request: FastifyRequest, reply: FastifyReply) => {
    const genre = (request.params as { genre: string }).genre;
    const page = (request.query as { page: number }).page;

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `hianime:genre:${genre}:${page}`,
          async () => await hianime.genreSearch(genre, page),
          REDIS_TTL,
        )
        : await hianime.genreSearch(genre, page);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });
  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.params as { query: string }).query;
    const page = (request.query as { page: number }).page;

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `hianime:search:${query}:${page}`,
          async () => await hianime.search(query, page),
          REDIS_TTL,
        )
        : await hianime.search(query, page);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });
};

export default routes;
