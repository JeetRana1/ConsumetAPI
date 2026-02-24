import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { MANGA } from '@consumet/extensions';

import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { Redis } from 'ioredis';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  const mangakakalot = new MANGA.MangaKakalot();
  const mangapill = new MANGA.MangaPill();
  const mangahere = new MANGA.MangaHere();

  const fromCache = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    return redis ? await cache.fetch(redis as Redis, key, fn, REDIS_TTL) : await fn();
  };

  const tryMany = async <T>(fns: Array<() => Promise<T>>): Promise<T> => {
    let lastErr: any = null;
    for (const fn of fns) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('All provider fallbacks failed');
  };

  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro: `Welcome to the Mangakakalot provider (with fallbacks): check out the provider's website @ ${mangakakalot.toString.baseUrl}`,
      routes: {
        '/:query': {
          description: 'Search for manga by title',
          example: '/manga/mangakakalot/naruto?page=1',
        },
        '/info': {
          description: 'Get manga details by id',
          example: '/manga/mangakakalot/info?id=naruto',
        },
        '/read': {
          description: 'Get chapter pages/images by chapterId',
          example: '/manga/mangakakalot/read?chapterId=naruto/chapter-700-5',
        },
        '/latestmanga': {
          description: 'Get latest updates',
          example: '/manga/mangakakalot/latestmanga?page=1',
        },
        '/suggestions': {
          description: 'Get autocomplete suggestions while typing',
          example: '/manga/mangakakalot/suggestions?query=one piece',
        },
        '/bygenre': {
          description: 'Get manga filtered by genre',
          example: '/manga/mangakakalot/bygenre?genre=action&page=1',
        },
      },
      documentation: 'https://docs.consumet.org/#tag/mangakakalot',
    });
  });

  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.query as { id: string }).id;

    if (!id) {
      return reply.status(400).send({
        message: 'id is required',
      });
    }

    try {
      const res = await tryMany([
        () =>
          fromCache(`mangakakalot:info:${id}`, () =>
            mangakakalot.fetchMangaInfo(id),
          ),
        () =>
          fromCache(`mangakakalot:fallback:mangapill:info:${id}`, () =>
            mangapill.fetchMangaInfo(id),
          ),
        () =>
          fromCache(`mangakakalot:fallback:mangahere:info:${id}`, () =>
            mangahere.fetchMangaInfo(id),
          ),
      ]);

      reply.status(200).send(res);
    } catch {
      reply.status(500).send({
        message: 'Failed to fetch manga info from all fallback providers.',
      });
    }
  });

  fastify.get('/read', async (request: FastifyRequest, reply: FastifyReply) => {
    const chapterId = (request.query as { chapterId: string }).chapterId;

    if (!chapterId) {
      return reply.status(400).send({
        message: 'chapterId is required',
      });
    }

    try {
      const res = await tryMany([
        () =>
          fromCache(`mangakakalot:read:${chapterId}`, () =>
            mangakakalot.fetchChapterPages(chapterId),
          ),
        () =>
          fromCache(`mangakakalot:fallback:mangapill:read:${chapterId}`, () =>
            mangapill.fetchChapterPages(chapterId),
          ),
        () =>
          fromCache(`mangakakalot:fallback:mangahere:read:${chapterId}`, () =>
            mangahere.fetchChapterPages(chapterId),
          ),
      ]);

      reply.status(200).send(res);
    } catch {
      reply.status(500).send({
        message: 'Failed to fetch chapter pages from all fallback providers.',
      });
    }
  });

  fastify.get('/latestmanga', async (request: FastifyRequest, reply: FastifyReply) => {
    const page = (request.query as { page?: number }).page || 1;
    const mh = mangahere as any;
    const mp = mangapill as any;

    try {
      const res = await tryMany([
        () =>
          fromCache(`mangakakalot:latestmanga:${page}`, () =>
            mangakakalot.fetchLatestUpdates(page),
          ),
        () =>
          fromCache(`mangakakalot:fallback:mangahere:latestmanga:${page}`, async () => {
            if (typeof mh.fetchLatestUpdates === 'function') return await mh.fetchLatestUpdates(page);
            return await mangahere.search('one piece', page);
          }),
        () =>
          fromCache(`mangakakalot:fallback:mangapill:latestmanga:${page}`, async () => {
            if (typeof mp.fetchLatestUpdates === 'function') return await mp.fetchLatestUpdates(page);
            return await mangapill.search('one piece');
          }),
      ]);

      reply.status(200).send(res);
    } catch {
      reply.status(500).send({
        message: 'Failed to fetch latest manga updates from all fallback providers.',
      });
    }
  });

  fastify.get('/bygenre', async (request: FastifyRequest, reply: FastifyReply) => {
    const genre = (request.query as { genre: string }).genre;
    const page = (request.query as { page?: number }).page || 1;

    if (!genre) {
      return reply.status(400).send({ message: 'genre is required' });
    }

    try {
      const res = await tryMany([
        () =>
          fromCache(`mangakakalot:bygenre:${genre}:${page}`, () =>
            mangakakalot.fetchByGenre(genre, page),
          ),
        () =>
          fromCache(`mangakakalot:fallback:mangahere:bygenre:${genre}:${page}`, () =>
            mangahere.search(genre, page),
          ),
        () =>
          fromCache(`mangakakalot:fallback:mangapill:bygenre:${genre}:${page}`, () =>
            mangapill.search(genre),
          ),
      ]);

      reply.status(200).send(res);
    } catch {
      reply.status(500).send({
        message: 'Failed to fetch by genre from all fallback providers.',
      });
    }
  });

  fastify.get('/suggestions', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.query as { query: string }).query;
    const mp = mangapill as any;

    if (!query) {
      return reply.status(400).send({ message: 'query is required' });
    }

    try {
      const res = await tryMany([
        () =>
          fromCache(`mangakakalot:suggestions:${query}`, () =>
            mangakakalot.fetchSuggestions(query),
          ),
        () =>
          fromCache(`mangakakalot:fallback:mangapill:suggestions:${query}`, async () => {
            if (typeof mp.fetchSuggestions === 'function') return await mp.fetchSuggestions(query);
            return await mangapill.search(query);
          }),
        () =>
          fromCache(`mangakakalot:fallback:mangahere:suggestions:${query}`, () =>
            mangahere.search(query, 1),
          ),
      ]);

      reply.status(200).send(res);
    } catch {
      reply.status(500).send({
        message: 'Failed to fetch suggestions from all fallback providers.',
      });
    }
  });

  // This parametric route MUST be last to avoid catching static routes like /info, /read, etc.
  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    const { query } = request.params as { query: string };
    const page = (request.query as { page?: number }).page || 1;

    const ensureSearchShape = (payload: any) => {
      if (!payload) return null;
      if (Array.isArray(payload)) return { currentPage: String(page), hasNextPage: false, results: payload };
      if (Array.isArray(payload?.results)) return payload;
      if (Array.isArray(payload?.data?.results)) {
        return { ...payload, results: payload.data.results };
      }
      if (Array.isArray(payload?.data)) {
        return { currentPage: String(page), hasNextPage: false, results: payload.data };
      }
      return null;
    };

    const safe = async (fn: () => Promise<any>) => {
      try {
        return ensureSearchShape(await fn());
      } catch {
        return null;
      }
    };

    try {
      // Keep this endpoint stable for UI discovery: prefer providers that are currently reliable.
      const fromPill = await safe(() => mangapill.search(query));
      if (fromPill) return reply.status(200).send(fromPill);

      const fromHere = await safe(() => mangahere.search(query, page));
      if (fromHere) return reply.status(200).send(fromHere);

      const fromKakalot = await safe(() => mangakakalot.search(query, page));
      if (fromKakalot) return reply.status(200).send(fromKakalot);

      return reply.status(200).send({
        currentPage: String(page),
        hasNextPage: false,
        results: [],
      });
    } catch {
      return reply.status(200).send({
        currentPage: String(page),
        hasNextPage: false,
        results: [],
      });
    }
  });
};

export default routes;
