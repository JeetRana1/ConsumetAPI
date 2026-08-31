import { FastifyInstance, RegisterOptions } from 'fastify';
import { MangakProvider } from '../../providers/custom/mangakProvider';

const routes = async (fastify: FastifyInstance, _options: RegisterOptions) => {
  fastify.get('/search/:query', async (request: any, reply) => {
    try {
      const result = await MangakProvider.search(request.params.query, Number(request.query?.page) || 1, Number(request.query?.limit) || 20);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(502).send({ message: error.message });
    }
  });

  fastify.get('/info/:id', async (request: any, reply) => {
    try {
      const result = await MangakProvider.info(request.params.id);
      return result ? reply.send(result) : reply.status(404).send({ message: 'Manga not found' });
    } catch (error: any) {
      return reply.status(502).send({ message: error.message });
    }
  });

  fastify.get('/chapters/:id', async (request: any, reply) => {
    try {
      return reply.send({ chapters: await MangakProvider.chapters(request.params.id) });
    } catch (error: any) {
      return reply.status(502).send({ message: error.message });
    }
  });

  fastify.get('/chapter-images/:slug/:chapterSlug', async (request: any, reply) => {
    try {
      const result = await MangakProvider.chapterImages(request.params.slug, request.params.chapterSlug);
      return result ? reply.send(result) : reply.status(404).send({ message: 'Chapter images not found' });
    } catch (error: any) {
      return reply.status(502).send({ message: error.message });
    }
  });

  fastify.get('/chapter/:id/:slug/:number', async (request: any, reply) => {
    try {
      const result = await MangakProvider.chapter(request.params.id, request.params.slug, Number(request.params.number));
      return result ? reply.send(result) : reply.status(404).send({ message: 'Chapter not found' });
    } catch (error: any) {
      return reply.status(502).send({ message: error.message });
    }
  });
};

export default routes;
