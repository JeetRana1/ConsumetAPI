import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { META, PROVIDERS_LIST, StreamingServers } from '@consumet/extensions';
import { MOVIES } from '@consumet/extensions';
import { tmdbApi } from '../../main';
import { fetchWithServerFallback, MOVIE_SERVER_FALLBACKS } from '../../utils/streamable';
import { configureProvider } from '../../utils/provider';

// Map of anime providers that have direct routes in this API
const ANIME_PROVIDER_ROUTES: Record<string, string> = {
  satoru: '/anime/satoru',
  animesaturn: '/anime/animesaturn',
  hianime: '/anime/hianime',
  animepahe: '/anime/animepahe',
  animekai: '/anime/animekai',
  kickassanime: '/anime/kickassanime',
};

const resolveMovieProvider = (provider?: string) => {
  if (!provider) return undefined;
  switch (provider.toLowerCase()) {
    case 'flixhq':
      return configureProvider(new MOVIES.FlixHQ());
    case 'goku':
      return configureProvider(new MOVIES.Goku());
    case 'sflix':
      return configureProvider(new MOVIES.SFlix());
    case 'himovies':
      return configureProvider(new MOVIES.HiMovies());
    case 'dramacool':
      return configureProvider(new MOVIES.DramaCool());
    default:
      return undefined;
  }
};

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro:
        "Welcome to the tmdb provider: check out the provider's website @ https://www.themoviedb.org/",
      routes: ['/:query', '/info/:id', '/watch/:episodeId'],
      documentation: 'https://docs.consumet.org/#tag/tmdb',
    });
  });

  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.params as { query: string }).query;
    const page = (request.query as { page: number }).page;
    const tmdb = new META.TMDB(tmdbApi, configureProvider(new MOVIES.FlixHQ()));

    const res = await tmdb.search(query, page);

    reply.status(200).send(res);
  });

  fastify.get('/info/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.params as { id: string }).id;
    const type = (request.query as { type: string }).type;
    const provider = (request.query as { provider?: string }).provider;
    let tmdb = new META.TMDB(tmdbApi, configureProvider(new MOVIES.FlixHQ()));

    if (!type) return reply.status(400).send({ message: "The 'type' query is required" });

    if (typeof provider !== 'undefined') {
      const selectedProvider = resolveMovieProvider(provider);
      if (selectedProvider) {
        tmdb = new META.TMDB(tmdbApi, selectedProvider);
      } else {
        const possibleProvider = PROVIDERS_LIST.MOVIES.find(
          (p) => p.name.toLowerCase() === provider.toLocaleLowerCase(),
        );
        tmdb = new META.TMDB(tmdbApi, possibleProvider);
      }
    }

    const res = await tmdb.fetchMediaInfo(id, type);
    reply.status(200).send(res);
  });

  fastify.get('/trending', async (request: FastifyRequest, reply: FastifyReply) => {
    const validTimePeriods = new Set(['day', 'week'] as const);
    type validTimeType = typeof validTimePeriods extends Set<infer T> ? T : undefined;

    const type = (request.query as { type?: string }).type || 'all';
    let timePeriod =
      (request.query as { timePeriod?: validTimeType }).timePeriod || 'day';

    // make day as default time period
    if (!validTimePeriods.has(timePeriod)) timePeriod = 'day';

    const page = (request.query as { page?: number }).page || 1;

    const tmdb = new META.TMDB(tmdbApi, configureProvider(new MOVIES.FlixHQ()));

    try {
      const res = await tmdb.fetchTrending(type, timePeriod, page);
      reply.status(200).send(res);
    } catch (err) {
      reply.status(500).send({ message: 'Failed to fetch trending media.' });
    }
  });

  const watch = async (request: FastifyRequest, reply: FastifyReply) => {
    let episodeId = (request.params as { episodeId: string }).episodeId;
    if (!episodeId) {
      episodeId = (request.query as { episodeId: string }).episodeId;
    }
    const id = (request.query as { id: string }).id;
    const type = (request.query as { type: string }).type;
    const provider = (request.query as { provider?: string }).provider;
    const server = (request.query as { server?: StreamingServers }).server;

    // Check if it's an anime provider - redirect to anime route
    const providerLower = provider?.toLowerCase();
    if (providerLower && ANIME_PROVIDER_ROUTES[providerLower]) {
      const animeBaseUrl = ANIME_PROVIDER_ROUTES[providerLower];
      const queryParts: string[] = [];
      if (server) queryParts.push(`server=${encodeURIComponent(server)}`);
      if (providerLower === 'hianime') queryParts.push('category=both');
      const queryString = queryParts.length ? `?${queryParts.join('&')}` : '';
      const redirectUrl = `${animeBaseUrl}/watch/${episodeId}${queryString}`;
      return reply.redirect(redirectUrl);
    }

    // Movie/TV providers
    let tmdb = new META.TMDB(tmdbApi, configureProvider(new MOVIES.FlixHQ()));
    if (typeof provider !== 'undefined') {
      const selectedProvider = resolveMovieProvider(provider);
      if (selectedProvider) {
        tmdb = new META.TMDB(tmdbApi, selectedProvider);
      } else {
        const possibleProvider = PROVIDERS_LIST.MOVIES.find(
          (p) => p.name.toLowerCase() === provider.toLocaleLowerCase(),
        );
        tmdb = new META.TMDB(tmdbApi, possibleProvider);
      }
    }
    try {
      // For movies, the id parameter contains the provider's media ID (e.g., "movie/watch-marty-supreme-139738")
      // We need to use this as the first parameter, not the TMDB episodeId
      // For TV shows, episodeId is the actual episode ID from the provider
      let sourceId: string;
      let mediaId: string;
      
      if (type === 'movie' && id) {
        // For movies, extract the media ID from the id parameter
        // id format: "movie/watch-marty-supreme-139738" -> we need "watch-marty-supreme-139738"
        sourceId = id.replace(/^movie\//, '');
        mediaId = id;
      } else {
        // For TV shows, use episodeId as sourceId and id as mediaId
        sourceId = episodeId;
        mediaId = id;
      }

      const res = await fetchWithServerFallback(
        async (selectedServer) => await tmdb.fetchEpisodeSources(sourceId, mediaId, selectedServer),
        server,
        MOVIE_SERVER_FALLBACKS,
      );

      reply.status(200).send(res);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      reply.status(404).send({ message });
    }
  };
  fastify.get('/watch', watch);
  fastify.get('/watch/:episodeId', watch);
};

export default routes;
