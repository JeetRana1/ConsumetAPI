"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cache_1 = __importDefault(require("../../utils/cache"));
const main_1 = require("../../main");
const nightflix_1 = __importDefault(require("../../providers/movies/nightflix"));
const provider = new nightflix_1.default();
const routes = async (fastify, _options) => {
    fastify.get('/', async (_request, reply) => {
        reply.status(200).send({
            intro: 'Welcome to the custom NightFlix provider',
            routes: ['/:query', '/search', '/info', '/watch', '/servers'],
        });
    });
    fastify.get('/:query', async (request, reply) => {
        const query = decodeURIComponent(request.params.query);
        const page = Number(request.query.page || 1);
        try {
            const res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `nightflix:search:${query}:${page}`, async () => await provider.search(query, page), main_1.REDIS_TTL)
                : await provider.search(query, page);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.post('/search', async (request, reply) => {
        const { query } = request.body;
        if (!query)
            return reply.status(400).send({ error: 'Query is required' });
        try {
            const res = await provider.search(query, 1);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/info', async (request, reply) => {
        const id = request.query.id;
        if (!id)
            return reply.status(400).send({ message: 'id is required' });
        try {
            const res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `nightflix:info:${id}`, async () => await provider.fetchMediaInfo(id), main_1.REDIS_TTL)
                : await provider.fetchMediaInfo(id);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/servers', async (request, reply) => {
        const episodeId = request.query.episodeId;
        if (!episodeId)
            return reply.status(400).send({ message: 'episodeId is required' });
        try {
            const res = await provider.fetchEpisodeServers(episodeId);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/watch', async (request, reply) => {
        const episodeId = request.query.episodeId;
        const mediaId = request.query.mediaId;
        if (!episodeId)
            return reply.status(400).send({ message: 'episodeId is required' });
        try {
            const res = await provider.fetchEpisodeSources(episodeId, mediaId);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
};
exports.default = routes;
