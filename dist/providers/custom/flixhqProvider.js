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
        switch (kind) {
            case 'movie-server':
                return `${this.baseUrl}/ajax/episode/list/${id}`;
            case 'tv-server':
                return `${this.baseUrl}/ajax/episode/servers/${id}`;
            case 'tv':
                return `${this.baseUrl}/ajax/season/episodes/${id}`;
            case 'season':
                return `${this.baseUrl}/ajax/season/list/${id}`;
            default:
                return '';
        }
    }
    static async fetchHome() {
        try {
            const data = await (0, flixhqFetcher_1.fetcher)(`${this.baseUrl}/home`, false, 'flixhq');
            if (!data || !data.success)
                throw new Error('Failed to fetch home');
            return parser.parseHome(cheerio.load(data.text));
        }
        catch (error) {
            return { error: error.message };
        }
    }
    static async search(query, page = 1) {
        if (!query)
            return { error: 'Query is required' };
        try {
            const slugQuery = this.createSlug(query);
            const data = await (0, flixhqFetcher_1.fetcher)(`${this.baseUrl}/search/${slugQuery}?page=${page}`, false, 'flixhq');
            if (!data || !data.success)
                throw new Error('Failed to search');
            return parser.parsePaginatedResults(cheerio.load(data.text), 'div.block_area-content.block_area-list.film_list.film_list-grid div.flw-item');
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
            const mediaPath = mediaId.replace('-', '/');
            const pageRes = await (0, flixhqFetcher_1.fetcher)(`${this.baseUrl}/${mediaPath}`, false, 'flixhq');
            if (!pageRes || !pageRes.success)
                throw new Error('Failed to fetch info page');
            const { data, recommended } = parser.parseInfo(cheerio.load(pageRes.text));
            let episodes = [];
            const internalId = mediaPath.split('-').at(-1);
            if (data.type === 'TV') {
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
                // Fallback for updated FlixHQ markup where season list may already contain
                // first-season episode entries but per-season endpoint returns empty.
                if (!episodes.length) {
                    const fallbackEpisodes = parser.parseEpisodes(cheerio.load(seasonsRes.text), 1, mediaId);
                    if (fallbackEpisodes.length) {
                        episodes = fallbackEpisodes;
                    }
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
            return { data, providerEpisodes: episodes, recommended };
        }
        catch (error) {
            return { error: error.message };
        }
    }
    static async fetchServers(episodeId) {
        if (!episodeId)
            return { error: 'episodeId is required' };
        try {
            const rawEpisodeId = String(episodeId || '').trim();
            const isExplicitTvEpisode = rawEpisodeId.includes('-episode-');
            const isExplicitMovie = rawEpisodeId.includes('movie');
            const isNumericId = /^\d+$/.test(rawEpisodeId);
            const modeOrder = isExplicitTvEpisode
                ? ['tv', 'movie']
                : isExplicitMovie || isNumericId
                    ? ['movie', 'tv']
                    : ['movie', 'tv'];
            let servers = [];
            let resolvedKind = modeOrder[0];
            let lastError = null;
            for (const mode of modeOrder) {
                try {
                    if (mode === 'movie') {
                        const id = rawEpisodeId.split('-').at(-1) || rawEpisodeId;
                        const referer = rawEpisodeId.includes('-')
                            ? `${this.baseUrl}/watch-${rawEpisodeId.replace('-', '/')}`
                            : `${this.baseUrl}/movie`;
                        const res = await (0, flixhqFetcher_1.fetcher)(this.buildAjaxUrl(id, 'movie-server'), false, 'flixhq', {
                            headers: {
                                'X-Requested-With': 'XMLHttpRequest',
                                Referer: referer,
                            },
                        });
                        if (!res || !res.success)
                            throw new Error('Failed to fetch movie servers');
                        const parsedServers = parser.parseServers(cheerio.load(res.text));
                        if (Array.isArray(parsedServers) && parsedServers.length > 0) {
                            servers = parsedServers;
                            resolvedKind = 'movie';
                            break;
                        }
                        throw new Error('No movie servers found');
                    }
                    const parts = rawEpisodeId.split('-episode-');
                    const id = parts.at(1) || rawEpisodeId;
                    const referer = rawEpisodeId.includes('-episode-')
                        ? `${this.baseUrl}/watch-${parts.at(0)?.replace('-', '/')}`
                        : `${this.baseUrl}/tv-show`;
                    const res = await (0, flixhqFetcher_1.fetcher)(this.buildAjaxUrl(id, 'tv-server'), false, 'flixhq', {
                        headers: {
                            'X-Requested-With': 'XMLHttpRequest',
                            Referer: referer,
                        },
                    });
                    if (!res || !res.success)
                        throw new Error('Failed to fetch tv servers');
                    const parsedServers = parser.parseServers(cheerio.load(res.text));
                    if (Array.isArray(parsedServers) && parsedServers.length > 0) {
                        servers = parsedServers;
                        resolvedKind = 'tv';
                        break;
                    }
                    throw new Error('No tv servers found');
                }
                catch (err) {
                    lastError = err;
                }
            }
            if (!servers.length) {
                throw lastError || new Error('Failed to fetch servers');
            }
            const preferred = servers.filter((s) => ['upcloud', 'megacloud', 'vidcloud', 'rabbitstream'].includes(String(s?.serverName || '').toLowerCase()));
            return { data: preferred.length ? preferred : servers, kind: resolvedKind };
        }
        catch (error) {
            return { error: error.message };
        }
    }
    static async fetchSources(episodeId, server = 'megacloud') {
        if (episodeId.startsWith('http')) {
            const serverUrl = new URL(episodeId);
            try {
                const sources = await this.extractor.extract(serverUrl, `${this.baseUrl}/`);
                return {
                    headers: { Referer: `${serverUrl.origin}/` },
                    sources: sources.sources || [],
                    subtitles: sources.subtitles || [],
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
            const priorityOrder = Array.from(new Set([server, 'megacloud', 'upcloud', 'vidcloud', 'rabbitstream'].map((v) => String(v || '').toLowerCase())));
            const prioritizedServers = [
                ...priorityOrder
                    .map((name) => servers.find((s) => String(s?.serverName || '').toLowerCase() === name))
                    .filter(Boolean),
                ...servers.filter((s) => !priorityOrder.includes(String(s?.serverName || '').toLowerCase())),
            ];
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
            let lastError = null;
            for (const selectedServer of prioritizedServers) {
                try {
                    const refererCandidates = [`${refererPath}.${selectedServer.serverId}`, `${watchRefererPath}.${selectedServer.serverId}`];
                    let embedData = null;
                    for (const referer of refererCandidates) {
                        const embedRes = await (0, flixhqFetcher_1.fetcher)(`${this.baseUrl}/ajax/episode/sources/${selectedServer.serverId}`, false, 'flixhq', {
                            headers: {
                                'X-Requested-With': 'XMLHttpRequest',
                                Referer: referer,
                            },
                        });
                        if (!embedRes || !embedRes.success)
                            continue;
                        try {
                            const parsed = JSON.parse(embedRes.text);
                            if (parsed?.link) {
                                embedData = parsed;
                                break;
                            }
                        }
                        catch {
                            // Try next referer candidate.
                        }
                    }
                    if (!embedData?.link)
                        throw new Error('Failed to get embed link from AJAX');
                    const extracted = await this.fetchSources(embedData.link, selectedServer.serverName || server);
                    const sourceCount = Array.isArray(extracted?.sources) ? extracted.sources.length : 0;
                    if (sourceCount > 0) {
                        return extracted;
                    }
                    lastError = new Error(`No playable sources from server ${String(selectedServer?.serverName || 'unknown')}`);
                }
                catch (err) {
                    lastError = err;
                }
            }
            throw lastError || new Error('No playable source extracted');
        }
        catch (error) {
            return { error: error.message };
        }
    }
}
exports.FlixHQProvider = FlixHQProvider;
FlixHQProvider.baseUrl = 'https://flixhq.to';
FlixHQProvider.extractor = new vidcloud_1.VidCloud();
