import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { META, PROVIDERS_LIST, StreamingServers } from '@consumet/extensions';
import { MOVIES } from '@consumet/extensions';
import { load } from 'cheerio';
import { tmdbApi, redis, REDIS_TTL } from '../../main';
import cache from '../../utils/cache';
import { Redis } from 'ioredis';
import { fetchWithServerFallback, MOVIE_SERVER_FALLBACKS } from '../../utils/streamable';
import { configureProvider } from '../../utils/provider';
import { getMovieEmbedFallbackSource } from '../../utils/movieServerFallback';
import axios from 'axios';
import { google } from 'googleapis';

const configureMeta = (meta: any) => {
  if (meta && (meta as any).client?.defaults) {
    // Already set globally in main.ts, but being explicit for meta routes
    (meta as any).client.defaults.headers.common['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  }
  return meta;
};

const parseIso8601DurationToSeconds = (duration?: string): number => {
  if (!duration || typeof duration !== 'string') return 0;
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return 0;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
};

const trailerScore = (params: {
  title: string;
  channelTitle?: string;
  durationSeconds: number;
  releaseYear?: string;
}): number => {
  const title = String(params.title || '').toLowerCase();
  const channelTitle = String(params.channelTitle || '').toLowerCase();
  const year = String(params.releaseYear || '').trim();

  let score = 0;

  if (title.includes('official trailer')) score += 140;
  else if (title.includes('trailer')) score += 100;

  if (title.includes('official')) score += 25;

  if (year && title.includes(year)) score += 12;

  if (
    title.includes('teaser') ||
    title.includes('clip') ||
    title.includes('behind the scenes') ||
    title.includes('featurette') ||
    title.includes('interview') ||
    title.includes('tv spot') ||
    title.includes('short') ||
    title.includes('promo') ||
    title.includes('reaction')
  ) {
    score -= 180;
  }

  if (channelTitle.includes('trailers')) score += 20;

  if (params.durationSeconds > 0) {
    if (params.durationSeconds < 45) score -= 220;
    else if (params.durationSeconds < 75) score -= 100;
    else if (params.durationSeconds >= 75 && params.durationSeconds <= 260) score += 30;
    else if (params.durationSeconds > 900) score -= 50;
  }

  return score;
};

const fetchTmdbOfficialTrailer = async (id: string, type?: string): Promise<string | null> => {
  if (!tmdbApi) return null;

  try {
    const tmdbType = String(type || '').toLowerCase() === 'tv' ? 'tv' : 'movie';
    const url = `https://api.themoviedb.org/3/${tmdbType}/${id}/videos?api_key=${tmdbApi}&language=en-US`;
    const response = await axios.get(url);
    const results = Array.isArray(response?.data?.results) ? response.data.results : [];

    const ranked = results
      .filter((row: any) => String(row?.site || '').toLowerCase() === 'youtube' && row?.key)
      .map((row: any) => {
        const trailerType = String(row?.type || '').toLowerCase();
        const trailerName = String(row?.name || '').toLowerCase();
        let score = 0;

        if (trailerType === 'trailer') score += 140;
        else score -= 80;

        if (row?.official === true) score += 60;
        if (trailerName.includes('official')) score += 25;

        if (
          trailerType.includes('teaser') ||
          trailerType.includes('clip') ||
          trailerType.includes('behind the scenes') ||
          trailerType.includes('featurette') ||
          trailerName.includes('teaser') ||
          trailerName.includes('clip') ||
          trailerName.includes('behind the scenes') ||
          trailerName.includes('featurette') ||
          trailerName.includes('tv spot')
        ) {
          score -= 220;
        }

        return {
          key: String(row.key),
          score,
          publishedAt: Date.parse(String(row?.published_at || row?.publishedAt || '')) || 0,
        };
      })
      .sort((a: any, b: any) => b.score - a.score || b.publishedAt - a.publishedAt);

    const best = ranked[0];
    if (!best || best.score <= 0) return null;
    return `https://www.youtube.com/watch?v=${best.key}`;
  } catch (error) {
    console.error('Error fetching TMDB official trailer:', error);
    return null;
  }
};

const extractYouTubeVideoId = (value: string): string | null => {
  if (!value) return null;

  const raw = String(value).trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;

  try {
    const url = new URL(raw);
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.split('/').filter(Boolean)[0] || '';
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    if (url.hostname.includes('youtube.com')) {
      const fromV = url.searchParams.get('v') || '';
      if (/^[a-zA-Z0-9_-]{11}$/.test(fromV)) return fromV;

      const parts = url.pathname.split('/').filter(Boolean);
      const idx = parts.findIndex((p) => p === 'embed' || p === 'shorts');
      if (idx >= 0 && parts[idx + 1] && /^[a-zA-Z0-9_-]{11}$/.test(parts[idx + 1])) {
        return parts[idx + 1];
      }
    }
  } catch {
    // ignore parse errors
  }

  const fallback = raw.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/i);
  return fallback ? fallback[1] : null;
};

const getYouTubeWatchUrl = (value: string): string | null => {
  const id = extractYouTubeVideoId(value);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
};

const hasForbiddenTrailerText = (value: string): boolean => {
  const text = String(value || '').toLowerCase();
  if (!text) return false;
  return (
    text.includes('teaser') ||
    text.includes('clip') ||
    text.includes('behind the scenes') ||
    text.includes('featurette') ||
    text.includes('tv spot') ||
    text.includes('promo') ||
    text.includes('interview') ||
    text.includes('short')
  );
};

const chooseOfficialTrailerFromExisting = async (payload: any): Promise<string | null> => {
  const candidates: Array<{ url: string; score: number }> = [];

  const pushCandidate = (rawUrl: any, name?: any, type?: any, official?: any) => {
    const url = getYouTubeWatchUrl(String(rawUrl || ''));
    if (!url) return;

    const lowerName = String(name || '').toLowerCase();
    const lowerType = String(type || '').toLowerCase();
    let score = 0;

    if (lowerType === 'trailer') score += 120;
    if (lowerName.includes('official trailer')) score += 100;
    else if (lowerName.includes('trailer')) score += 60;
    if (official === true || lowerName.includes('official')) score += 25;

    if (hasForbiddenTrailerText(lowerName) || hasForbiddenTrailerText(lowerType)) {
      score -= 250;
    }

    if (url.includes('/shorts/')) score -= 400;

    candidates.push({ url, score });
  };

  if (typeof payload === 'string') {
    pushCandidate(payload);
  } else if (Array.isArray(payload)) {
    for (const row of payload.slice(0, 12)) {
      if (typeof row === 'string') pushCandidate(row);
      else if (row && typeof row === 'object') pushCandidate(row.url || row.link || row.id || row.key, row.name || row.title, row.type, row.official);
    }
  } else if (payload && typeof payload === 'object') {
    pushCandidate(payload.url || payload.link || payload.id || payload.key, payload.name || payload.title, payload.type, payload.official);
  }

  const ranked = candidates.sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 0) return null;
  return best.url;
};

