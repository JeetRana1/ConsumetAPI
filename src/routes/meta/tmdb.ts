import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { META, PROVIDERS_LIST, StreamingServers } from '@consumet/extensions';
import { MOVIES } from '@consumet/extensions';
import { load } from 'cheerio';
import { tmdbApi } from '../../main';
import { fetchWithServerFallback, MOVIE_SERVER_FALLBACKS } from '../../utils/streamable';
import { configureProvider } from '../../utils/provider';
import { getMovieEmbedFallbackSource } from '../../utils/movieServerFallback';

// Map of anime providers that have direct routes in this API
const ANIME_PROVIDER_ROUTES: Record<string, string> = {
  satoru: '/anime/satoru',
  hianime: '/anime/hianime',
  justanime: '/anime/justanime',
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

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const MOVIE_WATCH_ATTEMPT_TIMEOUT_MS = IS_PRODUCTION ? 2500 : 4000;

const DRAMACOOL_WP_BASE = process.env.DRAMACOOL_BASE_URL || 'https://dramacool9.com.ro';
const DRAMACOOL_SITEMAP_CACHE_TTL_MS = 1000 * 60 * 15;

let dramacoolSitemapCache:
  | { fetchedAt: number; postSitemaps: string[] }
  | undefined;
const dramacoolEpisodesCache = new Map<
  string,
  { fetchedAt: number; episodes: { id: string; url: string; episode: number | undefined }[] }
>();

const parseLocsFromXml = (xml: string): string[] => {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1].trim());
};

const parseEpisodeNumber = (value: string): number | undefined => {
  const match = value.match(/episode-(\d+)/i) || value.match(/episode\s*(\d+)/i);
  if (!match) return undefined;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : undefined;
};

const extractSlug = (value: string): string => {
  const clean = value.split('?')[0].replace(/\/$/, '');
  const last = clean.split('/').pop() || clean;
  return last.replace(/\.html$/i, '');
};

