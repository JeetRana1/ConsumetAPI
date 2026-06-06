import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';

import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { Redis } from 'ioredis';
import { FlixHQProvider } from '../../providers/custom/flixhqProvider';

const isDirectMediaUrl = (value: string): boolean =>
  /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(value || ''));

const isUsableSourceUrl = (value: string): boolean => {
  const raw = String(value || '').trim();
  if (!raw || /^blob:/i.test(raw)) return false;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (host === 'example.com' || host.endsWith('.example.com')) return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return false;
    if (host.includes('placeholder') || host.includes('dummy')) return false;
    return true;
  } catch {
    return false;
  }
};

const sortAndLimitSources = (rawSources: any[]): any[] => {
  const usable = rawSources.filter((item) => isUsableSourceUrl(String(item?.url || '')));
  const deduped = usable.filter(
    (item, idx, arr) => arr.findIndex((v) => String(v?.url || '') === String(item?.url || '')) === idx,
  );

  const hasMasterForBase = new Set(
    deduped
      .map((source) => String(source?.url || ''))
      .filter((url) => /\/master\.m3u8(?:\?|$)/i.test(url))
      .map((url) => url.replace(/\/master\.m3u8(?:\?.*)?$/i, '')),
  );

  const collapsed = deduped.filter((source) => {
    const url = String(source?.url || '');
    const base = url.replace(/\/index-[^/]+\.m3u8(?:\?.*)?$/i, '');
    return !hasMasterForBase.has(base) || /\/master\.m3u8(?:\?|$)/i.test(url);
  });

  const direct = collapsed
    .filter((s) => isDirectMediaUrl(String(s?.url || '')))
    .sort((a, b) => {
      const score = (source: any) => {
        const url = String(source?.url || '');
        const serverLabel = String(source?.server || source?.quality || '').toLowerCase();
        return (
          (/\.m3u8(?:\?|$)/i.test(url) || source?.isM3U8 ? 80 : 0) +
          (/\/master\.m3u8(?:\?|$)/i.test(url) ? 25 : 0) +
          (/\/index\.m3u8(?:\?|$)/i.test(url) ? 15 : 0) +
          (/\.mp4(?:\?|$)/i.test(url) ? 20 : 0) +
          (/hydrogen/.test(serverLabel) ? 35 : 0) +
          (/lithium/.test(serverLabel) ? 30 : 0) +
          (/helium/.test(serverLabel) ? 15 : 0) -
          (/oxygen/.test(serverLabel) ? 40 : 0)
        );
      };
      return score(b) - score(a);
    });
  const nonDirect = collapsed.filter((s) => !isDirectMediaUrl(String(s?.url || '')));

  return [...direct.slice(0, 8), ...nonDirect.slice(0, 2)];
};

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro: `Welcome to the custom FlixHQ provider`,
      routes: [
        '/:query',
        '/search',
        '/info',
        '/watch',
        '/home',
        '/popular-movies',
        '/popular-tv',
        '/top-movies',
        '/top-tv',
        '/upcoming',
        '/servers',
      ],
      documentation: 'https://docs.consumet.org/#tag/flixhq',
    });
  });

  fastify.get('/home', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `flixhq:home`,
            async () => await FlixHQProvider.fetchHome(),
            REDIS_TTL,
          )
        : await FlixHQProvider.fetchHome();

      reply.status(200).send(res);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = decodeURIComponent((request.params as { query: string }).query);
    const page = (request.query as { page: number }).page || 1;

    try {
      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `flixhq:search:${query}:${page}`,
            async () => await FlixHQProvider.search(query, page),
            REDIS_TTL,
          )
        : await FlixHQProvider.search(query, page);

      reply.status(200).send(res);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/search', async (request: FastifyRequest, reply: FastifyReply) => {
    const { query } = request.body as { query: string };
    const page = 1; // Default to page 1 for POST

    if (!query) {
      return reply.status(400).send({ error: 'Query is required' });
    }

    try {
      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `flixhq:search:${query}:${page}`,
            async () => await FlixHQProvider.search(query, page),
            REDIS_TTL,
          )
        : await FlixHQProvider.search(query, page);

      reply.status(200).send(res);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/popular-movies', async (request: FastifyRequest, reply: FastifyReply) => {
    const page = (request.query as { page: number }).page || 1;

    try {
      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `flixhq:popular-movies:${page}`,
            async () => await FlixHQProvider.fetchPopularMovies(page),
            REDIS_TTL,
          )
        : await FlixHQProvider.fetchPopularMovies(page);

      reply.status(200).send(res);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/popular-tv', async (request: FastifyRequest, reply: FastifyReply) => {
    const page = (request.query as { page: number }).page || 1;

    try {
      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `flixhq:popular-tv:${page}`,
            async () => await FlixHQProvider.fetchPopularTv(page),
            REDIS_TTL,
          )
        : await FlixHQProvider.fetchPopularTv(page);

      reply.status(200).send(res);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/top-movies', async (request: FastifyRequest, reply: FastifyReply) => {
    const page = (request.query as { page: number }).page || 1;

    try {
      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `flixhq:top-movies:${page}`,
            async () => await FlixHQProvider.fetchTopMovies(page),
            REDIS_TTL,
          )
        : await FlixHQProvider.fetchTopMovies(page);

      reply.status(200).send(res);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/top-tv', async (request: FastifyRequest, reply: FastifyReply) => {
    const page = (request.query as { page: number }).page || 1;

    try {
      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `flixhq:top-tv:${page}`,
            async () => await FlixHQProvider.fetchTopTv(page),
            REDIS_TTL,
          )
        : await FlixHQProvider.fetchTopTv(page);

      reply.status(200).send(res);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/upcoming', async (request: FastifyRequest, reply: FastifyReply) => {
    const page = (request.query as { page: number }).page || 1;

    try {
      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `flixhq:upcoming:${page}`,
            async () => await FlixHQProvider.fetchUpcoming(page),
            REDIS_TTL,
          )
        : await FlixHQProvider.fetchUpcoming(page);

      reply.status(200).send(res);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.query as { id: string }).id;

    if (typeof id === 'undefined') {
      return reply.status(400).send({ message: 'id is required' });
    }

    try {
      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `flixhq:info:${id}`,
            async () => await FlixHQProvider.fetchMediaInfo(id),
            REDIS_TTL,
          )
        : await FlixHQProvider.fetchMediaInfo(id);

      reply.status(200).send(res);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/servers', async (request: FastifyRequest, reply: FastifyReply) => {
    const episodeId = (request.query as { episodeId: string }).episodeId;

    if (typeof episodeId === 'undefined') {
      return reply.status(400).send({ message: 'episodeId is required' });
    }

    try {
      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `flixhq:servers:${episodeId}`,
            async () => await FlixHQProvider.fetchServers(episodeId),
            REDIS_TTL,
          )
        : await FlixHQProvider.fetchServers(episodeId);

      reply.status(200).send(res);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/watch', async (request: FastifyRequest, reply: FastifyReply) => {
    const episodeId = (request.query as { episodeId: string }).episodeId;
    const server = (request.query as { server: string }).server || 'vidking';
    const hasExplicitServer = typeof (request.query as { server?: string }).server !== 'undefined';
    const strictServer = String((request.query as { strictServer?: string }).strictServer || '').toLowerCase() === 'true' || hasExplicitServer;
    const allowEmbedFallback =
      String((request.query as { allowEmbedFallback?: string }).allowEmbedFallback || '').toLowerCase() === 'true';
    const extractionTimeoutMs = Number((request.query as { extractionTimeoutMs?: string }).extractionTimeoutMs);
    const requestedExtractionTimeoutMs =
      Number.isFinite(extractionTimeoutMs) && extractionTimeoutMs > 0 ? extractionTimeoutMs : undefined;

    if (typeof episodeId === 'undefined') {
      return reply.status(400).send({ message: 'episodeId is required' });
    }

    try {
      // Debug: log incoming request headers
      const hostHeader = String(request.headers.host || '').trim();
      const protocol = request.protocol;
      console.log('[FlixHQ Watch] Request host:', hostHeader, 'protocol:', protocol);

      const watchCacheKey = `flixhq:watch:v19:${episodeId}:${server}:${strictServer ? 'strict' : 'fallback'}:${allowEmbedFallback ? 'embed-ok' : 'direct'}:${requestedExtractionTimeoutMs || 'default'}`;
      let res: any = null;
      if (redis) {
        try {
          res = await cache.get(redis as Redis, watchCacheKey);
        } catch {
          res = null;
        }
      }

      if (!res) {
        res = await FlixHQProvider.fetchSources(episodeId, server, strictServer, {
          allowEmbedFallback,
          extractionTimeoutMs: requestedExtractionTimeoutMs,
        });
        if (redis && Array.isArray(res?.sources) && res.sources.length > 0 && !res?.error) {
          (redis as Redis).setex(watchCacheKey, REDIS_TTL, JSON.stringify(res)).catch(() => {});
        }
      }

      if (res && res.sources) {
        res.sources = sortAndLimitSources(res.sources).map((source: any) => ({
          ...source,
          url: String(source?.url || '').trim(),
          requiresProxy: false,
        }));
      }

      reply.status(200).send(res);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });
};

export default routes;


