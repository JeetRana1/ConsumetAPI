import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { load } from 'cheerio';
import { proxyGet } from '../../utils/outboundProxy';
import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { Redis } from 'ioredis';

const BASE_URL = 'https://animetsu.net';
const API_BASE = `${BASE_URL}/v2/api/anime`;
const STREAM_PROXY_BASE = 'https://swiftstream.top/proxy';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HASH_RE = /^[a-f0-9]{24}$/i;
const DEFAULT_SERVERS = ['kite', 'meg', 'pahe', 'dio', 'kiss'];
const SERVER_PRIORITY = new Map(DEFAULT_SERVERS.map((server, index) => [server, index]));
const STREAM_PROBE_TIMEOUT_MS = Number(
  process.env.ANIMETSU_STREAM_PROBE_TIMEOUT_MS || 1800,
);

type EpisodeRef = {
  animeId: string;
  episode: string;
};

const animetsuHeaders = (referer = `${BASE_URL}/`) => ({
  Accept: 'application/json, text/plain, */*',
  'X-Requested-With': 'XMLHttpRequest',
  Referer: referer,
  Origin: BASE_URL,
  'User-Agent': UA,
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors',
});

const animetsuGet = async (
  path: string,
  config: import('axios').AxiosRequestConfig = {},
) => {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const referer = String((config.headers as any)?.Referer || `${BASE_URL}/`);
  return proxyGet(url, {
    timeout: 8000,
    ...config,
    headers: {
      ...animetsuHeaders(referer),
      ...(config.headers || {}),
    },
  });
};

const absoluteUrl = (value?: any): string | undefined => {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  try {
    return new URL(raw, BASE_URL).toString();
  } catch {
    return undefined;
  }
};

const pickTitle = (title: any, fallback = ''): string => {
  if (typeof title === 'string') return title.trim();
  return String(
    title?.english || title?.romaji || title?.native || fallback || '',
  ).trim();
};

const normalizeImage = (item: any): string | undefined => {
  const image =
    item?.coverImage?.extraLarge ||
    item?.coverImage?.large ||
    item?.cover_image?.extraLarge ||
    item?.cover_image?.large ||
    item?.cover_image ||
    item?.image ||
    item?.poster ||
    item?.img;
  return absoluteUrl(image);
};

const normalizeCover = (item: any): string | undefined => {
  return absoluteUrl(
    item?.bannerImage || item?.banner || item?.cover || item?.banner_image,
  );
};

const extractHashId = (value: any): string => {
  const raw = String(value || '').trim();
  const match = raw.match(/[a-f0-9]{24}/i);
  return match ? match[0] : '';
};

const normalizeResults = (payload: any): any[] => {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

  return rows
    .map((item: any) => {
      const id = extractHashId(item?.id || item?._id || item?.href || item?.url);
      return {
        id,
        title: pickTitle(item?.title, item?.name),
        image: normalizeImage(item),
        cover: normalizeCover(item),
        releaseDate: item?.seasonYear || item?.year || item?.start_date,
        type: item?.format || item?.type,
        totalEpisodes: item?.total_eps || item?.episodes,
        anilistId: item?.anilist_id || item?.anilistId,
        malId: item?.mal_id || item?.malId,
        url: id ? `${BASE_URL}/anime/${id}` : undefined,
      };
    })
    .filter((item: any) => item.id && item.title);
};

const normalizeSeasonRows = (rows: any): any[] => {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((item: any, index: number) => {
      const id = extractHashId(item?.id || item?._id || item?.href || item?.url);
      return {
        id,
        title: pickTitle(item?.title, item?.name || item?.format),
        name: pickTitle(item?.title, item?.name || item?.format),
        image: normalizeImage(item),
        cover: normalizeCover(item),
        season:
          Number(item?.season || item?.seasonNumber || item?.number || index + 1) ||
          index + 1,
        releaseDate: item?.seasonYear || item?.year || item?.start_date,
        anilistId: item?.anilist_id || item?.anilistId,
        malId: item?.mal_id || item?.malId,
        episodes: [],
      };
    })
    .filter((item: any) => item.id);
};

