import { FastifyInstance, RegisterOptions } from 'fastify';
import { ANIME } from '@consumet/extensions';

const routes = async (fastify: FastifyInstance, _options: RegisterOptions) => {
  const provider = new (ANIME as any).AniKoto();

  fastify.get('/', async (_request, reply) => {
    reply.send({
      intro: `Welcome to the anikoto provider: check out ${provider.toString.baseUrl}`,
      routes: ['/:query', '/info', '/watch/:episodeId'],
    });
  });

  fastify.get('/:query', async (request: any, reply) => {
    try {
      reply.send(await provider.search(String(request.params.query), Number(request.query?.page) || 1));
    } catch (error: any) {
      reply.status(500).send({ message: error?.message || 'AniKoto search failed' });
    }
  });

  fastify.get('/info', async (request: any, reply) => {
    try {
      reply.send(await provider.fetchAnimeInfo(String(request.query?.id || '')));
    } catch (error: any) {
      reply.status(500).send({ message: error?.message || 'AniKoto info failed' });
    }
  });

  fastify.get('/watch/:episodeId', async (request: any, reply) => {
    try {
      reply.send(await provider.fetchEpisodeSources(String(request.params.episodeId)));
    } catch (error: any) {
      reply.status(500).send({ message: error?.message || 'AniKoto source extraction failed' });
    }
  });
};

export default routes;
