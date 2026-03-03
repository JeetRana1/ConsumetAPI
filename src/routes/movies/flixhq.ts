import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { MOVIES } from '@consumet/extensions';
import { StreamingServers } from '@consumet/extensions/dist/models';

import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { Redis } from 'ioredis';
import { fetchWithServerFallback, MOVIE_SERVER_FALLBACKS } from '../../utils/streamable';
import { configureProvider } from '../../utils/provider';
import { getMovieEmbedFallbackSource } from '../../utils/movieServerFallback';
import { promoteEmbedSourcesToDirect } from '../../utils/embedToDirect';
import { extractDirectSourcesWithPlaywright } from '../../utils/browserRuntimeExtractor';

const isDirectMediaUrl = (value: string): boolean =>
  /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(value || '')) || /\/m3u8-proxy\?/i.test(String(value || ''));

const parseResolution = (value: string): number => {
  const text = String(value || '');
  const byP = text.match(/(?:^|\D)(\d{3,4})p(?:\D|$)/i);
  if (byP) return Number(byP[1]);
  const byX = text.match(/(?:^|\D)(\d{3,4})x\d{3,4}(?:\D|$)/i);
  if (byX) return Number(byX[1]);
  if (/4k|2160/i.test(text)) return 2160;
  return 0;
};

const sourceRank = (source: any, fastStart = true): number => {
  const url = String(source?.url || '').toLowerCase();
  const qualityText = String(source?.quality || '');
  const resolution = parseResolution(qualityText || url);

  let score = 0;
  if (/\.m3u8(\?|$)/.test(url) || /m3u8-proxy/.test(url)) score += 3000;
  else if (/\.mpd(\?|$)/.test(url)) score += 2000;
  else if (/\.mp4(\?|$)/.test(url)) score += 1000;

  if (fastStart) {
    if (resolution > 0) score += Math.max(0, 1200 - resolution);
  } else {
    score += resolution;
  }

  if (/backup|alt|mirror/.test(String(source?.server || '').toLowerCase())) score -= 100;
  return score;
};

