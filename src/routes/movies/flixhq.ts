import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { StreamingServers } from '@consumet/extensions/dist/models';

import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { Redis } from 'ioredis';
import { FlixHQProvider } from '../../providers/custom/flixhqProvider';
import { extractDirectSourcesWithPlaywright } from '../../utils/browserRuntimeExtractor';

const isDirectMediaUrl = (value: string): boolean =>
  /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(value || '')) || /\/m3u8-proxy\?/i.test(String(value || ''));

const sortAndLimitSources = (rawSources: any[]): any[] => {
  const deduped = rawSources.filter(
    (item, idx, arr) => arr.findIndex((v) => String(v?.url || '') === String(item?.url || '')) === idx,
  );

  const direct = deduped.filter((s) => isDirectMediaUrl(String(s?.url || '')));
  const nonDirect = deduped.filter((s) => !isDirectMediaUrl(String(s?.url || '')));

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
    const server = (request.query as { server: string }).server || 'megacloud';

    if (typeof episodeId === 'undefined') {
      return reply.status(400).send({ message: 'episodeId is required' });
    }

    try {
      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `flixhq:watch:${episodeId}:${server}`,
            async () => await FlixHQProvider.fetchSources(episodeId, server),
            REDIS_TTL,
          )
        : await FlixHQProvider.fetchSources(episodeId, server);

      if (res && res.sources) {
        res.sources = sortAndLimitSources(res.sources);
      }

      reply.status(200).send(res);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });
};

export default routes;


