import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { MANGA } from '@consumet/extensions';
import axios from 'axios';

import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { Redis } from 'ioredis';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  const mangadex = new MANGA.MangaDex();

  const fetchChapterPagesWithFallback = async (chapterId: string) => {
    try {
      return await mangadex.fetchChapterPages(chapterId);
    } catch {
      const { data } = await axios.get(
        `https://api.mangadex.org/at-home/server/${encodeURIComponent(chapterId)}`,
        {
          timeout: 15000,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Mozilla/5.0',
          },
        },
      );

      const baseUrl = String(data?.baseUrl || '');
      const hash = String(data?.chapter?.hash || '');
      const files = Array.isArray(data?.chapter?.data) ? data.chapter.data : [];

      if (!baseUrl || !hash || !files.length) {
        throw new Error('No chapter pages found');
      }

      return files.map((file: string, idx: number) => ({
        img: `${baseUrl}/data/${hash}/${file}`,
        page: String(idx + 1),
      }));
    }
  };

  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro: `Welcome to the mangadex provider: check out the provider's website @ ${mangadex.toString.baseUrl}`,
      routes: ['/:query', '/info/:id', '/read/:chapterId'],
      documentation: 'https://docs.consumet.org/#tag/mangadex',
    });
  });

  // --- SEARCH ---
  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    const { query } = request.params as { query: string };
    const { page } = request.query as { page?: number };

    try {
      const res = redis
        ? await cache.fetch(
            redis as Redis,
            `mangadex:search:${query}:${page ?? 1}`,
            () => mangadex.search(query, page),
            REDIS_TTL,
          )
        : await mangadex.search(query, page);

      reply.status(200).send(res);
    } catch (err) {
      reply.status(500).send({
        message: 'Something went wrong. Please try again later.',
      });
    }
  });

  // --- INFO ---
  fastify.get('/info/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = decodeURIComponent((request.params as { id: string }).id);

    try {
      const res = redis
        ? await cache.fetch(
            redis as Redis,
            `mangadex:info:${id}`,
            () => mangadex.fetchMangaInfo(id),
            REDIS_TTL,
          )
        : await mangadex.fetchMangaInfo(id);

      reply.status(200).send(res);
    } catch (err) {
      reply.status(500).send({
        message: 'Something went wrong. Please try again later.',
      });
    }
  });

  // --- READ CHAPTER ---
  fastify.get(
    '/read/:chapterId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { chapterId } = request.params as { chapterId: string };

      try {
        const res = redis
          ? await cache.fetch(
              redis as Redis,
              `mangadex:read:${chapterId}`,
              () => fetchChapterPagesWithFallback(chapterId),
              REDIS_TTL,
            )
          : await fetchChapterPagesWithFallback(chapterId);

        reply.status(200).send(res);
      } catch (err) {
        reply.status(500).send({
          message: 'Something went wrong. Please try again later.',
        });
      }
    },
  );
};

export default routes;
