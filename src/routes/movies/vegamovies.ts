import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { VegamoviesProvider } from '../../providers/custom/vegamoviesProvider';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  // GET /movies/vegamovies/
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page = 1 } = request.query as { page?: number };
      const data = await VegamoviesProvider.getRecent(Number(page));
      reply.status(200).send(data);
    } catch (err: any) {
      reply.status(500).send({ message: err.message || 'Something went wrong.' });
    }
  });

  // GET /movies/vegamovies/:query
  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    const { query } = request.params as { query: string };
    const { page = 1 } = request.query as { page?: number };
    try {
      const data = await VegamoviesProvider.search(query, Number(page));
      reply.status(200).send(data);
    } catch (err: any) {
      reply.status(500).send({ message: err.message || 'Something went wrong.' });
    }
  });

  // GET /movies/vegamovies/search?q=avengers&page=1
  fastify.get('/search', async (request: FastifyRequest, reply: FastifyReply) => {
    const { q, query, page = 1 } = request.query as { q?: string; query?: string; page?: number };
    const searchQuery = q || query;
    if (!searchQuery) {
      return reply.status(400).send({ message: 'Query parameter "q" is required.' });
    }
    try {
      const data = await VegamoviesProvider.search(searchQuery, Number(page));
      reply.status(200).send(data);
    } catch (err: any) {
      reply.status(500).send({ message: err.message || 'Something went wrong.' });
    }
  });

  // GET /movies/vegamovies/info?id=426-avengers-endgame-2019-hindi-dual-audio-720p
  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.query as { id?: string };
    if (!id) {
      return reply.status(400).send({ message: 'Query parameter "id" is required.' });
    }
    try {
      const data = await VegamoviesProvider.getInfo(id);
      reply.status(200).send(data);
    } catch (err: any) {
      reply.status(500).send({ message: err.message || 'Something went wrong.' });
    }
  });

  // GET /movies/vegamovies/watch?id=tt4154796&season=1&episode=1
  // id can be: IMDB ID (tt...) or a vegamovies slug
  fastify.get('/watch', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, season, episode } = request.query as { id?: string; season?: string; episode?: string };
    if (!id) {
      return reply.status(400).send({ message: 'Query parameter "id" (IMDB ID or slug) is required.' });
    }
    try {
      const data = await VegamoviesProvider.getSources(
        id, 
        season ? Number(season) : undefined, 
        episode ? Number(episode) : undefined
      );
      reply.status(200).send(data);
    } catch (err: any) {
      reply.status(500).send({ message: err.message || 'Something went wrong.' });
    }
  });
};

export default routes;
