import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import mangapill from './mangapill';
import mangadex from './mangadex';
import mangakakalot from './mangakakalot';
import mangahere from './mangahere';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  const supportedProviders = ['mangadex', 'mangahere', 'mangapill', 'mangakakalot'];

  await fastify.register(mangadex, { prefix: '/mangadex' });
  await fastify.register(mangahere, { prefix: '/mangahere' });
  await fastify.register(mangapill, { prefix: '/mangapill' });
  await fastify.register(mangakakalot, { prefix: '/mangakakalot' });

  fastify.get('/', async (request: any, reply: any) => {
    reply.status(200).send(
      'Welcome to Consumet Manga our available providers are: ' + supportedProviders.join(', '),
    );

  });

  fastify.get('/:mangaProvider', async (request: FastifyRequest, reply: FastifyReply) => {
    const mangaProvider = decodeURIComponent((request.params as { mangaProvider: string }).mangaProvider);

    try {
      if (supportedProviders.includes(mangaProvider)) {
        reply.redirect(`/manga/${mangaProvider}`);
      } else {
        reply
          .status(404)
          .send({ message: 'Page not found, please check the provider list.' });
      }
    } catch (err) {
      reply.status(500).send('Something went wrong. Please try again later.');
    }
  });
};

export default routes;
