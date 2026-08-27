import { FastifyInstance, RegisterOptions } from 'fastify';
import { ANIME } from '@consumet/extensions';
import { fetchCurrentAniKotoSources } from '../../providers/custom/anikotoProvider';

const routes = async (fastify: FastifyInstance, _options: RegisterOptions) => {
  const createProvider = () => new (ANIME as any).AniKoto();
  const provider = createProvider();
  fastify.get('/', async (_request, reply) => reply.send({ provider: 'anikoto', baseUrl: provider.toString.baseUrl }));

  fastify.get('/:query', async (request: any, reply) => {
    try {
      return reply.send(await provider.search(String(request.params.query), Number(request.query?.page) || 1));
    } catch (error: any) {
      return reply.status(502).send({ message: error?.message || 'AniKoto search failed' });
    }
  });

  fastify.get('/info', async (request: any, reply) => {
    try {
      return reply.send(await provider.fetchAnimeInfo(String(request.query?.id || '')));
    } catch (error: any) {
      return reply.status(502).send({ message: error?.message || 'AniKoto info failed' });
    }
  });

  fastify.get('/watch/:episodeId', async (request: any, reply) => {
    try {
      const episodeId = String(request.params.episodeId);
      const server = request.query?.server;
      try {
        const currentResult = await fetchCurrentAniKotoSources(episodeId, server);
        if (currentResult) return reply.send(currentResult);
      } catch (error: any) {
        request.log.warn({ err: error, episodeId }, 'Current AniKoto extraction failed; using extension provider');
      }

      let result: any;
      try {
        result = await createProvider().fetchEpisodeSources(episodeId, server);
      } catch (firstError) {
        // AniKoto's provider can retain stale extractor state. Recreate it once,
        // matching the recovery users previously got by restarting the API.
        request.log.warn({ err: firstError, episodeId }, 'AniKoto watch retry with fresh provider');
        result = await createProvider().fetchEpisodeSources(episodeId, server);
      }
      return reply.send(result);
    } catch (error: any) {
      return reply.status(502).send({ message: error?.message || 'AniKoto source extraction failed' });
    }
  });
};

export default routes;
