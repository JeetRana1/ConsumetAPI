import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { Racing } from '../../providers/sports/racing';
import { redis, REDIS_TTL } from '../../main';
import cache from '../../utils/cache';
import { Redis } from 'ioredis';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  const racing = new Racing();

  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro: 'Welcome to the Racing sports provider',
      routes: ['/:query', '/info', '/watch'],
    });
  });

  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = decodeURIComponent((request.params as { query: string }).query);
    const forceRefresh =
      String(
        (request.query as { forceRefresh?: string }).forceRefresh || '',
      ).toLowerCase() === 'true';

    try {
      const cacheKey = `sports:racing:search:${query}:${forceRefresh ? 'force' : 'cache'}`;
      let res =
        redis && !forceRefresh
          ? await cache.fetch(
              redis as Redis,
              cacheKey,
              async () => await racing.search(query),
              REDIS_TTL,
            )
          : await racing.fetchCatalogLatest({ query, forceRefresh });

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
      reply.header(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate',
      );
      reply.header('Pragma', 'no-cache');
      reply.header('Expires', '0');

      const res = await racing.fetchMediaInfo(id);

      reply.status(200).send(res);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/watch', async (request: FastifyRequest, reply: FastifyReply) => {
    const episodeId = (request.query as { episodeId: string }).episodeId;

    if (typeof episodeId === 'undefined') {
      return reply.status(400).send({ message: 'episodeId is required' });
    }

    try {
      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `sports:racing:watch:${episodeId}`,
            async () => await racing.fetchEpisodeSources(episodeId),
            REDIS_TTL,
          )
        : await racing.fetchEpisodeSources(episodeId);

      reply.status(200).send(res);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });
};

export default routes;