const normalizeProviderRelatedRows = (rows: any): any[] => {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((item: any) => {
      const id = extractHashId(item?.id || item?._id || item?.href || item?.url);
      return {
        id,
        title: pickTitle(item?.title, item?.name || item?.format),
        name: pickTitle(item?.title, item?.name || item?.format),
        image: normalizeImage(item),
        cover: normalizeCover(item),
        releaseDate: item?.seasonYear || item?.year || item?.start_date,
        anilistId: item?.anilist_id || item?.anilistId,
        malId: item?.mal_id || item?.malId,
        format: item?.format,
        type: item?.type,
        episodes: [],
      };
    })
    .filter((item: any) => item.id);
};

const makeEpisodeId = (animeId: string, episode: number | string) =>
  `${animeId}$episode$${episode}`;

const parseEpisodeId = (episodeId: string): EpisodeRef => {
  const raw = String(episodeId || '').trim();
  if (raw.includes('$episode$')) {
    const [animeId, episode = '1'] = raw.split('$episode$');
    return { animeId: extractHashId(animeId), episode: String(episode || '1') };
  }

  const urlEpisode = raw.match(/[?&]ep=(\d+)/i)?.[1];
  return {
    animeId: extractHashId(raw),
    episode: urlEpisode || '1',
  };
};

const normalizeEpisodeRows = (animeId: string, payload: any): any[] => {
  const episodesRaw = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.episodes)
      ? payload.episodes
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

  return episodesRaw
    .map((ep: any, index: number) => {
      const number =
        Number(ep?.ep_num || ep?.number || ep?.episode || ep?.ep || index + 1) ||
        index + 1;
      return {
        id: makeEpisodeId(animeId, number),
        providerEpisodeId: extractHashId(ep?.id || ep?._id || ep?.data_id),
        dataId: extractHashId(ep?.data_id || ep?.id || ep?._id),
        episode: number,
        number,
        episodeNum: number,
        title: ep?.name || ep?.title || `Episode ${number}`,
        image: absoluteUrl(ep?.image || ep?.img || ep?.thumbnail),
        description: ep?.description || ep?.desc || ep?.overview,
        isFiller: ep?.is_filler === true || ep?.isFiller === true,
        views: ep?.views,
        airedAt: ep?.aired_at || ep?.airedAt,
        url: `${BASE_URL}/watch/${animeId}?ep=${number}`,
      };
    })
    .filter((ep: any) => ep.id && ep.episode)
    .sort((a: any, b: any) => Number(a.episode) - Number(b.episode));
};

const scrapeEpisodesFromHtml = (animeId: string, html: string): any[] => {
  const $ = load(html || '');
  const found = new Map<number, any>();

  $('[href*="/watch/"], [data-ep], [data-episode], [data-id], [data-episode-id]').each(
    (_, el) => {
      const node = $(el);
      const href = String(
        node.attr('href') || node.find('[href*="/watch/"]').first().attr('href') || '',
      );
      const dataEp =
        node.attr('data-ep') ||
        node.attr('data-episode') ||
        node.attr('data-episode-number') ||
        node.data('ep') ||
        node.data('episode');
      const queryEp = href.match(/[?&]ep=(\d+)/i)?.[1];
      const textEp = node.text().match(/\b(?:ep|episode)\s*(\d+)\b/i)?.[1];
      const number = Number(dataEp || queryEp || textEp || 0);
      if (!number || found.has(number)) return;

      const providerEpisodeId = extractHashId(
        node.attr('data-id') ||
          node.attr('data-episode-id') ||
          node.data('id') ||
          node.data('episodeId') ||
          href,
      );

      found.set(number, {
        id: makeEpisodeId(animeId, number),
        providerEpisodeId,
        dataId: providerEpisodeId,
        episode: number,
        number,
        episodeNum: number,
        title:
          node.attr('title') ||
          node.find('[title]').first().attr('title') ||
          `Episode ${number}`,
        image: absoluteUrl(
          node.find('img').first().attr('src') ||
            node.find('img').first().attr('data-src'),
        ),
        url: `${BASE_URL}/watch/${animeId}?ep=${number}`,
      });
    },
  );

  return [...found.values()].sort((a, b) => Number(a.episode) - Number(b.episode));
};

const resolveStreamUrl = (source: any): string => {
  const raw = String(source?.url || source?.file || '').trim();
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (source?.need_proxy || raw.startsWith('/oppai/')) {
    return `${STREAM_PROXY_BASE}${raw.startsWith('/') ? raw : `/${raw}`}`;
  }
  return new URL(raw, BASE_URL).toString();
};