const toAbsoluteUrl = (base: string, maybeUrl: string): string => {
  if (/^https?:\/\//i.test(maybeUrl)) return maybeUrl;
  return `${base.replace(/\/$/, '')}/${String(maybeUrl || '').replace(/^\//, '')}`;
};

const normalizeText = (value: string): string =>
  String(value || '')
    .replace(/&#8217;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const safeJsonParse = (value: string) => {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
};

const toGenreNames = (genres: unknown): string[] => {
  if (!Array.isArray(genres)) return [];
  return genres
    .map((genre: any) => {
      if (typeof genre === 'string') return genre;
      if (genre && typeof genre.name === 'string') return genre.name;
      return '';
    })
    .filter(Boolean)
    .map((genre) => normalizeText(genre));
};

const getTitleCandidatesFromMedia = (media: any): string[] => {
  return [media?.title, media?.name, media?.originalTitle, media?.originalName]
    .filter((v, i, arr) => typeof v === 'string' && v.trim() && arr.indexOf(v) === i)
    .map((v) => String(v).trim());
};

const titleMatchScore = (candidateTitle: string, queries: string[]): number => {
  const candidate = normalizeText(candidateTitle);
  if (!candidate) return -1;
  let score = 0;
  for (const query of queries) {
    const normQuery = normalizeText(query);
    if (!normQuery) continue;
    if (candidate === normQuery) score = Math.max(score, 1000);
    else if (candidate.includes(normQuery) || normQuery.includes(candidate))
      score = Math.max(score, 700);
  }
  return score;
};

const isAnimeLikeMovie = (media: any): boolean => {
  const genreNames = toGenreNames(media?.genres);
  const hasAnimationGenre = genreNames.some((genre) => genre.includes('animation'));
  const hasAnimeGenre = genreNames.some((genre) => genre.includes('anime'));
  const lang = normalizeText(String(media?.originalLanguage || media?.original_language || ''));
  const isJapanese = lang === 'ja';
  return hasAnimeGenre || (hasAnimationGenre && isJapanese);
};

const normalizeSlug = (value: string): string =>
  String(value || '')
    .toLowerCase()
    .replace(/\.html$/i, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const stripTrailingYear = (value: string): string => value.replace(/-(19|20)\d{2}$/i, '');

const buildDramaSlugVariants = (dramaSlug: string): string[] => {
  const base = normalizeSlug(dramaSlug);
  const set = new Set<string>();
  const push = (v?: string) => {
    const clean = v ? normalizeSlug(v) : '';
    if (clean) set.add(clean);
  };

  push(base);
  push(stripTrailingYear(base));
  push(base.replace(/-season-\d+$/i, ''));
  push(base.replace(/-s\d+$/i, ''));
  push(base.replace(/-part-\d+$/i, ''));
  push(stripTrailingYear(base.replace(/-season-\d+$/i, '')));
  push(base.replace(/-\d{4}-[a-z]{2,4}$/i, ''));
  push(base.replace(/-[a-z]{2,4}$/i, ''));
  push(base.replace(/-\d{4}$/i, ''));

  const tokens = base.split('-').filter(Boolean);
  if (tokens.length >= 2) push(tokens.slice(0, 2).join('-'));
  if (tokens.length >= 1) push(tokens[0]);

  return [...set];
};

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  const tryAnimeProvidersForMovie = async ({
    titleCandidates,
    server,
  }: {
    titleCandidates: string[];
    server?: StreamingServers;
  }) => {
    if (!titleCandidates.length) return null;
    const providersInOrder = [
      'satoru',
      'hianime',
    ];

    for (const providerKey of providersInOrder) {
      const baseRoute = ANIME_PROVIDER_ROUTES[providerKey];
      if (!baseRoute) continue;
      for (const query of titleCandidates) {
        try {
          const searchRes = await fastify.inject({
            method: 'GET',
            url: `${baseRoute}/${encodeURIComponent(query)}`,
          });
          if (searchRes.statusCode >= 400) continue;
          const searchPayload: any = safeJsonParse(searchRes.body);
          const searchRows = Array.isArray(searchPayload?.results) ? searchPayload.results : [];
          if (!searchRows.length) continue;

          const picked = searchRows
            .map((item: any) => ({
              item,
              score: titleMatchScore(String(item?.title || item?.name || ''), titleCandidates),
            }))
            .sort((a: any, b: any) => b.score - a.score)[0]?.item;

          if (!picked?.id) continue;

          const infoRes = await fastify.inject({
            method: 'GET',
            url: `${baseRoute}/info/${encodeURIComponent(String(picked.id))}`,
          });
          if (infoRes.statusCode >= 400) continue;
          const infoPayload: any = safeJsonParse(infoRes.body);
          const episodes = Array.isArray(infoPayload?.episodes) ? infoPayload.episodes : [];
          if (!episodes.length) continue;

          const episodeIds = Array.from(
            new Set(
              [
                episodes[0]?.id,
                episodes[episodes.length - 1]?.id,
                episodes.find((ep: any) => Number(ep?.number || 0) === 1)?.id,
              ]
                .filter((value) => typeof value === 'string' && value.trim())
                .map((value) => String(value).trim()),
            ),
          );
          if (!episodeIds.length) continue;

          for (const candidateEpisodeId of episodeIds) {
            const queryParts: string[] = [];
            if (server) queryParts.push(`server=${encodeURIComponent(server)}`);
            if (providerKey === 'hianime') queryParts.push('category=both');
            const qs = queryParts.length ? `?${queryParts.join('&')}` : '';
            const watchRes = await fastify.inject({
              method: 'GET',
              url: `${baseRoute}/watch/${encodeURIComponent(candidateEpisodeId)}${qs}`,
            });
            if (watchRes.statusCode >= 400) continue;
            const watchPayload: any = safeJsonParse(watchRes.body);
            if (Array.isArray(watchPayload?.sources) && watchPayload.sources.length) {
              return watchPayload;
            }
          }
        } catch {
          continue;
        }
      }
    }

    return null;
  };

  const fetchDramacoolWpSearch = async (query: string) => {
    const dramacool = configureProvider(new MOVIES.DramaCool()) as any;
    const endpoint = `${DRAMACOOL_WP_BASE.replace(/\/$/, '')}/wp-json/wp/v2/search?search=${encodeURIComponent(query)}&per_page=20`;
    const response = await dramacool.client.get(endpoint);
    const results = Array.isArray(response?.data)
      ? response.data.filter((item: any) => item?.subtype === 'drama' && typeof item?.url === 'string')
      : [];
    return results as Array<{ title: string; url: string }>;
  };

  const getDramacoolPostSitemaps = async (): Promise<string[]> => {
    if (
      dramacoolSitemapCache &&
      Date.now() - dramacoolSitemapCache.fetchedAt < DRAMACOOL_SITEMAP_CACHE_TTL_MS
    ) {
      return dramacoolSitemapCache.postSitemaps;
    }

    const dramacool = configureProvider(new MOVIES.DramaCool()) as any;
    const sitemapIndexUrl = `${DRAMACOOL_WP_BASE.replace(/\/$/, '')}/sitemap_index.xml`;
    const xml = String((await dramacool.client.get(sitemapIndexUrl)).data || '');
    const postSitemaps = parseLocsFromXml(xml).filter((url) =>
      /\/post-sitemap\d*\.xml$/i.test(url),
    );

    dramacoolSitemapCache = { fetchedAt: Date.now(), postSitemaps };
    return postSitemaps;
  };

  const fetchDramacoolEpisodesBySlug = async (dramaSlug: string) => {
    const cached = dramacoolEpisodesCache.get(dramaSlug);
    if (cached && Date.now() - cached.fetchedAt < DRAMACOOL_SITEMAP_CACHE_TTL_MS) {
      return cached.episodes;
    }

    const dramacool = configureProvider(new MOVIES.DramaCool()) as any;
    const postSitemaps = await getDramacoolPostSitemaps();
    const variants = buildDramaSlugVariants(dramaSlug);
    const found = new Set<string>();

    for (const sitemapUrl of postSitemaps) {
      try {
        const xml = String((await dramacool.client.get(sitemapUrl)).data || '');
        const locs = parseLocsFromXml(xml);
        for (const loc of locs) {
          const lower = loc.toLowerCase();
          const locSlug = extractSlug(lower);
          const isEpisode = /(?:^|-)episode-\d+/i.test(locSlug);
          const matched = variants.some((variant) => locSlug.startsWith(`${variant}-episode-`));
          const looseMatched = variants.some((variant) => locSlug.includes(`${variant}-`));
          if (lower.endsWith('.html') && isEpisode && (matched || looseMatched)) found.add(loc);
        }
      } catch {
        continue;
      }
    }

    const episodes = [...found]
      .map((url) => ({
        id: url,
        url,
        episode: parseEpisodeNumber(url),
      }))
      .sort((a, b) => (a.episode || 0) - (b.episode || 0));

    dramacoolEpisodesCache.set(dramaSlug, { fetchedAt: Date.now(), episodes });
    return episodes;
  };

  const fetchDramacoolEpisodesFromDramaPage = async (dramaUrlOrSlug: string, dramaSlug: string) => {
    const dramacool = configureProvider(new MOVIES.DramaCool()) as any;
    const dramaUrl = /^https?:\/\//i.test(dramaUrlOrSlug)
      ? dramaUrlOrSlug
      : `${DRAMACOOL_WP_BASE.replace(/\/$/, '')}/${dramaUrlOrSlug.replace(/^\//, '')}`;
    const html = String((await dramacool.client.get(dramaUrl)).data || '');
    const $ = load(html);
    const foundStrict = new Set<string>();
    const foundLoose = new Set<string>();
    const variants = buildDramaSlugVariants(dramaSlug);
    const selectors = [
      '.list-episode a[href*="episode-"]',
      '.all-episode a[href*="episode-"]',
      '.episodes a[href*="episode-"]',
      '[id*="episode"] a[href*="episode-"]',
      '.entry-content a[href*="episode-"]',
      'a[href*="episode-"]',
    ];

    for (const selector of selectors) {
      $(selector).each((_, el) => {
        const href = String($(el).attr('href') || '').trim();
        if (!href) return;
        const abs = toAbsoluteUrl(DRAMACOOL_WP_BASE, href);
        if (!/episode-\d+\.html$/i.test(abs)) return;
        const slug = extractSlug(abs).toLowerCase();
        const strict = variants.some((variant) => slug.startsWith(`${variant}-episode-`));
        const loose = variants.some((variant) => slug.includes(`${variant}-`));
        if (strict) foundStrict.add(abs);
        else if (loose) foundLoose.add(abs);
      });
      if (foundStrict.size) break;
    }

    const pool = foundStrict.size ? foundStrict : foundLoose;
    return [...pool]
      .map((url) => ({
        id: url,
        url,
        episode: parseEpisodeNumber(url),
      }))
      .sort((a, b) => (a.episode || 0) - (b.episode || 0));
  };

  const buildDramacoolTmdbInfo = async (id: string, type: string) => {
    const baseTmdb = new META.TMDB(tmdbApi, configureProvider(new MOVIES.FlixHQ()));
    const baseInfo: any = await baseTmdb.fetchMediaInfo(id, type);
    const titleCandidates = [
      baseInfo?.title,
      baseInfo?.name,
      baseInfo?.originalTitle,
      baseInfo?.originalName,
    ]
      .filter((v, i, arr) => typeof v === 'string' && v.trim() && arr.indexOf(v) === i)
      .map((v) => String(v).trim());
    if (!titleCandidates.length) return baseInfo;

    const yearGuess = Number(String(baseInfo?.releaseDate || baseInfo?.firstAirDate || '').slice(0, 4));
    const searchTerms = Array.from(
      new Set(
        titleCandidates.flatMap((title) => {
          const terms = [title];
          if (Number.isFinite(yearGuess) && yearGuess > 1900) terms.push(`${title} ${yearGuess}`);
          return terms;
        }),
      ),
    );

    const combinedResults: Array<{ title: string; url: string }> = [];
    for (const term of searchTerms) {
      try {
        const rows = await fetchDramacoolWpSearch(term);
        for (const row of rows) combinedResults.push(row);
      } catch {
        continue;
      }
    }

    const scored = combinedResults.map((item) => {
      const normItem = normalizeText(item.title);
      let score = 0;
      for (const candidate of titleCandidates) {
        const normCandidate = normalizeText(candidate);
        if (normItem === normCandidate) score += 120;
        else if (normItem.includes(normCandidate) || normCandidate.includes(normItem)) score += 80;
      }
      if (Number.isFinite(yearGuess) && yearGuess > 1900) {
        if (normItem.includes(String(yearGuess))) score += 25;
        if (normItem.includes(String(yearGuess - 1)) || normItem.includes(String(yearGuess + 1))) score += 8;
      }
      return { item, score };
    });

    const pick = scored.sort((a, b) => b.score - a.score)[0]?.item || combinedResults[0];
    if (!pick) return baseInfo;

    const dramaSlug = extractSlug(pick.url);
    let dcEpisodes = await fetchDramacoolEpisodesFromDramaPage(pick.url, dramaSlug);
    if (!dcEpisodes.length) {
      dcEpisodes = await fetchDramacoolEpisodesBySlug(dramaSlug);
    }
    if (!dcEpisodes.length) {
      try {
        const delegated = await fastify.inject({
          method: 'GET',
          url: `/movies/dramacool/info?id=${encodeURIComponent(pick.url)}`,
        });
        const payload = JSON.parse(delegated.body || '{}');
        const fallbackEpisodes = Array.isArray(payload?.episodes)
          ? payload.episodes
            .map((ep: any) => ({
              id: ep?.id || ep?.url,
              url: ep?.url || ep?.id,
              episode: parseEpisodeNumber(String(ep?.id || ep?.url || ep?.title || '')),
            }))
            .filter((ep: any) => typeof ep.id === 'string')
          : [];
        if (fallbackEpisodes.length) {
          dcEpisodes = fallbackEpisodes;
        }
      } catch {
        // ignore fallback and continue with whatever we already have
      }
    }
    const byEpisode = new Map<number, { id: string; url: string }>();
    for (const ep of dcEpisodes) {
      if (typeof ep.episode === 'number') byEpisode.set(ep.episode, ep);
    }

    if (Array.isArray(baseInfo?.seasons)) {
      baseInfo.seasons = baseInfo.seasons.map((season: any, seasonIndex: number) => {
        if (!Array.isArray(season?.episodes)) return season;
        const isPrimarySeason = (season?.season || seasonIndex + 1) === 1;
        return {
          ...season,
          episodes: season.episodes.map((episode: any) => {
            if (!isPrimarySeason) return episode;
            const epNum = Number(episode?.episode || episode?.number);
            const mapped = byEpisode.get(epNum);
            if (!mapped) return episode;
            return {
              ...episode,
              id: mapped.id,
              url: mapped.url,
            };
          }),
        };
      });
    }

    baseInfo.id = dramaSlug;
    baseInfo.url = pick.url;
    return baseInfo;
  };

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
    const providerLower = provider?.toLowerCase();
    let tmdb = new META.TMDB(tmdbApi, configureProvider(new MOVIES.FlixHQ()));

    if (!type) return reply.status(400).send({ message: "The 'type' query is required" });

    if (providerLower === 'dramacool') {
      try {
        const res = await buildDramacoolTmdbInfo(id, type);
        return reply.status(200).send(res);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ message });
      }
    }

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
    const directOnlyRaw = String((request.query as { directOnly?: string }).directOnly || '').toLowerCase();
    const directOnly = directOnlyRaw === '1' || directOnlyRaw === 'true' || directOnlyRaw === 'yes';

    // Check if it's an anime provider - redirect to anime route
    const providerLower = provider?.toLowerCase();
    if (providerLower && ANIME_PROVIDER_ROUTES[providerLower]) {
      // Satoru episode ids are often HiAnime-style ids (slug$episode$nnn).
      // On serverless, routing those through /anime/hianime/watch is more reliable
      // than the Satoru origin and avoids upstream timeout stalls.
      const isHiAnimeStyleEpisode = String(episodeId || '').includes('$episode$');
      if (providerLower === 'satoru' && isHiAnimeStyleEpisode) {
        const queryParts: string[] = ['category=both', 'server=vidstreaming'];
        const queryString = `?${queryParts.join('&')}`;
        const redirectUrl = `/anime/hianime/watch/${episodeId}${queryString}`;
        return reply.redirect(redirectUrl);
      }

      const animeBaseUrl = ANIME_PROVIDER_ROUTES[providerLower];
      const queryParts: string[] = [];
      if (server) queryParts.push(`server=${encodeURIComponent(server)}`);
      if (providerLower === 'hianime') queryParts.push('category=both');
      const queryString = queryParts.length ? `?${queryParts.join('&')}` : '';
      const redirectUrl = `${animeBaseUrl}/watch/${episodeId}${queryString}`;
      return reply.redirect(redirectUrl);
    }
    if (providerLower === 'dramacool') {
      try {
        let dramacoolEpisodeId = episodeId;
        if (!dramacoolEpisodeId && id && type) {
          const info: any = await buildDramacoolTmdbInfo(id, type);
          const requestedSeason = Number((request.query as { season?: number }).season || 1);
          const requestedEpisode = Number((request.query as { episode?: number }).episode || 1);
          const seasonMatch = Array.isArray(info?.seasons)
            ? info.seasons.find((s: any) => Number(s?.season || 1) === requestedSeason)
            : undefined;
          const epMatch = Array.isArray(seasonMatch?.episodes)
            ? seasonMatch.episodes.find(
              (ep: any) => Number(ep?.episode || ep?.number || 0) === requestedEpisode,
            )
            : undefined;
          dramacoolEpisodeId = epMatch?.id;
        }

        if (!dramacoolEpisodeId) {
          return reply.status(400).send({ message: 'episodeId is required for dramacool watch' });
        }

        const queryParts = [`episodeId=${encodeURIComponent(dramacoolEpisodeId)}`];
        if (server) queryParts.push(`server=${encodeURIComponent(server)}`);
        if (directOnly) queryParts.push('directOnly=true');
        const delegated = await fastify.inject({
          method: 'GET',
          url: `/movies/dramacool/watch?${queryParts.join('&')}`,
        });

        const payloadText = delegated.body || '{}';
        const payload = (() => {
          try {
            return JSON.parse(payloadText);
          } catch {
            return { message: payloadText };
          }
        })();

        return reply.status(delegated.statusCode || 200).send(payload);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(404).send({ message });
      }
    }

    if (type === 'movie' && !providerLower && id) {
      try {
        const discoveryTmdb = new META.TMDB(tmdbApi, configureProvider(new MOVIES.FlixHQ()));
        const mediaInfo: any = await discoveryTmdb.fetchMediaInfo(id, type);
        const titleCandidates = getTitleCandidatesFromMedia(mediaInfo);
        if (isAnimeLikeMovie(mediaInfo) && titleCandidates.length) {
          const animeFallback = await tryAnimeProvidersForMovie({
            titleCandidates,
            server,
          });
          if (animeFallback) return reply.status(200).send(animeFallback);
        }
      } catch {
        // Ignore discovery errors and continue with movie providers.
      }
    }

    // Movie/TV providers
    let movieProvider: any = configureProvider(new MOVIES.FlixHQ());
    let tmdb = new META.TMDB(tmdbApi, movieProvider);
    if (typeof provider !== 'undefined') {
      const selectedProvider = resolveMovieProvider(provider);
      if (selectedProvider) {
        movieProvider = selectedProvider as any;
        tmdb = new META.TMDB(tmdbApi, selectedProvider);
      } else {
        const possibleProvider = PROVIDERS_LIST.MOVIES.find(
          (p) => p.name.toLowerCase() === provider.toLocaleLowerCase(),
        );
        movieProvider = (possibleProvider as any) || movieProvider;
        tmdb = new META.TMDB(tmdbApi, possibleProvider);
      }
    }
    let sourceId = '';
    let mediaId = '';
    try {
      // For movies, the id parameter contains the provider's media ID (e.g., "movie/watch-marty-supreme-139738")
      // We need to use this as the first parameter, not the TMDB episodeId
      // For TV shows, episodeId is the actual episode ID from the provider

      if (type === 'movie' && id) {
        // For movies, episodeId is the provider source ID in TMDB responses.
        // Fall back to slug extraction only when episodeId is missing.
        sourceId = String(episodeId || '').trim() || id.replace(/^movie\//, '');
        mediaId = id;
      } else {
        // For TV shows, use episodeId as sourceId and id as mediaId
        sourceId = episodeId;
        mediaId = id;
      }

      const res = await fetchWithServerFallback(
        async (selectedServer) => await tmdb.fetchEpisodeSources(sourceId, mediaId, selectedServer),
        server,
        server
          ? [server]
          : [
            StreamingServers.VidCloud,
            StreamingServers.UpCloud,
          ],
        {
          attemptTimeoutMs: MOVIE_WATCH_ATTEMPT_TIMEOUT_MS,
          requireDirectPlayable: directOnly,
        },
      );

      reply.status(200).send(res);
    } catch (err: any) {
      if (type === 'movie' && id) {
        try {
          const discoveryTmdb = new META.TMDB(tmdbApi, configureProvider(new MOVIES.FlixHQ()));
          const mediaInfo: any = await discoveryTmdb.fetchMediaInfo(id, type);
          const titleCandidates = getTitleCandidatesFromMedia(mediaInfo);
          if (titleCandidates.length) {
            const animeFallback = await tryAnimeProvidersForMovie({
              titleCandidates,
              server,
            });
            if (animeFallback) return reply.status(200).send(animeFallback);
          }
        } catch {
          // Ignore anime fallback errors and continue existing fallback logic.
        }
      }

      if (type === 'movie' && sourceId) {
        try {
          const fallback = await getMovieEmbedFallbackSource(
            movieProvider,
            sourceId,
            mediaId,
            server,
          );

          if (fallback) {
            return reply.status(200).send(fallback);
          }
        } catch {
          // Ignore fallback errors and return the extraction error below.
        }
      }

      const message = err instanceof Error ? err.message : String(err);
      reply.status(404).send({ message });
    }
  };
  fastify.get('/watch', watch);
  fastify.get('/watch/:episodeId', watch);
};

export default routes;

