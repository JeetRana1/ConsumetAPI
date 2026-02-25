import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { META, PROVIDERS_LIST } from '@consumet/extensions';
import { getProxyCandidatesSync } from '../../utils/outboundProxy';
import { configureProvider } from '../../utils/provider';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  fastify.get('/', (_, rp) => {
    const anilist = generateAnilistMangaMeta();
    rp.status(200).send({
      intro: `Welcome to the anilist manga provider: check out the provider's website @ ${anilist.provider.toString().baseUrl || 'https://anilist.co/'}`,
      routes: ['/:query', '/info/:id', '/read'],
      documentation: 'https://docs.consumet.org/#tag/anilist',
    });
  });

  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = (request.params as { query: string }).query;
      const anilist = generateAnilistMangaMeta();
      const res = await anilist.search(query);
      reply.status(200).send(res);
    } catch (err: any) {
      reply.status(200).send({ results: [], message: err.message });
    }
  });

  fastify.get('/info/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.params as { id: string }).id;
    const provider = (request.query as { provider: string }).provider;

    const possibleProvider = provider
      ? PROVIDERS_LIST.MANGA.find((p) => p.name.toLowerCase() === provider.toLowerCase())
      : undefined;

    const anilist = generateAnilistMangaMeta(possibleProvider);

    if (typeof id === 'undefined')
      return reply.status(400).send({ message: 'id is required' });

    try {
      const res = await anilist.fetchMangaInfo(id);
      reply.status(200).send(res);
    } catch (err: any) {
      reply.status(500).send({ message: err.message || 'Something went wrong.' });
    }
  });

  fastify.get('/read', async (request: FastifyRequest, reply: FastifyReply) => {
    const chapterId = (request.query as { chapterId: string }).chapterId;
    const provider = (request.query as { provider: string }).provider;

    const possibleProvider = provider
      ? PROVIDERS_LIST.MANGA.find((p) => p.name.toLowerCase() === provider.toLowerCase())
      : undefined;

    const anilist = generateAnilistMangaMeta(possibleProvider);

    if (typeof chapterId === 'undefined')
      return reply.status(400).send({ message: 'chapterId is required' });

    try {
      const res = await anilist.fetchChapterPages(chapterId);
      reply.status(200).send(res);
    } catch (err: any) {
      reply.status(500).send({ message: err.message || 'Something went wrong.' });
    }
  });

  fastify.get('/chapters/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.params as { id: string }).id;
    const provider = (request.query as { provider: string }).provider;

    const possibleProvider = provider
      ? PROVIDERS_LIST.MANGA.find((p) => p.name.toLowerCase() === provider.toLowerCase())
      : undefined;

    const anilist = generateAnilistMangaMeta(possibleProvider);

    if (typeof id === 'undefined')
      return reply.status(400).send({ message: 'id is required' });

    try {
      const res = await anilist.fetchChaptersList(id);
      reply.status(200).send(res);
    } catch (err: any) {
      reply.status(500).send({ message: err.message || 'Something went wrong.' });
    }
  });
};

const generateAnilistMangaMeta = (provider?: any): any => {
  return configureProvider(new META.Anilist.Manga(provider));
};

export default routes;
