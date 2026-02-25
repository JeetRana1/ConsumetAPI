import { Redis } from 'ioredis';
import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { META } from '@consumet/extensions';
import { Genres, SubOrSub } from '@consumet/extensions/dist/models';
import Anilist from '@consumet/extensions/dist/providers/meta/anilist';
import { StreamingServers } from '@consumet/extensions/dist/models';

import cache from '../../utils/cache';
import { redis } from '../../main';
import Hianime from '@consumet/extensions/dist/providers/anime/hianime';
import { fetchWithServerFallback } from '../../utils/streamable';
import { configureProvider } from '../../utils/provider';
import { getProxyCandidatesSync } from '../../utils/outboundProxy';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro:
        "Welcome to the anilist provider: check out the provider's website @ https://anilist.co/",
      routes: ['/:query', '/info/:id', '/watch/:episodeId'],
      documentation: 'https://docs.consumet.org/#tag/anilist',
    });
  });

  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const anilist = generateAnilistMeta();
      const query = (request.params as { query: string }).query;
      const page = (request.query as { page: number }).page;
      const perPage = (request.query as { perPage: number }).perPage;

      const res = await anilist.search(query, page, perPage);
      reply.status(200).send(res);
    } catch (err: any) {
      console.error('[Anilist] Search error:', err?.message || err);
      reply.status(200).send({ results: [], message: err?.message || 'Search failed' });
    }
  });

  fastify.get(
    '/advanced-search',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = (request.query as { query: string }).query;
      const page = (request.query as { page: number }).page;
      const perPage = (request.query as { perPage: number }).perPage;
      const type = (request.query as { type: string }).type;
      let genres = (request.query as { genres?: string | string[] }).genres;
      const id = (request.query as { id: string }).id;
      const format = (request.query as { format: string }).format;
      let sort = (request.query as { sort?: string | string[] }).sort;
      const status = (request.query as { status: string }).status;
      const year = (request.query as { year: number }).year;
      const season = (request.query as { season: string }).season;
      const countryOfOrigin = (request.query as { countryOfOrigin: string }).countryOfOrigin;

      const anilist = generateAnilistMeta();

      if (genres) {
        try {
          const parsedGenres = JSON.parse(genres as string);
          parsedGenres.forEach((genre: string) => {
            if (!Object.values(Genres).includes(genre as Genres)) {
              // We'll just skip invalid genres or handle specifically
            }
          });
          genres = parsedGenres;
        } catch {
          genres = undefined;
        }
      }

      if (sort) {
        try {
          sort = JSON.parse(sort as string);
        } catch {
          sort = undefined;
        }
      }

      if (season) {
        if (!['WINTER', 'SPRING', 'SUMMER', 'FALL'].includes(season))
          return reply.status(400).send({ message: `${season} is not a valid season` });
      }

      const res = await anilist.advancedSearch(
        query,
        type,
        page,
        perPage,
        format,
        sort as string[],
        genres as string[],
        id,
        year,
        status,
        season,
        countryOfOrigin
      );

      reply.status(200).send(res);
    },
  );

  fastify.get('/trending', async (request: FastifyRequest, reply: FastifyReply) => {
    const page = (request.query as { page: number }).page;
    const perPage = (request.query as { perPage: number }).perPage;

    const anilist = generateAnilistMeta();

    redis
      ? reply
        .status(200)
        .send(
          await cache.fetch(
            redis as Redis,
            `anilist:trending;${page};${perPage}`,
            async () => await anilist.fetchTrendingAnime(page, perPage),
            60 * 60,
          ),
        )
      : reply.status(200).send(await anilist.fetchTrendingAnime(page, perPage));
  });

  fastify.get('/popular', async (request: FastifyRequest, reply: FastifyReply) => {
    const page = (request.query as { page: number }).page;
    const perPage = (request.query as { perPage: number }).perPage;

    const anilist = generateAnilistMeta();

    redis
      ? reply
        .status(200)
        .send(
          await cache.fetch(
            redis as Redis,
            `anilist:popular;${page};${perPage}`,
            async () => await anilist.fetchPopularAnime(page, perPage),
            60 * 60,
          ),
        )
      : reply.status(200).send(await anilist.fetchPopularAnime(page, perPage));
  });

  fastify.get(
    '/airing-schedule',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const page = (request.query as { page: number }).page;
      const perPage = (request.query as { perPage: number }).perPage;
      const weekStart = (request.query as { weekStart: number | string }).weekStart;
      const weekEnd = (request.query as { weekEnd: number | string }).weekEnd;
      const notYetAired = (request.query as { notYetAired: boolean }).notYetAired;

      const anilist = generateAnilistMeta();
      const _weekStart = Math.ceil(Date.now() / 1000);

      const res = await anilist.fetchAiringSchedule(
        page ?? 1,
        perPage ?? 20,
        weekStart ?? _weekStart,
        weekEnd ?? _weekStart + 604800,
        notYetAired ?? true,
      );

      reply.status(200).send(res);
    },
  );

  fastify.get('/genre', async (request: FastifyRequest, reply: FastifyReply) => {
    const genres = (request.query as { genres: string }).genres;
    const page = (request.query as { page: number }).page;
    const perPage = (request.query as { perPage: number }).perPage;

    const anilist = generateAnilistMeta();

    if (typeof genres === 'undefined')
      return reply.status(400).send({ message: 'genres is required' });

    try {
      const parsedGenres = JSON.parse(genres);
      const res = await anilist.fetchAnimeGenres(parsedGenres, page, perPage);
      reply.status(200).send(res);
    } catch (err: any) {
      reply.status(400).send({ message: 'Invalid genres data' });
    }
  });

  fastify.get(
    '/recent-episodes',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const provider = (request.query as { provider: 'Hianime' }).provider;
      const page = (request.query as { page: number }).page;
      const perPage = (request.query as { perPage: number }).perPage;

      const anilist = generateAnilistMeta(provider);
      const res = await anilist.fetchRecentEpisodes(provider, page, perPage);
      reply.status(200).send(res);
    }
  );

  fastify.get('/random-anime', async (request: FastifyRequest, reply: FastifyReply) => {
    const anilist = generateAnilistMeta();
    const res = await anilist.fetchRandomAnime().catch(() => {
      return reply.status(404).send({ message: 'Anime not found' });
    });
    reply.status(200).send(res);
  });

  fastify.get('/servers/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.params as { id: string }).id;
    const provider = (request.query as { provider?: string }).provider;

    let anilist = generateAnilistMeta(provider);
    const res = await anilist.fetchEpisodeServers(id);
    reply.status(200).send(res);
  });

  fastify.get('/episodes/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const id = (request.params as { id: string }).id;
    const provider = (request.query as { provider?: string }).provider;
    let fetchFiller = (request.query as { fetchFiller?: string | boolean }).fetchFiller;
    let dub = (request.query as { dub?: string | boolean }).dub;

    let anilist = generateAnilistMeta(provider);

    dub = (dub === 'true' || dub === '1');
    fetchFiller = (fetchFiller === 'true' || fetchFiller === '1');

    try {
      if (redis) {
        const data = await cache.fetch(
          redis,
          `anilist:episodes;${id};${dub};${fetchFiller};${anilist.provider.name.toLowerCase()}`,
          async () => anilist.fetchEpisodesListById(id, dub as boolean, fetchFiller as boolean),
          dayOfWeek === 0 || dayOfWeek === 6 ? 60 * 120 : (60 * 60) / 2,
        );
        reply.status(200).send(data);
      } else {
        const data = await anilist.fetchEpisodesListById(id, dub as boolean, fetchFiller as boolean);
        reply.status(200).send(data);
      }
    } catch (err) {
      return reply.status(404).send({ message: 'Anime not found' });
    }
  });

  fastify.get('/data/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.params as { id: string }).id;
    const anilist = generateAnilistMeta();
    const res = await anilist.fetchAnilistInfoById(id);
    reply.status(200).send(res);
  });

  fastify.get('/info/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.params as { id: string }).id;
    const today = new Date();
    const dayOfWeek = today.getDay();
    const provider = (request.query as { provider?: string }).provider;
    let fetchFiller = (request.query as { fetchFiller?: string | boolean }).fetchFiller;
    let isDub = (request.query as { dub?: string | boolean }).dub;

    let anilist = generateAnilistMeta(provider);

    isDub = (isDub === 'true' || isDub === '1');
    fetchFiller = (fetchFiller === 'true' || fetchFiller === '1');

    try {
      if (redis) {
        const data = await cache.fetch(
          redis,
          `anilist:info;${id};${isDub};${fetchFiller};${anilist.provider.name.toLowerCase()}`,
          async () => anilist.fetchAnimeInfo(id, isDub as boolean, fetchFiller as boolean),
          dayOfWeek === 0 || dayOfWeek === 6 ? 60 * 120 : (60 * 60) / 2,
        );
        reply.status(200).send(data);
      } else {
        const data = await anilist.fetchAnimeInfo(id, isDub as boolean, fetchFiller as boolean);
        reply.status(200).send(data);
      }
    } catch (err: any) {
      reply.status(500).send({ message: err.message });
    }
  });

  fastify.get('/character/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.params as { id: string }).id;
    const anilist = generateAnilistMeta();
    const res = await anilist.fetchCharacterInfoById(id);
    reply.status(200).send(res);
  });

  fastify.get(
    '/watch/:episodeId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const episodeId = (request.params as { episodeId: string }).episodeId;
      const provider = (request.query as { provider?: string }).provider;
      const server = (request.query as { server?: StreamingServers }).server;
      let isDub = (request.query as { dub?: string | boolean }).dub;

      if (server && !Object.values(StreamingServers).includes(server))
        return reply.status(400).send('Invalid server');

      isDub = (isDub === 'true' || isDub === '1');
      let anilist = generateAnilistMeta(provider);

      try {
        const fetchSources = async (selectedServer?: StreamingServers) => {
          return provider === 'zoro' || provider === 'hianime'
            ? await anilist.fetchEpisodeSources(
              episodeId,
              selectedServer,
              isDub ? SubOrSub.DUB : SubOrSub.SUB,
            )
            : await anilist.fetchEpisodeSources(episodeId, selectedServer);
        };

        if (redis) {
          const data = await cache.fetch(
            redis,
            `anilist:watch;${episodeId};${anilist.provider.name.toLowerCase()};${server};${isDub ? 'dub' : 'sub'}`,
            async () => await fetchWithServerFallback(fetchSources, server),
            600,
          );
          reply.status(200).send(data);
        } else {
          const data = await fetchWithServerFallback(fetchSources, server);
          reply.status(200).send(data);
        }
      } catch (err) {
        reply.status(500).send({ message: 'Something went wrong.' });
      }
    },
  );

  fastify.get('/staff/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.params as { id: string }).id;
    const anilist = generateAnilistMeta();
    try {
      if (redis) {
        const data = await cache.fetch(
          redis,
          `anilist:staff;${id}`,
          async () => await anilist.fetchStaffById(Number(id)),
          60 * 60,
        );
        reply.status(200).send(data);
      } else {
        const data = await anilist.fetchStaffById(Number(id));
        reply.status(200).send(data);
      }
    } catch (err: any) {
      reply.status(404).send({ message: err.message });
    }
  });

  fastify.get('/favorites', async (request: FastifyRequest, reply: FastifyReply) => {
    const type = (request.query as { type?: 'ANIME' | 'MANGA' | 'BOTH' }).type;
    const headers = request.headers as Record<string, string>;

    if (!headers.authorization) {
      return reply.status(401).send({ message: 'Authorization header is required' });
    }

    const anilist = generateAnilistMeta();
    try {
      const res = await anilist.fetchFavoriteList(headers.authorization, type);
      reply.status(200).send(res);
    } catch (err: any) {
      reply.status(500).send({ message: err.message });
    }
  });
};

const generateAnilistMeta = (provider: string | undefined = undefined): Anilist => {
  const proxies = getProxyCandidatesSync();
  const url = proxies.length > 0 ? (proxies.length === 1 ? proxies[0] : proxies) : [];
  return new Anilist(configureProvider(new Hianime()), {
    url: url as string | string[],
  });
};

export default routes;
