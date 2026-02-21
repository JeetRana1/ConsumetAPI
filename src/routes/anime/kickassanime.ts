import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { ANIME } from '@consumet/extensions';
import { StreamingServers } from '@consumet/extensions/dist/models';

import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { Redis } from 'ioredis';
import { fetchWithServerFallback } from '../../utils/streamable';
import { configureProvider } from '../../utils/provider';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  const kickassanime = configureProvider(new ANIME.KickAssAnime());
  (kickassanime as any).baseUrl = 'https://kaa.lt';

  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro: `Welcome to the kickassanime provider: check out the provider's website @ ${kickassanime.toString.baseUrl}`,
      routes: ['/:query', '/info', '/watch/:episodeId', '/servers/:episodeId'],
      documentation: 'https://docs.consumet.org/#tag/kickassanime',
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
          `kickassanime:info:${id}`,
          async () => await kickassanime.fetchAnimeInfo(id),
          REDIS_TTL,
        )
        : await kickassanime.fetchAnimeInfo(id);

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

      if (typeof episodeId === 'undefined')
        return reply.status(400).send({ message: 'episodeId is required' });

      try {
        let res = redis
          ? await cache.fetch(
            redis as Redis,
            `kickassanime:watch:${episodeId}:${server}`,
            async () =>
              await fetchWithServerFallback(
                async (selectedServer) =>
                  await kickassanime.fetchEpisodeSources(episodeId, selectedServer),
                server,
              ),
            REDIS_TTL,
          )
          : await fetchWithServerFallback(
            async (selectedServer) =>
              await kickassanime.fetchEpisodeSources(episodeId, selectedServer),
            server,
          );

        reply.status(200).send(res);
      } catch (err) {
        reply
          .status(500)
          .send({ message: 'Something went wrong. Contact developer for help.' });
      }
    },
  );

  fastify.get(
    '/servers/:episodeId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const episodeId = (request.params as { episodeId: string }).episodeId;

      if (typeof episodeId === 'undefined')
        return reply.status(400).send({ message: 'episodeId is required' });

      try {
        let res = redis
          ? await cache.fetch(
            redis as Redis,
            `kickassanime:servers:${episodeId}`,
            async () => await kickassanime.fetchEpisodeServers(episodeId),
            REDIS_TTL,
          )
          : await kickassanime.fetchEpisodeServers(episodeId);

        reply.status(200).send(res);
      } catch (err) {
        reply
          .status(500)
          .send({ message: 'Something went wrong. Contact developer for help.' });
      }
    },
  );
  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.params as { query: string }).query;
    const page = (request.query as { page: number }).page;

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `kickassanime:search:${query}:${page}`,
          async () => await kickassanime.search(query, page),
          REDIS_TTL,
        )
        : await kickassanime.search(query, page);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.', error: (err as any).message });
    }
  });
};

export default routes;
