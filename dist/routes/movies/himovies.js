"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const extensions_1 = require("@consumet/extensions");
const models_1 = require("@consumet/extensions/dist/models");
const cache_1 = __importDefault(require("../../utils/cache"));
const main_1 = require("../../main");
const streamable_1 = require("../../utils/streamable");
const provider_1 = require("../../utils/provider");
const movieServerFallback_1 = require("../../utils/movieServerFallback");
const embedToDirect_1 = require("../../utils/embedToDirect");
const browserRuntimeExtractor_1 = require("../../utils/browserRuntimeExtractor");
const isDirectMediaUrl = (value) => /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(value || '')) || /\/m3u8-proxy\?/i.test(String(value || ''));
const sourceRank = (source) => {
    const url = String(source?.url || '').toLowerCase();
    let score = 0;
    if (/\.m3u8(\?|$)/.test(url) || /m3u8-proxy/.test(url))
        score += 3000;
    else if (/\.mpd(\?|$)/.test(url))
        score += 2000;
    else if (/\.mp4(\?|$)/.test(url))
        score += 1000;
    return score;
};
const sortAndDedupDirect = (rawSources) => {
    const direct = (Array.isArray(rawSources) ? rawSources : []).filter((s) => isDirectMediaUrl(String(s?.url || '')));
    const deduped = direct.filter((item, idx, arr) => arr.findIndex((v) => String(v?.url || '') === String(item?.url || '')) === idx);
    deduped.sort((a, b) => sourceRank(b) - sourceRank(a));
    return deduped;
};
const routes = async (fastify, options) => {
    const himovies = (0, provider_1.configureProvider)(new extensions_1.MOVIES.HiMovies());
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: `Welcome to the himovies provider: check out the provider's website @ ${himovies.toString.baseUrl}`,
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
            documentation: 'https://docs.consumet.org/#tag/himovies',
        });
    });
    fastify.get('/:query', async (request, reply) => {
        const query = decodeURIComponent(request.params.query);
        const page = request.query.page;
        let res = main_1.redis
            ? await cache_1.default.fetch(main_1.redis, `himovies:${query}:${page}`, async () => await himovies.search(query, page ? page : 1), main_1.REDIS_TTL)
            : await himovies.search(query, page ? page : 1);
        reply.status(200).send(res);
    });
    fastify.get('/recent-shows', async (request, reply) => {
        let res = main_1.redis
            ? await cache_1.default.fetch(main_1.redis, `himovies:recent-shows`, async () => await himovies.fetchRecentTvShows(), main_1.REDIS_TTL)
            : await himovies.fetchRecentTvShows();
        reply.status(200).send(res);
    });
    fastify.get('/recent-movies', async (request, reply) => {
        let res = main_1.redis
            ? await cache_1.default.fetch(main_1.redis, `himovies:recent-movies`, async () => await himovies.fetchRecentMovies(), main_1.REDIS_TTL)
            : await himovies.fetchRecentMovies();
        reply.status(200).send(res);
    });
    fastify.get('/trending', async (request, reply) => {
        const type = request.query.type;
        try {
            if (!type) {
                const res = {
                    results: [
                        ...(await himovies.fetchTrendingMovies()),
                        ...(await himovies.fetchTrendingTvShows()),
                    ],
                };
                return reply.status(200).send(res);
            }
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `himovies:trending:${type}`, async () => type === 'tv'
                    ? await himovies.fetchTrendingTvShows()
                    : await himovies.fetchTrendingMovies(), main_1.REDIS_TTL)
                : type === 'tv'
                    ? await himovies.fetchTrendingTvShows()
                    : await himovies.fetchTrendingMovies();
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({
                message: 'Something went wrong. Please try again later. or contact the developers.',
            });
        }
    });
    fastify.get('/info', async (request, reply) => {
        const id = request.query.id;
        if (typeof id === 'undefined')
            return reply.status(400).send({
                message: 'id is required',
            });
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `himovies:info:${id}`, async () => await himovies.fetchMediaInfo(id), main_1.REDIS_TTL)
                : await himovies.fetchMediaInfo(id);
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({
                message: 'Something went wrong. Please try again later. or contact the developers.',
            });
        }
    });
    fastify.get('/watch', async (request, reply) => {
        const episodeId = request.query.episodeId;
        const mediaId = request.query.mediaId;
        const server = request.query.server;
        if (typeof episodeId === 'undefined')
            return reply.status(400).send({ message: 'episodeId is required' });
        if (typeof mediaId === 'undefined')
            return reply.status(400).send({ message: 'mediaId is required' });
        if (server && !Object.values(models_1.StreamingServers).includes(server))
            return reply.status(400).send({ message: 'Invalid server query' });
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `himovies:watch:${episodeId}:${mediaId}:${server}`, async () => await (0, streamable_1.fetchWithServerFallback)(async (selectedServer) => await himovies.fetchEpisodeSources(episodeId, mediaId, selectedServer), server, streamable_1.MOVIE_SERVER_FALLBACKS), main_1.REDIS_TTL)
                : await (0, streamable_1.fetchWithServerFallback)(async (selectedServer) => await himovies.fetchEpisodeSources(episodeId, mediaId, selectedServer), server, streamable_1.MOVIE_SERVER_FALLBACKS);
            const promoted = await (0, embedToDirect_1.promoteEmbedSourcesToDirect)(himovies, res, server);
            const currentSources = Array.isArray(promoted?.sources)
                ? promoted.sources
                : [];
            let directSources = sortAndDedupDirect(currentSources);
            if (directSources.length === 0) {
                const embedCandidates = new Set();
                if (typeof promoted?.embedURL === 'string' && promoted.embedURL.trim()) {
                    embedCandidates.add(promoted.embedURL.trim());
                }
                for (const sourceEntry of currentSources) {
                    const u = String(sourceEntry?.url || '').trim();
                    if (!u || isDirectMediaUrl(u))
                        continue;
                    if (/^https?:\/\//i.test(u))
                        embedCandidates.add(u);
                }
                for (const embedUrl of [...embedCandidates].slice(0, 3)) {
                    const extracted = await (0, browserRuntimeExtractor_1.extractDirectSourcesWithPlaywright)(embedUrl, String(promoted?.headers?.Referer || episodeId), 15000);
                    if (extracted.length > 0) {
                        directSources = sortAndDedupDirect(extracted);
                        if (directSources.length > 0)
                            break;
                    }
                }
            }
            if (directSources.length === 0) {
                throw new Error('No direct playable source found (embed-only sources were skipped).');
            }
            reply.status(200).send({
                ...promoted,
                sources: directSources,
                embedURL: undefined,
            });
        }
        catch (err) {
            try {
                const fallback = await (0, movieServerFallback_1.getMovieEmbedFallbackSource)(himovies, episodeId, mediaId, server);
                if (fallback) {
                    const promotedFallback = await (0, embedToDirect_1.promoteEmbedSourcesToDirect)(himovies, fallback, server);
                    const directFallback = sortAndDedupDirect(promotedFallback?.sources || []);
                    if (directFallback.length > 0) {
                        return reply.status(200).send({
                            ...promotedFallback,
                            sources: directFallback,
                            embedURL: undefined,
                        });
                    }
                }
            }
            catch {
                // Ignore fallback errors and return the original extraction error below.
            }
            const message = err instanceof Error ? err.message : String(err);
            reply.status(404).send({ message });
        }
    });
    fastify.get('/servers', async (request, reply) => {
        const episodeId = request.query.episodeId;
        const mediaId = request.query.mediaId;
        if (typeof episodeId === 'undefined')
            return reply.status(400).send({ message: 'episodeId is required' });
        if (typeof mediaId === 'undefined')
            return reply.status(400).send({ message: 'mediaId is required' });
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `himovies:servers:${episodeId}:${mediaId}`, async () => await himovies.fetchEpisodeServers(episodeId, mediaId), main_1.REDIS_TTL)
                : await himovies.fetchEpisodeServers(episodeId, mediaId);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({
                message: 'Something went wrong. Please try again later. or contact the developers.',
            });
        }
    });
    fastify.get('/country/:country', async (request, reply) => {
        const country = request.params.country;
        const page = request.query.page ?? 1;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `himovies:country:${country}:${page}`, async () => await himovies.fetchByCountry(country, page), main_1.REDIS_TTL)
                : await himovies.fetchByCountry(country, page);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({
                message: 'Something went wrong. Please try again later. or contact the developers.',
            });
        }
    });
    fastify.get('/genre/:genre', async (request, reply) => {
        const genre = request.params.genre;
        const page = request.query.page ?? 1;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `himovies:genre:${genre}:${page}`, async () => await himovies.fetchByGenre(genre, page), main_1.REDIS_TTL)
                : await himovies.fetchByGenre(genre, page);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({
                message: 'Something went wrong. Please try again later. or contact the developers.',
            });
        }
    });
};
exports.default = routes;
