import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { proxyGet } from '../../utils/outboundProxy';
import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { Redis } from 'ioredis';

const BASE_URL = 'https://animetsu.live';
const API_BASE = `${BASE_URL}/v2/api/anime`;
const STREAM_PROXY_BASE = 'https://swiftstream.top/proxy';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DEFAULT_SERVERS = ['kite', 'meg', 'pahe', 'dio', 'kiss'];
const SERVER_PRIORITY = new Map(DEFAULT_SERVERS.map((server, index) => [server, index]));

const animetsuGet = async (path: string, config: import('axios').AxiosRequestConfig = {}) => {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  return proxyGet(url, {
    ...config,
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${BASE_URL}/`,
      Origin: BASE_URL,
      'User-Agent': UA,
      ...(config.headers || {}),
    },
  });
};

const pickTitle = (title: any, fallback = ''): string => {
  if (typeof title === 'string') return title;
  return String(title?.english || title?.romaji || title?.native || fallback || '').trim();
};

const normalizeImage = (item: any): string | undefined => {
  const image = item?.coverImage?.large || item?.coverImage?.extraLarge || item?.image || item?.poster;
  return typeof image === 'string' ? image : undefined;
};

const normalizeResults = (payload: any): any[] => {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

  return rows.map((item: any) => ({
    id: String(item?.id || item?._id || '').trim(),
    title: pickTitle(item?.title, item?.name),
    image: normalizeImage(item),
    cover: item?.bannerImage || item?.cover,
    releaseDate: item?.seasonYear || item?.year,
    type: item?.format || item?.type,
    anilistId: item?.anilist_id || item?.anilistId,
    malId: item?.mal_id || item?.malId,
  })).filter((item: any) => item.id && item.title);
};

const normalizeSeasonRows = (rows: any): any[] => {
  if (!Array.isArray(rows)) return [];

  return rows.map((item: any, index: number) => ({
    id: String(item?.id || item?._id || '').trim(),
    title: pickTitle(item?.title, item?.name || item?.format),
    name: pickTitle(item?.title, item?.name || item?.format),
    image: normalizeImage(item),
    cover: item?.bannerImage || item?.cover,
    season: Number(item?.season || item?.seasonNumber || item?.number || index + 1) || index + 1,
    releaseDate: item?.seasonYear || item?.year,
    anilistId: item?.anilist_id || item?.anilistId,
    malId: item?.mal_id || item?.malId,
    episodes: [],
  })).filter((item: any) => item.id);
};

const makeEpisodeId = (animeId: string, episode: number | string) => `${animeId}$episode$${episode}`;

const parseEpisodeId = (episodeId: string) => {
  const [animeId, episode = '1'] = String(episodeId || '').split('$episode$');
  return { animeId, episode };
};

const normalizeEpisodeRows = (animeId: string, payload: any): any[] => {
  const episodesRaw = Array.isArray(payload) ? payload : payload?.episodes || [];
  return episodesRaw.map((ep: any) => {
    const number = Number(ep?.ep_num || ep?.number || ep?.episode || 0) || ep?.ep_num || ep?.number || ep?.episode;
    return {
      id: makeEpisodeId(animeId, number || 1),
      providerEpisodeId: String(ep?.id || ep?._id || '').trim() || null,
      episode: number || 1,
      number: number || 1,
      episodeNum: number || 1,
      title: ep?.name || ep?.title,
      image: ep?.image || ep?.img || ep?.thumbnail,
      description: ep?.description || ep?.desc || ep?.overview,
      isFiller: ep?.is_filler === true || ep?.isFiller === true,
      views: ep?.views,
    };
  });
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

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  const searchHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.params as { query: string }).query;
    try {
      const fetchSearch = async () => {
        const res = await animetsuGet(`/search/?query=${encodeURIComponent(query)}`);
        return {
          currentPage: 1,
          hasNextPage: false,
          results: normalizeResults(res.data),
        };
      };

      const data = redis
        ? await cache.fetch(redis as Redis, `animetsu:search:${query}`, fetchSearch, REDIS_TTL)
        : await fetchSearch();

      reply.status(200).send(data);
    } catch (err: any) {
      console.error('Animetsu search error:', err.message);
      reply.status(200).send({ currentPage: 1, hasNextPage: false, results: [] });
    }
  };

  fastify.get('/search/:query', searchHandler);

  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = String((request.query as { id?: string }).id || '').trim();
    if (!id) return reply.status(400).send({ message: 'id is required' });

    try {
      const fetchInfo = async () => {
        const [infoRes, epsRes] = await Promise.all([
          animetsuGet(`/info/${encodeURIComponent(id)}`),
          animetsuGet(`/eps/${encodeURIComponent(id)}`),
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
        const episodes = normalizeEpisodeRows(id, epsRes.data);

        const seasons = normalizeSeasonRows(relatedSeasons);

        return {
          ...baseInfo,
          id: String(info?.id || id),
          title: pickTitle(info?.title, info?.name),
          image: normalizeImage(info),
          cover: info?.bannerImage || info?.cover,
          anilistId: info?.anilist_id || info?.anilistId,
          malId: info?.mal_id || info?.malId,
          seasons,
          relatedSeasons,
          relations: relatedRelations,
          episodes,
        };
      };

      const data = redis
        ? await cache.fetch(redis as Redis, `animetsu:info:v2:${id}`, fetchInfo, REDIS_TTL)
        : await fetchInfo();

      reply.status(200).send(data);
    } catch (err: any) {
      console.error('Animetsu info error:', err.message);
      reply.status(200).send({ id, title: '', episodes: [] });
    }
  });

  fastify.get('/info/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    (request as any).query = { ...(request.query as any), id: (request.params as { id: string }).id };
    return fastify.inject({
      method: 'GET',
      url: `/anime/animetsu/info?id=${encodeURIComponent((request.params as { id: string }).id)}`,
    }).then((res) => {
      reply.status(res.statusCode).headers(res.headers as any).send(res.body);
    });
  });

  fastify.get('/servers/:id/:episode', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, episode } = request.params as { id: string; episode: string };
    try {
      const res = await animetsuGet(`/servers/${encodeURIComponent(id)}/${encodeURIComponent(episode)}`);
      reply.status(200).send(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      console.error('Animetsu servers error:', err.message);
      reply.status(200).send([]);
    }
  });

  fastify.get('/watch/:episodeId', async (request: FastifyRequest, reply: FastifyReply) => {
    const episodeId = (request.params as { episodeId: string }).episodeId;
    const query = request.query as { server?: string; source_type?: string; category?: string };
    const { animeId, episode } = parseEpisodeId(episodeId);
    const requestedSourceType = String(query.source_type || query.category || '').toLowerCase();
    const sourceTypes = requestedSourceType === 'dub'
      ? ['dub']
      : requestedSourceType === 'sub'
        ? ['sub']
        : ['sub', 'dub'];
    const servers = query.server ? [query.server] : DEFAULT_SERVERS;

    if (!animeId) return reply.status(400).send({ message: 'episodeId is invalid' });

    try {
      const fetchWatch = async () => {
        const allSources: any[] = [];
        const allSubtitles: any[] = [];
        let firstIntro: any;
        let firstOutro: any;
        let episodeMeta: any = null;

        try {
          const epsRes = await animetsuGet(`/eps/${encodeURIComponent(animeId)}`, { timeout: 2500 });
          const episodeRows = normalizeEpisodeRows(animeId, epsRes.data);
          const requestedEpisodeNo = Number(episode || 0);
          episodeMeta = episodeRows.find((row) => Number(row?.episode || row?.number || 0) === requestedEpisodeNo) || null;
          if (!episodeMeta && requestedEpisodeNo > 0) {
            return {
              headers: {
                Referer: `${BASE_URL}/`,
                Origin: BASE_URL,
                'User-Agent': UA,
              },
              sources: [],
              subtitles: [],
              message: `Animetsu episode ${requestedEpisodeNo} was not found for ${animeId}`,
            };
          }
        } catch (err: any) {
          console.warn('Animetsu episode verification skipped:', err?.message || err);
        }

        const completedResults: any[] = [];
        const watchJobs = servers.flatMap((server) =>
          sourceTypes.map(async (sourceType) => {
            const startedAt = Date.now();
            try {
              const res = await animetsuGet(
                `/oppai/${encodeURIComponent(animeId)}/${encodeURIComponent(episode)}?server=${encodeURIComponent(server)}&source_type=${sourceType}`,
                { timeout: requestedSourceType ? 3200 : 4500 },
              );
              const payload = res.data || {};
              const audioLabel = sourceType === 'dub' ? 'Dubbed' : 'Subbed';
              const resolvedServer = String(payload.server || server).toLowerCase();
              const sources = (payload.sources || [])
                .map((source: any) => {
                  const url = resolveStreamUrl(source);
                  return {
                    url,
                    quality: `${resolvedServer.toUpperCase()} ${audioLabel} ${source?.quality || source?.label || 'auto'}`.trim(),
                    isM3U8: source?.type === 'video/mpegurl' || source?.old_hls === true || /\.m3u8(?:$|\?)/i.test(url),
                    referer: `${BASE_URL}/`,
                    provider: 'animetsu',
                    server: resolvedServer,
                    isDub: sourceType === 'dub',
                    isSub: sourceType === 'sub',
                    audio: sourceType,
                    responseTime: Date.now() - startedAt,
                  };
                })
                .filter((source: any) => source.url);

              const subtitles = (payload.subs || [])
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
              console.error(`Animetsu watch ${server} ${sourceType} error:`, err.message);
              const result = { server, sourceType, sources: [], subtitles: [] };
              completedResults.push(result);
              return result;
            }
          }),
        );

        const allResultsPromise = Promise.all(watchJobs);
        const fastDeadlineMs = requestedSourceType ? 2200 : 3200;
        await Promise.race([
          allResultsPromise,
          new Promise((resolve) => setTimeout(resolve, fastDeadlineMs)),
        ]);
        let settled = completedResults.filter((row) => row.sources.length);
        if (!settled.length) {
          settled = await allResultsPromise;
        } else {
          allResultsPromise.catch(() => undefined);
        }
        settled
          .filter((row) => row.sources.length)
          .sort((a, b) => {
            const aServerRank = SERVER_PRIORITY.get(String(a.server || '').toLowerCase()) ?? 99;
            const bServerRank = SERVER_PRIORITY.get(String(b.server || '').toLowerCase()) ?? 99;
            const aAudioRank = requestedSourceType ? 0 : (a.sourceType === 'sub' ? 0 : 1);
            const bAudioRank = requestedSourceType ? 0 : (b.sourceType === 'sub' ? 0 : 1);
            return aAudioRank - bAudioRank || aServerRank - bServerRank;
          })
          .forEach((row) => {
            row.sources.forEach((source: any) => allSources.push(source));
            row.subtitles.forEach((subtitle: any) => allSubtitles.push(subtitle));
            firstIntro = firstIntro || row.intro;
            firstOutro = firstOutro || row.outro;
          });

        const seenSources = new Set<string>();
        const dedupedSources = allSources.filter((source) => {
          const key = `${source.server}:${source.audio}:${source.url}`;
          if (seenSources.has(key)) return false;
          seenSources.add(key);
          return true;
        });

        const seenSubtitles = new Set<string>();
        const dedupedSubtitles = allSubtitles.filter((subtitle) => {
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
          episode: episodeMeta,
          intro: firstIntro,
          outro: firstOutro,
        };
      };

      const data = redis
        ? await cache.fetch(redis as Redis, `animetsu:watch:v3:${episodeId}:${servers.join(',')}:${sourceTypes.join(',')}`, fetchWatch, REDIS_TTL)
        : await fetchWatch();

      reply.status(200).send(data);
    } catch (err: any) {
      console.error('Animetsu watch error:', err.message);
      reply.status(200).send({ sources: [], subtitles: [] });
    }
  });

  fastify.get('/:query', searchHandler);
};

export default routes;
