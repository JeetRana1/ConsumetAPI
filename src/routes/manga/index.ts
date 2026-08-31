import { FastifyInstance, RegisterOptions } from 'fastify';
import mangak from './mangak';

const routes = async (fastify: FastifyInstance, _options: RegisterOptions) => {
  await fastify.register(mangak, { prefix: '/mangak' });
};

export default routes;
