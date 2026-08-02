import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { HdStream4uProvider } from '../../providers/custom/hdstream4uProvider';

const sourceCache = new Map<string, { expires: number; value: any }>();
const SOURCE_CACHE_TTL_MS = 5 * 60 * 1000;

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro: 'HDStream4u / HDHub4u provider',
      routes: ['/search', '/info', '/watch'],
    });
  });

  fastify.get('/search', async (request: FastifyRequest, reply: FastifyReply) => {
    const { query, page } = request.query as { query?: string; page?: number };
    if (!query) return reply.status(400).send({ error: 'query is required' });
    const res = await HdStream4uProvider.search(query, page || 1);
    reply.status(200).send(res);
  });

  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, type } = request.query as { id?: string; type?: string };
    if (!id) return reply.status(400).send({ error: 'id is required' });
    const res = await HdStream4uProvider.fetchMediaInfo(id, type || 'movie');
    reply.status(200).send(res);
  });

  fastify.get('/watch', async (request: FastifyRequest, reply: FastifyReply) => {
    const { episodeId, server, mediaId } = request.query as {
      episodeId?: string;
      server?: string;
      mediaId?: string;
    };
    if (!episodeId) return reply.status(400).send({ error: 'episodeId is required' });
    const cacheKey = `${episodeId}|${server || ''}|${mediaId || ''}`;
    const cached = sourceCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return reply.status(200).send(cached.value);
    }

    let res = await HdStream4uProvider.fetchSources(episodeId, server, false, { mediaId });
    if (!res?.sources?.length) {
      res = await HdStream4uProvider.fetchSources(episodeId, server, false, { mediaId });
    }
    const hasShortLivedHls = res?.sources?.some((source: any) =>
      Boolean(source?.isM3U8 || source?.isM3u8 || /\.m3u8(?:[?#]|$)/i.test(String(source?.url || ''))),
    );
    if (res?.sources?.length && !hasShortLivedHls) {
      sourceCache.set(cacheKey, { expires: Date.now() + SOURCE_CACHE_TTL_MS, value: res });
    }
    reply.status(200).send(res);
  });
};

export default routes;
