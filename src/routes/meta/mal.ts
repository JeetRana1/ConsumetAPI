import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { META, PROVIDERS_LIST } from '@consumet/extensions';
import { getProxyCandidatesSync } from '../../utils/outboundProxy';
import { configureProvider } from '../../utils/provider';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro:
        "Welcome to the mal provider: check out the provider's website @ https://mal.co/",
      routes: ['/:query', '/info/:id', '/watch/:episodeId'],
      documentation: 'https://docs.consumet.org/#tag/mal',
    });
  });

  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = (request.params as { query: string }).query;
      const page = (request.query as { page: number }).page;
      const mal = generateMalMeta();
      const res = await mal.search(query, page);
      reply.status(200).send(res);
    } catch (err: any) {
      reply.status(200).send({ results: [], message: err.message });
    }
  });

  // mal info with episodes
  fastify.get('/info/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.params as { id: string }).id;
    const provider = (request.query as { provider?: string }).provider;
    let fetchFiller = (request.query as { fetchFiller?: string | boolean }).fetchFiller;
    let isDub = (request.query as { dub?: string | boolean }).dub;

    const possibleProvider = provider
      ? PROVIDERS_LIST.ANIME.find((p) => p.name.toLowerCase() === provider.toLowerCase())
      : undefined;

    const mal = generateMalMeta(possibleProvider);

    isDub = isDub === 'true' || isDub === '1';
    fetchFiller = fetchFiller === 'true' || fetchFiller === '1';

    try {
      const res = await mal.fetchAnimeInfo(id, isDub as boolean, fetchFiller as boolean);
      reply.status(200).send(res);
    } catch (err: any) {
      reply.status(500).send({ message: err.message });
    }
  });

  fastify.get(
    '/watch/:episodeId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const episodeId = (request.params as { episodeId: string }).episodeId;
      const provider = (request.query as { provider?: string }).provider;

      const possibleProvider = provider
        ? PROVIDERS_LIST.ANIME.find((p) => p.name.toLowerCase() === provider.toLowerCase())
        : undefined;

      const mal = generateMalMeta(possibleProvider);
      try {
        const res = await mal.fetchEpisodeSources(episodeId);
        reply.status(200).send(res);
      } catch (err: any) {
        reply.status(404).send({ message: err.message || err });
      }
    },
  );
};

const generateMalMeta = (provider?: any): any => {
  return configureProvider(new META.Myanimelist(provider));
};

export default routes;