const isLikelyHlsManifest = (body: string, contentType?: string): boolean => {
  const text = String(body || '').trim();
  if (!text) return false;

  if (
    /application\/(vnd\.apple\.mpegurl|x-mpegURL)|audio\/x-mpegurl/i.test(
      String(contentType || ''),
    )
  ) {
    return true;
  }

  return /^#EXTM3U\b/m.test(text);
};

const shouldProbeSource = (source: any): boolean => {
  const url = String(source?.url || '').trim();
  if (!url || source?.isM3U8 !== true) return false;
  if (/\.m3u8(?:$|\?)/i.test(url)) return false;
  return /swiftstream\.top\/proxy\/oppai\//i.test(url);
};

const probePlayableSource = async (source: any): Promise<any | null> => {
  if (!shouldProbeSource(source)) return source;

  try {
    const response = await proxyGet(source.url, {
      timeout: STREAM_PROBE_TIMEOUT_MS,
      responseType: 'text',
      validateStatus: () => true,
      headers: {
        ...animetsuHeaders(`${BASE_URL}/`),
        Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*',
      },
    });

    const contentType = String(response.headers?.['content-type'] || '');
    if (response.status < 200 || response.status >= 300) return null;
    if (!isLikelyHlsManifest(String(response.data || ''), contentType)) return null;
    return source;
  } catch {
    return null;
  }
};

const filterPlayableSources = async (sources: any[]): Promise<any[]> => {
  if (!sources.some(shouldProbeSource)) return sources;

  const probed = await Promise.all(sources.map((source) => probePlayableSource(source)));
  return probed.filter(Boolean);
};

const normalizeServerList = (server?: string): string[] => {
  if (!server || server === 'auto') return DEFAULT_SERVERS;
  return [String(server).toLowerCase()];
};

const normalizeSourceTypes = (sourceType?: string): string[] => {
  const requested = String(sourceType || '').toLowerCase();
  if (requested === 'dub') return ['dub'];
  if (requested === 'sub') return ['sub'];
  return ['sub', 'dub'];
};

export const search = async (query: string) => {
  if (!query?.trim()) return { currentPage: 1, hasNextPage: false, results: [] };
  const res = await animetsuGet(`/search/?query=${encodeURIComponent(query.trim())}`);
  return {
    currentPage: 1,
    hasNextPage: false,
    results: normalizeResults(res.data),
  };
};

export const getEpisodes = async (animeId: string) => {
  const id = extractHashId(animeId);
  if (!id || !HASH_RE.test(id)) throw new Error('Animetsu anime id is invalid');

  try {
    const res = await animetsuGet(`/eps/${encodeURIComponent(id)}`, {
      headers: { Referer: `${BASE_URL}/anime/${id}` },
    });
    const episodes = normalizeEpisodeRows(id, res.data);
    if (episodes.length) return episodes;
  } catch (err: any) {
    console.warn(
      'Animetsu episodes API failed, scraping HTML fallback:',
      err?.message || err,
    );
  }

  const page = await proxyGet(`${BASE_URL}/anime/${encodeURIComponent(id)}`, {
    headers: animetsuHeaders(`${BASE_URL}/anime/${id}`),
    timeout: 8000,
  });
  const episodes = scrapeEpisodesFromHtml(id, String(page.data || ''));
  if (!episodes.length) throw new Error(`No Animetsu episodes found for ${id}`);
  return episodes;
};

