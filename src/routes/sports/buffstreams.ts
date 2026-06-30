import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { BuffStreams } from '../../providers/sports/buffstreams';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  const buffstreams = new BuffStreams();

  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro: 'Welcome to the BuffStreams sports provider',
      routes: ['/:query', '/info', '/watch'],
    });
  });

  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = decodeURIComponent((request.params as { query: string }).query);
    const date = (request.query as { date?: string }).date;

    try {
      let res = await buffstreams.search(query, { date });

      reply.status(200).send(res);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.query as { id: string }).id;

    if (typeof id === 'undefined') {
      return reply.status(400).send({ message: 'id is required' });
    }

    try {
      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      reply.header('Pragma', 'no-cache');
      reply.header('Expires', '0');

      const res = await buffstreams.fetchMediaInfo(id);

      reply.status(200).send(res);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/watch', async (request: FastifyRequest, reply: FastifyReply) => {
    const episodeId = (request.query as { episodeId: string }).episodeId;

    if (typeof episodeId === 'undefined') {
      return reply.status(400).send({ message: 'episodeId is required' });
    }

    try {
      let res = await buffstreams.fetchEpisodeSources(episodeId);

      reply.status(200).send(res);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/livesport', async (request: FastifyRequest, reply: FastifyReply) => {
    const title = (request.query as { title: string }).title;
    const sport = (request.query as { sport: string }).sport || 'soccer';

    if (typeof title === 'undefined') {
      return reply.status(400).send({ message: 'title is required' });
    }

    try {
      const { LiveSportHelper } = await import('../../providers/sports/livesport-helper');
      const axios = (await import('axios')).default;
      const client = axios.create();
      const res = await LiveSportHelper.getLiveStats(client, title, sport);
      reply.status(200).send(res);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/directory', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { LiveSportHelper } = await import('../../providers/sports/livesport-helper');
      const axios = (await import('axios')).default;
      const client = axios.create();
      const res = await LiveSportHelper.getGlobalDirectory(client);
      reply.status(200).send(res);
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });
};

export default routes;



