import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';

import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { Redis } from 'ioredis';

const NETMIRROR_BASE_URL = process.env.NETMIRROR_BASE_URL || 'https://net20.cc';
const NETMIRROR_T_HASH_T = process.env.NETMIRROR_T_HASH_T;
const NETMIRROR_DEFAULT_OTT = process.env.NETMIRROR_OTT || 'nf';

type NetMirrorSearchResult = {
  head?: string;
  type?: number;
  searchResult?: Array<{ id: string; t: string }>;
};

type NetMirrorPostData = {
  status?: string;
  d_lang?: string;
  title?: string;
  year?: string;
  ua?: string;
  match?: string;
  runtime?: string;
  hdsd?: string;
  type?: string;
  genre?: string;
  m_desc?: string;
  desc?: string;
  season?: Array<{
    s: string;
    id: string;
    ep: string;
    sele: string;
  }>;
  episodes?: Array<{
    complate?: string;
    id: string;
    t: string;
    s: string;
    ep: string;
    ep_desc?: string;
    time?: string;
  }>;
};

type NetMirrorPlaylist = {
  title?: string;
  image?: string;
  sources?: Array<{
    file: string;
    label?: string;
    type?: string;
    default?: string;
  }>;
  tracks?: Array<{
    kind?: string;
    file: string;
    label?: string;
    language?: string;
  }>;
};

const parseJson = async <T>(res: Response): Promise<T> => {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON response (${res.status})`);
  }
};

const getCookies = async (ott: string): Promise<string> => {
  const initRes = await fetch(`${NETMIRROR_BASE_URL}/p.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'init=1',
  });

  const setCookie = initRes.headers.get('set-cookie') || '';
  if (!setCookie) throw new Error('NetMirror cookie bootstrap failed');
  const tHash = /t_hash=([^;]+)/i.exec(setCookie)?.[1] || '';

  const cookieParts = [];
  if (NETMIRROR_T_HASH_T) cookieParts.push(`t_hash_t=${NETMIRROR_T_HASH_T}`);
  cookieParts.push(`t_hash=${tHash}`);
  cookieParts.push(`ott=${ott || NETMIRROR_DEFAULT_OTT}`);
  return cookieParts.join('; ');
};