export const getStreamLinks = async (
  episodeId: string,
  options: { server?: string; sourceType?: string } = {},
) => {
  const { animeId, episode } = parseEpisodeId(episodeId);
  if (!animeId || !HASH_RE.test(animeId))
    throw new Error('Animetsu episode id is invalid');

  const servers = normalizeServerList(options.server);
  const sourceTypes = normalizeSourceTypes(options.sourceType);
  const watchReferer = `${BASE_URL}/watch/${animeId}?ep=${episode}`;
  const completedResults: any[] = [];

  const jobs = servers.flatMap((server) =>
    sourceTypes.map(async (sourceType) => {
      const startedAt = Date.now();
      try {
        const res = await animetsuGet(
          `/oppai/${encodeURIComponent(animeId)}/${encodeURIComponent(episode)}?server=${encodeURIComponent(
            server,
          )}&source_type=${encodeURIComponent(sourceType)}`,
          {
            timeout: sourceTypes.length === 1 ? 3500 : 5000,
            headers: { Referer: watchReferer },
          },
        );
        const payload = res.data || {};
        const resolvedServer = String(payload.server || server).toLowerCase();
        const audioLabel = sourceType === 'dub' ? 'Dubbed' : 'Subbed';
        let sources = (Array.isArray(payload.sources) ? payload.sources : [])
          .map((source: any) => {
            const url = resolveStreamUrl(source);
            return {
              url,
              quality:
                `${resolvedServer.toUpperCase()} ${audioLabel} ${source?.quality || source?.label || 'master'}`.trim(),
              isM3U8:
                source?.type === 'video/mpegurl' ||
                source?.old_hls === true ||
                /\.m3u8(?:$|\?)/i.test(url),
              referer: `${BASE_URL}/`,
              headers: {
                Referer: `${BASE_URL}/`,
                Origin: BASE_URL,
                'User-Agent': UA,
              },
              provider: 'animetsu',
              server: resolvedServer,
              isDub: sourceType === 'dub',
              isSub: sourceType === 'sub',
              audio: sourceType,
              responseTime: Date.now() - startedAt,
            };
          })
          .filter((source: any) => source.url);

        sources = await filterPlayableSources(sources);

        const subtitles = (Array.isArray(payload.subs) ? payload.subs : [])
          .map((sub: any) => ({
            url: sub?.url,
            lang: sub?.lang || sub?.label || 'Unknown',
            referer: `${BASE_URL}/`,
            provider: 'animetsu',
            audio: sourceType,
          }))
          .filter((sub: any) => sub.url);

        const result = {
          server: resolvedServer,
          sourceType,
          sources,
          subtitles,
          intro: payload.skips?.intro,
          outro: payload.skips?.outro,
        };
        completedResults.push(result);
        return result;
      } catch (err: any) {
        console.error(
          `Animetsu watch ${server} ${sourceType} error:`,
          err?.message || err,
        );
        const result = { server, sourceType, sources: [], subtitles: [] };
        completedResults.push(result);
        return result;
      }
    }),
  );

  const allResultsPromise = Promise.all(jobs);
  const fastDeadlineMs = sourceTypes.length === 1 ? 2500 : 3500;
  await Promise.race([
    allResultsPromise,
    new Promise((resolve) => setTimeout(resolve, fastDeadlineMs)),
  ]);

  let rows = completedResults.filter((row) => row.sources.length);
  if (!rows.length) rows = await allResultsPromise;
  else allResultsPromise.catch(() => undefined);

  rows = rows
    .filter((row) => row.sources.length)
    .sort((a, b) => {
      const aServerRank = SERVER_PRIORITY.get(String(a.server || '').toLowerCase()) ?? 99;
      const bServerRank = SERVER_PRIORITY.get(String(b.server || '').toLowerCase()) ?? 99;
      const aAudioRank = options.sourceType ? 0 : a.sourceType === 'sub' ? 0 : 1;
      const bAudioRank = options.sourceType ? 0 : b.sourceType === 'sub' ? 0 : 1;
      return aAudioRank - bAudioRank || aServerRank - bServerRank;
    });

  const sources: any[] = [];
  const subtitles: any[] = [];
  let intro: any;
  let outro: any;

  for (const row of rows) {
    sources.push(...row.sources);
    subtitles.push(...row.subtitles);
    intro = intro || row.intro;
    outro = outro || row.outro;
  }

  const seenSources = new Set<string>();
  const dedupedSources = sources.filter((source) => {
    const key = `${source.server}:${source.audio}:${source.url}`;
    if (seenSources.has(key)) return false;
    seenSources.add(key);
    return true;
  });

  const seenSubtitles = new Set<string>();
  const dedupedSubtitles = subtitles.filter((subtitle) => {
    const key = `${subtitle.lang}:${subtitle.url}`;
    if (seenSubtitles.has(key)) return false;
    seenSubtitles.add(key);
    return true;
  });

  return {
    headers: {
      Referer: `${BASE_URL}/`,
      Origin: BASE_URL,
      'User-Agent': UA,
    },
    sources: dedupedSources,
    subtitles: dedupedSubtitles,
    intro,
    outro,
  };
};

