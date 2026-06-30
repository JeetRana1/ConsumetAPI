import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import buffstreams from './buffstreams';
import racing from './racing';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  fastify.register(buffstreams, { prefix: '/buffstreams' });
  fastify.register(racing, { prefix: '/racing' });

  fastify.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.status(200).send('Welcome to Consumet Sports');
  });
};

export default routes;