const sortAndLimitSources = (rawSources: any[], fastStart = true): any[] => {
  const deduped = rawSources.filter(
    (item, idx, arr) => arr.findIndex((v) => String(v?.url || '') === String(item?.url || '')) === idx,
  );

  const direct = deduped.filter((s) => isDirectMediaUrl(String(s?.url || '')));
  const nonDirect = deduped.filter((s) => !isDirectMediaUrl(String(s?.url || '')));

  direct.sort((a, b) => sourceRank(b, fastStart) - sourceRank(a, fastStart));
  return [...direct.slice(0, 8), ...nonDirect.slice(0, 2)];
};

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  const flixhq = configureProvider(new MOVIES.FlixHQ());

  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro: `Welcome to the flixhq provider: check out the provider's website @ ${flixhq.toString.baseUrl}`,
      routes: [
        '/:query',
        '/info',
        '/watch',
        '/recent-shows',
        '/recent-movies',
        '/trending',
        '/servers',
        '/country',
        '/genre',
      ],
      documentation: 'https://docs.consumet.org/#tag/flixhq',
    });
  });

  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = decodeURIComponent((request.params as { query: string }).query);

    const page = (request.query as { page: number }).page;

    let res = redis
      ? await cache.fetch(
          redis as Redis,
          `flixhq:${query}:${page}`,
          async () => await flixhq.search(query, page ? page : 1),
          REDIS_TTL,
        )
      : await flixhq.search(query, page ? page : 1);

    reply.status(200).send(res);
  });

  fastify.get('/recent-shows', async (request: FastifyRequest, reply: FastifyReply) => {
    let res = redis
      ? await cache.fetch(
          redis as Redis,
          `flixhq:recent-shows`,
          async () => await flixhq.fetchRecentTvShows(),
          REDIS_TTL,
        )
      : await flixhq.fetchRecentTvShows();

    reply.status(200).send(res);
  });

  fastify.get('/recent-movies', async (request: FastifyRequest, reply: FastifyReply) => {
    let res = redis
      ? await cache.fetch(
          redis as Redis,
          `flixhq:recent-movies`,
          async () => await flixhq.fetchRecentMovies(),
          REDIS_TTL,
        )
      : await flixhq.fetchRecentMovies();

    reply.status(200).send(res);
  });

  fastify.get('/trending', async (request: FastifyRequest, reply: FastifyReply) => {
    const type = (request.query as { type: string }).type;
    try {
      if (!type) {
        const res = {
          results: [
            ...(await flixhq.fetchTrendingMovies()),
            ...(await flixhq.fetchTrendingTvShows()),
          ],
        };
        return reply.status(200).send(res);
      }

      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `flixhq:trending:${type}`,
            async () =>
              type === 'tv'
                ? await flixhq.fetchTrendingTvShows()
                : await flixhq.fetchTrendingMovies(),
            REDIS_TTL,
          )
        : type === 'tv'
          ? await flixhq.fetchTrendingTvShows()
          : await flixhq.fetchTrendingMovies();

      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({
        message:
          'Something went wrong. Please try again later. or contact the developers.',
      });
    }
  });

  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.query as { id: string }).id;

    if (typeof id === 'undefined')
      return reply.status(400).send({
        message: 'id is required',
      });

    try {
      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `flixhq:info:${id}`,
            async () => await flixhq.fetchMediaInfo(id),
            REDIS_TTL,
          )
        : await flixhq.fetchMediaInfo(id);

      reply.status(200).send(res);
    } catch (err) {
      reply.status(500).send({
        message:
          'Something went wrong. Please try again later. or contact the developers.',
      });
    }
  });

  fastify.get('/watch', async (request: FastifyRequest, reply: FastifyReply) => {
    const episodeId = (request.query as { episodeId: string }).episodeId;
    const mediaId = (request.query as { mediaId: string }).mediaId;
    const server = (request.query as { server: StreamingServers }).server;
    const fastStartRaw = String((request.query as { fastStart?: string }).fastStart || 'true')
      .toLowerCase()
      .trim();
    const fastStart = fastStartRaw !== '0' && fastStartRaw !== 'false' && fastStartRaw !== 'no';

    if (typeof episodeId === 'undefined')
      return reply.status(400).send({ message: 'episodeId is required' });
    if (typeof mediaId === 'undefined')
      return reply.status(400).send({ message: 'mediaId is required' });

    if (server && !Object.values(StreamingServers).includes(server))
      return reply.status(400).send({ message: 'Invalid server query' });

    try {
      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `flixhq:watch:${episodeId}:${mediaId}:${server}`,
            async () =>
              await fetchWithServerFallback(
                async (selectedServer) =>
                  await flixhq.fetchEpisodeSources(episodeId, mediaId, selectedServer),
                server,
                MOVIE_SERVER_FALLBACKS,
              ),
            REDIS_TTL,
          )
        : await fetchWithServerFallback(
            async (selectedServer) =>
              await flixhq.fetchEpisodeSources(episodeId, mediaId, selectedServer),
            server,
            MOVIE_SERVER_FALLBACKS,
          );

      const promoted = await promoteEmbedSourcesToDirect(
        flixhq as any,
        res as any,
        server,
      );
      if (Array.isArray((promoted as any)?.sources)) {
        (promoted as any).sources = sortAndLimitSources((promoted as any).sources, fastStart);
      }

      const currentSources = Array.isArray((promoted as any)?.sources)
        ? (promoted as any).sources
        : [];
      const hasDirect = currentSources.some((s: any) =>
        isDirectMediaUrl(String(s?.url || '')),
      );
      if (hasDirect) return reply.status(200).send(promoted);

      const embedCandidates = new Set<string>();
      if (typeof (promoted as any)?.embedURL === 'string' && (promoted as any).embedURL.trim()) {
        embedCandidates.add((promoted as any).embedURL.trim());
      }
      for (const source of currentSources) {
        const url = String(source?.url || '').trim();
        if (!url || isDirectMediaUrl(url)) continue;
        if (/^https?:\/\//i.test(url)) embedCandidates.add(url);
      }

      const runtimeDirect: any[] = [];
      for (const embedUrl of [...embedCandidates].slice(0, 3)) {
        const extracted = await extractDirectSourcesWithPlaywright(
          embedUrl,
          String((promoted as any)?.headers?.Referer || episodeId),
          15000,
        );
        for (const item of extracted) runtimeDirect.push(item);
      }

      if (runtimeDirect.length > 0) {
        const deduped = sortAndLimitSources(runtimeDirect, fastStart);
        return reply.status(200).send({
          ...(promoted as any),
          sources: deduped,
          embedURL: (promoted as any)?.embedURL || [...embedCandidates][0],
        });
      }

      return reply.status(200).send(promoted);
    } catch (err: any) {
      try {
        const fallback = await getMovieEmbedFallbackSource(
          flixhq as any,
          episodeId,
          mediaId,
          server,
        );

        if (fallback) {
          const promotedFallback = await promoteEmbedSourcesToDirect(
            flixhq as any,
            fallback as any,
            server,
          );
          if (Array.isArray((promotedFallback as any)?.sources)) {
            (promotedFallback as any).sources = sortAndLimitSources(
              (promotedFallback as any).sources,
              fastStart,
            );
          }
          return reply.status(200).send(promotedFallback);
        }
      } catch {
        // Ignore fallback errors and return the original extraction error below.
      }

      const message = err instanceof Error ? err.message : String(err);
      reply.status(404).send({ message });
    }
  });

  fastify.get('/servers', async (request: FastifyRequest, reply: FastifyReply) => {
    const episodeId = (request.query as { episodeId: string }).episodeId;
    const mediaId = (request.query as { mediaId: string }).mediaId;

    if (typeof episodeId === 'undefined')
      return reply.status(400).send({ message: 'episodeId is required' });
    if (typeof mediaId === 'undefined')
      return reply.status(400).send({ message: 'mediaId is required' });

    try {
      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `flixhq:servers:${episodeId}:${mediaId}`,
            async () => await flixhq.fetchEpisodeServers(episodeId, mediaId),
            REDIS_TTL,
          )
        : await flixhq.fetchEpisodeServers(episodeId, mediaId);

      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({
        message:
          'Something went wrong. Please try again later. or contact the developers.',
      });
    }
  });

  fastify.get(
    '/country/:country',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const country = (request.params as { country: string }).country;
      const page = (request.query as { page: number }).page ?? 1;
      try {
        let res = redis
          ? await cache.fetch(
              redis as Redis,
              `flixhq:country:${country}:${page}`,
              async () => await flixhq.fetchByCountry(country, page),
              REDIS_TTL,
            )
          : await flixhq.fetchByCountry(country, page);

        reply.status(200).send(res);
      } catch (error) {
        reply.status(500).send({
          message:
            'Something went wrong. Please try again later. or contact the developers.',
        });
      }
    },
  );

  fastify.get('/genre/:genre', async (request: FastifyRequest, reply: FastifyReply) => {
    const genre = (request.params as { genre: string }).genre;
    const page = (request.query as { page: number }).page ?? 1;
    try {
      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `flixhq:genre:${genre}:${page}`,
            async () => await flixhq.fetchByGenre(genre, page),
            REDIS_TTL,
          )
        : await flixhq.fetchByGenre(genre, page);

      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({
        message:
          'Something went wrong. Please try again later. or contact the developers.',
      });
    }
  });
};
export default routes;