const attachBestTrailer = async (info: any, id: string, type?: string) => {
  if (!info || typeof info !== 'object') return;

  const tmdbTrailer = await fetchTmdbOfficialTrailer(id, type);
  if (tmdbTrailer) {
    info.trailer = tmdbTrailer;
    return;
  }

  const existingTrailer = await chooseOfficialTrailerFromExisting(info.trailer);
  if (existingTrailer) {
    info.trailer = existingTrailer;
    return;
  }

  delete info.trailer;

  const title = info.title || info.name;
  const year = info.releaseDate || info.firstAirDate;
  const yearStr = year ? new Date(year).getFullYear().toString() : undefined;
  const youtubeTrailer = await fetchYouTubeTrailer(title, yearStr);
  if (youtubeTrailer) {
    info.trailer = youtubeTrailer;
  }
};

const fetchYouTubeTrailer = async (title: string, year?: string): Promise<string | null> => {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;

  try {
    const youtube = google.youtube({
      version: 'v3',
      auth: apiKey,
    });

    const query = `${title} ${year ? year : ''} trailer`.trim();
    const response = await youtube.search.list({
      part: ['snippet'],
      q: query,
      type: ['video'],
      maxResults: 8,
      order: 'relevance',
    });

    const items = response.data.items;
    if (items && items.length > 0) {
      const candidates = items
        .map((item) => ({
          id: item.id?.videoId,
          title: item.snippet?.title || '',
          channelTitle: item.snippet?.channelTitle || '',
        }))
        .filter((item) => item.id);

      if (!candidates.length) return null;

      const videoDetails = await youtube.videos.list({
        part: ['contentDetails'],
        id: candidates.map((candidate) => candidate.id as string),
      });

      const durationById = new Map<string, number>();
      for (const detail of videoDetails.data.items || []) {
        const detailId = detail.id || '';
        const duration = parseIso8601DurationToSeconds(detail.contentDetails?.duration || '');
        if (detailId) durationById.set(detailId, duration);
      }

      const ranked = candidates
        .map((candidate) => {
          const id = candidate.id as string;
          const score = trailerScore({
            title: candidate.title,
            channelTitle: candidate.channelTitle,
            durationSeconds: durationById.get(id) || 0,
            releaseYear: year,
          });
          return { ...candidate, score };
        })
        .sort((a, b) => b.score - a.score);

      const best = ranked[0];
      if (best && best.score > -40) {
        return `https://www.youtube.com/watch?v=${best.id}`;
      }
    }
  } catch (error) {
    console.error('Error fetching YouTube trailer:', error);
  }
  return null;
};

// Map of anime providers that have direct routes in this API
const ANIME_PROVIDER_ROUTES: Record<string, string> = {
  satoru: '/anime/satoru',
  justanime: '/anime/justanime',
  animesalt: '/anime/animesalt',
};

