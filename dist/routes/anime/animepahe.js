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
    const animepahe = (0, provider_1.configureProvider)(new extensions_1.ANIME.AnimePahe());
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: `Welcome to the animepahe provider: check out the provider's website @ ${animepahe.toString.baseUrl}`,
            routes: ['/info/:id', '/watch/:episodeId', '/recent-episodes', '/:query'],
            documentation: 'https://docs.consumet.org/#tag/animepahe',
        });
    });
    fastify.get('/recent-episodes', async (request, reply) => {
        const page = request.query.page;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `animepahe:recent-episodes:${page}`, async () => await animepahe.fetchRecentEpisodes(page), main_1.REDIS_TTL)
                : await animepahe.fetchRecentEpisodes(page);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({
                message: 'Something went wrong. Contact developer for help.',
            });
        }
    });
    fastify.get('/info/:id', async (request, reply) => {
        const id = decodeURIComponent(request.params.id);
        const episodePage = request.query.episodePage;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `animepahe:info:${id}:${episodePage}`, async () => await animepahe.fetchAnimeInfo(id, episodePage), main_1.REDIS_TTL)
                : await animepahe.fetchAnimeInfo(id, episodePage);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/watch', async (request, reply) => {
        const episodeId = request.query.episodeId;
        if (typeof episodeId === 'undefined')
            return reply.status(400).send({ message: 'episodeId is required' });
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `animepahe:watch:${episodeId}`, async () => await animepahe.fetchEpisodeSources(episodeId), main_1.REDIS_TTL)
                : await animepahe.fetchEpisodeSources(episodeId);
            reply.status(200).send(res);
        }
        catch (err) {
            console.log(err);
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/:query', async (request, reply) => {
        const query = request.params.query;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `animepahe:search:${query}`, async () => await animepahe.search(query), main_1.REDIS_TTL)
                : await animepahe.search(query);
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({
                message: 'Something went wrong. Contact developer for help.',
            });
        }
    });
};
exports.default = routes;
