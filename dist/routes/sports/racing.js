"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const racing_1 = require("../../providers/sports/racing");
const main_1 = require("../../main");
const cache_1 = __importDefault(require("../../utils/cache"));
const routes = async (fastify, options) => {
    const racing = new racing_1.Racing();
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: 'Welcome to the Racing sports provider',
            routes: ['/:query', '/info', '/watch'],
        });
    });
    fastify.get('/:query', async (request, reply) => {
        const query = decodeURIComponent(request.params.query);
        const forceRefresh = String(request.query.forceRefresh || '').toLowerCase() === 'true';
        try {
            const cacheKey = `sports:racing:search:${query}:${forceRefresh ? 'force' : 'cache'}`;
            let res = main_1.redis && !forceRefresh
                ? await cache_1.default.fetch(main_1.redis, cacheKey, async () => await racing.search(query), main_1.REDIS_TTL)
                : await racing.fetchCatalogLatest({ query, forceRefresh });
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
            reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            reply.header('Pragma', 'no-cache');
            reply.header('Expires', '0');
            const res = await racing.fetchMediaInfo(id);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/watch', async (request, reply) => {
        const episodeId = request.query.episodeId;
        if (typeof episodeId === 'undefined') {
            return reply.status(400).send({ message: 'episodeId is required' });
        }
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `sports:racing:watch:${episodeId}`, async () => await racing.fetchEpisodeSources(episodeId), main_1.REDIS_TTL)
                : await racing.fetchEpisodeSources(episodeId);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
};
exports.default = routes;