const netmirrorGet = async <T>(path: string, ott?: string): Promise<T> => {
  const cookie = await getCookies(ott || NETMIRROR_DEFAULT_OTT);
  const res = await fetch(`${NETMIRROR_BASE_URL}${path}`, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${NETMIRROR_BASE_URL}/home`,
      Cookie: cookie,
    },
  });

  if (!res.ok) {
    throw new Error(`NetMirror request failed: ${res.status}`);
  }

  return parseJson<T>(res);
};

const parseEpisodeNumber = (value?: string): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const toQuality = (label?: string): string => {
  const val = String(label || '').toLowerCase();
  if (val.includes('full') || val.includes('1080')) return '1080p';
  if (val.includes('mid') || val.includes('720')) return '720p';
  if (val.includes('low') || val.includes('480')) return '480p';
  return 'auto';
};

const mapSubtitles = (tracks?: NetMirrorPlaylist['tracks']) => {
  if (!Array.isArray(tracks)) return [];
  return tracks
    .filter((track) => String(track?.kind || '').toLowerCase() === 'captions')
    .map((track) => ({
      url: String(track.file || '').startsWith('//') ? `https:${track.file}` : track.file,
      lang: track.label || track.language || 'Unknown',
    }))
    .filter((track) => Boolean(track.url));
};

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  fastify.get('/', (_, reply) => {
    reply.status(200).send({
      intro: `Welcome to the netmirror provider: extraction pipeline @ ${NETMIRROR_BASE_URL}`,
      routes: [
        '/:query',
        '/info',
        '/watch',
        '/recent-shows',
        '/recent-movies',
        '/trending',
        '/servers',
      ],
      documentation: 'https://docs.consumet.org/#tag/movies',
    });
  });

  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = decodeURIComponent((request.params as { query: string }).query || '');
    const page = Number((request.query as { page?: number }).page || 1);
    const ott = String((request.query as { ott?: string }).ott || NETMIRROR_DEFAULT_OTT);
    const cacheKey = `netmirror:search:${query}:${page}:${ott}`;

    try {
      const res = redis
        ? await cache.fetch(
            redis as Redis,
            cacheKey,
            async () => await netmirrorGet<NetMirrorSearchResult>(`/search.php?s=${encodeURIComponent(query)}&t=x`, ott),
            REDIS_TTL,
          )
        : await netmirrorGet<NetMirrorSearchResult>(`/search.php?s=${encodeURIComponent(query)}&t=x`, ott);

      const rows = Array.isArray(res?.searchResult) ? res.searchResult : [];
      const results = rows.map((item) => ({
        id: item.id,
        title: item.t,
        image: `https://imgcdn.kim/poster/342/${item.id}.jpg`,
        type: 'MOVIE',
      }));

      reply.status(200).send({
        currentPage: page,
        hasNextPage: false,
        results,
      });
    } catch (err: any) {
      reply.status(500).send({ message: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.query as { id?: string }).id;
    const ott = String((request.query as { ott?: string }).ott || NETMIRROR_DEFAULT_OTT);
    if (!id) return reply.status(400).send({ message: 'id is required' });

    const cacheKey = `netmirror:info:${id}:${ott}`;
    try {
      let data = redis
        ? await cache.fetch(
            redis as Redis,
            cacheKey,
            async () => await netmirrorGet<NetMirrorPostData>(`/post.php?id=${encodeURIComponent(id)}&t=x`, ott),
            REDIS_TTL,
          )
        : await netmirrorGet<NetMirrorPostData>(`/post.php?id=${encodeURIComponent(id)}&t=x`, ott);

      // NetMirror may return anti-bot payloads for post.php ("Invalid User").
      // Fallback to a minimal info payload so clients can still use id for /watch.
      if (String((data as any)?.status || '').toLowerCase() === 'n') {
        const search = await netmirrorGet<NetMirrorSearchResult>(`/search.php?s=${encodeURIComponent(id)}&t=x`, ott);
        const match =
          (Array.isArray(search?.searchResult) ? search.searchResult.find((r) => r.id === id) : undefined) ||
          (Array.isArray(search?.searchResult) ? search.searchResult[0] : undefined);
        data = {
          title: match?.t || id,
          type: 'm',
          genre: '',
          runtime: '',
          desc: '',
          m_desc: '',
          year: '',
          episodes: [{ id, t: match?.t || id, s: 'S1', ep: '1' }],
        };
      }

      const isTv = String(data?.type || '').toLowerCase() === 't';
      const episodes =
        Array.isArray(data?.episodes) && data.episodes.length
          ? data.episodes.map((ep) => ({
              id: ep.id,
              title: ep.t,
              number: parseEpisodeNumber(ep.ep),
              season: parseEpisodeNumber(String(ep.s || '').replace(/^s/i, '')),
              description: ep.ep_desc || '',
              duration: ep.time || '',
            }))
          : [
              {
                id,
                title: data?.title || (isTv ? 'Episode 1' : 'Full Movie'),
              },
            ];

      reply.status(200).send({
        id,
        title: data?.title || '',
        image: `https://imgcdn.kim/poster/780/${id}.jpg`,
        cover: `https://imgcdn.kim/poster/1920/${id}.jpg`,
        type: isTv ? 'TV Series' : 'Movie',
        genres: String(data?.genre || '')
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean),
        duration: data?.runtime || '',
        description: data?.desc || data?.m_desc || '',
        year: data?.year || '',
        episodes,
      });
    } catch (err: any) {
      reply.status(500).send({ message: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.get('/watch', async (request: FastifyRequest, reply: FastifyReply) => {
    const episodeId = (request.query as { episodeId?: string }).episodeId;
    const ott = String((request.query as { ott?: string }).ott || NETMIRROR_DEFAULT_OTT);

    if (!episodeId) return reply.status(400).send({ message: 'episodeId is required' });

    const cacheKey = `netmirror:watch:${episodeId}:${ott}`;
    try {
      const playlistRows = redis
        ? await cache.fetch(
            redis as Redis,
            cacheKey,
            async () =>
              await netmirrorGet<NetMirrorPlaylist[]>(
                `/playlist.php?id=${encodeURIComponent(episodeId)}&t=Video&tm=${Date.now()}`,
                ott,
              ),
            REDIS_TTL,
          )
        : await netmirrorGet<NetMirrorPlaylist[]>(
            `/playlist.php?id=${encodeURIComponent(episodeId)}&t=Video&tm=${Date.now()}`,
            ott,
          );

      const playlist = Array.isArray(playlistRows) ? playlistRows[0] : undefined;
      const rows = Array.isArray(playlist?.sources) ? playlist.sources : [];
      const sources = rows
        .map((source) => {
          const file = String(source.file || '').trim();
          if (!file) return null;
          const fullUrl = file.startsWith('http') ? file : `${NETMIRROR_BASE_URL}${file}`;
          return {
            url: fullUrl,
            quality: toQuality(source.label),
            isM3U8: /\.m3u8(\?|$)/i.test(fullUrl) || true,
          };
        })
        .filter(Boolean);

      if (!sources.length) {
        return reply.status(404).send({ message: 'No sources found for this episode' });
      }

      const subtitles = mapSubtitles(playlist?.tracks);
      reply.status(200).send({
        headers: { Referer: `${NETMIRROR_BASE_URL}/` },
        sources,
        subtitles,
      });
    } catch (err: any) {
      reply.status(404).send({ message: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.get('/servers', async (request: FastifyRequest, reply: FastifyReply) => {
    const episodeId = (request.query as { episodeId?: string }).episodeId;
    if (!episodeId) return reply.status(400).send({ message: 'episodeId is required' });

    reply.status(200).send([
      {
        name: 'NetMirror',
        url: `${NETMIRROR_BASE_URL}/playlist.php?id=${encodeURIComponent(episodeId)}`,
      },
    ]);
  });

  fastify.get('/recent-movies', async (request: FastifyRequest, reply: FastifyReply) => {
    const ott = String((request.query as { ott?: string }).ott || NETMIRROR_DEFAULT_OTT);
    const cacheKey = `netmirror:recent-movies:${ott}`;

    try {
      const res = redis
        ? await cache.fetch(
            redis as Redis,
            cacheKey,
            async () => await netmirrorGet<NetMirrorSearchResult>('/search.php?s=new&t=x', ott),
            REDIS_TTL,
          )
        : await netmirrorGet<NetMirrorSearchResult>('/search.php?s=new&t=x', ott);

      const rows = Array.isArray(res?.searchResult) ? res.searchResult : [];
      reply.status(200).send(
        rows.map((item) => ({
          id: item.id,
          title: item.t,
          image: `https://imgcdn.kim/poster/342/${item.id}.jpg`,
          type: 'MOVIE',
        })),
      );
    } catch (err: any) {
      reply.status(500).send({ message: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.get('/recent-shows', async (request: FastifyRequest, reply: FastifyReply) => {
    // NetMirror API does not split "recent shows" separately; reuse recent list.
    const ott = String((request.query as { ott?: string }).ott || NETMIRROR_DEFAULT_OTT);
    const cacheKey = `netmirror:recent-shows:${ott}`;

    try {
      const res = redis
        ? await cache.fetch(
            redis as Redis,
            cacheKey,
            async () => await netmirrorGet<NetMirrorSearchResult>('/search.php?s=new&t=x', ott),
            REDIS_TTL,
          )
        : await netmirrorGet<NetMirrorSearchResult>('/search.php?s=new&t=x', ott);

      const rows = Array.isArray(res?.searchResult) ? res.searchResult : [];
      reply.status(200).send(
        rows.map((item) => ({
          id: item.id,
          title: item.t,
          image: `https://imgcdn.kim/poster/342/${item.id}.jpg`,
          type: 'TV Series',
        })),
      );
    } catch (err: any) {
      reply.status(500).send({ message: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.get('/trending', async (request: FastifyRequest, reply: FastifyReply) => {
    const ott = String((request.query as { ott?: string }).ott || NETMIRROR_DEFAULT_OTT);
    const cacheKey = `netmirror:trending:${ott}`;

    try {
      const res = redis
        ? await cache.fetch(
            redis as Redis,
            cacheKey,
            async () => await netmirrorGet<NetMirrorSearchResult>('/search.php?s=new&t=x', ott),
            REDIS_TTL,
          )
        : await netmirrorGet<NetMirrorSearchResult>('/search.php?s=new&t=x', ott);

      const rows = (Array.isArray(res?.searchResult) ? res.searchResult : []).slice(0, 10);
      reply.status(200).send(
        rows.map((item) => ({
          id: item.id,
          title: item.t,
          image: `https://imgcdn.kim/poster/342/${item.id}.jpg`,
          type: 'MOVIE',
        })),
      );
    } catch (err: any) {
      reply.status(500).send({ message: err instanceof Error ? err.message : String(err) });
    }
  });
};

export default routes;
