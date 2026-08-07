import { FastifyInstance, RegisterOptions } from 'fastify';
const routes = async (fastify: FastifyInstance, _options: RegisterOptions) => {
  fastify.get('/', async (_request, reply) => {
    reply.status(503).send({ message: 'AniKoto is unavailable in the installed extensions package' });
  });

  fastify.get('/:query', async (request: any, reply) => {
    reply.status(503).send({ message: 'AniKoto is unavailable in the installed extensions package' });
  });

  fastify.get('/info', async (request: any, reply) => {
    reply.status(503).send({ message: 'AniKoto is unavailable in the installed extensions package' });
  });

  fastify.get('/watch/:episodeId', async (request: any, reply) => {
    reply.status(503).send({ message: 'AniKoto is unavailable in the installed extensions package' });
  });
};

export default routes;
