"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cache_1 = __importDefault(require("../../utils/cache"));
const main_1 = require("../../main");
const flixhqProvider_1 = require("../../providers/custom/flixhqProvider");
const isDirectMediaUrl = (value) => /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(value || '')) || /\/m3u8-proxy\?/i.test(String(value || ''));
const sortAndLimitSources = (rawSources) => {
    const deduped = rawSources.filter((item, idx, arr) => arr.findIndex((v) => String(v?.url || '') === String(item?.url || '')) === idx);
    const direct = deduped.filter((s) => isDirectMediaUrl(String(s?.url || '')));
    const nonDirect = deduped.filter((s) => !isDirectMediaUrl(String(s?.url || '')));
    return [...direct.slice(0, 8), ...nonDirect.slice(0, 2)];
};
const routes = async (fastify, options) => {
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: `Welcome to the custom FlixHQ provider`,
            routes: [
                '/:query',
                '/info',
                '/watch',
                '/home',
                '/popular-movies',
                '/popular-tv',
                '/top-movies',
                '/top-tv',
                '/upcoming',
                '/servers',
            ],
            documentation: 'https://docs.consumet.org/#tag/flixhq',
        });
    });
    fastify.get('/home', async (request, reply) => {
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:home`, async () => await flixhqProvider_1.FlixHQProvider.fetchHome(), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.fetchHome();
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/:query', async (request, reply) => {
        const query = decodeURIComponent(request.params.query);
        const page = request.query.page || 1;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:search:${query}:${page}`, async () => await flixhqProvider_1.FlixHQProvider.search(query, page), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.search(query, page);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/popular-movies', async (request, reply) => {
        const page = request.query.page || 1;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:popular-movies:${page}`, async () => await flixhqProvider_1.FlixHQProvider.fetchPopularMovies(page), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.fetchPopularMovies(page);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/popular-tv', async (request, reply) => {
        const page = request.query.page || 1;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:popular-tv:${page}`, async () => await flixhqProvider_1.FlixHQProvider.fetchPopularTv(page), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.fetchPopularTv(page);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/top-movies', async (request, reply) => {
        const page = request.query.page || 1;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:top-movies:${page}`, async () => await flixhqProvider_1.FlixHQProvider.fetchTopMovies(page), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.fetchTopMovies(page);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/top-tv', async (request, reply) => {
        const page = request.query.page || 1;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:top-tv:${page}`, async () => await flixhqProvider_1.FlixHQProvider.fetchTopTv(page), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.fetchTopTv(page);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/upcoming', async (request, reply) => {
        const page = request.query.page || 1;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:upcoming:${page}`, async () => await flixhqProvider_1.FlixHQProvider.fetchUpcoming(page), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.fetchUpcoming(page);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/info', async (request, reply) => {
        const id = request.query.id;
        if (typeof id === 'undefined') {
            return reply.status(400).send({ message: 'id is required' });
        }
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:info:${id}`, async () => await flixhqProvider_1.FlixHQProvider.fetchMediaInfo(id), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.fetchMediaInfo(id);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/servers', async (request, reply) => {
        const episodeId = request.query.episodeId;
        if (typeof episodeId === 'undefined') {
            return reply.status(400).send({ message: 'episodeId is required' });
        }
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:servers:${episodeId}`, async () => await flixhqProvider_1.FlixHQProvider.fetchServers(episodeId), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.fetchServers(episodeId);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/watch', async (request, reply) => {
        const episodeId = request.query.episodeId;
        const server = request.query.server || 'megacloud';
        if (typeof episodeId === 'undefined') {
            return reply.status(400).send({ message: 'episodeId is required' });
        }
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:watch:${episodeId}:${server}`, async () => await flixhqProvider_1.FlixHQProvider.fetchSources(episodeId, server), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.fetchSources(episodeId, server);
            if (res && res.sources) {
                res.sources = sortAndLimitSources(res.sources);
            }
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
};
exports.default = routes;
