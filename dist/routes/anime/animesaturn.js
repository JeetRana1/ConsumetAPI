"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const extensions_1 = require("@consumet/extensions");
const main_1 = require("../../main");
const cache_1 = __importDefault(require("../../utils/cache"));
const provider_1 = require("../../utils/provider");
const routes = async (fastify, options) => {
    const animesaturn = (0, provider_1.configureProvider)(new extensions_1.ANIME.AnimeSaturn());
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: "Welcome to the animesaturn provider: check out the provider's website @ https://www.animesaturn.tv/",
            routes: ['/:query', '/info/:id', '/watch/:episodeId'],
            documentation: 'https://docs.consumet.org/#tag/animesaturn',
        });
    });
    fastify.get('/:query', async (request, reply) => {
        const query = request.params.query;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `animesaturn:search:${query}`, async () => await animesaturn.search(query), main_1.REDIS_TTL)
                : await animesaturn.search(query);
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({
                message: 'Something went wrong. Contact developer for help.',
            });
        }
    });
    fastify.get('/info', async (request, reply) => {
        const id = request.query.id;
        if (typeof id === 'undefined')
            return reply.status(400).send({ message: 'id is required' });
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `animesaturn:info:${id}`, async () => await animesaturn.fetchAnimeInfo(id), main_1.REDIS_TTL)
                : await animesaturn.fetchAnimeInfo(id);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/watch/:episodeId', async (request, reply) => {
        const episodeId = request.params.episodeId;
        if (typeof episodeId === 'undefined')
            return reply.status(400).send({ message: 'episodeId is required' });
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `animesaturn:watch:${episodeId}`, async () => await animesaturn.fetchEpisodeSources(episodeId), main_1.REDIS_TTL)
                : await animesaturn.fetchEpisodeSources(episodeId);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/servers/:episodeId', async (request, reply) => {
        const episodeId = request.params.episodeId;
        if (typeof episodeId === 'undefined')
            return reply.status(400).send({ message: 'episodeId is required' });
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `animesaturn:servers:${episodeId}`, async () => await animesaturn.fetchEpisodeServers(episodeId), main_1.REDIS_TTL)
                : await animesaturn.fetchEpisodeServers(episodeId);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
};
exports.default = routes;
