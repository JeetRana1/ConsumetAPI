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
const axios_1 = __importDefault(require("axios"));
const googleapis_1 = require("googleapis");
const configureMeta = (meta) => {
    if (meta && meta.client?.defaults) {
        // Already set globally in main.ts, but being explicit for meta routes
        meta.client.defaults.headers.common['User-Agent'] =
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
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
    if (!shouldLookupTrailers)
        return;
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
    animesalt: '/anime/animesalt',
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
const resolveHdstream4uTvEpisodeId = async (request, id, type, season, episode) => {
    const requestedSeason = Number(season || 1);
    const requestedEpisode = Number(episode || 1);
    let targetId = String(id || '').trim();
    try {
        const tmdbInfoRes = await request.server.inject({
            method: 'GET',
            url: `/meta/tmdb/info/${encodeURIComponent(targetId)}?type=${encodeURIComponent(type || 'tv')}`,
        });
        const tmdbInfo = safeJsonParse(tmdbInfoRes.body || '{}');
        const titleCandidates = getTitleCandidatesFromMedia(tmdbInfo);
        const preferredYear = Number(String(tmdbInfo?.releaseDate || tmdbInfo?.first_air_date || '').slice(0, 4));
        const targetSeasonLabel = `season ${requestedSeason}`;
        for (const title of titleCandidates) {
            try {
                const results = await searchHdhub4uByTitle(`${title} ${targetSeasonLabel}`);
                const normTitle = normalizeText(title);
                const ranked = results
                    .map((entry) => {
                    const score = titleMatchScore(entry.title, titleCandidates);
                    const normalizedEntry = normalizeText(entry.title);
                    const startsWithBonus = normTitle && normalizedEntry.startsWith(normTitle) ? 400 : 0;
                    const trailingAfterTitle = normTitle && normalizedEntry.startsWith(normTitle)
                        ? normalizedEntry.slice(normTitle.length).trim()
                        : '';
                    const foreignSuffixPenalty = trailingAfterTitle &&
                        !/^(?:\(?season\b|s\d+\b|series\b|web\b|all\s+episodes\b|bluray\b|webrip\b|web-dl\b|hindi\b|english\b|dual\b|x264\b|480p\b|720p\b|1080p\b|2160p\b|dd5\.1\b|\|)/i.test(trailingAfterTitle)
                        ? -550
                        : 0;
                    const seasonHit = new RegExp(`season[\\s-]*${requestedSeason}(?:\\b|-)`, 'i').test(`${entry.title} ${entry.url}`)
                        ? 300
                        : -200;
                    const yearBonus = preferredYear &&
                        new RegExp(`(^|[^\\d])${preferredYear}([^\\d]|$)`, 'i').test(entry.title)
                        ? 120
                        : 0;
                    return {
                        url: entry.url,
                        score: score + seasonHit + yearBonus + startsWithBonus + foreignSuffixPenalty,
                    };
                })
                    .filter((entry) => entry.score >= 700)
                    .sort((a, b) => b.score - a.score);
                if (ranked[0]?.url) {
                    targetId = ranked[0].url;
                    break;
                }
            }
            catch {
                // fall back to generic info lookup below
            }
        }
    }
    catch {
        // fall through to generic info lookup below
    }
    const infoRes = await request.server.inject({
        method: 'GET',
        url: `/movies/hdstream4u/info?id=${encodeURIComponent(targetId)}&type=${encodeURIComponent(type || 'tv')}`,
    });
    if (infoRes.statusCode >= 400)
        return '';
    const payload = safeJsonParse(infoRes.body || '{}');
    const entries = Array.isArray(payload?.episodes) ? payload.episodes : [];
    const match = entries.find((entry) => Number(entry?.seasonNumber || entry?.season || 1) === requestedSeason &&
        Number(entry?.episodeNumber || entry?.episode || entry?.number || 0) === requestedEpisode);
    const normalizeEpisodeId = (entry) => {
        const raw = String(entry?.episodeId || entry?.url || entry?.id || '').trim();
        // If the episodeId is a hubstream hash URL, extract the hash and look up
        // the equivalent hdstream4u file URL from the entries list.
        if (/^https?:\/\/(?:[^.]+\.)*hubstream\.(?:art|pw|cc|ink|foo|boo)\/?#/i.test(raw)) {
            for (const candidate of entries) {
                const candidateUrl = String(candidate?.episodeId || candidate?.url || candidate?.id || '').trim();
                if (/^https?:\/\/(?:[^.]+\.)?(?:hdstream4u\.com|morencius\.com)\/file\//i.test(candidateUrl)) {
                    return candidateUrl;
                }
            }
        }
        return raw;
    };
    if (match)
        return normalizeEpisodeId(match);
    // HDStream4u season pages sometimes expose only the requested season's episodes
    // but still label every row as season 1. When that happens, fall back to episode
    // number matching so TMDB SxEy requests can still resolve.
    const episodeOnlyMatches = entries.filter((entry) => Number(entry?.episodeNumber || entry?.episode || entry?.number || 0) === requestedEpisode);
    if (episodeOnlyMatches.length === 1) {
        return normalizeEpisodeId(episodeOnlyMatches[0]);
    }
    const seasonValues = Array.from(new Set(entries
        .map((entry) => Number(entry?.seasonNumber || entry?.season || 1))
        .filter((value) => Number.isFinite(value) && value > 0)));
    if (seasonValues.length === 1) {
        const fallback = episodeOnlyMatches[0];
        if (fallback)
            return normalizeEpisodeId(fallback);
    }
    return '';
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
const resolveTmdbExternalImdbId = async (id, type) => {
    const sourceId = String(id || '').trim();
    if (!sourceId)
        return '';
    if (/^tt\d+$/i.test(sourceId))
        return sourceId;
    if (!/^\d+$/.test(sourceId) || !main_1.tmdbApi)
        return '';
    const mediaTypes = Array.from(new Set([type === 'tv' ? 'tv' : 'movie', type === 'tv' ? 'movie' : 'tv']));
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
const HDHUB4U_POST_SITEMAP_URL = 'https://new2.hdhub4u.cl/post-sitemap.xml';
let hdhub4uSitemapCache = null;
const fetchHdhub4uSitemapUrls = async () => {
    if (hdhub4uSitemapCache && hdhub4uSitemapCache.expiresAt > Date.now()) {
        return hdhub4uSitemapCache.urls;
    }
    const response = await axios_1.default.get(HDHUB4U_POST_SITEMAP_URL, {
        timeout: 20000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        responseType: 'text',
    });
    const xml = String(response.data || '');
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)]
        .map((match) => String(match[1] || '').trim())
        .filter((value) => /^https?:\/\//i.test(value));
    hdhub4uSitemapCache = {
        urls,
        expiresAt: Date.now() + 30 * 60 * 1000,
    };
    return urls;
};
const searchHdhub4uByTitle = async (query) => {
    const apiUrl = new URL('https://search.pingora.fyi/collections/post/documents/search');
    apiUrl.searchParams.set('q', query);
    apiUrl.searchParams.set('query_by', 'post_title,category,stars,director,imdb_id');
    apiUrl.searchParams.set('query_by_weights', '4,2,2,2,4');
    apiUrl.searchParams.set('sort_by', 'sort_by_date:desc');
    apiUrl.searchParams.set('limit', '10');
    apiUrl.searchParams.set('highlight_fields', 'none');
    apiUrl.searchParams.set('use_cache', 'true');
    apiUrl.searchParams.set('page', '1');
    apiUrl.searchParams.set('analytics_tag', new Date().toISOString().slice(0, 10));
    const response = await axios_1.default.get(apiUrl.toString(), {
        timeout: 15000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'application/json, text/plain, */*',
            Origin: 'https://new2.hdhub4u.cl',
            Referer: `https://new2.hdhub4u.cl/?s=${encodeURIComponent(query)}`,
        },
    });
    const hits = Array.isArray(response.data?.hits) ? response.data.hits : [];
    return hits
        .map((hit) => hit?.document || {})
        .map((doc) => ({
        title: String(doc?.post_title || '').trim(),
        url: String(doc?.permalink || doc?.url || '').trim(),
    }))
        .filter((entry) => entry.title && entry.url);
};
const findBestHdhub4uUrl = async (titleCandidates, year) => {
    const urls = await fetchHdhub4uSitemapUrls();
    const ranked = urls
        .map((url) => {
        const slug = stripTrailingYear(normalizeSlug(new URL(url).pathname.split('/').filter(Boolean).pop() || ''));
        const score = titleMatchScore(slug.replace(/-/g, ' '), titleCandidates);
        const yearBonus = year && new RegExp(`(^|-)${year}(-|$)`, 'i').test(url) ? 120 : 0;
        const tvBonus = /season|episode|series|web-series/i.test(url) ? 30 : 0;
        return { url, score: score + yearBonus + tvBonus };
    })
        .filter((entry) => entry.score >= 700)
        .sort((a, b) => b.score - a.score);
    return ranked[0]?.url || '';
};
const extractHdstreamMovieCandidateIds = (infoPayload) => {
    const servers = Array.isArray(infoPayload?.servers) ? infoPayload.servers : [];
    const episodes = Array.isArray(infoPayload?.episodes) ? infoPayload.episodes : [];
    const out = [];
    const push = (value) => {
        const clean = String(value || '').trim();
        if (clean && !out.includes(clean))
            out.push(clean);
    };
    servers.forEach((server) => {
        const url = String(server?.url || '').trim();
        const fileCode = String(server?.fileCode || '').trim();
        if (/(?:hdstream4u|morencius)\.com\/file\//i.test(url)) {
            push(fileCode || url);
        }
    });
    servers.forEach((server) => {
        const url = String(server?.url || '').trim();
        if (/hubstream\.(?:art|pw|cc|ink|foo|boo)\/#/i.test(url))
            push(url);
    });
    episodes.forEach((episode) => {
        push(episode?.episodeId);
        push(episode?.url);
    });
    return out;
};
const withSoftTimeout = async (promise, timeoutMs) => {
    return await Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
};
const resolveHdstream4uEpisodeId = async (request, mediaInfo) => {
    const mediaIdHint = String(mediaInfo?.tmdbId || mediaInfo?.id || '').trim();
    const mediaTypeHint = String(mediaInfo?.type || mediaInfo?.media_type || 'movie').trim();
    if (mediaIdHint) {
        const directInfoRes = await request.server.inject({
            method: 'GET',
            url: `/movies/hdstream4u/info?id=${encodeURIComponent(mediaIdHint)}&type=${encodeURIComponent(mediaTypeHint)}`,
        });
        if (directInfoRes.statusCode < 400) {
            const directInfoPayload = safeJsonParse(directInfoRes.body || '{}');
            const directCandidates = extractHdstreamMovieCandidateIds(directInfoPayload);
            if (directCandidates.length)
                return directCandidates[0];
        }
    }
    const titleCandidates = getTitleCandidatesFromMedia(mediaInfo);
    if (!titleCandidates.length)
        return '';
    const preferredYear = Number(String(mediaInfo?.releaseDate || mediaInfo?.first_air_date || '').slice(0, 4));
    let matchedUrl = '';
    for (const title of titleCandidates) {
        try {
            const results = await searchHdhub4uByTitle(title);
            const ranked = results
                .map((entry) => {
                const score = titleMatchScore(entry.title, titleCandidates);
                const yearBonus = preferredYear && new RegExp(`(^|[^\\d])${preferredYear}([^\\d]|$)`, 'i').test(entry.title)
                    ? 120
                    : 0;
                const tvLike = /season|episode|series|web[\s-]*series/i.test(entry.title + ' ' + entry.url);
                const typeBonus = mediaInfo?.type === 'tv' || mediaInfo?.media_type === 'tv'
                    ? (tvLike ? 80 : -40)
                    : (tvLike ? -60 : 40);
                return { url: entry.url, score: score + yearBonus + typeBonus };
            })
                .filter((entry) => entry.score >= 700)
                .sort((a, b) => b.score - a.score);
            if (ranked[0]?.url) {
                matchedUrl = ranked[0].url;
                break;
            }
        }
        catch {
            // Fall back to sitemap matching below.
        }
    }
    if (!matchedUrl) {
        matchedUrl = await findBestHdhub4uUrl(titleCandidates, Number.isFinite(preferredYear) ? preferredYear : undefined);
    }
    if (!matchedUrl)
        return '';
    const infoRes = await request.server.inject({
        method: 'GET',
        url: `/movies/hdstream4u/info?id=${encodeURIComponent(matchedUrl)}`,
    });
    if (infoRes.statusCode >= 400)
        return '';
    const infoPayload = safeJsonParse(infoRes.body || '{}');
    const servers = Array.isArray(infoPayload?.servers) ? infoPayload.servers : [];
    const isTv = String(mediaInfo?.type || mediaInfo?.media_type || '').toLowerCase() === 'tv';
    const directFileServer = servers.find((server) => /(?:hdstream4u|morencius)\.com\/file\//i.test(String(server?.url || '')));
    const primary = servers.find((server) => /watch\s*online/i.test(String(server?.name || ''))) ||
        servers.find((server) => /^https?:\/\//i.test(String(server?.url || ''))) ||
        servers[0];
    const fallbackEpisode = Array.isArray(infoPayload?.episodes) ? infoPayload.episodes[0] : null;
    if (!isTv) {
        const directFileId = String(directFileServer?.fileCode || directFileServer?.url || '').trim();
        if (directFileId)
            return directFileId;
        const providerMediaId = String(infoPayload?.id || matchedUrl || infoPayload?.url || '').trim();
        if (providerMediaId)
            return providerMediaId;
    }
    return String(primary?.url ||
        primary?.fileCode ||
        primary?.id ||
        fallbackEpisode?.episodeId ||
        fallbackEpisode?.url ||
        '').trim();
};
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
        ? await cache_1.default.fetch(main_1.redis, `tmdb:info:${type}:${id}:trailer-v3`, fetchBase, main_1.REDIS_TTL)
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
            const scored = results
                .map((item) => {
                const itemTitle = String(item?.title || '');
                let score = titleMatchScore(itemTitle, titleCandidates);
                if (Number.isFinite(yearGuess) && yearGuess > 1900) {
                    const itemYear = Number(String(item?.releaseDate || '').slice(0, 4));
                    if (itemYear === yearGuess)
                        score += 50;
                }
                return { item, score };
            })
                .sort((a, b) => b.score - a.score);
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
                const directRes = await axios_1.default.get(directUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                });
                if (directRes?.data) {
                    const direct = directRes.data;
                    const isTv = String(type || '').toLowerCase() === 'tv';
                    let seasons = Array.isArray(direct?.seasons)
                        ? direct.seasons.map((s) => ({
                            id: String(s?.id || ''),
                            name: s?.name,
                            season: s?.season_number,
                            image: s?.poster_path
                                ? `https://image.tmdb.org/t/p/original${s.poster_path}`
                                : null,
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
                                const seasonRes = await axios_1.default.get(seasonUrl, {
                                    headers: { 'User-Agent': 'Mozilla/5.0' },
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
                        image: direct?.poster_path
                            ? `https://image.tmdb.org/t/p/original${direct.poster_path}`
                            : null,
                        cover: direct?.backdrop_path
                            ? `https://image.tmdb.org/t/p/original${direct.backdrop_path}`
                            : null,
                        status: direct?.status,
                        releaseDate: direct?.release_date || direct?.first_air_date,
                        runtime: normalizedRuntime,
                        duration: normalizedRuntime,
                        rating: direct?.vote_average,
                        genres: Array.isArray(direct?.genres)
                            ? direct.genres.map((g) => g?.name).filter(Boolean)
                            : [],
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
        ? await cache_1.default.fetch(main_1.redis, `tmdb:info:${type}:${id}:flixhq-mapped:v3`, fetchBase, main_1.REDIS_TTL)
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
                const anilistRows = Array.isArray(anilistPayload?.results)
                    ? anilistPayload.results
                    : [];
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
                if (!Number.isFinite(yearGuess) ||
                    yearGuess <= 1900 ||
                    !Number.isFinite(rowYear))
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
                const baseSeasons = Array.isArray(baseInfo?.seasons)
                    ? baseInfo.seasons.length
                    : 0;
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
                return reply
                    .status(200)
                    .send({ ...rescued, message: 'Search results rescued after fetch failure' });
            }
            reply
                .status(200)
                .send({
                results: [],
                total_results: 0,
                message: 'Search failed, please try again or check TMDB key.',
            });
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
                    results: res.data.results
                        .filter((item) => item?.id !== undefined && item?.id !== null)
                        .map((item) => ({
                        id: String(item.id),
                        title: item.title || item.name || 'Unknown',
                        image: item.poster_path
                            ? `https://image.tmdb.org/t/p/original${item.poster_path}`
                            : null,
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
    const getAlternateTmdbType = (type) => String(type || '').toLowerCase() === 'tv' ? 'movie' : 'tv';
    const fetchDirectTmdbPayload = async (id, type) => {
        const url = `https://api.themoviedb.org/3/${type}/${id}?api_key=${main_1.tmdbApi}`;
        return axios_1.default.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 5000,
        });
    };
    const getDirectTmdbInfo = async (id, type, includeSeasons = false) => {
        try {
            if (!main_1.tmdbApi)
                return null;
            let resolvedType = String(type || '').toLowerCase() === 'tv' ? 'tv' : 'movie';
            let res = null;
            try {
                res = await fetchDirectTmdbPayload(id, resolvedType);
            }
            catch (err) {
                const status = Number(err?.response?.status || 0);
                if (status === 404) {
                    const alternateType = getAlternateTmdbType(resolvedType);
                    try {
                        res = await fetchDirectTmdbPayload(id, alternateType);
                        resolvedType = alternateType;
                    }
                    catch (altErr) {
                        const altStatus = Number(altErr?.response?.status || 0);
                        if (altStatus !== 404) {
                            console.error('Direct TMDB Fetch Error:', altErr);
                        }
                        return null;
                    }
                }
                else {
                    console.error('Direct TMDB Fetch Error:', err);
                    return null;
                }
            }
            if (res.data) {
                const isTv = resolvedType === 'tv';
                const movieRuntime = Number(res.data.runtime || 0);
                const tvEpisodeRuntime = Array.isArray(res.data.episode_run_time) && res.data.episode_run_time.length
                    ? Number(res.data.episode_run_time[0] || 0)
                    : 0;
                const normalizedRuntime = movieRuntime > 0 ? movieRuntime : tvEpisodeRuntime;
                let seasons = Array.isArray(res.data.seasons)
                    ? res.data.seasons.map((s) => ({
                        id: s?.id !== undefined && s?.id !== null
                            ? String(s.id)
                            : `${id}-season-${s?.season_number ?? ''}`,
                        name: s.name,
                        season: s.season_number,
                        image: s.poster_path
                            ? `https://image.tmdb.org/t/p/original${s.poster_path}`
                            : null,
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
                    id: res.data?.id !== undefined && res.data?.id !== null
                        ? String(res.data.id)
                        : String(id),
                    title: res.data.title || res.data.name || 'Unknown',
                    type: resolvedType,
                    media_type: resolvedType,
                    description: res.data.overview,
                    image: `https://image.tmdb.org/t/p/original${res.data.poster_path}`,
                    cover: `https://image.tmdb.org/t/p/original${res.data.backdrop_path}`,
                    status: res.data.status,
                    releaseDate: res.data.release_date || res.data.first_air_date,
                    runtime: normalizedRuntime,
                    duration: normalizedRuntime,
                    rating: res.data.vote_average,
                    genres: res.data.genres?.map((g) => g.name) || [],
                    totalEpisodes: res.data.number_of_episodes ||
                        (res.data.episodes ? res.data.episodes.length : 0),
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
            return reply
                .status(400)
                .send({
                message: "The 'type' query is required and could not be auto-resolved.",
            });
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
                const direct = await getDirectTmdbInfo(id, type, String(type || '').toLowerCase() === 'tv');
                if (!direct)
                    return null;
                await attachBestTrailer(direct, id, type);
                convertTmdbImagesToUrls(direct);
                return direct;
            };
            const directRes = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `tmdb:info:direct:${type}:${id}:seasons-v2`, fetchDirect, main_1.REDIS_TTL)
                : await fetchDirect();
            if (directRes) {
                return reply.status(200).send(directRes);
            }
            // Fall through to provider-backed path as a last resort.
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
                if (!tmdb) {
                    return reply
                        .status(200)
                        .send({
                        id,
                        title: 'Unknown',
                        type,
                        media_type: type,
                        episodes: [],
                        message: 'TMDB key not configured on the server.',
                    });
                }
            }
            else {
                const possibleProvider = extensions_1.PROVIDERS_LIST.MOVIES.find((p) => p.name.toLowerCase() === provider.toLocaleLowerCase());
                tmdb = createTmdbClient(possibleProvider);
                if (!tmdb) {
                    return reply
                        .status(200)
                        .send({
                        id,
                        title: 'Unknown',
                        type,
                        media_type: type,
                        episodes: [],
                        message: 'TMDB key not configured on the server.',
                    });
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
                ? await cache_1.default.fetch(main_1.redis, `tmdb:info:${type}:${id}:${provider || 'default'}:trailer-v3`, fetchInfo, main_1.REDIS_TTL)
                : await fetchInfo();
            // If title is "Unknown" or missing, try to rescue it directly from TMDB
            if (!res || !res.title || res.title === 'Unknown') {
                const rescued = await getDirectTmdbInfo(id, type);
                if (rescued) {
                    await attachBestTrailer(rescued, id, type);
                    convertTmdbImagesToUrls(rescued);
                    res = {
                        ...(res || {}),
                        ...rescued,
                        message: 'Metadata partially rescued via direct fetch',
                    };
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
                return reply
                    .status(200)
                    .send({
                    ...rescued,
                    episodes: [],
                    message: 'Metadata rescued after fetch failure',
                });
            }
            reply
                .status(200)
                .send({
                id,
                title: 'Unknown',
                episodes: [],
                message: 'TMDB metadata fetch failed',
            });
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
            return reply
                .status(400)
                .send({
                message: "The 'type' query is required and could not be auto-resolved.",
            });
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
                const direct = await getDirectTmdbInfo(id, type, String(type || '').toLowerCase() === 'tv');
                if (!direct)
                    return null;
                await attachBestTrailer(direct, id, type);
                convertTmdbImagesToUrls(direct);
                return direct;
            };
            const directRes = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `tmdb:info:direct:${type}:${id}:seasons-v2`, fetchDirect, main_1.REDIS_TTL)
                : await fetchDirect();
            if (directRes) {
                return reply.status(200).send(directRes);
            }
            // Fall through to provider-backed path as a last resort.
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
                ? await cache_1.default.fetch(main_1.redis, `tmdb:info:${type}:${id}:${provider || 'default'}:trailer-v3`, fetchInfo, main_1.REDIS_TTL)
                : await fetchInfo();
            // If title is "Unknown" or missing, try to rescue it directly from TMDB
            if (!res || !res.title || res.title === 'Unknown') {
                const rescued = await getDirectTmdbInfo(id, type);
                if (rescued) {
                    await attachBestTrailer(rescued, id, type);
                    convertTmdbImagesToUrls(rescued);
                    res = {
                        ...(res || {}),
                        ...rescued,
                        message: 'Metadata partially rescued via direct fetch',
                    };
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
                return reply
                    .status(200)
                    .send({
                    ...rescued,
                    episodes: [],
                    message: 'Metadata rescued after fetch failure',
                });
            }
            reply
                .status(200)
                .send({
                id,
                title: 'Unknown',
                episodes: [],
                message: 'TMDB metadata fetch failed',
            });
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
        try {
            let res = await getDirectTmdbTrending(type, timePeriod, page);
            // If direct TMDB is empty, fall back to the extension provider.
            if (!res || !Array.isArray(res.results) || res.results.length === 0) {
                const tmdb = createTmdbClient((0, provider_1.configureProvider)(new extensions_2.MOVIES.FlixHQ()));
                if (tmdb) {
                    res = await tmdb.fetchTrending(type, timePeriod, page);
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
                return reply
                    .status(200)
                    .send({ ...rescued, message: 'Trending rescued after fetch failure' });
            }
            reply
                .status(200)
                .send({
                results: [],
                message: 'Trending currently unavailable, please check TMDB key.',
            });
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
                    results: res.data.results
                        .filter((item) => item?.id !== undefined && item?.id !== null)
                        .map((item) => ({
                        id: String(item.id),
                        title: item.title || item.name || 'Unknown',
                        image: item.poster_path
                            ? `https://image.tmdb.org/t/p/original${item.poster_path}`
                            : null,
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
        const sourceType = String(request.query.source_type ||
            request.query.category ||
            '').toLowerCase();
        const requestedSeasonForCache = String(request.query.season || '');
        const requestedEpisodeForCache = String(request.query.episode || '');
        console.log(`[tmdb.ts] watch hit: id=${id}, type=${type}, provider=${provider}, providerLower=${providerLower}`);
        // Build cache key for watch results (skip caching if server is specified since that changes results)
        const cacheKey = !server
            ? `tmdb:watch:v5:${type}:${id}:${provider || 'default'}:${requestedSeasonForCache}:${requestedEpisodeForCache}:${episodeId || ''}:${directOnly}:${sourceType}`
            : null;
        // Try to return from cache first
        if (cacheKey && main_1.redis) {
            try {
                const cached = await main_1.redis.get(cacheKey);
                if (cached) {
                    const payload = JSON.parse(cached);
                    const cachedCookie = String(payload?.headers?.Cookie || '').trim();
                    if (providerLower === 'hdstream4u' && !cachedCookie) {
                        // Older cached HDStream4u watch payloads are missing the browser-session
                        // cookie needed by hubstream manifests. Recompute instead of serving stale data.
                    }
                    else {
                        return reply.status(200).send(payload);
                    }
                }
            }
            catch {
                // Ignore cache read errors and proceed with normal flow
            }
        }
        if (providerLower === 'hdstream4u' && type === 'movie' && id) {
            try {
                const infoRes = await request.server.inject({
                    method: 'GET',
                    url: `/movies/hdstream4u/info?id=${encodeURIComponent(String(id))}&type=movie`,
                });
                if (infoRes.statusCode < 400) {
                    const infoPayload = safeJsonParse(infoRes.body || '{}');
                    const candidates = extractHdstreamMovieCandidateIds(infoPayload).slice(0, 3);
                    if (candidates.length) {
                        const candidatePayloads = candidates.map(async (candidateId) => {
                            const delegated = await withSoftTimeout(request.server.inject({
                                method: 'GET',
                                url: `/movies/hdstream4u/watch?episodeId=${encodeURIComponent(candidateId)}&mediaId=${encodeURIComponent(String(id))}`,
                            }), 4500);
                            if (!delegated || delegated.statusCode >= 400)
                                throw new Error('candidate failed');
                            const payload = safeJsonParse(delegated.body || '{}');
                            const sources = Array.isArray(payload?.sources) ? payload.sources : [];
                            if (!sources.length)
                                throw new Error('candidate empty');
                            return payload;
                        });
                        const fastest = await Promise.any(candidatePayloads).catch(() => null);
                        if (fastest) {
                            if (cacheKey && main_1.redis) {
                                main_1.redis
                                    .setex(cacheKey, main_1.REDIS_TTL, JSON.stringify(fastest))
                                    .catch(() => { });
                            }
                            return reply.status(200).send(fastest);
                        }
                    }
                }
            }
            catch {
                // Fall through to the standard provider flow below.
            }
        }
        // Check if it's an anime provider
        if (providerLower && ANIME_PROVIDER_ROUTES[providerLower]) {
            let resolvedEpisodeId = episodeId;
            // Attempt to resolve episodeId from season/episode if it's a provider-specific mapping provider
            if (providerLower === 'animesalt' &&
                (!resolvedEpisodeId || !resolvedEpisodeId.includes('$'))) {
                try {
                    const info = await buildAnimesaltTmdbInfo(request, id, type || 'tv');
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
                return reply
                    .status(400)
                    .send({ message: `episodeId is required for ${providerLower} watch` });
            }
            const animeBaseUrl = ANIME_PROVIDER_ROUTES[providerLower];
            const queryParts = [];
            if (server) {
                queryParts.push(`server=${encodeURIComponent(server)}`);
            }
            if (providerLower === 'hianime')
                queryParts.push('category=both');
            if (directOnly)
                queryParts.push('directOnly=true');
            const queryString = queryParts.length ? `?${queryParts.join('&')}` : '';
            const redirectUrl = `${animeBaseUrl}/watch/${resolvedEpisodeId}${queryString}`;
            return reply.redirect(redirectUrl);
        }
        if (type === 'movie' &&
            id &&
            providerLower === 'flixhq' &&
            !episodeId) {
            // FAST PATH: For movies, skip full episode mapping and go straight to FlixHQ watch
            // This cuts response time by 60-70% compared to full buildFlixhqTmdbInfo
            try {
                let titleForSearch = '';
                // TMDB numeric ids are not FlixHQ movie ids. Resolve movies through title search first.
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
                            const movieMatch = results
                                .filter((item) => normalizeText(String(item?.type || '')) === 'movie')
                                .map((item) => ({
                                item,
                                score: titleMatchScore(String(item?.name || item?.title || ''), [
                                    titleForSearch,
                                ]),
                            }))
                                .sort((a, b) => b.score - a.score)[0]?.item;
                            if (movieMatch?.id) {
                                // Found movie! Directly call FlixHQ watch
                                const queryParts = [`episodeId=${encodeURIComponent(movieMatch.id)}`];
                                if (server)
                                    queryParts.push(`server=${encodeURIComponent(server)}`);
                                if (server)
                                    queryParts.push('strictServer=true');
                                if (directOnly)
                                    queryParts.push('directOnly=true');
                                if (!directOnly)
                                    queryParts.push('allowEmbedFallback=true');
                                const watchRes = await request.server.inject({
                                    method: 'GET',
                                    url: `/movies/flixhq/watch?${queryParts.join('&')}`,
                                });
                                if (watchRes.statusCode < 400) {
                                    const watchPayload = safeJsonParse(watchRes.body || '{}');
                                    const sources = Array.isArray(watchPayload?.sources)
                                        ? watchPayload.sources
                                        : [];
                                    if (sources.length > 0) {
                                        if (!directOnly ||
                                            sources.some((src) => /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(src?.url || '')))) {
                                            if (cacheKey && main_1.redis) {
                                                main_1.redis
                                                    .setex(cacheKey, main_1.REDIS_TTL, JSON.stringify(watchPayload))
                                                    .catch(() => { });
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
        const resolveFlixhqTvEpisodeId = async () => {
            const requestedSeason = Number(request.query.season || 1);
            const requestedEpisode = Number(request.query.episode || 1);
            const pickEpisodeId = (info) => {
                const seasonMatch = Array.isArray(info?.seasons)
                    ? info.seasons.find((s) => Number(s?.season || s?.number || 1) === requestedSeason)
                    : undefined;
                const epMatch = Array.isArray(seasonMatch?.episodes)
                    ? seasonMatch.episodes.find((ep) => Number(ep?.episode || ep?.number || ep?.episodeNumber || 0) ===
                        requestedEpisode)
                    : undefined;
                const providerEpisodeMatch = Array.isArray(info?.providerEpisodes)
                    ? info.providerEpisodes.find((ep) => Number(ep?.seasonNumber || ep?.season || 1) === requestedSeason &&
                        Number(ep?.episodeNumber || ep?.episode || ep?.number || 0) ===
                            requestedEpisode)
                    : undefined;
                return String(epMatch?.id ||
                    epMatch?.episodeId ||
                    epMatch?.url ||
                    providerEpisodeMatch?.episodeId ||
                    providerEpisodeMatch?.id ||
                    providerEpisodeMatch?.url ||
                    '').trim();
            };
            try {
                const info = await buildFlixhqTmdbInfo(request, String(id || ''), String(type || 'tv'));
                const mapped = pickEpisodeId(info);
                if (mapped)
                    return mapped;
            }
            catch {
                // Try title search fallback below.
            }
            const mediaInfo = await getDirectTmdbInfo(String(id || ''), String(type || 'tv'));
            const title = String(mediaInfo?.title || mediaInfo?.name || '').trim();
            if (!title)
                return '';
            const searchRes = await request.server.inject({
                method: 'GET',
                url: `/movies/flixhq/${encodeURIComponent(title)}`,
            });
            if (searchRes.statusCode >= 400)
                return '';
            const searchPayload = safeJsonParse(searchRes.body || '{}');
            const results = Array.isArray(searchPayload?.data) ? searchPayload.data : [];
            const yearGuess = Number(String(mediaInfo?.releaseDate || mediaInfo?.firstAirDate || '').slice(0, 4));
            const scored = results
                .filter((row) => String(row?.id || '').trim())
                .map((row) => ({
                row,
                score: titleMatchScore(String(row?.name || row?.title || ''), [title]) +
                    (Number(String(row?.releaseDate || '').slice(0, 4)) === yearGuess ? 50 : 0) +
                    (String(row?.type || '')
                        .toLowerCase()
                        .includes('tv')
                        ? 20
                        : 0),
            }))
                .sort((a, b) => b.score - a.score);
            const flixId = String(scored[0]?.row?.id || '').trim();
            if (!flixId)
                return '';
            const infoRes = await request.server.inject({
                method: 'GET',
                url: `/movies/flixhq/info?id=${encodeURIComponent(flixId)}&type=tv`,
            });
            if (infoRes.statusCode >= 400)
                return '';
            return pickEpisodeId(safeJsonParse(infoRes.body || '{}'));
        };
        if (!episodeId &&
            type === 'tv' &&
            id &&
            (!providerLower || providerLower === 'flixhq')) {
            try {
                episodeId = (await resolveFlixhqTvEpisodeId()) || episodeId;
            }
            catch {
                // Ignore mapping fallback failures and allow normal flow to return extraction errors.
            }
        }
        if (!episodeId && type === 'tv' && id && providerLower === 'hdstream4u') {
            try {
                episodeId =
                    (await resolveHdstream4uTvEpisodeId(request, String(id || ''), String(type || 'tv'), Number(request.query.season || 1), Number(request.query.episode || 1))) || episodeId;
            }
            catch {
                // Ignore mapping failures and continue.
            }
        }
        let discoveredMovieOrTvInfo = null;
        if ((type === 'movie' || type === 'tv') &&
            (!providerLower || providerLower === 'hdstream4u') &&
            id) {
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
                discoveredMovieOrTvInfo = mediaInfo;
                // Final check for "Unknown" title after fetch
                if (!mediaInfo || !mediaInfo.title || mediaInfo.title === 'Unknown') {
                    const rescued = await getDirectTmdbInfo(id, type);
                    if (rescued)
                        mediaInfo = { ...(mediaInfo || {}), ...rescued };
                }
                const titleCandidates = getTitleCandidatesFromMedia(mediaInfo);
                if (titleCandidates.length) {
                    try {
                        const hdstreamEpisodeId = type === 'tv' && episodeId
                            ? episodeId
                            : await resolveHdstream4uEpisodeId(request, mediaInfo);
                        if (hdstreamEpisodeId) {
                            const delegated = await request.server.inject({
                                method: 'GET',
                                url: `/movies/hdstream4u/watch?episodeId=${encodeURIComponent(hdstreamEpisodeId)}${type === 'movie' && id ? `&mediaId=${encodeURIComponent(String(id))}` : ''}`,
                            });
                            if (delegated.statusCode < 400) {
                                const payload = safeJsonParse(delegated.body || '{}');
                                const sources = Array.isArray(payload?.sources) ? payload.sources : [];
                                if (sources.length > 0) {
                                    if (cacheKey && main_1.redis) {
                                        main_1.redis
                                            .setex(cacheKey, main_1.REDIS_TTL, JSON.stringify(payload))
                                            .catch(() => { });
                                    }
                                    return reply.status(200).send(payload);
                                }
                            }
                        }
                    }
                    catch {
                        // Fall through to remaining providers.
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
                        lowerSourceId.includes('hianime');
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
                    if (server)
                        queryParts.push('strictServer=true');
                    if (directOnly)
                        queryParts.push('directOnly=true');
                    if (!directOnly)
                        queryParts.push('allowEmbedFallback=true');
                    const delegated = await request.server.inject({
                        method: 'GET',
                        url: `/movies/flixhq/watch?${queryParts.join('&')}`,
                    });
                    if (delegated.statusCode < 400) {
                        const payload = safeJsonParse(delegated.body || '{}');
                        const sources = Array.isArray(payload?.sources) ? payload.sources : [];
                        if (!directOnly ||
                            sources.some((src) => /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(src?.url || '')))) {
                            // Cache watch result for fast subsequent loads
                            if (cacheKey && main_1.redis) {
                                main_1.redis
                                    .setex(cacheKey, main_1.REDIS_TTL, JSON.stringify(payload))
                                    .catch(() => { });
                            }
                            return reply.status(200).send(payload);
                        }
                    }
                }
                catch {
                    // Fall through to TMDB provider extraction path.
                }
            }
            if (providerLower === 'hdstream4u' && sourceId) {
                try {
                    const delegated = await request.server.inject({
                        method: 'GET',
                        url: `/movies/hdstream4u/watch?episodeId=${encodeURIComponent(sourceId)}${mediaId ? `&mediaId=${encodeURIComponent(mediaId)}` : ''}`,
                    });
                    if (delegated.statusCode < 400) {
                        const payload = safeJsonParse(delegated.body || '{}');
                        const sources = Array.isArray(payload?.sources) ? payload.sources : [];
                        if (sources.length > 0) {
                            if (cacheKey && main_1.redis) {
                                main_1.redis.setex(cacheKey, main_1.REDIS_TTL, JSON.stringify(payload)).catch(() => { });
                            }
                            return reply.status(200).send(payload);
                        }
                    }
                }
                catch {
                    // Fall through.
                }
            }
            if (providerLower === 'hdstream4u' && !sourceId) {
                throw new Error('HDStream4u: no episode ID found for requested TV episode');
            }
            const res = await (0, streamable_1.fetchWithServerFallback)(async (selectedServer) => await tmdb.fetchEpisodeSources(sourceId, mediaId, selectedServer), server, server ? [server] : [extensions_1.StreamingServers.VidCloud, extensions_1.StreamingServers.UpCloud], {
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
            if ((type === 'tv' || type === 'movie') &&
                sourceId &&
                (!providerLower || providerLower === 'flixhq')) {
                try {
                    const queryParts = [`episodeId=${encodeURIComponent(sourceId)}`];
                    if (server)
                        queryParts.push(`server=${encodeURIComponent(server)}`);
                    if (server)
                        queryParts.push('strictServer=true');
                    if (directOnly)
                        queryParts.push('directOnly=true');
                    if (!directOnly)
                        queryParts.push('allowEmbedFallback=true');
                    const delegated = await request.server.inject({
                        method: 'GET',
                        url: `/movies/flixhq/watch?${queryParts.join('&')}`,
                    });
                    if (delegated.statusCode < 400) {
                        const payload = safeJsonParse(delegated.body || '{}');
                        const sources = Array.isArray(payload?.sources) ? payload.sources : [];
                        if (!directOnly ||
                            sources.some((src) => /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(src?.url || '')))) {
                            // Cache watch result for fast subsequent loads
                            if (cacheKey && main_1.redis) {
                                main_1.redis
                                    .setex(cacheKey, main_1.REDIS_TTL, JSON.stringify(payload))
                                    .catch(() => { });
                            }
                            return reply.status(200).send(payload);
                        }
                    }
                }
                catch {
                    // Continue to existing fallbacks below.
                }
            }
            if (type === 'movie' && sourceId) {
                try {
                    const fallback = await (0, movieServerFallback_1.getMovieEmbedFallbackSource)(movieProvider, sourceId, mediaId, server);
                    if (fallback) {
                        // Cache watch result for fast subsequent loads
                        if (cacheKey && main_1.redis) {
                            main_1.redis
                                .setex(cacheKey, main_1.REDIS_TTL, JSON.stringify(fallback))
                                .catch(() => { });
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
