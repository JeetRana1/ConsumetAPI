"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const extensions_1 = require("@consumet/extensions");
const cache_1 = __importDefault(require("../../utils/cache"));
const main_1 = require("../../main");
const provider_1 = require("../../utils/provider");
const routes = async (fastify, options) => {
    const animeunity = (0, provider_1.configureProvider)(new extensions_1.ANIME.AnimeUnity());
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: `Welcome to the animeunity provider: check out the provider's website @ ${animeunity.toString.baseUrl}`,
            routes: ['/:query', '/info', '/watch/:episodeId'],
            documentation: 'https://docs.consumet.org/#tag/animeunity',
        });
    });
    fastify.get('/:query', async (request, reply) => {
        const query = request.params.query;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `animeunity:search:${query}`, async () => await animeunity.search(query), main_1.REDIS_TTL)
                : await animeunity.search(query);
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
        const page = request.query.page;
        if (typeof id === 'undefined')
            return reply.status(400).send({ message: 'id is required' });
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `animeunity:info:${id}:${page}`, async () => await animeunity.fetchAnimeInfo(id, page), main_1.REDIS_TTL)
                : await animeunity.fetchAnimeInfo(id, page);
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
                ? await cache_1.default.fetch(main_1.redis, `animeunity:watch:${episodeId}`, async () => await animeunity.fetchEpisodeSources(episodeId), main_1.REDIS_TTL)
                : await animeunity.fetchEpisodeSources(episodeId);
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
