import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { StreamingServers } from '@consumet/extensions/dist/models';
import { Redis } from 'ioredis';

import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { configureProvider } from '../../utils/provider';
import NetMirror from '../../providers/movies/netmirror';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  const netmirror = configureProvider(new NetMirror());

  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro: `Welcome to the netmirror provider: check out the provider's website @ ${netmirror.toString.baseUrl}`,
      routes: ['/:query', '/info', '/watch', '/recent-movies', '/trending', '/servers'],
      documentation: 'https://docs.consumet.org/#tag/netmirror',
    });
  });

  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = decodeURIComponent((request.params as { query: string }).query);
    const page = (request.query as { page: number }).page;

    const res = redis
      ? await cache.fetch(
          redis as Redis,
          `netmirror:${query}:${page}`,
          async () => await netmirror.search(query, page || 1),
          REDIS_TTL,
        )
      : await netmirror.search(query, page || 1);

    reply.status(200).send(res);
  });

  fastify.get('/recent-movies', async (request: FastifyRequest, reply: FastifyReply) => {
    const res = redis
      ? await cache.fetch(
          redis as Redis,
          `netmirror:recent-movies`,
          async () => await netmirror.fetchRecentMovies(),
          REDIS_TTL,
        )
      : await netmirror.fetchRecentMovies();

    reply.status(200).send(res);
  });

  fastify.get('/trending', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const res = redis
        ? await cache.fetch(
            redis as Redis,
            `netmirror:trending`,
            async () => await netmirror.fetchTrendingMovies(),
            REDIS_TTL,
          )
        : await netmirror.fetchTrendingMovies();

      reply.status(200).send(res);
    } catch {
      reply.status(500).send({
        message: 'Something went wrong. Please try again later. or contact the developers.',
      });
    }
  });

  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.query as { id: string }).id;
    if (typeof id === 'undefined') return reply.status(400).send({ message: 'id is required' });

    try {
      const res = redis
        ? await cache.fetch(
            redis as Redis,
            `netmirror:info:${id}`,
            async () => await netmirror.fetchMediaInfo(id),
            REDIS_TTL,
          )
        : await netmirror.fetchMediaInfo(id);

      reply.status(200).send(res);
    } catch {
      reply.status(500).send({
        message: 'Something went wrong. Please try again later. or contact the developers.',
      });
    }
  });

  fastify.get('/watch', async (request: FastifyRequest, reply: FastifyReply) => {
    const episodeId = (request.query as { episodeId: string }).episodeId;
    const mediaId = (request.query as { mediaId: string }).mediaId;
    const server = (request.query as { server: StreamingServers }).server;

    if (typeof episodeId === 'undefined')
      return reply.status(400).send({ message: 'episodeId is required' });

    if (server && !Object.values(StreamingServers).includes(server))
      return reply.status(400).send({ message: 'Invalid server query' });

    try {
      const res = redis
        ? await cache.fetch(
            redis as Redis,
            `netmirror:watch:${episodeId}:${mediaId}:${server}`,
            async () => await netmirror.fetchEpisodeSources(episodeId, mediaId),
            REDIS_TTL,
          )
        : await netmirror.fetchEpisodeSources(episodeId, mediaId);

      reply.status(200).send(res);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      reply.status(404).send({ message });
    }
  });

  fastify.get('/servers', async (request: FastifyRequest, reply: FastifyReply) => {
    const episodeId = (request.query as { episodeId: string }).episodeId;
    const mediaId = (request.query as { mediaId: string }).mediaId;

    if (typeof episodeId === 'undefined')
      return reply.status(400).send({ message: 'episodeId is required' });

    try {
      const res = redis
        ? await cache.fetch(
            redis as Redis,
            `netmirror:servers:${episodeId}:${mediaId}`,
            async () => await netmirror.fetchEpisodeServers(episodeId, mediaId),
            REDIS_TTL,
          )
        : await netmirror.fetchEpisodeServers(episodeId, mediaId);

      reply.status(200).send(res);
    } catch {
      reply.status(500).send({
        message: 'Something went wrong. Please try again later. or contact the developers.',
      });
    }
  });
};

export default routes;
