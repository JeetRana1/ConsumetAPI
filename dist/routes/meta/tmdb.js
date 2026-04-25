"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const extensions_1 = require("@consumet/extensions");
const extensions_2 = require("@consumet/extensions");
const main_1 = require("../../main");
const cache_1 = __importDefault(require("../../utils/cache"));
const streamable_1 = require("../../utils/streamable");
const provider_1 = require("../../utils/provider");
const movieServerFallback_1 = require("../../utils/movieServerFallback");
const vegamoviesProvider_1 = require("../../providers/custom/vegamoviesProvider");
const axios_1 = __importDefault(require("axios"));
const googleapis_1 = require("googleapis");
const configureMeta = (meta) => {
    if (meta && meta.client?.defaults) {
        // Already set globally in main.ts, but being explicit for meta routes
        meta.client.defaults.headers.common['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    }
    return meta;
};
const shouldLookupTrailers = String(process.env.TMDB_ENABLE_TRAILER_LOOKUP || 'false').toLowerCase() === 'true';
const createTmdbClient = (provider) => {
    if (!main_1.tmdbApi)
        return null;
    return configureMeta(new extensions_1.META.TMDB(main_1.tmdbApi, provider));
};
const parseIso8601DurationToSeconds = (duration) => {
    if (!duration || typeof duration !== 'string')
        return 0;
    const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
    if (!match)
        return 0;
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] || 0);
    return hours * 3600 + minutes * 60 + seconds;
};
const trailerScore = (params) => {
    const title = String(params.title || '').toLowerCase();
    const channelTitle = String(params.channelTitle || '').toLowerCase();
    const year = String(params.releaseYear || '').trim();
    let score = 0;
    if (title.includes('official trailer'))
        score += 140;
    else if (title.includes('trailer'))
        score += 100;
    if (title.includes('official'))
        score += 25;
    if (year && title.includes(year))
        score += 12;
    if (title.includes('teaser') ||
        title.includes('clip') ||
        title.includes('behind the scenes') ||
        title.includes('featurette') ||
        title.includes('interview') ||
        title.includes('tv spot') ||
        title.includes('short') ||
        title.includes('promo') ||
        title.includes('reaction')) {
        score -= 180;
    }
    if (channelTitle.includes('trailers'))
        score += 20;
    if (params.durationSeconds > 0) {
        if (params.durationSeconds < 45)
            score -= 220;
        else if (params.durationSeconds < 75)
            score -= 100;
        else if (params.durationSeconds >= 75 && params.durationSeconds <= 260)
            score += 30;
        else if (params.durationSeconds > 900)
            score -= 50;
    }
    return score;
};
const fetchTmdbOfficialTrailer = async (id, type) => {
    if (!main_1.tmdbApi)
        return null;
    try {
        const tmdbType = String(type || '').toLowerCase() === 'tv' ? 'tv' : 'movie';
        const url = `https://api.themoviedb.org/3/${tmdbType}/${id}/videos?api_key=${main_1.tmdbApi}&language=en-US`;
        const response = await axios_1.default.get(url);
        const results = Array.isArray(response?.data?.results) ? response.data.results : [];
        const ranked = results
            .filter((row) => String(row?.site || '').toLowerCase() === 'youtube' && row?.key)
            .map((row) => {
            const trailerType = String(row?.type || '').toLowerCase();
            const trailerName = String(row?.name || '').toLowerCase();
            let score = 0;
            if (trailerType === 'trailer')
                score += 140;
            else
                score -= 80;
            if (row?.official === true)
                score += 60;
            if (trailerName.includes('official'))
                score += 25;
            if (trailerType.includes('teaser') ||
                trailerType.includes('clip') ||
                trailerType.includes('behind the scenes') ||
                trailerType.includes('featurette') ||
                trailerName.includes('teaser') ||
                trailerName.includes('clip') ||
                trailerName.includes('behind the scenes') ||
                trailerName.includes('featurette') ||
                trailerName.includes('tv spot')) {
                score -= 220;
            }
            return {
                key: String(row.key),
                score,
                publishedAt: Date.parse(String(row?.published_at || row?.publishedAt || '')) || 0,
            };
        })
            .sort((a, b) => b.score - a.score || b.publishedAt - a.publishedAt);
        const best = ranked[0];
        if (!best || best.score <= 0)
            return null;
        return `https://www.youtube.com/watch?v=${best.key}`;
    }
    catch (error) {
        console.error('Error fetching TMDB official trailer:', error);
        return null;
    }
};
const extractYouTubeVideoId = (value) => {
    if (!value)
        return null;
    const raw = String(value).trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(raw))
        return raw;
    try {
        const url = new URL(raw);
        if (url.hostname.includes('youtu.be')) {
            const id = url.pathname.split('/').filter(Boolean)[0] || '';
            return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
        }
        if (url.hostname.includes('youtube.com')) {
            const fromV = url.searchParams.get('v') || '';
            if (/^[a-zA-Z0-9_-]{11}$/.test(fromV))
                return fromV;
            const parts = url.pathname.split('/').filter(Boolean);
            const idx = parts.findIndex((p) => p === 'embed' || p === 'shorts');
            if (idx >= 0 && parts[idx + 1] && /^[a-zA-Z0-9_-]{11}$/.test(parts[idx + 1])) {
                return parts[idx + 1];
            }
        }
    }
    catch {
        // ignore parse errors
    }
    const fallback = raw.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/i);
    return fallback ? fallback[1] : null;
};
const getYouTubeWatchUrl = (value) => {
    const id = extractYouTubeVideoId(value);
    return id ? `https://www.youtube.com/watch?v=${id}` : null;
};
const hasForbiddenTrailerText = (value) => {
    const text = String(value || '').toLowerCase();
    if (!text)
        return false;
    return (text.includes('teaser') ||
        text.includes('clip') ||
        text.includes('behind the scenes') ||
        text.includes('featurette') ||
        text.includes('tv spot') ||
        text.includes('promo') ||
        text.includes('interview') ||
        text.includes('short'));
};
const chooseOfficialTrailerFromExisting = async (payload) => {
    const candidates = [];
    const pushCandidate = (rawUrl, name, type, official) => {
        const url = getYouTubeWatchUrl(String(rawUrl || ''));
        if (!url)
            return;
        const lowerName = String(name || '').toLowerCase();
        const lowerType = String(type || '').toLowerCase();
        let score = 0;
        if (lowerType === 'trailer')
            score += 120;
        if (lowerName.includes('official trailer'))
            score += 100;
        else if (lowerName.includes('trailer'))
            score += 60;
        if (official === true || lowerName.includes('official'))
            score += 25;
        if (hasForbiddenTrailerText(lowerName) || hasForbiddenTrailerText(lowerType)) {
            score -= 250;
        }
        if (url.includes('/shorts/'))
            score -= 400;
        candidates.push({ url, score });
    };
    if (typeof payload === 'string') {
        pushCandidate(payload);
    }
    else if (Array.isArray(payload)) {
        for (const row of payload.slice(0, 12)) {
            if (typeof row === 'string')
                pushCandidate(row);
            else if (row && typeof row === 'object')
                pushCandidate(row.url || row.link || row.id || row.key, row.name || row.title, row.type, row.official);
        }
    }
    else if (payload && typeof payload === 'object') {
        pushCandidate(payload.url || payload.link || payload.id || payload.key, payload.name || payload.title, payload.type, payload.official);
    }
    const ranked = candidates.sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best || best.score < 0)
        return null;
    return best.url;
};
const attachBestTrailer = async (info, id, type) => {
    if (!info || typeof info !== 'object')
        return;
    if (!shouldLookupTrailers)
        return;
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
const fetchYouTubeTrailer = async (title, year) => {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey)
        return null;
    try {
        const youtube = googleapis_1.google.youtube({
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
            if (!candidates.length)
                return null;
            const videoDetails = await youtube.videos.list({
                part: ['contentDetails'],
                id: candidates.map((candidate) => candidate.id),
            });
            const durationById = new Map();
            for (const detail of videoDetails.data.items || []) {
                const detailId = detail.id || '';
                const duration = parseIso8601DurationToSeconds(detail.contentDetails?.duration || '');
                if (detailId)
                    durationById.set(detailId, duration);
            }
            const ranked = candidates
                .map((candidate) => {
                const id = candidate.id;
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
    }
    catch (error) {
        console.error('Error fetching YouTube trailer:', error);
    }
    return null;
};
// Map of anime providers that have direct routes in this API
const ANIME_PROVIDER_ROUTES = {
    satoru: '/anime/satoru',
    justanime: '/anime/justanime',
    animesalt: '/anime/animesalt',
    animekai: '/anime/animekai',
};
const resolveMovieProvider = (provider) => {
    if (!provider)
        return undefined;
    switch (provider.toLowerCase()) {
        case 'flixhq':
            return (0, provider_1.configureProvider)(new extensions_2.MOVIES.FlixHQ());
        default:
            return undefined;
    }
};
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const MOVIE_WATCH_ATTEMPT_TIMEOUT_MS = Number(process.env.MOVIE_WATCH_ATTEMPT_TIMEOUT_MS || (IS_PRODUCTION ? 7000 : 5000));
const parseLocsFromXml = (xml) => {
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1].trim());
};
const parseEpisodeNumber = (value) => {
    const match = value.match(/episode-(\d+)/i) || value.match(/episode\s*(\d+)/i);
    if (!match)
        return undefined;
    const num = Number(match[1]);
    return Number.isFinite(num) ? num : undefined;
};
const extractSlug = (value) => {
    const clean = value.split('?')[0].replace(/\/$/, '');
    const last = clean.split('/').pop() || clean;
    return last.replace(/\.html$/i, '');
};
const toAbsoluteUrl = (base, maybeUrl) => {
    if (/^https?:\/\//i.test(maybeUrl))
        return maybeUrl;
    return `${base.replace(/\/$/, '')}/${String(maybeUrl || '').replace(/^\//, '')}`;
};
const normalizeText = (value) => String(value || '')
    .replace(/&#8217;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
const safeJsonParse = (value) => {
    try {
        return JSON.parse(value || '{}');
    }
    catch {
        return {};
    }
};
const toGenreNames = (genres) => {
    if (!Array.isArray(genres))
        return [];
    return genres
        .map((genre) => {
        if (typeof genre === 'string')
            return genre;
        if (genre && typeof genre.name === 'string')
            return genre.name;
        return '';
    })
        .filter(Boolean)
        .map((genre) => normalizeText(genre));
};
const getTitleCandidatesFromMedia = (media) => {
    return [media?.title, media?.name, media?.originalTitle, media?.originalName]
        .filter((v, i, arr) => typeof v === 'string' && v.trim() && arr.indexOf(v) === i)
        .map((v) => String(v).trim());
};
const titleMatchScore = (candidateTitle, queries) => {
    const candidate = normalizeText(candidateTitle);
    if (!candidate)
        return -1;
    let score = 0;
    for (const query of queries) {
        const normQuery = normalizeText(query);
        if (!normQuery)
            continue;
        if (candidate === normQuery)
            score = Math.max(score, 1000);
        else if (candidate.includes(normQuery) || normQuery.includes(candidate))
            score = Math.max(score, 700);
    }
    return score;
};
const normalizeVegamoviesSourceId = (value) => {
    const raw = String(value || '').trim();
    if (!raw)
        return '';
    const withoutQuery = raw.split('?')[0].replace(/\.html$/i, '');
    return (withoutQuery.split('/').filter(Boolean).pop() || withoutQuery).trim();
};
const resolveVegamoviesSlugFromTmdb = async (id, type) => {
    const sourceId = normalizeVegamoviesSourceId(id);
    if (!sourceId)
        return '';
    if (/^tt\d+$/i.test(sourceId) || !/^\d+$/.test(sourceId)) {
        return sourceId;
    }
    const candidateTitles = [];
    try {
        if (main_1.tmdbApi) {
            const mediaTypes = Array.from(new Set([
                type === 'tv' ? 'tv' : 'movie',
                type === 'tv' ? 'movie' : 'tv',
            ]));
            for (const mediaType of mediaTypes) {
                try {
                    const response = await axios_1.default.get(`https://api.themoviedb.org/3/${mediaType}/${id}?api_key=${main_1.tmdbApi}&language=en-US`);
                    const data = response?.data;
                    if (data) {
                        candidateTitles.push(...getTitleCandidatesFromMedia(data));
                        if (candidateTitles.length)
                            break;
                    }
                }
                catch {
                    // Try the next TMDB media type.
                }
            }
        }
    }
    catch {
        // Fall through to secondary TMDB fetch below.
    }
    if (!candidateTitles.length) {
        try {
            const tmdbClient = new extensions_1.META.TMDB(main_1.tmdbApi, (0, provider_1.configureProvider)(new extensions_2.MOVIES.FlixHQ()));
            const mediaInfo = await tmdbClient.fetchMediaInfo(id, type || 'movie');
            candidateTitles.push(...getTitleCandidatesFromMedia(mediaInfo));
        }
        catch {
            // Ignore and return empty below.
        }
    }
    const normalizedTitles = Array.from(new Set(candidateTitles.map((title) => String(title || '').trim()).filter(Boolean)));
    if (!normalizedTitles.length)
        return '';
    let bestSlug = '';
    let bestScore = -1;
    for (const query of normalizedTitles.slice(0, 3)) {
        try {
            const searchRes = await vegamoviesProvider_1.VegamoviesProvider.search(query, 1);
            const results = Array.isArray(searchRes?.results) ? searchRes.results : [];
            for (const result of results.slice(0, 10)) {
                const resultTitle = String(result?.title || '').trim();
                const score = titleMatchScore(resultTitle, normalizedTitles);
                if (score > bestScore && result?.id) {
                    bestScore = score;
                    bestSlug = String(result.id).trim();
                }
            }
            if (bestScore >= 700)
                break;
        }
        catch {
            // Try the next title candidate.
        }
    }
    return bestSlug;
};
const resolveTmdbExternalImdbId = async (id, type) => {
    const sourceId = normalizeVegamoviesSourceId(id);
    if (!sourceId)
        return '';
    if (/^tt\d+$/i.test(sourceId))
        return sourceId;
    if (!/^\d+$/.test(sourceId) || !main_1.tmdbApi)
        return '';
    const mediaTypes = Array.from(new Set([
        type === 'tv' ? 'tv' : 'movie',
        type === 'tv' ? 'movie' : 'tv',
    ]));
    for (const mediaType of mediaTypes) {
        try {
            const response = await axios_1.default.get(`https://api.themoviedb.org/3/${mediaType}/${sourceId}/external_ids?api_key=${main_1.tmdbApi}`);
            const imdbId = String(response?.data?.imdb_id || '').trim();
            if (/^tt\d+$/i.test(imdbId))
                return imdbId;
        }
        catch {
            // Try the next TMDB media type.
        }
    }
    return '';
};
const resolveVegamoviesInfo = async (id, type) => {
    const sourceId = await resolveVegamoviesSlugFromTmdb(id, type);
    const lookupId = sourceId || normalizeVegamoviesSourceId(id);
    if (!lookupId)
        throw new Error('Unable to resolve Vegamovies title');
    return vegamoviesProvider_1.VegamoviesProvider.getInfo(lookupId);
};
const resolveVegamoviesWatch = async (id, type, season, episode) => {
    console.log(`[Vegamovies] Resolving watch for id=${id}, type=${type}, s=${season}, e=${episode}`);
    let title = '';
    let tmdbId = '';
    // Try to get TMDB info to get a clean title for searching
    try {
        if (main_1.tmdbApi) {
            let data = null;
            if (/^tt\d+$/i.test(id)) {
                // Search by IMDB ID
                const findRes = await axios_1.default.get(`https://api.themoviedb.org/3/find/${id}?api_key=${main_1.tmdbApi}&external_source=imdb_id`);
                const results = findRes.data.movie_results.concat(findRes.data.tv_results);
                if (results.length) {
                    data = results[0];
                    tmdbId = data.id.toString();
                }
            }
            else if (/^\d+$/.test(id)) {
                // Search by TMDB ID
                const mediaType = type === 'tv' ? 'tv' : 'movie';
                const res = await axios_1.default.get(`https://api.themoviedb.org/3/${mediaType}/${id}?api_key=${main_1.tmdbApi}`);
                data = res.data;
                tmdbId = id;
            }
            if (data) {
                title = data.title || data.name || '';
            }
        }
    }
    catch (err) {
        console.warn(`[Vegamovies] Failed to fetch TMDB info for ${id}:`, err.message);
    }
    // If we have a title, search Vegamovies for it
    if (title) {
        console.log(`[Vegamovies] Searching for title: ${title}`);
        const searchResults = await vegamoviesProvider_1.VegamoviesProvider.search(title);
        const movie = searchResults?.results?.find((r) => r.title.toLowerCase().includes(title.toLowerCase()) ||
            title.toLowerCase().includes(r.title.toLowerCase()));
        if (movie) {
            console.log(`[Vegamovies] Found slug via title search: ${movie.id}`);
            return await vegamoviesProvider_1.VegamoviesProvider.getSources(movie.id, season, episode);
        }
    }
    // Fallback to IMDB ID resolution if title search failed or no title found
    const externalImdbId = await resolveTmdbExternalImdbId(id, type);
    if (externalImdbId) {
        console.log(`[Vegamovies] Attempting resolution via IMDB ID: ${externalImdbId}`);
        try {
            const sources = await vegamoviesProvider_1.VegamoviesProvider.getSources(externalImdbId, season, episode);
            if (sources?.sources?.length)
                return sources;
        }
        catch (err) {
            console.warn(`[Vegamovies] Resolution via IMDB ID failed:`, err.message);
        }
    }
    // Final fallback: use the provided ID directly
    const lookupId = normalizeVegamoviesSourceId(id);
    console.log(`[Vegamovies] Final fallback lookup ID: ${lookupId}`);
    return await vegamoviesProvider_1.VegamoviesProvider.getSources(lookupId, season, episode);
};
const isAnimeLikeMovie = (media) => {
    const genreNames = toGenreNames(media?.genres);
    const hasAnimationGenre = genreNames.some((genre) => genre.includes('animation'));
    const hasAnimeGenre = genreNames.some((genre) => genre.includes('anime'));
    const lang = normalizeText(String(media?.originalLanguage || media?.original_language || ''));
    const isJapanese = lang === 'ja';
    return hasAnimeGenre || (hasAnimationGenre && isJapanese);
};
const normalizeSlug = (value) => String(value || '')
    .toLowerCase()
    .replace(/\.html$/i, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
const stripTrailingYear = (value) => value.replace(/-(19|20)\d{2}$/i, '');
const buildDramaSlugVariants = (dramaSlug) => {
    const base = normalizeSlug(dramaSlug);
    const set = new Set();
    const push = (v) => {
        const clean = v ? normalizeSlug(v) : '';
        if (clean)
            set.add(clean);
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
    if (tokens.length >= 2)
        push(tokens.slice(0, 2).join('-'));
    if (tokens.length >= 1)
        push(tokens[0]);
    return [...set];
};
const convertTmdbImagesToUrls = (data) => {
    if (!data || typeof data !== 'object')
        return data;
    const convertPath = (path) => {
        if (!path || typeof path !== 'string')
            return null;
        if (path.startsWith('http'))
            return path;
        return `https://image.tmdb.org/t/p/w500${path}`;
    };
    if (data.poster_path)
        data.image = convertPath(data.poster_path);
    if (data.backdrop_path)
        data.cover = convertPath(data.backdrop_path);
    if (data.profile_path)
        data.image = convertPath(data.profile_path);
    if (Array.isArray(data.seasons)) {
        data.seasons = data.seasons.map((season) => {
            if (season.poster_path)
                season.image = convertPath(season.poster_path);
            return season;
        });
    }
    if (Array.isArray(data.episodes)) {
        data.episodes = data.episodes.map((episode) => {
            if (episode.still_path)
                episode.image = convertPath(episode.still_path);
            return episode;
        });
    }
    return data;
};
const tryAnimeProvidersForMovie = async (request, options) => {
    const { titleCandidates, server } = options;
    if (!titleCandidates.length)
        return null;
    const providersInOrder = [
        'satoru',
    ];
    for (const providerKey of providersInOrder) {
        const baseRoute = ANIME_PROVIDER_ROUTES[providerKey];
        if (!baseRoute)
            continue;
        // Limit to top 2 titles for speed
        const queries = titleCandidates.slice(0, 2);
        // Parallelize title searches
        const searchPromises = queries.map(async (query) => {
            try {
                const searchRes = await request.server.inject({
                    method: 'GET',
                    url: `${baseRoute}/${encodeURIComponent(query)}`,
                });
                if (searchRes.statusCode >= 400)
                    return null;
                const searchPayload = safeJsonParse(searchRes.body);
                const searchRows = Array.isArray(searchPayload?.results) ? searchPayload.results : [];
                if (!searchRows.length)
                    return null;
                return searchRows
                    .map((item) => ({
                    item,
                    score: titleMatchScore(String(item?.title || item?.name || ''), titleCandidates),
                }))
                    .sort((a, b) => b.score - a.score)[0]?.item || null;
            }
            catch {
                return null;
            }
        });
        const searchResults = await Promise.all(searchPromises);
        // Try to process each found item in parallel
        const pickPromises = searchResults
            .filter((picked) => picked?.id)
            .map(async (picked) => {
            try {
                const infoRes = await request.server.inject({
                    method: 'GET',
                    url: `${baseRoute}/info/${encodeURIComponent(String(picked.id))}`,
                });
                if (infoRes.statusCode >= 400)
                    return null;
                const infoPayload = safeJsonParse(infoRes.body);
                const episodes = Array.isArray(infoPayload?.episodes) ? infoPayload.episodes : [];
                if (!episodes.length)
                    return null;
                const episodeIds = Array.from(new Set([
                    episodes[0]?.id,
                    episodes[episodes.length - 1]?.id,
                    episodes.find((ep) => Number(ep?.number || 0) === 1)?.id,
                ]
                    .filter((value) => typeof value === 'string' && value.trim())
                    .map((value) => String(value).trim())));
                if (!episodeIds.length)
                    return null;
                // Try first episode only for speed
                for (const candidateEpisodeId of episodeIds.slice(0, 1)) {
                    const queryParts = [];
                    if (server)
                        queryParts.push(`server=${encodeURIComponent(server)}`);
                    const qs = queryParts.length ? `?${queryParts.join('&')}` : '';
                    const watchRes = await request.server.inject({
                        method: 'GET',
                        url: `${baseRoute}/watch/${encodeURIComponent(candidateEpisodeId)}${qs}`,
                    });
                    if (watchRes.statusCode >= 400)
                        continue;
                    const watchPayload = safeJsonParse(watchRes.body);
                    if (Array.isArray(watchPayload?.sources) && watchPayload.sources.length) {
                        return watchPayload;
                    }
                }
                return null;
            }
            catch {
                return null;
            }
        });
        const results = await Promise.all(pickPromises);
        const firstValid = results.find((r) => r);
        if (firstValid)
            return firstValid;
    }
    return null;
};
const buildJustanimeTmdbInfo = async (request, id, type) => {
    const baseTmdb = new extensions_1.META.TMDB(main_1.tmdbApi, (0, provider_1.configureProvider)(new extensions_2.MOVIES.FlixHQ()));
    const fetchBase = async () => {
        const res = await baseTmdb.fetchMediaInfo(id, type);
        if (res && typeof res === 'object') {
            delete res.cast;
            delete res.characters;
            delete res.recommendations;
            delete res.similar;
        }
        return res;
    };
    const baseInfo = main_1.redis
        ? await cache_1.default.fetch(main_1.redis, `tmdb:info:${type}:${id}`, fetchBase, main_1.REDIS_TTL)
        : await fetchBase();
    await attachBestTrailer(baseInfo, id, type);
    const titleCandidates = getTitleCandidatesFromMedia(baseInfo);
    if (!titleCandidates.length)
        return baseInfo;
    const yearGuess = Number(String(baseInfo?.releaseDate || baseInfo?.firstAirDate || '').slice(0, 4));
    // Search JustAnime with multiple title candidates and year variants
    let pick = null;
    const searchTerms = [];
    // Add title candidates
    searchTerms.push(...titleCandidates.slice(0, 2));
    // Add simplified versions (remove special characters, colons, etc.)
    titleCandidates.slice(0, 2).forEach(title => {
        const simplified = title.replace(/[^\w\s]/g, '').trim();
        if (simplified !== title)
            searchTerms.push(simplified);
    });
    // Add year variants for better matching
    if (Number.isFinite(yearGuess) && yearGuess > 1900) {
        searchTerms.push(...titleCandidates.slice(0, 2).map(title => `${title} ${yearGuess}`));
    }
    for (const term of searchTerms.slice(0, 6)) { // Try up to 6 search terms
        try {
            const searchRes = await request.server.inject({
                method: 'GET',
                url: `/anime/justanime/${encodeURIComponent(term)}`,
            });
            if (searchRes.statusCode < 400) {
                const payload = safeJsonParse(searchRes.body || '{}');
                const results = Array.isArray(payload?.results)
                    ? payload.results
                    : Array.isArray(payload?.data)
                        ? payload.data
                        : [];
                const scored = results.map((item) => {
                    // JustAnime title is a nested object: {english, romaji}
                    const titleObj = item?.title;
                    const itemTitle = typeof titleObj === 'string'
                        ? titleObj
                        : String(titleObj?.english || titleObj?.romaji || titleObj?.native || item?.name || '');
                    let score = titleMatchScore(itemTitle, titleCandidates);
                    if (Number.isFinite(yearGuess) && yearGuess > 1900) {
                        const itemYear = Number(String(item?.year || item?.released || '').slice(0, 4));
                        if (itemYear === yearGuess)
                            score += 50;
                        else if (Math.abs(itemYear - yearGuess) <= 1)
                            score += 20;
                    }
                    return { item, score };
                }).sort((a, b) => b.score - a.score);
                const candidate = scored[0]?.item;
                if (candidate && (!pick || (scored[0]?.score || 0) > (pick.score || 0))) {
                    pick = { ...candidate, score: scored[0]?.score || 0 };
                }
            }
        }
        catch {
            continue; // Try next term
        }
    }
    if (pick) {
        const providerId = String(pick.id || pick.anilistId || '');
        const anilistId = pick.anilistId ? String(pick.anilistId) : null;
        if (providerId) {
            // Map episodes to JustAnime format: providerId$episode$number
            if (Array.isArray(baseInfo.seasons)) {
                baseInfo.seasons = baseInfo.seasons.map((season, seasonIdx) => {
                    if (!Array.isArray(season.episodes))
                        return season;
                    return {
                        ...season,
                        episodes: season.episodes.map((ep) => ({
                            ...ep,
                            id: `${providerId}$episode$${ep.episode || ep.number}`,
                        })),
                    };
                });
            }
            else if (Array.isArray(baseInfo.episodes)) {
                baseInfo.episodes = baseInfo.episodes.map((ep) => ({
                    ...ep,
                    id: `${providerId}$episode$${ep.episode || ep.number}`,
                }));
            }
            if (anilistId)
                baseInfo.anilistId = anilistId;
            baseInfo.id = providerId;
        }
    }
    convertTmdbImagesToUrls(baseInfo);
    return baseInfo;
};
const buildAnimesaltTmdbInfo = async (request, id, type) => {
    const baseTmdb = new extensions_1.META.TMDB(main_1.tmdbApi, (0, provider_1.configureProvider)(new extensions_2.MOVIES.FlixHQ()));
    const fetchBase = async () => {
        const res = await baseTmdb.fetchMediaInfo(id, type);
        if (res && typeof res === 'object') {
            delete res.cast;
            delete res.characters;
            delete res.recommendations;
            delete res.similar;
        }
        return res;
    };
    const baseInfo = main_1.redis
        ? await cache_1.default.fetch(main_1.redis, `tmdb:info:${type}:${id}`, fetchBase, main_1.REDIS_TTL)
        : await fetchBase();
    await attachBestTrailer(baseInfo, id, type);
    const titleCandidates = getTitleCandidatesFromMedia(baseInfo);
    if (!titleCandidates.length)
        return baseInfo;
    const yearGuess = Number(String(baseInfo?.releaseDate || baseInfo?.firstAirDate || '').slice(0, 4));
    // Search AnimeSalt with primary titles
    const term = titleCandidates[0];
    try {
        const searchRes = await request.server.inject({
            method: 'GET',
            url: `/anime/animesalt/${encodeURIComponent(term)}`,
        });
        if (searchRes.statusCode < 400) {
            const payload = safeJsonParse(searchRes.body || '{}');
            const results = Array.isArray(payload?.results) ? payload.results : [];
            const scored = results.map((item) => {
                const itemTitle = String(item?.title || '');
                let score = titleMatchScore(itemTitle, titleCandidates);
                if (Number.isFinite(yearGuess) && yearGuess > 1900) {
                    const itemYear = Number(String(item?.releaseDate || '').slice(0, 4));
                    if (itemYear === yearGuess)
                        score += 50;
                }
                return { item, score };
            }).sort((a, b) => b.score - a.score);
            const pick = scored[0]?.item;
            if (pick && pick.anilistId) {
                const anilistId = String(pick.anilistId);
                if (Array.isArray(baseInfo.seasons)) {
                    baseInfo.seasons = baseInfo.seasons.map((season) => {
                        if (!Array.isArray(season.episodes))
                            return season;
                        return {
                            ...season,
                            episodes: season.episodes.map((ep) => ({
                                ...ep,
                                id: `${anilistId}$episode$${ep.episode || ep.number}`,
                            })),
                        };
                    });
                }
                else if (Array.isArray(baseInfo.episodes)) {
                    baseInfo.episodes = baseInfo.episodes.map((ep) => ({
                        ...ep,
                        id: `${anilistId}$episode$${ep.episode || ep.number}`,
                    }));
                }
                baseInfo.anilistId = anilistId;
                baseInfo.id = anilistId;
            }
        }
    }
    catch {
        // ignore mapping errors
    }
    convertTmdbImagesToUrls(baseInfo);
    return baseInfo;
};
const inferAnimekaiSeasonNumber = (value) => {
    const raw = String(value || '').toLowerCase();
    if (!raw)
        return 1;
    const seasonMatch = raw.match(/season\s*(\d+)/i);
    if (seasonMatch?.[1]) {
        const n = Number(seasonMatch[1]);
        if (Number.isFinite(n) && n > 0)
            return n;
    }
    const ordinalMatch = raw.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i);
    if (ordinalMatch?.[1]) {
        const n = Number(ordinalMatch[1]);
        if (Number.isFinite(n) && n > 0)
            return n;
    }
    const partMatch = raw.match(/\bpart\s*(\d+)\b/i);
    if (partMatch?.[1]) {
        const n = Number(partMatch[1]);
        if (Number.isFinite(n) && n > 0)
            return n;
    }
    return 1;
};
const buildAnimekaiTmdbInfo = async (request, id, type) => {
    const baseTmdb = new extensions_1.META.TMDB(main_1.tmdbApi, (0, provider_1.configureProvider)(new extensions_2.MOVIES.FlixHQ()));
    const fetchBase = async () => {
        try {
            const res = await baseTmdb.fetchMediaInfo(id, type);
            if (res && typeof res === 'object') {
                delete res.cast;
                delete res.characters;
                delete res.recommendations;
                delete res.similar;
            }
            return res;
        }
        catch {
            if (!main_1.tmdbApi) {
                throw new Error('Failed to fetch TMDB base info for AnimeKai mapping');
            }
            const tmdbType = String(type || '').toLowerCase() === 'tv' ? 'tv' : 'movie';
            const baseUrl = `https://api.themoviedb.org/3/${tmdbType}/${id}?api_key=${main_1.tmdbApi}&language=en-US`;
            const direct = await axios_1.default.get(baseUrl);
            const raw = direct?.data || {};
            const rescued = {
                id: raw.id,
                title: raw.title || raw.name || 'Unknown',
                name: raw.name || raw.title || 'Unknown',
                releaseDate: raw.release_date || raw.first_air_date || null,
                firstAirDate: raw.first_air_date || null,
                image: raw.poster_path || null,
                cover: raw.backdrop_path || null,
                description: raw.overview || '',
                genres: Array.isArray(raw.genres) ? raw.genres : [],
                seasons: [],
                episodes: [],
            };
            if (tmdbType === 'tv' && Array.isArray(raw.seasons)) {
                const seasonRows = raw.seasons
                    .filter((season) => Number(season?.season_number || 0) > 0)
                    .sort((a, b) => Number(a?.season_number || 0) - Number(b?.season_number || 0));
                const seasonDetails = await Promise.all(seasonRows.map(async (season) => {
                    const seasonNo = Number(season?.season_number || 0);
                    try {
                        const seasonUrl = `https://api.themoviedb.org/3/tv/${id}/season/${seasonNo}?api_key=${main_1.tmdbApi}&language=en-US`;
                        const seasonRes = await axios_1.default.get(seasonUrl);
                        const eps = Array.isArray(seasonRes?.data?.episodes)
                            ? seasonRes.data.episodes.map((ep) => ({
                                id: '',
                                episode: Number(ep?.episode_number || 0),
                                number: Number(ep?.episode_number || 0),
                                title: ep?.name || `Episode ${ep?.episode_number || 0}`,
                            }))
                            : [];
                        return {
                            season: seasonNo,
                            number: seasonNo,
                            name: season?.name || `Season ${seasonNo}`,
                            episodes: eps,
                        };
                    }
                    catch {
                        return {
                            season: seasonNo,
                            number: seasonNo,
                            name: season?.name || `Season ${seasonNo}`,
                            episodes: [],
                        };
                    }
                }));
                rescued.seasons = seasonDetails;
            }
            return rescued;
        }
    };
    const baseInfo = main_1.redis
        ? await cache_1.default.fetch(main_1.redis, `tmdb:info:${type}:${id}:animekai-mapped:v2`, fetchBase, main_1.REDIS_TTL)
        : await fetchBase();
    await attachBestTrailer(baseInfo, id, type);
    if (String(type || '').toLowerCase() === 'tv' && main_1.tmdbApi) {
        const currentSeasons = Array.isArray(baseInfo?.seasons) ? baseInfo.seasons : [];
        const nonSpecialCount = currentSeasons.filter((season) => Number(season?.season || season?.number || 0) > 0).length;
        const looksCollapsed = nonSpecialCount <= 1;
        if (looksCollapsed) {
            try {
                const tmdbSeriesUrl = `https://api.themoviedb.org/3/tv/${id}?api_key=${main_1.tmdbApi}&language=en-US`;
                const seriesRes = await axios_1.default.get(tmdbSeriesUrl);
                const rawSeasons = Array.isArray(seriesRes?.data?.seasons) ? seriesRes.data.seasons : [];
                const seasonRows = rawSeasons
                    .filter((season) => Number(season?.season_number || 0) > 0)
                    .sort((a, b) => Number(a?.season_number || 0) - Number(b?.season_number || 0));
                if (seasonRows.length > 1) {
                    const rebuilt = await Promise.all(seasonRows.map(async (season) => {
                        const seasonNo = Number(season?.season_number || 0);
                        try {
                            const seasonUrl = `https://api.themoviedb.org/3/tv/${id}/season/${seasonNo}?api_key=${main_1.tmdbApi}&language=en-US`;
                            const seasonRes = await axios_1.default.get(seasonUrl);
                            const eps = Array.isArray(seasonRes?.data?.episodes)
                                ? seasonRes.data.episodes.map((ep) => ({
                                    id: '',
                                    episode: Number(ep?.episode_number || 0),
                                    number: Number(ep?.episode_number || 0),
                                    title: ep?.name || `Episode ${ep?.episode_number || 0}`,
                                }))
                                : [];
                            return {
                                season: seasonNo,
                                number: seasonNo,
                                name: season?.name || `Season ${seasonNo}`,
                                episodes: eps,
                            };
                        }
                        catch {
                            return {
                                season: seasonNo,
                                number: seasonNo,
                                name: season?.name || `Season ${seasonNo}`,
                                episodes: [],
                            };
                        }
                    }));
                    baseInfo.seasons = rebuilt;
                }
            }
            catch {
                // Keep existing base seasons when direct TMDB season rebuild fails.
            }
        }
    }
    const titleCandidates = getTitleCandidatesFromMedia(baseInfo);
    if (!titleCandidates.length)
        return baseInfo;
    const yearGuess = Number(String(baseInfo?.releaseDate || baseInfo?.firstAirDate || '').slice(0, 4));
    const sequelTerms = titleCandidates.slice(0, 2).flatMap((title) => {
        const clean = String(title || '').trim();
        if (!clean)
            return [];
        const baseParts = [
            // Standard season patterns
            `${clean} season 2`,
            `${clean} 2nd season`,
            `${clean} season 3`,
            `${clean} season 4`,
            `${clean} season 5`,
            `${clean} season 6`,
            // Arc-based patterns (common for anime)
            `${clean} part 1`,
            `${clean} part 2`,
            `${clean} part 3`,
            // Alternate numbering
            `${clean} 2`,
            `${clean} 3`,
            `${clean} 4`,
        ];
        // Add numeric year variants for modern animes
        return baseParts;
    });
    const searchTerms = Array.from(new Set([
        ...titleCandidates.slice(0, 2),
        ...titleCandidates.slice(0, 2).map((title) => String(title || '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()),
        ...sequelTerms,
        ...(Number.isFinite(yearGuess) && yearGuess > 1900
            ? titleCandidates.slice(0, 2).map((title) => `${title} ${yearGuess}`)
            : []),
    ].filter(Boolean))).slice(0, 24); // Increased to 24 to cover expanded sequel terms
    const candidateMap = new Map();
    for (const term of searchTerms) {
        try {
            const searchRes = await request.server.inject({
                method: 'GET',
                url: `/anime/animekai/search/${encodeURIComponent(term)}?page=1`,
            });
            if (searchRes.statusCode >= 400)
                continue;
            const payload = safeJsonParse(searchRes.body || '{}');
            const rows = Array.isArray(payload?.results) ? payload.results : [];
            for (const row of rows.slice(0, 8)) {
                const rowId = String(row?.id || '').trim();
                if (!rowId || candidateMap.has(rowId))
                    continue;
                const rowTitle = String(row?.title || row?.name || '').trim();
                let score = titleMatchScore(rowTitle, titleCandidates);
                const seasonHint = inferAnimekaiSeasonNumber(rowTitle);
                if (seasonHint === 1)
                    score += 5;
                if (Number.isFinite(yearGuess) && yearGuess > 1900) {
                    const y = Number(String(row?.year || row?.releaseDate || '').slice(0, 4));
                    if (y === yearGuess)
                        score += 50;
                    else if (Number.isFinite(y) && Math.abs(y - yearGuess) <= 1)
                        score += 20;
                }
                candidateMap.set(rowId, {
                    ...row,
                    _score: score,
                    _seasonHint: seasonHint,
                });
            }
        }
        catch {
            continue;
        }
    }
    const candidates = Array.from(candidateMap.values())
        .sort((a, b) => Number(b?._score || 0) - Number(a?._score || 0))
        .slice(0, 20); // Increased from 10 to 20 to catch more season-specific entries
    if (!candidates.length) {
        convertTmdbImagesToUrls(baseInfo);
        return baseInfo;
    }
    const infos = [];
    const assignedSeasonHints = new Set();
    for (const candidate of candidates) {
        const candidateId = String(candidate?.id || '').trim();
        if (!candidateId)
            continue;
        try {
            const infoRes = await request.server.inject({
                method: 'GET',
                url: `/anime/animekai/info?id=${encodeURIComponent(candidateId)}`,
            });
            if (infoRes.statusCode >= 400)
                continue;
            const infoPayload = safeJsonParse(infoRes.body || '{}');
            const episodes = Array.isArray(infoPayload?.episodes) ? infoPayload.episodes : [];
            const episodeCount = episodes.length;
            // Skip candidates with VERY few episodes (likely specials/shorts, not full seasons)
            // Accept 8+ episodes OR anything that looks like 10+ continuous episodes
            if (!episodeCount)
                continue;
            if (episodeCount < 8) {
                // Only skip if it's clearly too small (less than 50% of typical season average ~13 eps)
                const minAcceptable = Math.max(8, Math.floor((Number(baseInfo?.seasons?.at(0)?.episode_count || 13)) / 2));
                if (episodeCount < minAcceptable)
                    continue;
            }
            let seasonHint = Number(candidate?._seasonHint || inferAnimekaiSeasonNumber(infoPayload?.title || candidate?.title || '')) || 1;
            // IMPROVED: Match by episode count against TMDB seasons for anime-specific sequels
            // Many anime use arc names (Jujutsu Kaisen: Culling Game) instead of "Season 3"
            if (Array.isArray(baseInfo?.seasons) && baseInfo.seasons.length > 1) {
                const tmdbSeasons = baseInfo.seasons
                    .filter((s) => Number(s?.season || s?.number || 0) > 0)
                    .map((s) => {
                    const seasonNo = Number(s?.season || s?.number || 0);
                    // Try episodes array first, fallback to episode_count field
                    const epCount = Array.isArray(s?.episodes)
                        ? s.episodes.length
                        : (Number(s?.episode_count || 0) || 0);
                    return { seasonNo, epCount };
                })
                    .sort((a, b) => a.seasonNo - b.seasonNo);
                // Try to match by episode count first (most reliable for arc-named seasons)
                const matchedBySeason = tmdbSeasons.find((s) => s.epCount === episodeCount);
                if (matchedBySeason && !assignedSeasonHints.has(matchedBySeason.seasonNo)) {
                    seasonHint = matchedBySeason.seasonNo;
                }
                else if (Math.abs(seasonHint - 1) < tmdbSeasons.length && !assignedSeasonHints.has(seasonHint)) {
                    // Use inferred hint if it's within valid season range and not yet assigned
                }
                else {
                    // Last resort: find first unassigned season number
                    const unassignedSeason = tmdbSeasons.find((s) => !assignedSeasonHints.has(s.seasonNo));
                    if (unassignedSeason) {
                        seasonHint = unassignedSeason.seasonNo;
                    }
                }
            }
            // Avoid duplicate season hints (prefer first/highest-episode candidate for each season)
            if (assignedSeasonHints.has(seasonHint))
                continue;
            assignedSeasonHints.add(seasonHint);
            infos.push({
                id: candidateId,
                title: String(infoPayload?.title || candidate?.title || '').trim(),
                seasonHint,
                episodes,
                anilistId: String(candidate?.anilistId || '').trim() || undefined,
            });
        }
        catch {
            continue;
        }
    }
    if (!infos.length) {
        try {
            const anilistRes = await request.server.inject({
                method: 'GET',
                url: `/meta/anilist/${encodeURIComponent(titleCandidates[0] || '')}`,
            });
            if (anilistRes.statusCode < 400) {
                const anilistPayload = safeJsonParse(anilistRes.body || '{}');
                const anilistRows = Array.isArray(anilistPayload?.results) ? anilistPayload.results : [];
                const picked = anilistRows
                    .map((item) => ({ item, score: titleMatchScore(String(item?.title || item?.name || ''), titleCandidates) }))
                    .sort((a, b) => b.score - a.score)[0]?.item;
                const pickedId = String(picked?.id || '').trim();
                if (pickedId)
                    baseInfo.anilistId = pickedId;
            }
        }
        catch {
            // Ignore AniList fallback errors
        }
        convertTmdbImagesToUrls(baseInfo);
        return baseInfo;
    }
    const best = infos[0];
    baseInfo.id = best.id;
    if (best.anilistId) {
        baseInfo.anilistId = best.anilistId;
    }
    else {
        try {
            const anilistRes = await request.server.inject({
                method: 'GET',
                url: `/meta/anilist/${encodeURIComponent(titleCandidates[0] || best.title || '')}`,
            });
            if (anilistRes.statusCode < 400) {
                const anilistPayload = safeJsonParse(anilistRes.body || '{}');
                const anilistRows = Array.isArray(anilistPayload?.results) ? anilistPayload.results : [];
                const picked = anilistRows
                    .map((item) => ({ item, score: titleMatchScore(String(item?.title || item?.name || ''), titleCandidates) }))
                    .sort((a, b) => b.score - a.score)[0]?.item;
                const pickedId = String(picked?.id || '').trim();
                if (pickedId)
                    baseInfo.anilistId = pickedId;
            }
        }
        catch {
            // Ignore AniList enrichment errors
        }
    }
    if (String(type || '').toLowerCase() === 'tv' && Array.isArray(baseInfo?.seasons)) {
        const existingSeasons = baseInfo.seasons
            .filter((season) => Number(season?.season || season?.number || 0) > 0)
            .map((season) => Number(season?.season || season?.number || 0));
        const uniqueHints = Array.from(new Set(infos.map((info) => Number(info.seasonHint || 0)).filter((n) => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
        if (existingSeasons.length <= 1 && uniqueHints.length > 1) {
            baseInfo.seasons = uniqueHints.map((seasonNo) => {
                const seasonInfo = infos.find((info) => Number(info.seasonHint || 0) === seasonNo);
                const seasonEpisodes = Array.isArray(seasonInfo?.episodes) ? seasonInfo.episodes : [];
                return {
                    season: seasonNo,
                    number: seasonNo,
                    name: `Season ${seasonNo}`,
                    id: seasonInfo?.id,
                    providerAnimeId: seasonInfo?.id,
                    episodes: seasonEpisodes.map((ep, idx) => ({
                        id: String(ep?.id || ''),
                        episode: Number(ep?.number || ep?.episode || idx + 1),
                        number: Number(ep?.number || ep?.episode || idx + 1),
                        title: String(ep?.title || `Episode ${idx + 1}`),
                    })),
                };
            });
        }
        const nonSpecialSeasons = baseInfo.seasons
            .filter((season) => Number(season?.season || season?.number || 0) > 0)
            .sort((a, b) => Number(a?.season || a?.number || 0) - Number(b?.season || b?.number || 0));
        const assigned = new Map();
        const unassigned = [...infos];
        // 1) Assign direct season hints first.
        for (const info of infos) {
            const hint = Number(info.seasonHint || 0);
            if (!Number.isFinite(hint) || hint <= 0)
                continue;
            if (assigned.has(hint))
                continue;
            assigned.set(hint, info);
        }
        // 2) Assign remaining infos by season order.
        for (const season of nonSpecialSeasons) {
            const seasonNo = Number(season?.season || season?.number || 0);
            if (assigned.has(seasonNo))
                continue;
            const next = unassigned.find((item) => {
                return !Array.from(assigned.values()).includes(item);
            });
            if (!next)
                continue;
            assigned.set(seasonNo, next);
        }
        const singleInfoSequentialMode = infos.length === 1;
        let globalEpisodeOffset = 0;
        baseInfo.seasons = baseInfo.seasons.map((season) => {
            if (!Array.isArray(season?.episodes))
                return season;
            const seasonNo = Number(season?.season || season?.number || 0);
            const mappedInfo = assigned.get(seasonNo);
            if (!mappedInfo) {
                return season;
            }
            if (singleInfoSequentialMode) {
                // Some AnimeKai titles expose all seasons as one continuous episode list.
                // Distribute IDs by TMDB season episode counts to keep season watch mapping accurate.
                const mappedEpisodes = Array.isArray(mappedInfo.episodes) ? mappedInfo.episodes : [];
                const sortedMapped = [...mappedEpisodes].sort((a, b) => Number(a?.number || a?.episode || 0) - Number(b?.number || b?.episode || 0));
                // Get expected episode count from TMDB season - try episodes array first, then episode_count field
                const seasonEpisodeCount = Array.isArray(season?.episodes)
                    ? season.episodes.length
                    : (Number(season?.episode_count || 0) || sortedMapped.length);
                const seasonSlice = sortedMapped.slice(globalEpisodeOffset, globalEpisodeOffset + seasonEpisodeCount);
                globalEpisodeOffset += seasonEpisodeCount;
                const byIndex = new Map();
                for (let i = 0; i < seasonSlice.length; i++) {
                    byIndex.set(i + 1, seasonSlice[i]);
                }
                return {
                    ...season,
                    id: mappedInfo.id,
                    providerAnimeId: mappedInfo.id,
                    episodes: season.episodes.map((ep, idx) => {
                        const mapped = byIndex.get(idx + 1);
                        if (!mapped?.id)
                            return ep;
                        return {
                            ...ep,
                            id: String(mapped.id),
                        };
                    }),
                };
            }
            const byEpNumber = new Map();
            for (const ep of mappedInfo.episodes) {
                const n = Number(ep?.number || ep?.episode || 0);
                if (!Number.isFinite(n) || n <= 0)
                    continue;
                if (!byEpNumber.has(n))
                    byEpNumber.set(n, ep);
            }
            // If TMDB season has no episodes populated, use the AnimeKai episodes directly
            const seasonEpisodes = !Array.isArray(season?.episodes) || season.episodes.length === 0
                ? Array.isArray(mappedInfo.episodes)
                    ? mappedInfo.episodes.map((ep, idx) => ({
                        id: String(ep?.id || ''),
                        episode: Number(ep?.number || ep?.episode || idx + 1),
                        number: Number(ep?.number || ep?.episode || idx + 1),
                        title: String(ep?.title || `Episode ${idx + 1}`),
                    }))
                    : (season?.episodes || [])
                : season.episodes.map((ep, idx) => {
                    const epNo = Number(ep?.episode || ep?.number || idx + 1);
                    const mapped = byEpNumber.get(epNo);
                    if (!mapped?.id)
                        return ep;
                    return {
                        ...ep,
                        id: String(mapped.id),
                    };
                });
            return {
                ...season,
                id: mappedInfo.id,
                providerAnimeId: mappedInfo.id,
                episodes: seasonEpisodes,
            };
        });
    }
    else if (Array.isArray(baseInfo?.episodes)) {
        const byEpNumber = new Map();
        for (const ep of best.episodes) {
            const n = Number(ep?.number || ep?.episode || 0);
            if (!Number.isFinite(n) || n <= 0)
                continue;
            if (!byEpNumber.has(n))
                byEpNumber.set(n, ep);
        }
        baseInfo.episodes = baseInfo.episodes.map((ep, idx) => {
            const epNo = Number(ep?.episode || ep?.number || idx + 1);
            const mapped = byEpNumber.get(epNo);
            if (!mapped?.id)
                return ep;
            return {
                ...ep,
                id: String(mapped.id),
            };
        });
    }
    convertTmdbImagesToUrls(baseInfo);
    return baseInfo;
};
const buildFlixhqTmdbInfo = async (request, id, type) => {
    const baseTmdb = new extensions_1.META.TMDB(main_1.tmdbApi, (0, provider_1.configureProvider)(new extensions_2.MOVIES.FlixHQ()));
    const fetchBase = async () => {
        let res = null;
        try {
            res = await baseTmdb.fetchMediaInfo(id, type);
        }
        catch {
            if (main_1.tmdbApi) {
                const directUrl = `https://api.themoviedb.org/3/${type}/${id}?api_key=${main_1.tmdbApi}`;
                const directRes = await axios_1.default.get(directUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                if (directRes?.data) {
                    const direct = directRes.data;
                    const isTv = String(type || '').toLowerCase() === 'tv';
                    let seasons = Array.isArray(direct?.seasons)
                        ? direct.seasons.map((s) => ({
                            id: String(s?.id || ''),
                            name: s?.name,
                            season: s?.season_number,
                            image: s?.poster_path ? `https://image.tmdb.org/t/p/original${s.poster_path}` : null,
                            episodes: [],
                        }))
                        : [];
                    if (isTv && seasons.length) {
                        const seasonDetails = await Promise.all(seasons
                            .filter((s) => Number.isFinite(Number(s?.season)) && Number(s.season) >= 0)
                            .slice(0, 25)
                            .map(async (s) => {
                            try {
                                const seasonNo = Number(s.season);
                                const seasonUrl = `https://api.themoviedb.org/3/tv/${id}/season/${seasonNo}?api_key=${main_1.tmdbApi}&language=en-US`;
                                const seasonRes = await axios_1.default.get(seasonUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                                const episodes = Array.isArray(seasonRes?.data?.episodes)
                                    ? seasonRes.data.episodes.map((ep, idx) => {
                                        const epNo = Number(ep?.episode_number || ep?.number || idx + 1);
                                        return {
                                            id: `${id}-s${seasonNo}e${epNo}`,
                                            episode: epNo,
                                            number: epNo,
                                            title: ep?.name || `Episode ${epNo}`,
                                            season: seasonNo,
                                        };
                                    })
                                    : [];
                                return { seasonNo, episodes };
                            }
                            catch {
                                return null;
                            }
                        }));
                        const bySeasonNo = new Map();
                        seasonDetails.forEach((entry) => {
                            if (!entry || !Number.isFinite(Number(entry.seasonNo)))
                                return;
                            bySeasonNo.set(Number(entry.seasonNo), Array.isArray(entry.episodes) ? entry.episodes : []);
                        });
                        seasons = seasons.map((s) => {
                            const seasonNo = Number(s?.season || 0);
                            return { ...s, episodes: bySeasonNo.get(seasonNo) || [] };
                        });
                    }
                    const movieRuntime = Number(direct?.runtime || 0);
                    const tvEpisodeRuntime = Array.isArray(direct?.episode_run_time) && direct.episode_run_time.length
                        ? Number(direct.episode_run_time[0] || 0)
                        : 0;
                    const normalizedRuntime = movieRuntime > 0 ? movieRuntime : tvEpisodeRuntime;
                    res = {
                        id: String(direct?.id || id),
                        title: direct?.title || direct?.name || 'Unknown',
                        type,
                        media_type: type,
                        description: direct?.overview,
                        image: direct?.poster_path ? `https://image.tmdb.org/t/p/original${direct.poster_path}` : null,
                        cover: direct?.backdrop_path ? `https://image.tmdb.org/t/p/original${direct.backdrop_path}` : null,
                        status: direct?.status,
                        releaseDate: direct?.release_date || direct?.first_air_date,
                        runtime: normalizedRuntime,
                        duration: normalizedRuntime,
                        rating: direct?.vote_average,
                        genres: Array.isArray(direct?.genres) ? direct.genres.map((g) => g?.name).filter(Boolean) : [],
                        totalEpisodes: Number(direct?.number_of_episodes || 0),
                        seasons,
                    };
                }
            }
        }
        if (!res) {
            throw new Error('Failed to fetch base metadata for FlixHQ mapping');
        }
        if (res && typeof res === 'object') {
            delete res.cast;
            delete res.characters;
            delete res.recommendations;
            delete res.similar;
        }
        return res;
    };
    const baseInfo = main_1.redis
        ? await cache_1.default.fetch(main_1.redis, `tmdb:info:${type}:${id}:flixhq-mapped:v2`, fetchBase, main_1.REDIS_TTL)
        : await fetchBase();
    await attachBestTrailer(baseInfo, id, type);
    const titleCandidates = getTitleCandidatesFromMedia(baseInfo);
    if (!titleCandidates.length)
        return baseInfo;
    const yearGuess = Number(String(baseInfo?.releaseDate || baseInfo?.firstAirDate || '').slice(0, 4));
    const expectedType = String(type || '').toLowerCase() === 'tv' ? 'tv' : 'movie';
    const resolveAniListId = async () => {
        const queries = titleCandidates.slice(0, 2);
        for (const query of queries) {
            try {
                const anilistRes = await request.server.inject({
                    method: 'GET',
                    url: `/meta/anilist/${encodeURIComponent(query)}`,
                });
                if (anilistRes.statusCode >= 400)
                    continue;
                const anilistPayload = safeJsonParse(anilistRes.body || '{}');
                const anilistRows = Array.isArray(anilistPayload?.results) ? anilistPayload.results : [];
                if (!anilistRows.length)
                    continue;
                const picked = anilistRows
                    .map((item) => ({
                    item,
                    score: titleMatchScore(String(item?.title || item?.name || ''), titleCandidates),
                }))
                    .sort((a, b) => b.score - a.score)[0]?.item;
                const pickedId = String(picked?.id || '').trim();
                if (pickedId)
                    return pickedId;
            }
            catch {
                continue;
            }
        }
        return null;
    };
    const animeId = await resolveAniListId();
    if (animeId)
        baseInfo.anilistId = animeId;
    // Build search terms, prioritizing exact titles over year variants
    const mainTerms = titleCandidates.slice(0, 2); // First 2 most relevant titles
    const searchTerms = Array.from(new Set([
        ...mainTerms, // Prioritize exact title matches first
        ...mainTerms.flatMap((title) => Number.isFinite(yearGuess) && yearGuess > 1900 ? [`${title} ${yearGuess}`] : []),
    ])).slice(0, 4); // Limit to top 4 search terms for speed
    // Parallelize all searches instead of sequential
    const searchPromises = searchTerms.map(async (term) => {
        try {
            const searchRes = await request.server.inject({
                method: 'GET',
                url: `/movies/flixhq/${encodeURIComponent(term)}`,
            });
            if (searchRes.statusCode >= 400)
                return [];
            const payload = safeJsonParse(searchRes.body || '{}');
            return Array.isArray(payload?.data) ? payload.data : [];
        }
        catch {
            return [];
        }
    });
    const searchResults = await Promise.all(searchPromises);
    const combinedResults = searchResults.flat();
    const seen = new Set();
    const deduped = combinedResults.filter((row) => {
        const key = String(row?.id || '').trim();
        if (!key || seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
    const scored = deduped
        .map((item) => {
        const itemType = normalizeText(String(item?.type || ''));
        const itemTitle = String(item?.name || item?.title || '');
        const score = titleMatchScore(itemTitle, titleCandidates) +
            (itemType === expectedType ? 120 : -250) +
            (() => {
                const rowYear = Number(item?.releaseDate);
                if (!Number.isFinite(yearGuess) || yearGuess <= 1900 || !Number.isFinite(rowYear))
                    return 0;
                if (rowYear === yearGuess)
                    return 30;
                if (Math.abs(rowYear - yearGuess) === 1)
                    return 10;
                return 0;
            })() +
            (() => {
                if (expectedType !== 'tv')
                    return 0;
                const baseSeasons = Array.isArray(baseInfo?.seasons) ? baseInfo.seasons.length : 0;
                const rowSeasons = Number(item?.seasons || 0);
                if (!baseSeasons || !rowSeasons)
                    return 0;
                if (baseSeasons === rowSeasons)
                    return 12;
                if (Math.abs(baseSeasons - rowSeasons) <= 1)
                    return 5;
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
                const infoRes = await request.server.inject({
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
                        const bySeasonEpisode = new Map();
                        for (const ep of providerEpisodes) {
                            const seasonNum = Number(ep?.seasonNumber || 0);
                            const episodeNum = Number(ep?.episodeNumber || 0);
                            if (!seasonNum || !episodeNum)
                                continue;
                            bySeasonEpisode.set(`${seasonNum}:${episodeNum}`, ep);
                        }
                        if (Array.isArray(baseInfo?.seasons)) {
                            baseInfo.seasons = baseInfo.seasons.map((season, seasonIndex) => {
                                const seasonNum = Number(season?.season || seasonIndex + 1);
                                if (!Array.isArray(season?.episodes))
                                    return season;
                                return {
                                    ...season,
                                    episodes: season.episodes.map((episode, episodeIndex) => {
                                        const episodeNum = Number(episode?.episode || episode?.number || episodeIndex + 1);
                                        const mapped = bySeasonEpisode.get(`${seasonNum}:${episodeNum}`);
                                        if (!mapped?.episodeId)
                                            return episode;
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
            }
            catch {
                // Fall through to normal path
            }
        }
    }
    let pick = scored[0]?.item;
    if (!pick?.id)
        return baseInfo;
    try {
        const infoRes = await request.server.inject({
            method: 'GET',
            url: `/movies/flixhq/info?id=${encodeURIComponent(String(pick.id))}`,
        });
        if (infoRes.statusCode >= 400)
            return baseInfo;
        const payload = safeJsonParse(infoRes.body || '{}');
        const providerEpisodes = Array.isArray(payload?.providerEpisodes)
            ? payload.providerEpisodes
            : Array.isArray(payload?.data?.providerEpisodes)
                ? payload.data.providerEpisodes
                : [];
        if (!providerEpisodes.length)
            return baseInfo;
        const bySeasonEpisode = new Map();
        for (const ep of providerEpisodes) {
            const seasonNum = Number(ep?.seasonNumber || 0);
            const episodeNum = Number(ep?.episodeNumber || 0);
            if (!seasonNum || !episodeNum)
                continue;
            bySeasonEpisode.set(`${seasonNum}:${episodeNum}`, ep);
        }
        if (Array.isArray(baseInfo?.seasons)) {
            baseInfo.seasons = baseInfo.seasons.map((season, seasonIndex) => {
                const seasonNum = Number(season?.season || seasonIndex + 1);
                if (!Array.isArray(season?.episodes))
                    return season;
                return {
                    ...season,
                    episodes: season.episodes.map((episode, episodeIndex) => {
                        const episodeNum = Number(episode?.episode || episode?.number || episodeIndex + 1);
                        const mapped = bySeasonEpisode.get(`${seasonNum}:${episodeNum}`);
                        if (!mapped?.episodeId)
                            return episode;
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
        convertTmdbImagesToUrls(baseInfo);
        return baseInfo;
    }
    catch {
        return baseInfo;
    }
};
const routes = async (fastify, options) => {
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: "Welcome to the tmdb provider: check out the provider's website @ https://www.themoviedb.org/",
            routes: ['/:query', '/info/:id', '/watch/:episodeId'],
            documentation: 'https://docs.consumet.org/#tag/tmdb',
        });
    });
    fastify.get('/:query', async (request, reply) => {
        const query = request.params.query;
        const page = request.query.page;
        const tmdb = configureMeta(new extensions_1.META.TMDB(main_1.tmdbApi, (0, provider_1.configureProvider)(new extensions_2.MOVIES.FlixHQ())));
        try {
            const fetchSearch = async () => {
                return await tmdb.search(query, page);
            };
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `tmdb:search:${query}:${page || 1}`, fetchSearch, main_1.REDIS_TTL)
                : await fetchSearch();
            // If results are empty or error out, try direct rescue
            if (!res || !Array.isArray(res.results) || res.results.length === 0) {
                const rescued = await getDirectTmdbSearch(query, page);
                if (rescued && rescued.results.length > 0) {
                    res = { ...rescued, message: 'Search results rescued via direct fetch' };
                }
            }
            reply.status(200).send(res);
        }
        catch (err) {
            console.error('TMDB Search Error:', err);
            // Catch-all rescue
            const rescued = await getDirectTmdbSearch(query, page);
            if (rescued) {
                return reply.status(200).send({ ...rescued, message: 'Search results rescued after fetch failure' });
            }
            reply.status(200).send({ results: [], total_results: 0, message: 'Search failed, please try again or check TMDB key.' });
        }
    });
    const getDirectTmdbSearch = async (query, page = 1) => {
        try {
            if (!main_1.tmdbApi)
                return null;
            const url = `https://api.themoviedb.org/3/search/multi?api_key=${main_1.tmdbApi}&query=${encodeURIComponent(query)}&page=${page}`;
            const res = await axios_1.default.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (res.data && Array.isArray(res.data.results)) {
                return {
                    results: res.data.results.map((item) => ({
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
        }
        catch (err) {
            console.error('Direct TMDB Search Error:', err);
        }
        return null;
    };
    const getDirectTmdbInfo = async (id, type, includeSeasons = false) => {
        try {
            if (!main_1.tmdbApi)
                return null;
            const url = `https://api.themoviedb.org/3/${type}/${id}?api_key=${main_1.tmdbApi}`;
            const res = await axios_1.default.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 5000,
            });
            if (res.data) {
                const isTv = String(type || '').toLowerCase() === 'tv';
                const movieRuntime = Number(res.data.runtime || 0);
                const tvEpisodeRuntime = Array.isArray(res.data.episode_run_time) && res.data.episode_run_time.length
                    ? Number(res.data.episode_run_time[0] || 0)
                    : 0;
                const normalizedRuntime = movieRuntime > 0 ? movieRuntime : tvEpisodeRuntime;
                let seasons = Array.isArray(res.data.seasons)
                    ? res.data.seasons.map((s) => ({
                        id: s.id.toString(),
                        name: s.name,
                        season: s.season_number,
                        image: s.poster_path ? `https://image.tmdb.org/t/p/original${s.poster_path}` : null,
                        episodes: [],
                    }))
                    : [];
                if (isTv && includeSeasons && seasons.length) {
                    const seasonFetches = seasons
                        .filter((s) => Number.isFinite(Number(s?.season)) && Number(s.season) >= 0)
                        .slice(0, 25)
                        .map(async (s) => {
                        try {
                            const seasonNo = Number(s.season);
                            const seasonUrl = `https://api.themoviedb.org/3/tv/${id}/season/${seasonNo}?api_key=${main_1.tmdbApi}&language=en-US`;
                            const seasonRes = await axios_1.default.get(seasonUrl, {
                                headers: { 'User-Agent': 'Mozilla/5.0' },
                                timeout: 5000,
                            });
                            const episodes = Array.isArray(seasonRes?.data?.episodes)
                                ? seasonRes.data.episodes.map((ep, idx) => {
                                    const epNo = Number(ep?.episode_number || ep?.number || idx + 1);
                                    return {
                                        id: `${id}-s${seasonNo}e${epNo}`,
                                        episode: epNo,
                                        number: epNo,
                                        title: ep?.name || `Episode ${epNo}`,
                                        season: seasonNo,
                                    };
                                })
                                : [];
                            return { seasonNo, episodes };
                        }
                        catch {
                            return null;
                        }
                    });
                    const seasonDetails = await Promise.all(seasonFetches);
                    const bySeasonNo = new Map();
                    seasonDetails.forEach((entry) => {
                        if (!entry || !Number.isFinite(Number(entry.seasonNo)))
                            return;
                        bySeasonNo.set(Number(entry.seasonNo), Array.isArray(entry.episodes) ? entry.episodes : []);
                    });
                    seasons = seasons.map((s) => {
                        const seasonNo = Number(s?.season || 0);
                        return { ...s, episodes: bySeasonNo.get(seasonNo) || [] };
                    });
                }
                return {
                    id: res.data.id.toString(),
                    title: res.data.title || res.data.name || 'Unknown',
                    type: type,
                    media_type: type,
                    description: res.data.overview,
                    image: `https://image.tmdb.org/t/p/original${res.data.poster_path}`,
                    cover: `https://image.tmdb.org/t/p/original${res.data.backdrop_path}`,
                    status: res.data.status,
                    releaseDate: res.data.release_date || res.data.first_air_date,
                    runtime: normalizedRuntime,
                    duration: normalizedRuntime,
                    rating: res.data.vote_average,
                    genres: res.data.genres?.map((g) => g.name) || [],
                    totalEpisodes: res.data.number_of_episodes || (res.data.episodes ? res.data.episodes.length : 0),
                    seasons,
                    // Minimal info to keep UI working
                };
            }
        }
        catch (err) {
            console.error('Direct TMDB Fetch Error:', err);
        }
        return null;
    };
    fastify.get('/info', async (request, reply) => {
        const sanitizeType = (t) => {
            if (!t || t === 'undefined' || t === 'null')
                return undefined;
            return String(t).toLowerCase();
        };
        const id = request.query.id;
        let type = sanitizeType(request.query.type);
        const provider = request.query.provider;
        const providerLower = provider?.toLowerCase();
        let tmdb = createTmdbClient((0, provider_1.configureProvider)(new extensions_2.MOVIES.FlixHQ()));
        if (!id)
            return reply.status(400).send({ message: "The 'id' query is required" });
        // --- Smart Type Guessing Logic ---
        if (!type || (type !== 'movie' && type !== 'tv')) {
            console.log(`[SmartGuess] type missing for id ${id}, attempting resolution...`);
            try {
                // Try to fetch as TV first (37854 is a TV show in user's logs)
                const tvQuery = `https://api.themoviedb.org/3/tv/${id}?api_key=${main_1.tmdbApi}`;
                const tvRes = await axios_1.default.get(tvQuery).catch(() => null);
                if (tvRes?.data) {
                    type = 'tv';
                    console.log(`[SmartGuess] Resolved id ${id} as 'tv'`);
                }
                else {
                    const movieQuery = `https://api.themoviedb.org/3/movie/${id}?api_key=${main_1.tmdbApi}`;
                    const movieRes = await axios_1.default.get(movieQuery).catch(() => null);
                    if (movieRes?.data) {
                        type = 'movie';
                        console.log(`[SmartGuess] Resolved id ${id} as 'movie'`);
                    }
                }
            }
            catch {
                // Fallback below
            }
        }
        if (!type) {
            return reply.status(400).send({ message: "The 'type' query is required and could not be auto-resolved." });
        }
        if (!main_1.tmdbApi) {
            const rescued = await getDirectTmdbInfo(id, type);
            if (rescued) {
                await attachBestTrailer(rescued, id, type);
                convertTmdbImagesToUrls(rescued);
                return reply.status(200).send(rescued);
            }
            return reply.status(200).send({
                id,
                title: 'Unknown',
                type,
                media_type: type,
                episodes: [],
                message: 'TMDB key not configured on the server.',
            });
        }
        // When no provider is explicitly requested, prefer direct TMDB metadata.
        // This avoids hard dependency on FlixHQ host resolution during basic info fetches.
        if (!providerLower) {
            const fetchDirect = async () => {
                const direct = await getDirectTmdbInfo(id, type);
                if (!direct)
                    return null;
                await attachBestTrailer(direct, id, type);
                convertTmdbImagesToUrls(direct);
                return direct;
            };
            const directRes = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `tmdb:info:direct:${type}:${id}:trailer-v1`, fetchDirect, main_1.REDIS_TTL)
                : await fetchDirect();
            if (directRes) {
                return reply.status(200).send(directRes);
            }
            // Fall through to provider-backed path as a last resort.
        }
        if (providerLower === 'justanime') {
            try {
                const res = await buildJustanimeTmdbInfo(request, id, type);
                return reply.status(200).send(res);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return reply.status(500).send({ message });
            }
        }
        if (providerLower === 'animesalt') {
            try {
                const res = await buildAnimesaltTmdbInfo(request, id, type);
                return reply.status(200).send(res);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return reply.status(500).send({ message });
            }
        }
        if (providerLower === 'animekai') {
            try {
                const res = await buildAnimekaiTmdbInfo(request, id, type);
                return reply.status(200).send(res);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return reply.status(500).send({ message });
            }
        }
        if (providerLower === 'flixhq') {
            try {
                const res = await buildFlixhqTmdbInfo(request, id, type);
                return reply.status(200).send(res);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return reply.status(500).send({ message });
            }
        }
        if (providerLower === 'vegamovies') {
            try {
                const direct = await getDirectTmdbInfo(id, type);
                if (!direct)
                    throw new Error('Unable to resolve TMDB metadata');
                await attachBestTrailer(direct, id, type);
                convertTmdbImagesToUrls(direct);
                return reply.status(200).send(direct);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return reply.status(500).send({ message });
            }
        }
        if (typeof provider !== 'undefined') {
            const selectedProvider = resolveMovieProvider(provider);
            if (selectedProvider) {
                tmdb = createTmdbClient(selectedProvider);
                if (!tmdb) {
                    return reply.status(200).send({ id, title: 'Unknown', type, media_type: type, episodes: [], message: 'TMDB key not configured on the server.' });
                }
            }
            else {
                const possibleProvider = extensions_1.PROVIDERS_LIST.MOVIES.find((p) => p.name.toLowerCase() === provider.toLocaleLowerCase());
                tmdb = createTmdbClient(possibleProvider);
                if (!tmdb) {
                    return reply.status(200).send({ id, title: 'Unknown', type, media_type: type, episodes: [], message: 'TMDB key not configured on the server.' });
                }
            }
        }
        try {
            const fetchInfo = async () => {
                const info = await tmdb.fetchMediaInfo(id, type);
                if (info && typeof info === 'object') {
                    // Optimize for speed by removing heavy fields not used in current UI
                    delete info.cast;
                    delete info.characters;
                    delete info.recommendations;
                    delete info.similar;
                    await attachBestTrailer(info, id, type);
                    convertTmdbImagesToUrls(info);
                }
                return info;
            };
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `tmdb:info:${type}:${id}:${provider || 'default'}:trailer-v2`, fetchInfo, main_1.REDIS_TTL)
                : await fetchInfo();
            // If title is "Unknown" or missing, try to rescue it directly from TMDB
            if (!res || !res.title || res.title === 'Unknown') {
                const rescued = await getDirectTmdbInfo(id, type);
                if (rescued) {
                    await attachBestTrailer(rescued, id, type);
                    convertTmdbImagesToUrls(rescued);
                    res = { ...(res || {}), ...rescued, message: 'Metadata partially rescued via direct fetch' };
                }
            }
            reply.status(200).send(res);
        }
        catch (err) {
            console.error('TMDB Info Error:', err);
            // Catch-all rescue if the entire fetch fails
            const rescued = await getDirectTmdbInfo(id, type);
            if (rescued) {
                await attachBestTrailer(rescued, id, type);
                convertTmdbImagesToUrls(rescued);
                return reply.status(200).send({ ...rescued, episodes: [], message: 'Metadata rescued after fetch failure' });
            }
            reply.status(200).send({ id, title: 'Unknown', episodes: [], message: 'TMDB metadata fetch failed' });
        }
    });
    fastify.get('/info/:id', async (request, reply) => {
        const sanitizeType = (t) => {
            if (!t || t === 'undefined' || t === 'null')
                return undefined;
            return String(t).toLowerCase();
        };
        const id = request.params.id;
        let type = sanitizeType(request.query.type);
        const provider = request.query.provider;
        const providerLower = provider?.toLowerCase();
        let tmdb = createTmdbClient((0, provider_1.configureProvider)(new extensions_2.MOVIES.FlixHQ()));
        // --- Smart Type Guessing Logic ---
        if (!type || (type !== 'movie' && type !== 'tv')) {
            console.log(`[SmartGuess] type missing for id ${id}, attempting resolution...`);
            try {
                const tvQuery = `https://api.themoviedb.org/3/tv/${id}?api_key=${main_1.tmdbApi}`;
                const tvRes = await axios_1.default.get(tvQuery).catch(() => null);
                if (tvRes?.data) {
                    type = 'tv';
                    console.log(`[SmartGuess] Resolved id ${id} as 'tv'`);
                }
                else {
                    const movieQuery = `https://api.themoviedb.org/3/movie/${id}?api_key=${main_1.tmdbApi}`;
                    const movieRes = await axios_1.default.get(movieQuery).catch(() => null);
                    if (movieRes?.data) {
                        type = 'movie';
                        console.log(`[SmartGuess] Resolved id ${id} as 'movie'`);
                    }
                }
            }
            catch {
                // Fallback below
            }
        }
        if (!type) {
            return reply.status(400).send({ message: "The 'type' query is required and could not be auto-resolved." });
        }
        if (!main_1.tmdbApi) {
            return reply.status(200).send({
                id,
                title: 'Unknown',
                type,
                media_type: type,
                episodes: [],
                message: 'TMDB key not configured on the server.',
            });
        }
        // When no provider is explicitly requested, prefer direct TMDB metadata.
        // This avoids hard dependency on FlixHQ host resolution during basic info fetches.
        if (!providerLower) {
            const fetchDirect = async () => {
                const direct = await getDirectTmdbInfo(id, type);
                if (!direct)
                    return null;
                await attachBestTrailer(direct, id, type);
                convertTmdbImagesToUrls(direct);
                return direct;
            };
            const directRes = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `tmdb:info:direct:${type}:${id}:trailer-v1`, fetchDirect, main_1.REDIS_TTL)
                : await fetchDirect();
            if (directRes) {
                return reply.status(200).send(directRes);
            }
            // Fall through to provider-backed path as a last resort.
        }
        if (providerLower === 'justanime') {
            try {
                const res = await buildJustanimeTmdbInfo(request, id, type);
                return reply.status(200).send(res);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return reply.status(500).send({ message });
            }
        }
        if (providerLower === 'animesalt') {
            try {
                const res = await buildAnimesaltTmdbInfo(request, id, type);
                return reply.status(200).send(res);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return reply.status(500).send({ message });
            }
        }
        if (providerLower === 'animekai') {
            try {
                const res = await buildAnimekaiTmdbInfo(request, id, type);
                return reply.status(200).send(res);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return reply.status(500).send({ message });
            }
        }
        if (providerLower === 'flixhq') {
            try {
                const res = await buildFlixhqTmdbInfo(request, id, type);
                return reply.status(200).send(res);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return reply.status(500).send({ message });
            }
        }
        if (typeof provider !== 'undefined') {
            const selectedProvider = resolveMovieProvider(provider);
            if (selectedProvider) {
                tmdb = createTmdbClient(selectedProvider);
            }
            else {
                const possibleProvider = extensions_1.PROVIDERS_LIST.MOVIES.find((p) => p.name.toLowerCase() === provider.toLocaleLowerCase());
                tmdb = createTmdbClient(possibleProvider);
            }
        }
        try {
            const fetchInfo = async () => {
                const info = await tmdb.fetchMediaInfo(id, type);
                if (info && typeof info === 'object') {
                    // Optimize for speed by removing heavy fields not used in current UI
                    delete info.cast;
                    delete info.characters;
                    delete info.recommendations;
                    delete info.similar;
                    await attachBestTrailer(info, id, type);
                    convertTmdbImagesToUrls(info);
                }
                return info;
            };
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `tmdb:info:${type}:${id}:${provider || 'default'}:trailer-v2`, fetchInfo, main_1.REDIS_TTL)
                : await fetchInfo();
            // If title is "Unknown" or missing, try to rescue it directly from TMDB
            if (!res || !res.title || res.title === 'Unknown') {
                const rescued = await getDirectTmdbInfo(id, type);
                if (rescued) {
                    await attachBestTrailer(rescued, id, type);
                    convertTmdbImagesToUrls(rescued);
                    res = { ...(res || {}), ...rescued, message: 'Metadata partially rescued via direct fetch' };
                }
            }
            reply.status(200).send(res);
        }
        catch (err) {
            console.error('TMDB Info ID Error:', err);
            // Catch-all rescue
            const rescued = await getDirectTmdbInfo(id, type);
            if (rescued) {
                await attachBestTrailer(rescued, id, type);
                convertTmdbImagesToUrls(rescued);
                return reply.status(200).send({ ...rescued, episodes: [], message: 'Metadata rescued after fetch failure' });
            }
            reply.status(200).send({ id, title: 'Unknown', episodes: [], message: 'TMDB metadata fetch failed' });
        }
    });
    fastify.get('/trending', async (request, reply) => {
        const validTimePeriods = new Set(['day', 'week']);
        const sanitizeType = (t) => {
            if (!t || t === 'undefined' || t === 'null')
                return 'all';
            return String(t).toLowerCase();
        };
        const type = sanitizeType(request.query.type);
        let timePeriod = request.query.timePeriod || 'day';
        // make day as default time period
        if (!validTimePeriods.has(timePeriod))
            timePeriod = 'day';
        const page = request.query.page || 1;
        if (!main_1.tmdbApi) {
            return reply.status(200).send({
                results: [],
                page,
                message: 'TMDB key not configured on the server.',
            });
        }
        const tmdb = createTmdbClient((0, provider_1.configureProvider)(new extensions_2.MOVIES.FlixHQ()));
        if (!tmdb) {
            return reply.status(200).send({
                results: [],
                page,
                message: 'TMDB client could not be initialized.',
            });
        }
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
                res.results.forEach((item) => {
                    delete item.cast;
                    delete item.characters;
                });
            }
            reply.status(200).send(res);
        }
        catch (err) {
            console.error('TMDB Trending Error:', err);
            // Catch-all rescue
            const rescued = await getDirectTmdbTrending(type, timePeriod, page);
            if (rescued) {
                return reply.status(200).send({ ...rescued, message: 'Trending rescued after fetch failure' });
            }
            reply.status(200).send({ results: [], message: 'Trending currently unavailable, please check TMDB key.' });
        }
    });
    const getDirectTmdbTrending = async (type = 'all', timePeriod = 'day', page = 1) => {
        try {
            if (!main_1.tmdbApi)
                return null;
            const url = `https://api.themoviedb.org/3/trending/${type}/${timePeriod}?api_key=${main_1.tmdbApi}&page=${page}`;
            const res = await axios_1.default.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (res.data && Array.isArray(res.data.results)) {
                return {
                    results: res.data.results.map((item) => ({
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
        }
        catch (err) {
            console.error('Direct TMDB Trending Error:', err);
        }
        return null;
    };
    const watch = async (request, reply) => {
        const sanitizeType = (t) => {
            if (!t || t === 'undefined' || t === 'null')
                return undefined;
            return String(t).toLowerCase();
        };
        let episodeId = request.params.episodeId;
        if (!episodeId) {
            episodeId = request.query.episodeId;
        }
        const id = request.query.id;
        const type = sanitizeType(request.query.type);
        const provider = request.query.provider;
        const providerLower = provider?.toLowerCase();
        const server = request.query.server;
        const directOnlyRaw = String(request.query.directOnly || '').toLowerCase();
        const directOnly = directOnlyRaw === '1' || directOnlyRaw === 'true' || directOnlyRaw === 'yes';
        console.log(`[tmdb.ts] watch hit: id=${id}, type=${type}, provider=${provider}, providerLower=${providerLower}`);
        // Build cache key for watch results (skip caching if server is specified since that changes results)
        const cacheKey = !server ? `tmdb:watch:${type}:${id}:${provider || 'default'}:${directOnly}` : null;
        // Try to return from cache first
        if (cacheKey && main_1.redis) {
            try {
                const cached = await main_1.redis.get(cacheKey);
                if (cached) {
                    const payload = JSON.parse(cached);
                    return reply.status(200).send(payload);
                }
            }
            catch {
                // Ignore cache read errors and proceed with normal flow
            }
        }
        // Check if it's an anime provider
        if (providerLower && ANIME_PROVIDER_ROUTES[providerLower]) {
            let resolvedEpisodeId = episodeId;
            // Attempt to resolve episodeId from season/episode if it's a provider-specific mapping provider
            if ((providerLower === 'justanime' || providerLower === 'animesalt' || providerLower === 'animekai') && (!resolvedEpisodeId || !resolvedEpisodeId.includes('$'))) {
                try {
                    const info = providerLower === 'justanime'
                        ? await buildJustanimeTmdbInfo(request, id, type || 'tv')
                        : providerLower === 'animesalt'
                            ? await buildAnimesaltTmdbInfo(request, id, type || 'tv')
                            : await buildAnimekaiTmdbInfo(request, id, type || 'tv');
                    const requestedSeason = Number(request.query.season || 1);
                    const requestedEpisode = Number(request.query.episode || 1);
                    const seasonMatch = Array.isArray(info?.seasons)
                        ? info.seasons.find((s) => Number(s?.season || 1) === requestedSeason)
                        : undefined;
                    const epMatch = Array.isArray(seasonMatch?.episodes)
                        ? seasonMatch.episodes.find((ep) => Number(ep?.episode || ep?.number || 0) === requestedEpisode)
                        : undefined;
                    if (epMatch?.id) {
                        resolvedEpisodeId = epMatch.id;
                    }
                }
                catch {
                    // Fallback to default redirect
                }
            }
            if (!resolvedEpisodeId) {
                return reply.status(400).send({ message: `episodeId is required for ${providerLower} watch` });
            }
            const animeBaseUrl = ANIME_PROVIDER_ROUTES[providerLower];
            const queryParts = [];
            if (server) {
                const serverKey = providerLower === 'satoru' ? 'serverId' : 'server';
                queryParts.push(`${serverKey}=${encodeURIComponent(server)}`);
            }
            if (providerLower === 'hianime')
                queryParts.push('category=both');
            if (directOnly)
                queryParts.push('directOnly=true');
            const queryString = queryParts.length ? `?${queryParts.join('&')}` : '';
            const redirectUrl = `${animeBaseUrl}/watch/${resolvedEpisodeId}${queryString}`;
            return reply.redirect(redirectUrl);
        }
        if (providerLower === 'vegamovies') {
            try {
                const q = request.query;
                const season = type === 'tv' ? Number(q.season || 1) : (q.season ? Number(q.season) : undefined);
                const episode = type === 'tv' ? Number(q.episode || 1) : (q.episode ? Number(q.episode) : undefined);
                const res = await resolveVegamoviesWatch(id, type, season, episode);
                console.log(`[Vegamovies] Watch resolved successfully: ${res?.sources?.length || 0} sources`);
                return reply.status(200).send({ ...res, provider: 'vegamovies' });
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`[Vegamovies] Watch resolution failed: ${message}`);
                return reply.status(500).send({ message, error: 'Vegamovies resolution error' });
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
                        const directRes = await request.server.inject({
                            method: 'GET',
                            url: `/movies/flixhq/watch?episodeId=${encodeURIComponent(movieId)}`,
                        });
                        if (directRes.statusCode < 400) {
                            const payload = safeJsonParse(directRes.body || '{}');
                            if (Array.isArray(payload?.sources) && payload.sources.length > 0) {
                                if (!directOnly || payload.sources.some((src) => /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(src?.url || '')))) {
                                    if (cacheKey && main_1.redis) {
                                        main_1.redis.setex(cacheKey, main_1.REDIS_TTL, JSON.stringify(payload)).catch(() => { });
                                    }
                                    return reply.status(200).send(payload);
                                }
                            }
                        }
                    }
                    catch {
                        // Continue to search path
                    }
                }
                // If direct ID didn't work, get title and search
                try {
                    const baseTmdb = new extensions_1.META.TMDB(main_1.tmdbApi, (0, provider_1.configureProvider)(new extensions_2.MOVIES.FlixHQ()));
                    let mediaInfo;
                    try {
                        mediaInfo = await baseTmdb.fetchMediaInfo(id, 'movie');
                    }
                    catch {
                        mediaInfo = await getDirectTmdbInfo(id, 'movie');
                    }
                    if (mediaInfo?.title) {
                        titleForSearch = mediaInfo.title;
                    }
                }
                catch {
                    // Will use fallback
                }
                // Search FlixHQ with title
                if (titleForSearch) {
                    try {
                        const searchRes = await request.server.inject({
                            method: 'GET',
                            url: `/movies/flixhq/${encodeURIComponent(titleForSearch)}`,
                        });
                        if (searchRes.statusCode < 400) {
                            const payload = safeJsonParse(searchRes.body || '{}');
                            const results = Array.isArray(payload?.data) ? payload.data : [];
                            const movieMatch = results.find((item) => normalizeText(String(item?.type || '')) === 'movie');
                            if (movieMatch?.id) {
                                // Found movie! Directly call FlixHQ watch
                                const queryParts = [`episodeId=${encodeURIComponent(movieMatch.id)}`];
                                if (server)
                                    queryParts.push(`server=${encodeURIComponent(server)}`);
                                if (directOnly)
                                    queryParts.push('directOnly=true');
                                const watchRes = await request.server.inject({
                                    method: 'GET',
                                    url: `/movies/flixhq/watch?${queryParts.join('&')}`,
                                });
                                if (watchRes.statusCode < 400) {
                                    const watchPayload = safeJsonParse(watchRes.body || '{}');
                                    const sources = Array.isArray(watchPayload?.sources) ? watchPayload.sources : [];
                                    if (sources.length > 0) {
                                        if (!directOnly || sources.some((src) => /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(src?.url || '')))) {
                                            if (cacheKey && main_1.redis) {
                                                main_1.redis.setex(cacheKey, main_1.REDIS_TTL, JSON.stringify(watchPayload)).catch(() => { });
                                            }
                                            return reply.status(200).send(watchPayload);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    catch {
                        // Fall through to normal path
                    }
                }
            }
            catch {
                // Fall through to normal path
            }
        }
        if (!episodeId && type === 'tv' && id && (!providerLower || providerLower === 'flixhq')) {
            try {
                const info = await buildFlixhqTmdbInfo(request, id, type);
                const requestedSeason = Number(request.query.season || 1);
                const requestedEpisode = Number(request.query.episode || 1);
                const seasonMatch = Array.isArray(info?.seasons)
                    ? info.seasons.find((s) => Number(s?.season || 1) === requestedSeason)
                    : undefined;
                const epMatch = Array.isArray(seasonMatch?.episodes)
                    ? seasonMatch.episodes.find((ep) => Number(ep?.episode || ep?.number || 0) === requestedEpisode)
                    : undefined;
                episodeId = epMatch?.id || epMatch?.url || episodeId;
            }
            catch {
                // Ignore mapping fallback failures and allow normal flow to return extraction errors.
            }
        }
        if (type === 'movie' && !providerLower && id) {
            try {
                const discoveryTmdb = new extensions_1.META.TMDB(main_1.tmdbApi, (0, provider_1.configureProvider)(new extensions_2.MOVIES.FlixHQ()));
                let mediaInfo;
                try {
                    mediaInfo = await discoveryTmdb.fetchMediaInfo(id, type);
                }
                catch {
                    // Rescue directly if discovery fails
                    mediaInfo = await getDirectTmdbInfo(id, type);
                }
                // Final check for "Unknown" title after fetch
                if (!mediaInfo || !mediaInfo.title || mediaInfo.title === 'Unknown') {
                    const rescued = await getDirectTmdbInfo(id, type);
                    if (rescued)
                        mediaInfo = { ...(mediaInfo || {}), ...rescued };
                }
                const titleCandidates = getTitleCandidatesFromMedia(mediaInfo);
                if (isAnimeLikeMovie(mediaInfo) && titleCandidates.length) {
                    const animeFallback = await tryAnimeProvidersForMovie(request, {
                        titleCandidates,
                        server,
                    });
                    if (animeFallback) {
                        // Cache watch result for fast subsequent loads
                        if (cacheKey && main_1.redis) {
                            main_1.redis.setex(cacheKey, main_1.REDIS_TTL, JSON.stringify(animeFallback)).catch(() => { });
                        }
                        return reply.status(200).send(animeFallback);
                    }
                }
            }
            catch {
                // Ignore discovery errors and continue with movie providers.
            }
        }
        // Movie/TV providers
        let movieProvider = (0, provider_1.configureProvider)(new extensions_2.MOVIES.FlixHQ());
        let tmdb = configureMeta(new extensions_1.META.TMDB(main_1.tmdbApi, movieProvider));
        if (typeof provider !== 'undefined') {
            const selectedProvider = resolveMovieProvider(provider);
            if (selectedProvider) {
                movieProvider = selectedProvider;
                tmdb = configureMeta(new extensions_1.META.TMDB(main_1.tmdbApi, selectedProvider));
            }
            else {
                const possibleProvider = extensions_1.PROVIDERS_LIST.MOVIES.find((p) => p.name.toLowerCase() === provider.toLocaleLowerCase());
                movieProvider = possibleProvider || movieProvider;
                tmdb = configureMeta(new extensions_1.META.TMDB(main_1.tmdbApi, possibleProvider));
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
                    const foreignProviderHint = lowerSourceId.includes('animesalt') ||
                        lowerSourceId.includes('hianime') ||
                        lowerSourceId.includes('satoru');
                    if (foreignProviderUrl || foreignProviderHint) {
                        sourceId = '';
                    }
                }
                // FlixHQ often requires provider-specific numeric IDs (not TMDB ids) for watch extraction.
                if (!sourceId && providerLower === 'flixhq') {
                    try {
                        const flixInfo = await buildFlixhqTmdbInfo(request, id, type);
                        const infoEpisodeId = String(flixInfo?.episodeId || '').trim();
                        const providerSourceId = String(flixInfo?.providerSourceId || '').trim();
                        sourceId = infoEpisodeId || providerSourceId || sourceId;
                    }
                    catch {
                        // Ignore resolution errors and continue with generic fallback below.
                    }
                }
                // Generic fallback when provider-specific id could not be resolved.
                sourceId = sourceId || id.replace(/^movie\//, '');
            }
            else {
                // For TV shows, use episodeId as sourceId and id as mediaId
                sourceId = episodeId;
                mediaId = id;
            }
            // Fast path: delegate FlixHQ playback extraction to the custom provider first.
            // This path is optimized and cached at /movies/flixhq/watch.
            if ((providerLower === 'flixhq' || !providerLower) && sourceId) {
                try {
                    const queryParts = [`episodeId=${encodeURIComponent(sourceId)}`];
                    if (server)
                        queryParts.push(`server=${encodeURIComponent(server)}`);
                    const delegated = await request.server.inject({
                        method: 'GET',
                        url: `/movies/flixhq/watch?${queryParts.join('&')}`,
                    });
                    if (delegated.statusCode < 400) {
                        const payload = safeJsonParse(delegated.body || '{}');
                        const sources = Array.isArray(payload?.sources) ? payload.sources : [];
                        if (!directOnly || sources.some((src) => /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(src?.url || '')))) {
                            // Cache watch result for fast subsequent loads
                            if (cacheKey && main_1.redis) {
                                main_1.redis.setex(cacheKey, main_1.REDIS_TTL, JSON.stringify(payload)).catch(() => { });
                            }
                            return reply.status(200).send(payload);
                        }
                    }
                }
                catch {
                    // Fall through to TMDB provider extraction path.
                }
            }
            const res = await (0, streamable_1.fetchWithServerFallback)(async (selectedServer) => await tmdb.fetchEpisodeSources(sourceId, mediaId, selectedServer), server, server
                ? [server]
                : [
                    extensions_1.StreamingServers.VidCloud,
                    extensions_1.StreamingServers.UpCloud,
                ], {
                attemptTimeoutMs: MOVIE_WATCH_ATTEMPT_TIMEOUT_MS,
                requireDirectPlayable: directOnly,
            });
            // Cache watch result for fast subsequent loads
            if (cacheKey && main_1.redis && res) {
                main_1.redis.setex(cacheKey, main_1.REDIS_TTL, JSON.stringify(res)).catch(() => { });
            }
            reply.status(200).send(res);
        }
        catch (err) {
            if ((type === 'tv' || type === 'movie') && sourceId && (!providerLower || providerLower === 'flixhq')) {
                try {
                    const queryParts = [`episodeId=${encodeURIComponent(sourceId)}`];
                    if (server)
                        queryParts.push(`server=${encodeURIComponent(server)}`);
                    const delegated = await request.server.inject({
                        method: 'GET',
                        url: `/movies/flixhq/watch?${queryParts.join('&')}`,
                    });
                    if (delegated.statusCode < 400) {
                        const payload = safeJsonParse(delegated.body || '{}');
                        const sources = Array.isArray(payload?.sources) ? payload.sources : [];
                        if (!directOnly || sources.some((src) => /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(src?.url || '')))) {
                            // Cache watch result for fast subsequent loads
                            if (cacheKey && main_1.redis) {
                                main_1.redis.setex(cacheKey, main_1.REDIS_TTL, JSON.stringify(payload)).catch(() => { });
                            }
                            return reply.status(200).send(payload);
                        }
                    }
                }
                catch {
                    // Continue to existing fallbacks below.
                }
            }
            if (type === 'movie' && id) {
                try {
                    const discoveryTmdb = configureMeta(new extensions_1.META.TMDB(main_1.tmdbApi, (0, provider_1.configureProvider)(new extensions_2.MOVIES.FlixHQ())));
                    let mediaInfo;
                    try {
                        mediaInfo = await discoveryTmdb.fetchMediaInfo(id, type);
                    }
                    catch {
                        mediaInfo = await getDirectTmdbInfo(id, type);
                    }
                    if (!mediaInfo || !mediaInfo.title || mediaInfo.title === 'Unknown') {
                        const rescued = await getDirectTmdbInfo(id, type);
                        if (rescued)
                            mediaInfo = { ...(mediaInfo || {}), ...rescued };
                    }
                    const titleCandidates = getTitleCandidatesFromMedia(mediaInfo);
                    if (titleCandidates.length) {
                        const animeFallback = await tryAnimeProvidersForMovie(request, {
                            titleCandidates,
                            server,
                        });
                        if (animeFallback) {
                            // Cache watch result for fast subsequent loads
                            if (cacheKey && main_1.redis) {
                                main_1.redis.setex(cacheKey, main_1.REDIS_TTL, JSON.stringify(animeFallback)).catch(() => { });
                            }
                            return reply.status(200).send(animeFallback);
                        }
                    }
                }
                catch {
                    // Ignore anime fallback errors and continue existing fallback logic.
                }
            }
            if (type === 'movie' && sourceId) {
                try {
                    const fallback = await (0, movieServerFallback_1.getMovieEmbedFallbackSource)(movieProvider, sourceId, mediaId, server);
                    if (fallback) {
                        // Cache watch result for fast subsequent loads
                        if (cacheKey && main_1.redis) {
                            main_1.redis.setex(cacheKey, main_1.REDIS_TTL, JSON.stringify(fallback)).catch(() => { });
                        }
                        return reply.status(200).send(fallback);
                    }
                }
                catch {
                    // Ignore fallback errors and return the extraction error below.
                }
            }
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[tmdb.ts] watch failed: ${message}`);
            reply.status(404).send({ message, error: 'Not Found or Extraction Failed' });
        }
    };
    fastify.get('/watch', watch);
    fastify.get('/watch/:episodeId', watch);
};
exports.default = routes;
