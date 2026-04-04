"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const extensions_1 = require("@consumet/extensions");
const cache_1 = __importDefault(require("../../utils/cache"));
const main_1 = require("../../main");
const streamable_1 = require("../../utils/streamable");
const provider_1 = require("../../utils/provider");
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const WATCH_ATTEMPT_TIMEOUT_MS = IS_PRODUCTION ? 8000 : 12000;
const sanitizeKickassSources = (payload) => {
    if (!payload || !Array.isArray(payload.sources))
        return payload;
    const cleaned = payload.sources.filter((src) => {
        const url = String((src === null || src === void 0 ? void 0 : src.url) || '').trim().toLowerCase();
        if (!url)
            return false;
        if (Boolean(src === null || src === void 0 ? void 0 : src.isEmbed))
            return false;
        if (url.includes('kaa.lt/intro.mp4') || url.endsWith('/intro.mp4'))
            return false;
        // DASH links from this provider frequently fail with 403 on segment fetch.
        if (url.includes('.mpd'))
            return false;
        return true;
    });
    return { ...payload, sources: cleaned.length ? cleaned : payload.sources };
};
const routes = async (fastify, options) => {
    const kickassanime = (0, provider_1.configureProvider)(new extensions_1.ANIME.KickAssAnime());
    kickassanime.baseUrl = 'https://kaa.lt';
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: `Welcome to the kickassanime provider: check out the provider's website @ ${kickassanime.toString.baseUrl}`,
            routes: ['/:query', '/info', '/watch/:episodeId', '/servers/:episodeId'],
            documentation: 'https://docs.consumet.org/#tag/kickassanime',
        });
    });
    fastify.get('/info', async (request, reply) => {
        const id = request.query.id;
        if (typeof id === 'undefined')
            return reply.status(400).send({ message: 'id is required' });
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `kickassanime:info:${id}`, async () => await kickassanime.fetchAnimeInfo(id), main_1.REDIS_TTL)
                : await kickassanime.fetchAnimeInfo(id);
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
        const server = request.query.server;
        if (typeof episodeId === 'undefined')
            return reply.status(400).send({ message: 'episodeId is required' });
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `kickassanime:watch:${episodeId}:${server}`, async () => await (0, streamable_1.fetchWithServerFallback)(async (selectedServer) => await kickassanime.fetchEpisodeSources(episodeId, selectedServer), server, undefined, { attemptTimeoutMs: WATCH_ATTEMPT_TIMEOUT_MS }), main_1.REDIS_TTL)
                : await (0, streamable_1.fetchWithServerFallback)(async (selectedServer) => await kickassanime.fetchEpisodeSources(episodeId, selectedServer), server, undefined, { attemptTimeoutMs: WATCH_ATTEMPT_TIMEOUT_MS });
            reply.status(200).send(sanitizeKickassSources(res));
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
                ? await cache_1.default.fetch(main_1.redis, `kickassanime:servers:${episodeId}`, async () => await kickassanime.fetchEpisodeServers(episodeId), main_1.REDIS_TTL)
                : await kickassanime.fetchEpisodeServers(episodeId);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/:query', async (request, reply) => {
        const query = request.params.query;
        const page = request.query.page;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `kickassanime:search:${query}:${page}`, async () => await kickassanime.search(query, page), main_1.REDIS_TTL)
                : await kickassanime.search(query, page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.', error: err.message });
        }
    });
};
exports.default = routes;