const getInfo = async (id: string) => {
  const animeId = extractHashId(id);
  if (!animeId || !HASH_RE.test(animeId)) throw new Error('Animetsu anime id is invalid');

  const [infoRes, episodes] = await Promise.all([
    animetsuGet(`/info/${encodeURIComponent(animeId)}`, {
      headers: { Referer: `${BASE_URL}/anime/${animeId}` },
    }).catch(() => ({ data: {} })),
    getEpisodes(animeId).catch(() => []),
  ]);

  const info = infoRes.data || {};
  const {
    seasons: relatedSeasons,
    relations: relatedRelations,
    recommendations,
    characters,
    staff,
    studios,
    ...baseInfo
  } = info;
  void recommendations;
  void characters;
  void staff;
  void studios;

  return {
    ...baseInfo,
    id: String(info?.id || animeId),
    title: pickTitle(info?.title, info?.name),
    image: normalizeImage(info),
    cover: normalizeCover(info),
    anilistId: info?.anilist_id || info?.anilistId,
    malId: info?.mal_id || info?.malId,
    // Animetsu's "seasons" field is a related-entry list (movies, sequels,
    // specials), not the playable episode season for this hash. Returning it
    // as seasons makes the frontend map S1E1 to the wrong related entry.
    seasons: [],
    providerSeasons: normalizeProviderRelatedRows(relatedSeasons),
    relatedSeasons,
    relations: relatedRelations,
    episodes,
  };
};

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  void options;

  const searchHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.params as { query: string }).query;
    try {
      const fetchSearch = () => search(query);
      const data = redis
        ? await cache.fetch(
            redis as Redis,
            `animetsu:net:search:${query}`,
            fetchSearch,
            REDIS_TTL,
          )
        : await fetchSearch();
      reply.status(200).send(data);
    } catch (err: any) {
      console.error('Animetsu search error:', err?.message || err);
      reply.status(200).send({ currentPage: 1, hasNextPage: false, results: [] });
    }
  };

  fastify.get('/search/:query', searchHandler);

  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = String((request.query as { id?: string }).id || '').trim();
    if (!id) return reply.status(400).send({ message: 'id is required' });

    try {
      const fetchInfo = () => getInfo(id);
      const data = redis
        ? await cache.fetch(
            redis as Redis,
            `animetsu:net:info:v1:${extractHashId(id)}`,
            fetchInfo,
            REDIS_TTL,
          )
        : await fetchInfo();
      reply.status(200).send(data);
    } catch (err: any) {
      console.error('Animetsu info error:', err?.message || err);
      reply.status(200).send({ id: extractHashId(id) || id, title: '', episodes: [] });
    }
  });

  fastify.get('/info/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.params as { id: string }).id;
    const res = await fastify.inject({
      method: 'GET',
      url: `/anime/animetsu/info?id=${encodeURIComponent(id)}`,
    });
    reply
      .status(res.statusCode)
      .headers(res.headers as any)
      .send(res.body);
  });

  fastify.get(
    '/servers/:id/:episode',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, episode } = request.params as { id: string; episode: string };
      const animeId = extractHashId(id);
      try {
        const res = await animetsuGet(
          `/servers/${encodeURIComponent(animeId)}/${encodeURIComponent(episode)}`,
          {
            headers: { Referer: `${BASE_URL}/watch/${animeId}?ep=${episode}` },
            timeout: 3000,
          },
        );
        const rows = Array.isArray(res.data)
          ? res.data
          : Array.isArray(res.data?.servers)
            ? res.data.servers
            : [];
        reply
          .status(200)
          .send(
            rows.length
              ? rows
              : DEFAULT_SERVERS.map((server) => ({ id: server, name: server })),
          );
      } catch (err: any) {
        console.warn('Animetsu servers fallback:', err?.message || err);
        reply
          .status(200)
          .send(DEFAULT_SERVERS.map((server) => ({ id: server, name: server })));
      }
    },
  );

  fastify.get(
    '/watch/:episodeId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const episodeId = (request.params as { episodeId: string }).episodeId;
      const query = request.query as {
        server?: string;
        source_type?: string;
        category?: string;
      };

      try {
        const sourceType = query.source_type || query.category;
        const fetchWatch = () =>
          getStreamLinks(episodeId, { server: query.server, sourceType });
        const { animeId, episode } = parseEpisodeId(episodeId);
        const cacheKey = `animetsu:net:watch:v1:${animeId}:${episode}:${query.server || 'auto'}:${sourceType || 'both'}`;
        const data = redis
          ? await cache.fetch(redis as Redis, cacheKey, fetchWatch, REDIS_TTL)
          : await fetchWatch();
        reply.status(200).send(data);
      } catch (err: any) {
        console.error('Animetsu watch error:', err?.message || err);
        reply
          .status(200)
          .send({
            sources: [],
            subtitles: [],
            message: err?.message || 'Animetsu watch failed',
          });
      }
    },
  );

  fastify.get('/:query', searchHandler);
};

export default routes;
