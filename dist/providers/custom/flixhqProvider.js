"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlixHQProvider = void 0;
const cheerio = __importStar(require("cheerio"));
const flixhqFetcher_1 = require("../../utils/flixhqFetcher");
const vidcloud_1 = require("../../utils/vidcloud");
const parser = __importStar(require("../../utils/flixhqParser"));
const browserRuntimeExtractor_1 = require("../../utils/browserRuntimeExtractor");
// Simple in-memory cache with TTL to reduce repeated slow network/workflow calls
class SimpleCache {
    constructor() {
        this.map = new Map();
    }
    get(key) {
        const entry = this.map.get(key);
        if (!entry)
            return null;
        if (Date.now() > entry.expires) {
            this.map.delete(key);
            return null;
        }
        return entry.value;
    }
    set(key, value, ttlMs) {
        this.map.set(key, { value, expires: Date.now() + ttlMs });
    }
}
const cache = new SimpleCache();
const readPositiveNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};
const getEmbedExtractionTimeoutMs = (serverName, requestedTimeoutMs) => {
    const requested = readPositiveNumber(requestedTimeoutMs);
    if (requested)
        return Math.max(12000, requested);
    const server = String(serverName || '').toLowerCase();
    const envTimeout = readPositiveNumber(server === 'videasy'
        ? process.env.FLIXHQ_VIDEASY_EXTRACTION_TIMEOUT_MS
        : process.env.FLIXHQ_PLAYWRIGHT_TIMEOUT_MS || process.env.FLIXHQ_EXTRACTION_TIMEOUT_MS);
    if (envTimeout)
        return Math.max(12000, envTimeout);
    return server === 'videasy' ? 60000 : 30000;
};
const getServerExtractionTimeoutMs = (serverName) => {
    const server = String(serverName || '').toLowerCase();
    const envTimeout = readPositiveNumber(process.env.FLIXHQ_SERVER_EXTRACTION_TIMEOUT_MS);
    if (envTimeout)
        return Math.max(8000, envTimeout);
    return server === 'videasy' ? 70000 : 45000;
};
class FlixHQProvider {
    static createSlug(text) {
        return text
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }
    static buildAjaxUrl(id, kind) {
        // New endpoint uses /ajax/ajax.php with POST
        return `${this.baseUrl}/ajax/ajax.php`;
    }
    static getAjaxAction(kind) {
        switch (kind) {
            case 'movie-server':
                return 'movie-server';
            case 'tv-server':
                return 'tv-server';
            case 'tv-episodes':
                return 'season-episodes';
            case 'season-list':
                return 'season-list';
            default:
                return '';
        }
    }
    static getAjaxHeaders(referer) {
        return {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Referer: referer || `${this.baseUrl}/home`,
            Origin: this.baseUrl,
        };
    }
    static normalizeEpisodePath(episodeId) {
        const raw = String(episodeId || '').trim().replace(/^\/+/, '');
        if (raw.startsWith('http')) {
            try {
                return new URL(raw).pathname.replace(/^\/+/, '');
            }
            catch {
                return raw;
            }
        }
        if (raw.startsWith('episode-'))
            return raw.replace(/^episode-/, 'episode/');
        if (raw.startsWith('watch-movie-'))
            return raw.replace(/^watch-movie-/, 'watch-movie/');
        if (raw.startsWith('watch-series-'))
            return raw.replace(/^watch-series-/, 'watch-series/');
        return raw;
    }
    static buildWatchPageUrl(episodeId) {
        const rawEpisodeId = String(episodeId || '').trim();
        const normalizedPath = this.normalizeEpisodePath(rawEpisodeId);
        if (/^https?:\/\//i.test(rawEpisodeId)) {
            return {
                pageUrl: rawEpisodeId,
                kind: /\/(?:episode|watch-series)\//i.test(rawEpisodeId) ? 'tv' : 'movie',
            };
        }
        if (normalizedPath.startsWith('episode/')) {
            return {
                pageUrl: `${this.baseUrl}/${normalizedPath.replace(/\/?$/, '/')}`,
                kind: 'tv',
            };
        }
        if (normalizedPath.startsWith('watch-series/')) {
            return {
                pageUrl: `${this.baseUrl}/${normalizedPath.replace(/\/?$/, '/')}`,
                kind: 'tv',
            };
        }
        if (normalizedPath.startsWith('watch-movie/')) {
            return {
                pageUrl: `${this.baseUrl}/${normalizedPath.replace(/\/?$/, '/')}`,
                kind: 'movie',
            };
        }
        if (rawEpisodeId.startsWith('series-')) {
            const seriesSlug = rawEpisodeId
                .split('-episode-')[0]
                .replace(/^series-/, '')
                .replace(/-watch-online$/, '');
            return {
                pageUrl: `${this.baseUrl}/watch-series/${seriesSlug}-watch-online/`,
                kind: 'tv',
            };
        }
        const slug = rawEpisodeId.replace(/^movie-/, '').replace(/-watch-online$/, '');
        return {
            pageUrl: `${this.baseUrl}/watch-movie/${slug}-watch-online/`,
            kind: 'movie',
        };
    }
    static parseServerJson(text) {
        let payload;
        try {
            payload = JSON.parse(text);
        }
        catch {
            return null;
        }
        const list = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : payload ? [payload] : [];
        const servers = list
            .map((server, index) => {
            const link = String(server?.link || server?.url || server?.src || '').trim();
            const name = String(server?.name || server?.serverName || `Server ${index + 1}`).trim();
            if (!link)
                return null;
            return {
                serverId: link,
                serverName: name.toLowerCase(),
                serverUrl: link,
                link,
                enSub: server?.en_sub,
            };
        })
            .filter(Boolean);
        return servers.length ? servers : null;
    }
    static isUsableSourceUrl(value) {
        const raw = String(value || '').trim();
        if (!raw || /^blob:/i.test(raw))
            return false;
        try {
            const parsed = new URL(raw);
            const host = parsed.hostname.toLowerCase();
            if (host === 'example.com' || host.endsWith('.example.com'))
                return false;
            if (host === 'voorbeeld.com' || host.endsWith('.voorbeeld.com'))
                return false;
            if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0')
                return false;
            if (host.includes('placeholder') || host.includes('dummy'))
                return false;
            if (/\/video\.mp4$/i.test(parsed.pathname) && /voorbeeld|sample|placeholder|dummy/i.test(raw))
                return false;
            return true;
        }
        catch {
            return false;
        }
    }
    static isDirectMediaUrl(value) {
        const normalized = String(value || '');
        return /\.(m3u8|mp4|mpd)(\?|$)/i.test(normalized) && !/\/m3u8-proxy\?|\/utils\/proxy\?/i.test(normalized);
    }
    static normalizeSources(sources = []) {
        const seen = new Set();
        const filtered = sources
            .filter((source) => this.isUsableSourceUrl(source?.url) && this.isDirectMediaUrl(source?.url))
            .filter((source) => {
            const url = String(source?.url || '');
            if (seen.has(url))
                return false;
            seen.add(url);
            return true;
        });
        const hasMasterForBase = new Set(filtered
            .map((source) => String(source?.url || ''))
            .filter((url) => /\/master\.m3u8(?:\?|$)/i.test(url))
            .map((url) => url.replace(/\/master\.m3u8(?:\?.*)?$/i, '')));
        return filtered
            .filter((source) => {
            const url = String(source?.url || '');
            const base = url.replace(/\/index-[^/]+\.m3u8(?:\?.*)?$/i, '');
            return !hasMasterForBase.has(base) || /\/master\.m3u8(?:\?|$)/i.test(url);
        })
            .sort((a, b) => {
            const score = (source) => {
                const url = String(source?.url || '');
                const serverLabel = String(source?.server || source?.quality || '').toLowerCase();
                return ((/\.m3u8(?:\?|$)/i.test(url) || source?.isM3U8 ? 80 : 0) +
                    (/\/master\.m3u8(?:\?|$)/i.test(url) ? 25 : 0) +
                    (/\/index\.m3u8(?:\?|$)/i.test(url) ? 15 : 0) +
                    (/\.mp4(?:\?|$)/i.test(url) ? 20 : 0) +
                    (/hydrogen/.test(serverLabel) ? 35 : 0) +
                    (/lithium/.test(serverLabel) ? 30 : 0) +
                    (/helium/.test(serverLabel) ? 15 : 0) -
                    (/oxygen/.test(serverLabel) ? 40 : 0));
            };
            return score(b) - score(a);
        });
    }
    static normalizeSubtitles(subtitles = []) {
        const seen = new Set();
        return subtitles
            .map((subtitle) => {
            const url = String(subtitle?.url || subtitle?.file || subtitle?.src || '').trim();
            if (!this.isUsableSourceUrl(url) || !/\.(vtt|srt|ass)(\?|$)/i.test(url))
                return null;
            return {
                url,
                lang: String(subtitle?.lang || subtitle?.label || subtitle?.language || 'Unknown'),
                kind: subtitle?.kind || 'captions',
                default: Boolean(subtitle?.default),
            };
        })
            .filter(Boolean)
            .filter((subtitle) => {
            if (seen.has(subtitle.url))
                return false;
            seen.add(subtitle.url);
            return true;
        });
    }
    static async fetchHome() {
        try {
            const cacheKey = `flixhq:home`;
            const cached = cache.get(cacheKey);
            if (cached)
                return cached;
            const data = await (0, flixhqFetcher_1.fetcher)(`${this.baseUrl}/home`, false, 'flixhq');
            if (!data || !data.success)
                throw new Error('Failed to fetch home');
            const parsed = parser.parseHome(cheerio.load(data.text));
            cache.set(cacheKey, parsed, 1000 * 60 * 5); // cache 5 minutes
            return parsed;
        }
        catch (error) {
            return { error: error.message };
        }
    }
    static async search(query, page = 1) {
        if (!query)
            return { error: 'Query is required' };
        try {
            const params = new URLSearchParams();
            params.set('keyword', query);
            params.set('page', String(page || 1));
            const cacheKey = `flixhq:search:${query}:${page}`;
            const cached = cache.get(cacheKey);
            if (cached)
                return cached;
            const data = await (0, flixhqFetcher_1.fetcher)(`${this.baseUrl}/search?${params.toString()}`, false, 'flixhq');
            if (!data || !data.success)
                throw new Error('Failed to search');
            const parsed = parser.parsePaginatedResults(cheerio.load(data.text), 'div.block_area-content.block_area-list.film_list.film_list-grid div.flw-item');
            cache.set(cacheKey, parsed, 1000 * 60 * 5);
            return parsed;
        }
        catch (error) {
            return { error: error.message };
        }
    }
    static async searchSuggestions(query) {
        if (!query)
            return { error: 'Query is required' };
        try {
            const params = new URLSearchParams();
            params.append('keyword', query);
            const data = await (0, flixhqFetcher_1.fetcher)(`${this.baseUrl}/ajax/search`, false, 'flixhq', {
                method: 'POST',
                data: params.toString(),
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    Referer: `${this.baseUrl}/home`,
                    Origin: this.baseUrl,
                },
            });
            if (!data || !data.success)
                throw new Error('Failed to get suggestions');
            return parser.parseSearchSuggestions(cheerio.load(data.text));
        }
        catch (error) {
            return { error: error.message };
        }
    }
    static async fetchPopularMovies(page = 1) {
        try {
            const data = await (0, flixhqFetcher_1.fetcher)(`${this.baseUrl}/movie?page=${page}`, false, 'flixhq');
            if (!data || !data.success)
                throw new Error('Failed to fetch movies');
            return parser.parsePaginatedResults(cheerio.load(data.text), 'div.block_area-content.block_area-list.film_list.film_list-grid div.flw-item');
        }
        catch (error) {
            return { error: error.message };
        }
    }
    static async fetchPopularTv(page = 1) {
        try {
            const data = await (0, flixhqFetcher_1.fetcher)(`${this.baseUrl}/tv-show?page=${page}`, false, 'flixhq');
            if (!data || !data.success)
                throw new Error('Failed to fetch TV');
            return parser.parsePaginatedResults(cheerio.load(data.text), 'div.block_area-content.block_area-list.film_list.film_list-grid div.flw-item');
        }
        catch (error) {
            return { error: error.message };
        }
    }
    static async fetchTopMovies(page = 1) {
        try {
            const data = await (0, flixhqFetcher_1.fetcher)(`${this.baseUrl}/top-imdb?type=movie&page=${page}`, false, 'flixhq');
            if (!data || !data.success)
                throw new Error('Failed to fetch movies');
            return parser.parsePaginatedResults(cheerio.load(data.text), 'div.block_area-content.block_area-list.film_list.film_list-grid div.flw-item');
        }
        catch (error) {
            return { error: error.message };
        }
    }
    static async fetchTopTv(page = 1) {
        try {
            const data = await (0, flixhqFetcher_1.fetcher)(`${this.baseUrl}/top-imdb?type=tv&page=${page}`, false, 'flixhq');
            if (!data || !data.success)
                throw new Error('Failed to fetch TV');
            return parser.parsePaginatedResults(cheerio.load(data.text), 'div.block_area-content.block_area-list.film_list.film_list-grid div.flw-item');
        }
        catch (error) {
            return { error: error.message };
        }
    }
    static async fetchUpcoming(page = 1) {
        try {
            const data = await (0, flixhqFetcher_1.fetcher)(`${this.baseUrl}/coming-soon?page=${page}`, false, 'flixhq');
            if (!data || !data.success)
                throw new Error('Failed to fetch upcoming');
            return parser.parsePaginatedResults(cheerio.load(data.text), 'div.block_area-content.block_area-list.film_list.film_list-grid div.flw-item');
        }
        catch (error) {
            return { error: error.message };
        }
    }
    static async fetchMediaInfo(mediaId) {
        if (!mediaId)
            return { error: 'mediaId is required' };
        try {
            const cacheKey = `flixhq:info:${mediaId}`;
            const cached = cache.get(cacheKey);
            if (cached)
                return cached;
            // Reconstruct the media path from the ID
            // IDs are formatted as: watch-[type]-[slug]
            // We need to convert to: watch-[type]/[slug]
            const mediaPath = mediaId
                .replace(/^watch-movie-/, 'watch-movie/')
                .replace(/^watch-series-/, 'watch-series/');
            const pageRes = await (0, flixhqFetcher_1.fetcher)(`${this.baseUrl}/${mediaPath}`, false, 'flixhq');
            if (!pageRes || !pageRes.success)
                throw new Error('Failed to fetch info page');
            const { data, recommended } = parser.parseInfo(cheerio.load(pageRes.text));
            let episodes = [];
            const internalId = mediaPath.split('/').pop()?.split('-').at(-1);
            if (data.type === 'TV') {
                const pageEpisodes = parser.parseEpisodes(cheerio.load(pageRes.text), 1, mediaId);
                if (pageEpisodes.length)
                    episodes = pageEpisodes;
                if (!episodes.length) {
                    const seasonsRes = await (0, flixhqFetcher_1.fetcher)(this.buildAjaxUrl(internalId, 'season'), false, 'flixhq', {
                        headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: `${this.baseUrl}/${mediaPath}` },
                    });
                    if (!seasonsRes || !seasonsRes.success)
                        throw new Error('Failed to fetch seasons');
                    const seasons = parser.parseSeasons(cheerio.load(seasonsRes.text));
                    const seasonEpisodeLists = await Promise.all(seasons.map(async ({ seasonId, seasonNumber }) => {
                        const epRes = await (0, flixhqFetcher_1.fetcher)(this.buildAjaxUrl(seasonId, 'tv'), false, 'flixhq', {
                            headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: `${this.baseUrl}/${mediaPath}` },
                        });
                        if (!epRes || !epRes.success)
                            return [];
                        return parser.parseEpisodes(cheerio.load(epRes.text), seasonNumber, mediaId);
                    }));
                    episodes = seasonEpisodeLists.flat();
                }
            }
            else {
                episodes = [
                    {
                        episodeId: data.id?.replace('watch-', '') || mediaId.replace('watch-', ''),
                        title: data.name,
                        episodeNumber: 1,
                        seasonNumber: 0,
                    },
                ];
            }
            const result = { data, providerEpisodes: episodes, recommended };
            cache.set(cacheKey, result, 1000 * 60 * 5); // cache media info for 5 minutes
            return result;
        }
        catch (error) {
            return { error: error.message };
        }
    }
    static async fetchServers(episodeId) {
        if (!episodeId)
            return { error: 'episodeId is required' };
        try {
            const cacheKey = `flixhq:servers:${episodeId}`;
            const cached = cache.get(cacheKey);
            if (cached)
                return cached;
            console.log(`[FlixHQ] fetchServers: episodeId=${episodeId}`);
            const { pageUrl, kind } = this.buildWatchPageUrl(episodeId);
            console.log(`[FlixHQ] Watch page URL: ${pageUrl}, kind=${kind}`);
            const pageData = await (0, flixhqFetcher_1.fetcher)(pageUrl, false, 'flixhq', { timeout: 10000 });
            if (!pageData || !pageData.success) {
                console.log(`[FlixHQ] Failed to fetch page: ${pageData?.status || 'unknown'}`);
                throw new Error('Failed to fetch movie/series page');
            }
            const $ = cheerio.load(pageData.text);
            const token = $('#series-player').attr('data-token') ||
                $('.w_b-player[data-token]').attr('data-token') ||
                $('.watch_block[data-token]').attr('data-token') ||
                $('[data-token]').first().attr('data-token');
            console.log(`[FlixHQ] Token extracted: ${token ? 'yes' : 'no'}`);
            if (!token)
                throw new Error('Could not extract players token from page');
            const fieldName = kind === 'tv' ||
                $('#series-player').length > 0 ||
                String($('.watch_block').attr('data-type') || '') === '1'
                ? 'players_show'
                : 'players';
            console.log(`[FlixHQ] Field name: ${fieldName}`);
            const url = this.buildAjaxUrl('', '');
            const formData = new URLSearchParams();
            formData.append(fieldName, token);
            console.log(`[FlixHQ] Sending AJAX POST to ${url} with fieldName=${fieldName}`);
            const res = await (0, flixhqFetcher_1.fetcher)(url, false, 'flixhq', {
                method: 'POST',
                headers: this.getAjaxHeaders(pageUrl),
                data: formData.toString(),
                timeout: 8000,
            });
            if (!res || !res.success) {
                console.log(`[FlixHQ] AJAX failed: status=${res?.status}`);
                throw new Error('Failed to fetch players');
            }
            console.log(`[FlixHQ] AJAX response: ${res.text.substring(0, 300)}`);
            const parsedServers = this.parseServerJson(res.text) || parser.parseServers(cheerio.load(res.text));
            console.log(`[FlixHQ] Parsed servers: ${Array.isArray(parsedServers) ? parsedServers.length : 0} servers`);
            if (Array.isArray(parsedServers) && parsedServers.length > 0) {
                console.log(`[FlixHQ] Server names: ${parsedServers.map((s) => s?.serverName).join(', ')}`);
            }
            if (!Array.isArray(parsedServers) || parsedServers.length === 0) {
                throw new Error('No servers found for players');
            }
            const preferred = parsedServers.filter((s) => ['videasy', 'vidking', 'upcloud', 'megacloud', 'vidcloud', 'rabbitstream', 'flixhq'].includes(String(s?.serverName || '').toLowerCase()));
            const result = { data: preferred.length ? preferred : parsedServers, kind };
            cache.set(cacheKey, result, 1000 * 30); // cache servers for 30s
            return result;
        }
        catch (error) {
            console.error(`[FlixHQ] fetchServers error: ${error.message}`);
            return { error: error.message };
        }
    }
    static async fetchSources(episodeId, server = 'vidking', strictServer = false, options = {}) {
        const requestedServerRaw = String(server || '').toLowerCase();
        const requestedVidkingMirror = this.vidkingMirrors.includes(requestedServerRaw)
            ? requestedServerRaw
            : String(options.preferredMirror || '').toLowerCase();
        if (episodeId.startsWith('http')) {
            const serverUrl = new URL(episodeId);
            try {
                let sources = null;
                try {
                    sources = await this.extractor.extract(serverUrl, `${this.baseUrl}/`);
                }
                catch {
                    sources = null;
                }
                if (!Array.isArray(sources?.sources) || sources.sources.length === 0) {
                    const playback = await (0, browserRuntimeExtractor_1.extractPlaybackWithPlaywright)(serverUrl.href, `${this.baseUrl}/`, getEmbedExtractionTimeoutMs(requestedServerRaw, options.extractionTimeoutMs), { preferredMirror: requestedVidkingMirror });
                    if (playback.sources.length || playback.subtitles.length) {
                        sources = { sources: playback.sources, subtitles: playback.subtitles };
                    }
                }
                const normalizedSources = this.normalizeSources(sources?.sources || []);
                const normalizedSubtitles = this.normalizeSubtitles(sources?.subtitles || []);
                if (!normalizedSources.length) {
                    return {
                        headers: { Referer: `${serverUrl.origin}/` },
                        sources: [],
                        subtitles: normalizedSubtitles,
                    };
                }
                return {
                    headers: { Referer: `${serverUrl.origin}/` },
                    sources: normalizedSources,
                    subtitles: normalizedSubtitles,
                };
            }
            catch (error) {
                return { error: error.message };
            }
        }
        try {
            const serversRes = await this.fetchServers(episodeId);
            if (serversRes.error)
                throw new Error(serversRes.error);
            const servers = Array.isArray(serversRes.data) ? serversRes.data : [];
            if (!servers.length)
                throw new Error('No supported server found');
            const requestedServer = requestedServerRaw;
            const requestedFlixhqServer = requestedVidkingMirror ? 'vidking' : requestedServer;
            const availableServerNames = new Set(servers.map((s) => String(s?.serverName || '').toLowerCase()));
            const priorityOrder = Array.from(new Set([
                availableServerNames.has(requestedFlixhqServer) ? requestedFlixhqServer : '',
                'vidking',
                'videasy',
                'megacloud',
                'vidcloud',
                'upcloud',
                'flixhq',
                'rabbitstream',
            ].filter(Boolean)));
            const prioritizedServers = strictServer && requestedServer
                ? servers.filter((s) => String(s?.serverName || '').toLowerCase() === requestedFlixhqServer)
                : [
                    ...priorityOrder
                        .map((name) => servers.find((s) => String(s?.serverName || '').toLowerCase() === name))
                        .filter(Boolean),
                    ...servers.filter((s) => !priorityOrder.includes(String(s?.serverName || '').toLowerCase())),
                ];
            if (!prioritizedServers.length) {
                throw new Error(`Requested server ${requestedServer || server} not found`);
            }
            const resolvedKind = String(serversRes?.kind || '').toLowerCase() === 'movie' ? 'movie' : 'tv';
            const refererPath = resolvedKind === 'movie'
                ? (episodeId.includes('-') ? `${this.baseUrl}/${episodeId.replace('-', '/')}` : `${this.baseUrl}/movie`)
                : (episodeId.includes('-episode-')
                    ? `${this.baseUrl}/${episodeId.split('-episode-').at(0)?.replace('-', '/')}`
                    : `${this.baseUrl}/tv-show`);
            const watchRefererPath = resolvedKind === 'movie'
                ? (episodeId.includes('-') ? `${this.baseUrl}/watch-${episodeId.replace('-', '/')}` : `${this.baseUrl}/watch-movie`)
                : (episodeId.includes('-episode-')
                    ? `${this.baseUrl}/watch-${episodeId.split('-episode-').at(0)?.replace('-', '/')}`
                    : `${this.baseUrl}/watch-tv-show`);
            // Try servers in parallel (limited) to find the first working extraction faster.
            const primaryServerName = String(prioritizedServers[0]?.serverName || '').toLowerCase();
            const flixhqServer = servers.find((s) => String(s?.serverName || '').toLowerCase() === 'flixhq');
            const flixhqLink = flixhqServer?.serverUrl || flixhqServer?.link;
            const fallbackSubtitlesPromise = primaryServerName !== 'flixhq' && typeof flixhqLink === 'string' && /^https?:\/\//i.test(flixhqLink)
                ? (0, browserRuntimeExtractor_1.extractPlaybackWithPlaywright)(flixhqLink, `${this.baseUrl}/`, Math.min(15000, getEmbedExtractionTimeoutMs('flixhq')))
                    .then((playback) => this.normalizeSubtitles(playback.subtitles || []))
                    .catch(() => [])
                : Promise.resolve([]);
            const allowEmbedFallback = options.allowEmbedFallback !== false;
            const toEmbedFallback = (selectedServer, liveLink) => ({
                headers: { Referer: `${this.baseUrl}/` },
                sources: [{
                        url: liveLink,
                        quality: 'embed',
                        server: String(selectedServer?.serverName || server || 'embed').toLowerCase(),
                        isM3U8: false,
                        isEmbed: true,
                    }],
                subtitles: [],
            });
            const tryServer = async (selectedServer) => {
                const liveLink = selectedServer.serverUrl || selectedServer.link;
                const serverId = String(selectedServer?.serverId || '').trim();
                const hasAjaxServerId = Boolean(serverId) && !/^https?:\/\//i.test(serverId);
                console.log(`[FlixHQ] tryServer: serverName=${selectedServer?.serverName}, serverId=${selectedServer?.serverId}, liveLink=${typeof liveLink === 'string' ? liveLink.substring(0, 100) : 'N/A'}`);
                // If direct URL to a known player page, try extracting sources quickly (cached)
                if (typeof liveLink === 'string' && /^https?:\/\//i.test(liveLink)) {
                    try {
                        const cacheKey = `flixhq:source:v8:${requestedVidkingMirror || 'auto'}:${liveLink}`;
                        const cached = cache.get(cacheKey);
                        if (cached)
                            return cached;
                        const selectedServerName = String(selectedServer?.serverName || server || '').toLowerCase();
                        const extracted = await this.fetchSources(liveLink, requestedVidkingMirror || selectedServer.serverName || server, strictServer, {
                            allowEmbedFallback: false,
                            extractionTimeoutMs: getEmbedExtractionTimeoutMs(selectedServerName, options.extractionTimeoutMs),
                            preferredMirror: requestedVidkingMirror,
                        });
                        const sourceCount = Array.isArray(extracted?.sources) ? extracted.sources.length : 0;
                        console.log(`[FlixHQ] Direct liveLink extraction: ${sourceCount} sources found`);
                        if (sourceCount > 0) {
                            cache.set(cacheKey, extracted, 1000 * 60); // cache 1 minute
                            return extracted;
                        }
                    }
                    catch (directErr) {
                        console.log(`[FlixHQ] Direct liveLink extraction failed: ${directErr}`);
                    }
                    if (!hasAjaxServerId) {
                        if (allowEmbedFallback && typeof liveLink === 'string' && /^https?:\/\//i.test(liveLink)) {
                            return toEmbedFallback(selectedServer, liveLink);
                        }
                        throw new Error(`No playable sources from direct server ${String(selectedServer?.serverName || 'unknown')}`);
                    }
                }
                if (!hasAjaxServerId) {
                    if (allowEmbedFallback && typeof liveLink === 'string' && /^https?:\/\//i.test(liveLink)) {
                        return toEmbedFallback(selectedServer, liveLink);
                    }
                    throw new Error(`No AJAX server id for ${String(selectedServer?.serverName || 'unknown')}`);
                }
                const refererCandidates = [
                    `${refererPath}.${serverId}`,
                    `${watchRefererPath}.${serverId}`,
                    this.buildWatchPageUrl(episodeId).pageUrl,
                ];
                const ajaxCandidates = Array.from(new Set([
                    `${this.baseUrl}/ajax/episode/sources/${serverId}`,
                    `${this.baseUrl}/ajax/movie/episode/server/sources/${serverId}`,
                ]));
                let embedData = null;
                for (const referer of refererCandidates) {
                    for (const ajaxUrl of ajaxCandidates) {
                        try {
                            console.log(`[FlixHQ] AJAX call: ${ajaxUrl}, referer=${referer.substring(0, 100)}`);
                            const embedRes = await (0, flixhqFetcher_1.fetcher)(ajaxUrl, false, 'flixhq', {
                                headers: {
                                    'X-Requested-With': 'XMLHttpRequest',
                                    Referer: referer,
                                },
                                timeout: 6000,
                            });
                            if (!embedRes || !embedRes.success) {
                                console.log(`[FlixHQ] AJAX failed: success=${embedRes?.success}`);
                                continue;
                            }
                            console.log(`[FlixHQ] AJAX response text: ${embedRes.text.substring(0, 200)}`);
                            try {
                                const parsed = JSON.parse(embedRes.text);
                                console.log(`[FlixHQ] AJAX parsed: ${JSON.stringify(parsed).substring(0, 200)}`);
                                const link = parsed?.link || parsed?.data?.link || parsed?.url || parsed?.data?.url;
                                if (typeof link === 'string' && /^https?:\/\//i.test(link)) {
                                    embedData = { ...parsed, link };
                                    console.log(`[FlixHQ] Found embed link: ${link.substring(0, 100)}`);
                                    break;
                                }
                            }
                            catch (e) {
                                console.log(`[FlixHQ] Failed to parse AJAX JSON: ${e}`);
                                // Try next endpoint/referer candidate.
                            }
                        }
                        catch (e) {
                            console.log(`[FlixHQ] AJAX fetch error: ${e}`);
                            // continue to next candidate
                        }
                        if (embedData?.link)
                            break;
                    }
                    if (embedData?.link)
                        break;
                }
                if (!embedData?.link) {
                    console.log(`[FlixHQ] No embed link found for serverId=${selectedServer?.serverId}`);
                    throw new Error('Failed to get embed link from AJAX');
                }
                const cacheKey = `flixhq:embed:v8:${requestedVidkingMirror || 'auto'}:${embedData.link}`;
                const cachedEmbed = cache.get(cacheKey);
                if (cachedEmbed)
                    return cachedEmbed;
                const selectedServerName = String(selectedServer?.serverName || server || '').toLowerCase();
                const extracted = await this.fetchSources(embedData.link, requestedVidkingMirror || selectedServer.serverName || server, strictServer, {
                    allowEmbedFallback: false,
                    extractionTimeoutMs: getEmbedExtractionTimeoutMs(selectedServerName, options.extractionTimeoutMs),
                    preferredMirror: requestedVidkingMirror,
                });
                const sourceCount = Array.isArray(extracted?.sources) ? extracted.sources.length : 0;
                if (sourceCount > 0) {
                    cache.set(cacheKey, extracted, 1000 * 60); // cache embed extraction 1 minute
                    return extracted;
                }
                if (allowEmbedFallback && typeof embedData.link === 'string' && /^https?:\/\//i.test(embedData.link)) {
                    return toEmbedFallback(selectedServer, embedData.link);
                }
                throw new Error(`No playable sources from server ${String(selectedServer?.serverName || 'unknown')}`);
            };
            const parallelism = Math.max(1, Math.min(Number(process.env.FLIXHQ_SERVER_EXTRACTION_PARALLELISM || 1), prioritizedServers.length));
            const chunks = [];
            for (let i = 0; i < prioritizedServers.length; i += parallelism) {
                chunks.push(prioritizedServers.slice(i, i + parallelism));
            }
            // Wrapper to enforce timeout on each server attempt
            const tryServerWithTimeout = (selectedServer, timeoutMs = 25000) => {
                const liveLink = selectedServer?.serverUrl || selectedServer?.link;
                return Promise.race([
                    tryServer(selectedServer),
                    new Promise((_, reject) => setTimeout(() => reject(new Error(`Server ${selectedServer?.serverName} extraction timeout after ${timeoutMs}ms`)), timeoutMs)),
                ]).catch((error) => {
                    if (allowEmbedFallback && typeof liveLink === 'string' && /^https?:\/\//i.test(liveLink)) {
                        console.log(`[FlixHQ] ${error.message}; falling back to embed for ${selectedServer?.serverName}`);
                        return toEmbedFallback(selectedServer, liveLink);
                    }
                    throw error;
                });
            };
            const requestedServerForTimeout = String(server || '').toLowerCase();
            const serverExtractionTimeoutMs = getServerExtractionTimeoutMs(requestedServerForTimeout);
            const firstSuccessful = async (chunk) => {
                return new Promise((resolve, reject) => {
                    let pending = chunk.length;
                    let lastError = null;
                    for (const s of chunk) {
                        tryServerWithTimeout(s, serverExtractionTimeoutMs)
                            .then(resolve)
                            .catch((e) => {
                            console.error(`[FlixHQ] Server ${s?.serverName} failed:`, e.message);
                            lastError = e;
                            pending -= 1;
                            if (pending === 0)
                                reject(lastError || new Error('All servers failed'));
                        });
                    }
                });
            };
            let lastErr = null;
            for (const chunk of chunks) {
                try {
                    const extracted = await firstSuccessful(chunk);
                    const extractedSubtitles = this.normalizeSubtitles(Array.isArray(extracted?.subtitles) ? extracted.subtitles : []);
                    const fallbackSubtitles = extractedSubtitles.length ? [] : await fallbackSubtitlesPromise;
                    const subtitles = this.normalizeSubtitles([...extractedSubtitles, ...fallbackSubtitles]);
                    return { ...extracted, subtitles };
                }
                catch (error) {
                    lastErr = error;
                }
            }
            throw lastErr || new Error('No playable source extracted');
        }
        catch (error) {
            return { error: error.message };
        }
    }
}
exports.FlixHQProvider = FlixHQProvider;
FlixHQProvider.baseUrl = 'https://flixhq.one';
FlixHQProvider.extractor = new vidcloud_1.VidCloud();
FlixHQProvider.vidkingMirrors = ['hydrogen', 'lithium', 'helium', 'oxygen'];
