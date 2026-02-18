import { FastifyInstance, RegisterOptions } from 'fastify';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      message: 'MangaKakalot is currently unavailable in this version of the API.',
    });
  });
};

export default routes;