const resolveMovieProvider = (provider?: string) => {
  if (!provider) return undefined;
  switch (provider.toLowerCase()) {
    case 'flixhq':
      return configureProvider(new MOVIES.FlixHQ());
    case 'dramacool':
      return configureProvider(new MOVIES.DramaCool());
    default:
      return undefined;
  }
};

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const MOVIE_WATCH_ATTEMPT_TIMEOUT_MS = Number(
  process.env.MOVIE_WATCH_ATTEMPT_TIMEOUT_MS || (IS_PRODUCTION ? 7000 : 5000),
);

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
    ];

    for (const providerKey of providersInOrder) {
      const baseRoute = ANIME_PROVIDER_ROUTES[providerKey];
      if (!baseRoute) continue;
      
      // Limit to top 2 titles for speed
      const queries = titleCandidates.slice(0, 2);
      
      // Parallelize title searches
      const searchPromises = queries.map(async (query) => {
        try {
          const searchRes = await fastify.inject({
            method: 'GET',
            url: `${baseRoute}/${encodeURIComponent(query)}`,
          });
          if (searchRes.statusCode >= 400) return null;
          const searchPayload: any = safeJsonParse(searchRes.body);
          const searchRows = Array.isArray(searchPayload?.results) ? searchPayload.results : [];
          if (!searchRows.length) return null;

          return searchRows
            .map((item: any) => ({
              item,
              score: titleMatchScore(String(item?.title || item?.name || ''), titleCandidates),
            }))
            .sort((a: any, b: any) => b.score - a.score)[0]?.item || null;
        } catch {
          return null;
        }
      });

      const searchResults = await Promise.all(searchPromises);
      
      // Try to process each found item in parallel
      const pickPromises = searchResults
        .filter((picked) => picked?.id)
        .map(async (picked) => {
          try {
            const infoRes = await fastify.inject({
              method: 'GET',
              url: `${baseRoute}/info/${encodeURIComponent(String(picked.id))}`,
            });
            if (infoRes.statusCode >= 400) return null;
            const infoPayload: any = safeJsonParse(infoRes.body);
            const episodes = Array.isArray(infoPayload?.episodes) ? infoPayload.episodes : [];
            if (!episodes.length) return null;

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
            if (!episodeIds.length) return null;

            // Try first episode only for speed
            for (const candidateEpisodeId of episodeIds.slice(0, 1)) {
              const queryParts: string[] = [];
              if (server) queryParts.push(`server=${encodeURIComponent(server)}`);
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
            return null;
          } catch {
            return null;
          }
        });

      const results = await Promise.all(pickPromises);
      const firstValid = results.find((r) => r);
      if (firstValid) return firstValid;
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
    
    const fetchBase = async () => {
      const res = await baseTmdb.fetchMediaInfo(id, type);
      if (res && typeof res === 'object') {
        // Optimize for speed by removing heavy fields not used in current UI
        delete (res as any).cast;
        delete (res as any).characters;
        delete (res as any).recommendations;
        delete (res as any).similar;
      }
      return res;
    };

    const baseInfo: any = redis
      ? await cache.fetch(redis as Redis, `tmdb:info:${type}:${id}`, fetchBase, REDIS_TTL)
      : await fetchBase();

    await attachBestTrailer(baseInfo, id, type);

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
    
    // Limit search terms to top 2 titles + year variants for speed
    const mainTerms = titleCandidates.slice(0, 2);
    const searchTerms = Array.from(
      new Set([
        ...mainTerms,
        ...mainTerms.flatMap((title) =>
          Number.isFinite(yearGuess) && yearGuess > 1900 ? [`${title} ${yearGuess}`] : []
        ),
      ]),
    ).slice(0, 4); // Limit to top 4 for speed

    // Parallelize all searches
    const searchPromises = searchTerms.map(async (term) => {
      try {
        return await fetchDramacoolWpSearch(term);
      } catch {
        return [];
      }
    });

    const searchResults = await Promise.all(searchPromises);
    const combinedResults: Array<{ title: string; url: string }> = searchResults.flat();

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

  const buildFlixhqTmdbInfo = async (id: string, type: string) => {
    const baseTmdb = new META.TMDB(tmdbApi, configureProvider(new MOVIES.FlixHQ()));

    const fetchBase = async () => {
      const res = await baseTmdb.fetchMediaInfo(id, type);
      if (res && typeof res === 'object') {
        delete (res as any).cast;
        delete (res as any).characters;
        delete (res as any).recommendations;
        delete (res as any).similar;
      }
      return res;
    };

    const baseInfo: any = redis
      ? await cache.fetch(redis as Redis, `tmdb:info:${type}:${id}:flixhq-mapped:v2`, fetchBase, REDIS_TTL)
      : await fetchBase();

    await attachBestTrailer(baseInfo, id, type);

    const titleCandidates = getTitleCandidatesFromMedia(baseInfo);
    if (!titleCandidates.length) return baseInfo;

    const yearGuess = Number(String(baseInfo?.releaseDate || baseInfo?.firstAirDate || '').slice(0, 4));
    const expectedType = String(type || '').toLowerCase() === 'tv' ? 'tv' : 'movie';
    const resolveAniListId = async () => {
      const queries = titleCandidates.slice(0, 2);
      for (const query of queries) {
        try {
          const anilistRes = await fastify.inject({
            method: 'GET',
            url: `/meta/anilist/${encodeURIComponent(query)}`,
          });
          if (anilistRes.statusCode >= 400) continue;
          const anilistPayload = safeJsonParse(anilistRes.body || '{}');
          const anilistRows = Array.isArray(anilistPayload?.results) ? anilistPayload.results : [];
          if (!anilistRows.length) continue;

          const picked = anilistRows
            .map((item: any) => ({
              item,
              score: titleMatchScore(String(item?.title || item?.name || ''), titleCandidates),
            }))
            .sort((a: any, b: any) => b.score - a.score)[0]?.item;
          const pickedId = String(picked?.id || '').trim();
          if (pickedId) return pickedId;
        } catch {
          continue;
        }
      }
      return null;
    };

    const animeId = await resolveAniListId();
    if (animeId) baseInfo.anilistId = animeId;

    // Build search terms, prioritizing exact titles over year variants
    const mainTerms = titleCandidates.slice(0, 2); // First 2 most relevant titles
    const searchTerms = Array.from(
      new Set([
        ...mainTerms, // Prioritize exact title matches first
        ...mainTerms.flatMap((title) =>
          Number.isFinite(yearGuess) && yearGuess > 1900 ? [`${title} ${yearGuess}`] : []
        ),
      ]),
    ).slice(0, 4); // Limit to top 4 search terms for speed

    // Parallelize all searches instead of sequential
    const searchPromises = searchTerms.map(async (term) => {
      try {
        const searchRes = await fastify.inject({
          method: 'GET',
          url: `/movies/flixhq/${encodeURIComponent(term)}`,
        });
        if (searchRes.statusCode >= 400) return [];
        const payload = safeJsonParse(searchRes.body || '{}');
        return Array.isArray(payload?.data) ? payload.data : [];
      } catch {
        return [];
      }
    });

    const searchResults = await Promise.all(searchPromises);
    const combinedResults = searchResults.flat();

    const seen = new Set<string>();
    const deduped = combinedResults.filter((row) => {
      const key = String(row?.id || '').trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const scored = deduped
      .map((item) => {
        const itemType = normalizeText(String(item?.type || ''));
        const itemTitle = String(item?.name || item?.title || '');
        const score =
          titleMatchScore(itemTitle, titleCandidates) +
          (itemType === expectedType ? 120 : -250) +
          (() => {
            const rowYear = Number(item?.releaseDate);
            if (!Number.isFinite(yearGuess) || yearGuess <= 1900 || !Number.isFinite(rowYear)) return 0;
            if (rowYear === yearGuess) return 30;
            if (Math.abs(rowYear - yearGuess) === 1) return 10;
            return 0;
          })() +
          (() => {
            if (expectedType !== 'tv') return 0;
            const baseSeasons = Array.isArray(baseInfo?.seasons) ? baseInfo.seasons.length : 0;
            const rowSeasons = Number(item?.seasons || 0);
            if (!baseSeasons || !rowSeasons) return 0;
            if (baseSeasons === rowSeasons) return 12;
            if (Math.abs(baseSeasons - rowSeasons) <= 1) return 5;
            return 0;
          })();
        return { item, score };
      })
      .sort((a, b) => b.score - a.score);

    // Early exit if top match is perfect (exact title + correct type + correct year)
    const topMatch = scored[0];
    if (topMatch && topMatch.score > 1100) {
      // High confidence match: 1000 (exact) + 120 (type) + 30 (year) = 1150+
      const pick = topMatch.item;
      if (pick?.id) {
        try {
          const infoRes = await fastify.inject({
            method: 'GET',
            url: `/movies/flixhq/info?id=${encodeURIComponent(String(pick.id))}`,
          });
          if (infoRes.statusCode < 400) {
            const payload = safeJsonParse(infoRes.body || '{}');
            const providerEpisodes = Array.isArray(payload?.providerEpisodes)
              ? payload.providerEpisodes
              : Array.isArray(payload?.data?.providerEpisodes)
                ? payload.data.providerEpisodes
                : [];
            if (providerEpisodes.length > 0) {
              // Skip to the end of the function with early result
              const bySeasonEpisode = new Map<string, any>();
              for (const ep of providerEpisodes) {
                const seasonNum = Number(ep?.seasonNumber || 0);
                const episodeNum = Number(ep?.episodeNumber || 0);
                if (!seasonNum || !episodeNum) continue;
                bySeasonEpisode.set(`${seasonNum}:${episodeNum}`, ep);
              }

              if (Array.isArray(baseInfo?.seasons)) {
                baseInfo.seasons = baseInfo.seasons.map((season: any, seasonIndex: number) => {
                  const seasonNum = Number(season?.season || seasonIndex + 1);
                  if (!Array.isArray(season?.episodes)) return season;
                  return {
                    ...season,
                    episodes: season.episodes.map((episode: any, episodeIndex: number) => {
                      const episodeNum = Number(episode?.episode || episode?.number || episodeIndex + 1);
                      const mapped = bySeasonEpisode.get(`${seasonNum}:${episodeNum}`);
                      if (!mapped?.episodeId) return episode;
                      return {
                        ...episode,
                        id: mapped.episodeId,
                        url: mapped.episodeId,
                      };
                    }),
                  };
                });
              }

              baseInfo.provider = 'flixhq';
              baseInfo.providerSourceId = pick.id;
              return baseInfo; // Early return on perfect match
            }
          }
        } catch {
          // Fall through to normal path
        }
      }
    }

    const pick = scored[0]?.item;
    if (!pick?.id) return baseInfo;

    // For movies, validate the pick by checking release year
    if (expectedType === 'movie') {
      try {
        const infoRes = await fastify.inject({
          method: 'GET',
          url: `/movies/flixhq/info?id=${encodeURIComponent(String(pick.id))}`,
        });
        if (infoRes.statusCode < 400) {
          const payload = safeJsonParse(infoRes.body || '{}');
          const movieInfo = payload?.data || payload;
          const releaseDateStr = String(movieInfo?.releaseDate || '');
          const flixReleaseYear = releaseDateStr ? Number(releaseDateStr.slice(0, 4)) : 0;
          const tmdbReleaseYear = Number(String(baseInfo?.releaseDate || baseInfo?.firstAirDate || '').slice(0, 4));
          
          // If years match or are close, accept it
          const yearDiff = Math.abs(flixReleaseYear - tmdbReleaseYear);
          if (flixReleaseYear && tmdbReleaseYear && yearDiff <= 1) {
            baseInfo.provider = 'flixhq';
            baseInfo.providerSourceId = pick.id;
            return baseInfo;
          } else if (!tmdbReleaseYear || yearDiff > 1) {
            // If year doesn't match, try the next best match
            const nextPick = scored[1]?.item;
            if (nextPick?.id) {
              const nextInfoRes = await fastify.inject({
                method: 'GET',
                url: `/movies/flixhq/info?id=${encodeURIComponent(String(nextPick.id))}`,
              });
              if (nextInfoRes.statusCode < 400) {
                const nextPayload = safeJsonParse(nextInfoRes.body || '{}');
                const nextMovieInfo = nextPayload?.data || nextPayload;
                const nextReleaseDateStr = String(nextMovieInfo?.releaseDate || '');
                const nextFlixReleaseYear = nextReleaseDateStr ? Number(nextReleaseDateStr.slice(0, 4)) : 0;
                const nextYearDiff = Math.abs(nextFlixReleaseYear - tmdbReleaseYear);
                if (nextFlixReleaseYear && (!tmdbReleaseYear || nextYearDiff <= 1)) {
                  baseInfo.provider = 'flixhq';
                  baseInfo.providerSourceId = nextPick.id;
                  return baseInfo;
                }
              }
            }
          }
        }
      } catch {
        // Fall through
      }
      // If validation failed, return without mapping
      return baseInfo;
    }

    try {
      const infoRes = await fastify.inject({
        method: 'GET',
        url: `/movies/flixhq/info?id=${encodeURIComponent(String(pick.id))}`,
      });

      if (infoRes.statusCode >= 400) return baseInfo;
      const payload = safeJsonParse(infoRes.body || '{}');
      const providerEpisodes = Array.isArray(payload?.providerEpisodes)
        ? payload.providerEpisodes
        : Array.isArray(payload?.data?.providerEpisodes)
          ? payload.data.providerEpisodes
          : [];

      if (!providerEpisodes.length) return baseInfo;

      const bySeasonEpisode = new Map<string, any>();
      for (const ep of providerEpisodes) {
        const seasonNum = Number(ep?.seasonNumber || 0);
        const episodeNum = Number(ep?.episodeNumber || 0);
        if (!seasonNum || !episodeNum) continue;
        bySeasonEpisode.set(`${seasonNum}:${episodeNum}`, ep);
      }

      if (Array.isArray(baseInfo?.seasons)) {
        baseInfo.seasons = baseInfo.seasons.map((season: any, seasonIndex: number) => {
          const seasonNum = Number(season?.season || seasonIndex + 1);
          if (!Array.isArray(season?.episodes)) return season;
          return {
            ...season,
            episodes: season.episodes.map((episode: any, episodeIndex: number) => {
              const episodeNum = Number(episode?.episode || episode?.number || episodeIndex + 1);
              const mapped = bySeasonEpisode.get(`${seasonNum}:${episodeNum}`);
              if (!mapped?.episodeId) return episode;
              return {
                ...episode,
                id: mapped.episodeId,
                url: mapped.episodeId,
              };
            }),
          };
        });
      }

      baseInfo.provider = 'flixhq';
      baseInfo.providerSourceId = pick.id;
      return baseInfo;
    } catch {
      return baseInfo;
    }
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
    const tmdb = configureMeta(new META.TMDB(tmdbApi, configureProvider(new MOVIES.FlixHQ())));

    try {
      const fetchSearch = async () => {
        return await tmdb.search(query, page);
      };

      let res = redis
        ? await cache.fetch(redis as Redis, `tmdb:search:${query}:${page || 1}`, fetchSearch, REDIS_TTL)
        : await fetchSearch();

      // If results are empty or error out, try direct rescue
      if (!res || !Array.isArray(res.results) || res.results.length === 0) {
        const rescued = await getDirectTmdbSearch(query, page);
        if (rescued && rescued.results.length > 0) {
          res = { ...rescued, message: 'Search results rescued via direct fetch' };
        }
      }

      reply.status(200).send(res);
    } catch (err) {
      console.error('TMDB Search Error:', err);
      // Catch-all rescue
      const rescued = await getDirectTmdbSearch(query, page);
      if (rescued) {
        return reply.status(200).send({ ...rescued, message: 'Search results rescued after fetch failure' });
      }
      reply.status(200).send({ results: [], total_results: 0, message: 'Search failed, please try again or check TMDB key.' });
    }
  });

  const getDirectTmdbSearch = async (query: string, page: number = 1) => {
    try {
      if (!tmdbApi) return null;
      const url = `https://api.themoviedb.org/3/search/multi?api_key=${tmdbApi}&query=${encodeURIComponent(query)}&page=${page}`;
      const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.data && Array.isArray(res.data.results)) {
        return {
          results: res.data.results.map((item: any) => ({
            id: item.id.toString(),
            title: item.title || item.name || 'Unknown',
            image: item.poster_path ? `https://image.tmdb.org/t/p/original${item.poster_path}` : null,
            type: item.media_type === 'tv' ? 'tv' : 'movie',
            releaseDate: item.release_date || item.first_air_date,
            rating: item.vote_average,
          })),
          total_results: res.data.total_results,
          total_pages: res.data.total_pages,
        };
      }
    } catch (err) {
      console.error('Direct TMDB Search Error:', err);
    }
    return null;
  };

  const getDirectTmdbInfo = async (id: string, type: string) => {
    try {
      if (!tmdbApi) return null;
      const url = `https://api.themoviedb.org/3/${type}/${id}?api_key=${tmdbApi}`;
      const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.data) {
        return {
          id: res.data.id.toString(),
          title: res.data.title || res.data.name || 'Unknown',
          description: res.data.overview,
          image: `https://image.tmdb.org/t/p/original${res.data.poster_path}`,
          cover: `https://image.tmdb.org/t/p/original${res.data.backdrop_path}`,
          status: res.data.status,
          releaseDate: res.data.release_date || res.data.first_air_date,
          rating: res.data.vote_average,
          genres: res.data.genres?.map((g: any) => g.name) || [],
          totalEpisodes: res.data.number_of_episodes || (res.data.episodes ? res.data.episodes.length : 0),
          seasons: res.data.seasons?.map((s: any) => ({
             id: s.id.toString(),
             name: s.name,
             season: s.season_number,
             image: s.poster_path ? `https://image.tmdb.org/t/p/original${s.poster_path}` : null,
          })) || [],
          // Minimal info to keep UI working
        };
      }
    } catch (err) {
      console.error('Direct TMDB Fetch Error:', err);
    }
    return null;
  };

  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    const sanitizeType = (t: any): string | undefined => {
      if (!t || t === 'undefined' || t === 'null') return undefined;
      return String(t).toLowerCase();
    };

    const id = (request.query as { id: string }).id;
    let type = sanitizeType((request.query as { type: string }).type);
    const provider = (request.query as { provider?: string }).provider;
    const providerLower = provider?.toLowerCase();
    let tmdb = configureMeta(new META.TMDB(tmdbApi, configureProvider(new MOVIES.FlixHQ())));

    if (!id) return reply.status(400).send({ message: "The 'id' query is required" });

    // --- Smart Type Guessing Logic ---
    if (!type || (type !== 'movie' && type !== 'tv')) {
      console.log(`[SmartGuess] type missing for id ${id}, attempting resolution...`);
      try {
        // Try to fetch as TV first (37854 is a TV show in user's logs)
        const tvQuery = `https://api.themoviedb.org/3/tv/${id}?api_key=${tmdbApi}`;
        const tvRes = await axios.get(tvQuery).catch(() => null);
        if (tvRes?.data) {
          type = 'tv';
          console.log(`[SmartGuess] Resolved id ${id} as 'tv'`);
        } else {
          const movieQuery = `https://api.themoviedb.org/3/movie/${id}?api_key=${tmdbApi}`;
          const movieRes = await axios.get(movieQuery).catch(() => null);
          if (movieRes?.data) {
            type = 'movie';
            console.log(`[SmartGuess] Resolved id ${id} as 'movie'`);
          }
        }
      } catch {
        // Fallback below
      }
    }

    if (!type) {
      return reply.status(400).send({ message: "The 'type' query is required and could not be auto-resolved." });
    }

    if (providerLower === 'dramacool') {
      try {
        const res = await buildDramacoolTmdbInfo(id, type);
        return reply.status(200).send(res);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ message });
      }
    }

    if (providerLower === 'flixhq') {
      try {
        const res = await buildFlixhqTmdbInfo(id, type);
        return reply.status(200).send(res);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ message });
      }
    }

    if (typeof provider !== 'undefined') {
      const selectedProvider = resolveMovieProvider(provider);
      if (selectedProvider) {
        tmdb = configureMeta(new META.TMDB(tmdbApi, selectedProvider));
      } else {
        const possibleProvider = PROVIDERS_LIST.MOVIES.find(
          (p) => p.name.toLowerCase() === provider.toLocaleLowerCase(),
        );
        tmdb = configureMeta(new META.TMDB(tmdbApi, possibleProvider));
      }
    }

    try {
      const fetchInfo = async () => {
        const info = await tmdb.fetchMediaInfo(id, type);
        if (info && typeof info === 'object') {
          // Optimize for speed by removing heavy fields not used in current UI
          delete (info as any).cast;
          delete (info as any).characters;
          delete (info as any).recommendations;
          delete (info as any).similar;

          await attachBestTrailer(info, id, type);
        }
        return info;
      };

      let res = redis
        ? await cache.fetch(redis as Redis, `tmdb:info:${type}:${id}:${provider || 'default'}:trailer-v2`, fetchInfo, REDIS_TTL)
        : await fetchInfo();

      // If title is "Unknown" or missing, try to rescue it directly from TMDB
      if (!res || !(res as any).title || (res as any).title === 'Unknown') {
        const rescued = await getDirectTmdbInfo(id, type);
        if (rescued) {
          res = { ...(res || {}), ...rescued, message: 'Metadata partially rescued via direct fetch' };
        }
      }

      reply.status(200).send(res);
    } catch (err) {
      console.error('TMDB Info Error:', err);
      // Catch-all rescue if the entire fetch fails
      const rescued = await getDirectTmdbInfo(id, type);
      if (rescued) {
        return reply.status(200).send({ ...rescued, episodes: [], message: 'Metadata rescued after fetch failure' });
      }
      reply.status(200).send({ id, title: 'Unknown', episodes: [], message: 'TMDB metadata fetch failed' });
    }
  });

  fastify.get('/info/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const sanitizeType = (t: any): string | undefined => {
      if (!t || t === 'undefined' || t === 'null') return undefined;
      return String(t).toLowerCase();
    };

    const id = (request.params as { id: string }).id;
    let type = sanitizeType((request.query as { type: string }).type);
    const provider = (request.query as { provider?: string }).provider;
    const providerLower = provider?.toLowerCase();
    let tmdb = configureMeta(new META.TMDB(tmdbApi, configureProvider(new MOVIES.FlixHQ())));

    // --- Smart Type Guessing Logic ---
    if (!type || (type !== 'movie' && type !== 'tv')) {
      console.log(`[SmartGuess] type missing for id ${id}, attempting resolution...`);
      try {
        const tvQuery = `https://api.themoviedb.org/3/tv/${id}?api_key=${tmdbApi}`;
        const tvRes = await axios.get(tvQuery).catch(() => null);
        if (tvRes?.data) {
          type = 'tv';
          console.log(`[SmartGuess] Resolved id ${id} as 'tv'`);
        } else {
          const movieQuery = `https://api.themoviedb.org/3/movie/${id}?api_key=${tmdbApi}`;
          const movieRes = await axios.get(movieQuery).catch(() => null);
          if (movieRes?.data) {
            type = 'movie';
            console.log(`[SmartGuess] Resolved id ${id} as 'movie'`);
          }
        }
      } catch {
        // Fallback below
      }
    }

    if (!type) {
      return reply.status(400).send({ message: "The 'type' query is required and could not be auto-resolved." });
    }

    if (providerLower === 'dramacool') {
      try {
        const res = await buildDramacoolTmdbInfo(id, type);
        return reply.status(200).send(res);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ message });
      }
    }

    if (providerLower === 'flixhq') {
      try {
        const res = await buildFlixhqTmdbInfo(id, type);
        return reply.status(200).send(res);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ message });
      }
    }

    if (typeof provider !== 'undefined') {
      const selectedProvider = resolveMovieProvider(provider);
      if (selectedProvider) {
        tmdb = configureMeta(new META.TMDB(tmdbApi, selectedProvider));
      } else {
        const possibleProvider = PROVIDERS_LIST.MOVIES.find(
          (p) => p.name.toLowerCase() === provider.toLocaleLowerCase(),
        );
        tmdb = configureMeta(new META.TMDB(tmdbApi, possibleProvider));
      }
    }

    try {
      const fetchInfo = async () => {
        const info = await tmdb.fetchMediaInfo(id, type);
        if (info && typeof info === 'object') {
          // Optimize for speed by removing heavy fields not used in current UI
          delete (info as any).cast;
          delete (info as any).characters;
          delete (info as any).recommendations;
          delete (info as any).similar;

          await attachBestTrailer(info, id, type);
        }
        return info;
      };

      let res = redis
        ? await cache.fetch(redis as Redis, `tmdb:info:${type}:${id}:${provider || 'default'}:trailer-v2`, fetchInfo, REDIS_TTL)
        : await fetchInfo();

      // If title is "Unknown" or missing, try to rescue it directly from TMDB
      if (!res || !(res as any).title || (res as any).title === 'Unknown') {
        const rescued = await getDirectTmdbInfo(id, type);
        if (rescued) {
          res = { ...(res || {}), ...rescued, message: 'Metadata partially rescued via direct fetch' };
        }
      }

      reply.status(200).send(res);
    } catch (err) {
      console.error('TMDB Info ID Error:', err);
      // Catch-all rescue
      const rescued = await getDirectTmdbInfo(id, type);
      if (rescued) {
        return reply.status(200).send({ ...rescued, episodes: [], message: 'Metadata rescued after fetch failure' });
      }
      reply.status(200).send({ id, title: 'Unknown', episodes: [], message: 'TMDB metadata fetch failed' });
    }
  });

  fastify.get('/trending', async (request: FastifyRequest, reply: FastifyReply) => {
    const validTimePeriods = new Set(['day', 'week'] as const);
    type validTimeType = typeof validTimePeriods extends Set<infer T> ? T : undefined;

    const sanitizeType = (t: any): string => {
      if (!t || t === 'undefined' || t === 'null') return 'all';
      return String(t).toLowerCase();
    };

    const type = sanitizeType((request.query as { type?: string }).type);
    let timePeriod =
      (request.query as { timePeriod?: validTimeType }).timePeriod || 'day';

    // make day as default time period
    if (!validTimePeriods.has(timePeriod)) timePeriod = 'day';

    const page = (request.query as { page?: number }).page || 1;

    const tmdb = configureMeta(new META.TMDB(tmdbApi, configureProvider(new MOVIES.FlixHQ())));

    try {
      let res = await tmdb.fetchTrending(type, timePeriod, page);
      
      // If results are empty or missing, try direct rescue
      if (!res || !Array.isArray(res.results) || res.results.length === 0) {
        const rescued = await getDirectTmdbTrending(type, timePeriod, page);
        if (rescued && rescued.results.length > 0) {
          res = { ...rescued, message: 'Trending rescued via direct fetch' };
        }
      }

      if (res && Array.isArray(res.results)) {
        res.results.forEach((item: any) => {
          delete (item as any).cast;
          delete (item as any).characters;
        });
      }
      reply.status(200).send(res);
    } catch (err) {
      console.error('TMDB Trending Error:', err);
      // Catch-all rescue
      const rescued = await getDirectTmdbTrending(type, timePeriod, page);
      if (rescued) {
        return reply.status(200).send({ ...rescued, message: 'Trending rescued after fetch failure' });
      }
      reply.status(200).send({ results: [], message: 'Trending currently unavailable, please check TMDB key.' });
    }
  });

  const getDirectTmdbTrending = async (type: string = 'all', timePeriod: string = 'day', page: number = 1) => {
    try {
      if (!tmdbApi) return null;
      const url = `https://api.themoviedb.org/3/trending/${type}/${timePeriod}?api_key=${tmdbApi}&page=${page}`;
      const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.data && Array.isArray(res.data.results)) {
        return {
          results: res.data.results.map((item: any) => ({
            id: item.id.toString(),
            title: item.title || item.name || 'Unknown',
            image: item.poster_path ? `https://image.tmdb.org/t/p/original${item.poster_path}` : null,
            type: item.media_type || (type === 'all' ? 'movie' : type),
            releaseDate: item.release_date || item.first_air_date,
            rating: item.vote_average,
          })),
          page: res.data.page,
        };
      }
    } catch (err) {
      console.error('Direct TMDB Trending Error:', err);
    }
    return null;
  };

  const watch = async (request: FastifyRequest, reply: FastifyReply) => {
    const sanitizeType = (t: any): string | undefined => {
      if (!t || t === 'undefined' || t === 'null') return undefined;
      return String(t).toLowerCase();
    };

    let episodeId = (request.params as { episodeId: string }).episodeId;
    if (!episodeId) {
      episodeId = (request.query as { episodeId: string }).episodeId;
    }
    const id = (request.query as { id: string }).id;
    const type = sanitizeType((request.query as { type: string }).type);
    const provider = (request.query as { provider?: string }).provider;
    const server = (request.query as { server?: StreamingServers }).server;
    const directOnlyRaw = String((request.query as { directOnly?: string }).directOnly || '').toLowerCase();
    const directOnly = directOnlyRaw === '1' || directOnlyRaw === 'true' || directOnlyRaw === 'yes';

    // Build cache key for watch results (skip caching if server is specified since that changes results)
    const cacheKey = !server ? `tmdb:watch:${type}:${id}:${provider || 'default'}:${directOnly}` : null;

    // Try to return from cache first
    if (cacheKey && redis) {
      try {
        const cached = await (redis as Redis).get(cacheKey);
        if (cached) {
          const payload = JSON.parse(cached);
          return reply.status(200).send(payload);
        }
      } catch {
        // Ignore cache read errors and proceed with normal flow
      }
    }

    // Check if it's an anime provider - redirect to anime route
    const providerLower = provider?.toLowerCase();
    if (providerLower && ANIME_PROVIDER_ROUTES[providerLower]) {
      const animeBaseUrl = ANIME_PROVIDER_ROUTES[providerLower];
      const queryParts: string[] = [];
      if (server) {
        const serverKey = providerLower === 'satoru' ? 'serverId' : 'server';
        queryParts.push(`${serverKey}=${encodeURIComponent(server)}`);
      }
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

        // Cache successful watch results
        if (cacheKey && redis && delegated.statusCode < 400) {
          (redis as Redis).setex(cacheKey, REDIS_TTL, JSON.stringify(payload)).catch(() => {});
        }

        return reply.status(delegated.statusCode || 200).send(payload);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(404).send({ message });
      }
    }

    if (type === 'movie' && id && (!providerLower || providerLower === 'flixhq') && !episodeId) {
      // FAST PATH: For movies, skip full episode mapping and go straight to FlixHQ watch
      // This cuts response time by 60-70% compared to full buildFlixhqTmdbInfo
      try {
        let movieId = String(id).trim();
        let titleForSearch = '';

        // Try direct ID first (sometimes TMDB ID works directly)
        if (/^\d+$/.test(movieId)) {
          try {
            const directRes = await fastify.inject({
              method: 'GET',
              url: `/movies/flixhq/watch?episodeId=${encodeURIComponent(movieId)}`,
            });
            if (directRes.statusCode < 400) {
              const payload = safeJsonParse(directRes.body || '{}');
              if (Array.isArray(payload?.sources) && payload.sources.length > 0) {
                if (!directOnly || payload.sources.some((src: any) => /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(src?.url || '')))) {
                  if (cacheKey && redis) {
                    (redis as Redis).setex(cacheKey, REDIS_TTL, JSON.stringify(payload)).catch(() => {});
                  }
                  return reply.status(200).send(payload);
                }
              }
            }
          } catch {
            // Continue to search path
          }
        }

        // If direct ID didn't work, get title and search
        try {
          const baseTmdb = new META.TMDB(tmdbApi, configureProvider(new MOVIES.FlixHQ()));
          let mediaInfo: any;
          try {
            mediaInfo = await baseTmdb.fetchMediaInfo(id, 'movie');
          } catch {
            mediaInfo = await getDirectTmdbInfo(id, 'movie');
          }

          if (mediaInfo?.title) {
            titleForSearch = mediaInfo.title;
          }
        } catch {
          // Will use fallback
        }

        // Search FlixHQ with title
        if (titleForSearch) {
          try {
            const searchRes = await fastify.inject({
              method: 'GET',
              url: `/movies/flixhq/${encodeURIComponent(titleForSearch)}`,
            });
            if (searchRes.statusCode < 400) {
              const payload = safeJsonParse(searchRes.body || '{}');
              const results = Array.isArray(payload?.data) ? payload.data : [];
              const movieMatch = results.find((r: any) => normalizeText(String(r?.type || '')) === 'movie');
              
              if (movieMatch?.id) {
                // Found movie! Directly call FlixHQ watch
                const queryParts = [`episodeId=${encodeURIComponent(movieMatch.id)}`];
                if (server) queryParts.push(`server=${encodeURIComponent(server)}`);
                if (directOnly) queryParts.push('directOnly=true');
                
                const watchRes = await fastify.inject({
                  method: 'GET',
                  url: `/movies/flixhq/watch?${queryParts.join('&')}`,
                });

                if (watchRes.statusCode < 400) {
                  const watchPayload = safeJsonParse(watchRes.body || '{}');
                  const sources = Array.isArray(watchPayload?.sources) ? watchPayload.sources : [];
                  if (sources.length > 0) {
                    if (!directOnly || sources.some((src: any) => /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(src?.url || '')))) {
                      if (cacheKey && redis) {
                        (redis as Redis).setex(cacheKey, REDIS_TTL, JSON.stringify(watchPayload)).catch(() => {});
                      }
                      return reply.status(200).send(watchPayload);
                    }
                  }
                }
              }
            }
          } catch {
            // Fall through to normal path
          }
        }
      } catch {
        // Fall through to normal path
      }
    }

    if (!episodeId && type === 'tv' && id && (!providerLower || providerLower === 'flixhq')) {
      try {
        const info: any = await buildFlixhqTmdbInfo(id, type);
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
        episodeId = epMatch?.id || epMatch?.url || episodeId;
      } catch {
        // Ignore mapping fallback failures and allow normal flow to return extraction errors.
      }
    }

    if (type === 'movie' && !providerLower && id) {
      try {
        const discoveryTmdb = new META.TMDB(tmdbApi, configureProvider(new MOVIES.FlixHQ()));
        let mediaInfo: any;
        try {
          mediaInfo = await discoveryTmdb.fetchMediaInfo(id, type);
        } catch {
          // Rescue directly if discovery fails
          mediaInfo = await getDirectTmdbInfo(id, type);
        }

        // Final check for "Unknown" title after fetch
        if (!mediaInfo || !mediaInfo.title || mediaInfo.title === 'Unknown') {
          const rescued = await getDirectTmdbInfo(id, type);
          if (rescued) mediaInfo = { ...(mediaInfo || {}), ...rescued };
        }

        const titleCandidates = getTitleCandidatesFromMedia(mediaInfo);
        if (isAnimeLikeMovie(mediaInfo) && titleCandidates.length) {
          const animeFallback = await tryAnimeProvidersForMovie({
            titleCandidates,
            server,
          });
          if (animeFallback) {
            // Cache watch result for fast subsequent loads
            if (cacheKey && redis) {
              (redis as Redis).setex(cacheKey, REDIS_TTL, JSON.stringify(animeFallback)).catch(() => {});
            }
            return reply.status(200).send(animeFallback);
          }
        }
      } catch {
        // Ignore discovery errors and continue with movie providers.
      }
    }

    // Movie/TV providers
    let movieProvider: any = configureProvider(new MOVIES.FlixHQ());
    let tmdb = configureMeta(new META.TMDB(tmdbApi, movieProvider));
    if (typeof provider !== 'undefined') {
      const selectedProvider = resolveMovieProvider(provider);
      if (selectedProvider) {
        movieProvider = selectedProvider as any;
        tmdb = configureMeta(new META.TMDB(tmdbApi, selectedProvider));
      } else {
        const possibleProvider = PROVIDERS_LIST.MOVIES.find(
          (p) => p.name.toLowerCase() === provider.toLocaleLowerCase(),
        );
        movieProvider = (possibleProvider as any) || movieProvider;
        tmdb = configureMeta(new META.TMDB(tmdbApi, possibleProvider));
      }
    }
    let sourceId = '';
    let mediaId = '';
    try {
      // For movies, the id parameter contains the provider's media ID (e.g., "movie/watch-marty-supreme-139738")
      // We need to use this as the first parameter, not the TMDB episodeId
      // For TV shows, episodeId is the actual episode ID from the provider

      if (type === 'movie' && id) {
        // For movies, episodeId is the provider source ID in TMDB/provider responses.
        sourceId = String(episodeId || '').trim();
        mediaId = id;

        // Frontend can occasionally leak a previous provider episodeId (e.g. DramaCool URL)
        // into a FlixHQ movie request. Ignore those and resolve proper FlixHQ ids.
        if ((providerLower === 'flixhq' || !providerLower) && sourceId) {
          const lowerSourceId = sourceId.toLowerCase();
          const foreignProviderUrl = /^https?:\/\//i.test(sourceId);
          const foreignProviderHint =
            lowerSourceId.includes('dramacool') ||
            lowerSourceId.includes('animesalt') ||
            lowerSourceId.includes('hianime') ||
            lowerSourceId.includes('satoru');
          if (foreignProviderUrl || foreignProviderHint) {
            sourceId = '';
          }
        }

        // FlixHQ often requires provider-specific numeric IDs (not TMDB ids) for watch extraction.
        if (!sourceId && providerLower === 'flixhq') {
          try {
            const flixInfo: any = await buildFlixhqTmdbInfo(id, type);
            const infoEpisodeId = String(flixInfo?.episodeId || '').trim();
            const providerSourceId = String(flixInfo?.providerSourceId || '').trim();
            sourceId = infoEpisodeId || providerSourceId || sourceId;
          } catch {
            // Ignore resolution errors and continue with generic fallback below.
          }
        }

        // Generic fallback when provider-specific id could not be resolved.
        sourceId = sourceId || id.replace(/^movie\//, '');
      } else {
        // For TV shows, use episodeId as sourceId and id as mediaId
        sourceId = episodeId;
        mediaId = id;
      }

      // Fast path: delegate FlixHQ playback extraction to the custom provider first.
      // This path is optimized and cached at /movies/flixhq/watch.
      if ((providerLower === 'flixhq' || !providerLower) && sourceId) {
        try {
          const queryParts = [`episodeId=${encodeURIComponent(sourceId)}`];
          if (server) queryParts.push(`server=${encodeURIComponent(server)}`);
          const delegated = await fastify.inject({
            method: 'GET',
            url: `/movies/flixhq/watch?${queryParts.join('&')}`,
          });

          if (delegated.statusCode < 400) {
            const payload = safeJsonParse(delegated.body || '{}');
            const sources = Array.isArray(payload?.sources) ? payload.sources : [];
            if (!directOnly || sources.some((src: any) => /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(src?.url || '')))) {
              // Cache watch result for fast subsequent loads
              if (cacheKey && redis) {
                (redis as Redis).setex(cacheKey, REDIS_TTL, JSON.stringify(payload)).catch(() => {});
              }
              return reply.status(200).send(payload);
            }
          }
        } catch {
          // Fall through to TMDB provider extraction path.
        }
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

      // Cache watch result for fast subsequent loads
      if (cacheKey && redis && res) {
        (redis as Redis).setex(cacheKey, REDIS_TTL, JSON.stringify(res)).catch(() => {});
      }
      reply.status(200).send(res);
    } catch (err: any) {
      if ((type === 'tv' || type === 'movie') && sourceId && (!providerLower || providerLower === 'flixhq')) {
        try {
          const queryParts = [`episodeId=${encodeURIComponent(sourceId)}`];
          if (server) queryParts.push(`server=${encodeURIComponent(server)}`);
          const delegated = await fastify.inject({
            method: 'GET',
            url: `/movies/flixhq/watch?${queryParts.join('&')}`,
          });

          if (delegated.statusCode < 400) {
            const payload = safeJsonParse(delegated.body || '{}');
            const sources = Array.isArray(payload?.sources) ? payload.sources : [];
            if (!directOnly || sources.some((src: any) => /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(src?.url || '')))) {
              // Cache watch result for fast subsequent loads
              if (cacheKey && redis) {
                (redis as Redis).setex(cacheKey, REDIS_TTL, JSON.stringify(payload)).catch(() => {});
              }
              return reply.status(200).send(payload);
            }
          }
        } catch {
          // Continue to existing fallbacks below.
        }
      }

      if (type === 'movie' && id) {
        try {
          const discoveryTmdb = configureMeta(new META.TMDB(tmdbApi, configureProvider(new MOVIES.FlixHQ())));
          let mediaInfo: any;
          try {
             mediaInfo = await discoveryTmdb.fetchMediaInfo(id, type);
          } catch {
             mediaInfo = await getDirectTmdbInfo(id, type);
          }

          if (!mediaInfo || !mediaInfo.title || mediaInfo.title === 'Unknown') {
            const rescued = await getDirectTmdbInfo(id, type);
            if (rescued) mediaInfo = { ...(mediaInfo || {}), ...rescued };
          }

          const titleCandidates = getTitleCandidatesFromMedia(mediaInfo);
          if (titleCandidates.length) {
            const animeFallback = await tryAnimeProvidersForMovie({
              titleCandidates,
              server,
            });
            if (animeFallback) {
              // Cache watch result for fast subsequent loads
              if (cacheKey && redis) {
                (redis as Redis).setex(cacheKey, REDIS_TTL, JSON.stringify(animeFallback)).catch(() => {});
              }
              return reply.status(200).send(animeFallback);
            }
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
            // Cache watch result for fast subsequent loads
            if (cacheKey && redis) {
              (redis as Redis).setex(cacheKey, REDIS_TTL, JSON.stringify(fallback)).catch(() => {});
            }
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
