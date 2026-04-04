"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const extensions_1 = require("@consumet/extensions");
const provider_1 = require("../../utils/provider");
const cache_1 = __importDefault(require("../../utils/cache"));
const main_1 = require("../../main");
const routes = async (fastify, options) => {
    const mangapill = (0, provider_1.configureProvider)(new extensions_1.MANGA.MangaPill());
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: `Welcome to the Mangapill provider: check out the provider's website @ ${mangapill.toString.baseUrl}`,
            routes: ['/:query', '/info', '/read'],
            documentation: 'https://docs.consumet.org/#tag/mangapill',
        });
    });
    fastify.get('/:query', async (request, reply) => {
        const { query } = request.params;
        try {
            const res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `mangapill:search:${query}`, () => mangapill.search(query), main_1.REDIS_TTL)
                : await mangapill.search(query);
            reply.status(200).send(res);
        }
        catch {
            reply.status(500).send({
                message: 'Something went wrong. Please try again later.',
            });
        }
    });
    fastify.get('/info', async (request, reply) => {
        const id = request.query.id;
        if (!id)
            return reply.status(400).send({ message: 'id is required' });
        try {
            const res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `mangapill:info:${id}`, () => mangapill.fetchMangaInfo(id), main_1.REDIS_TTL)
                : await mangapill.fetchMangaInfo(id);
            reply.status(200).send(res);
        }
        catch {
            reply.status(500).send({
                message: 'Something went wrong. Please try again later.',
            });
        }
    });
    fastify.get('/read', async (request, reply) => {
        const chapterId = request.query.chapterId;
        if (!chapterId)
            return reply.status(400).send({ message: 'chapterId is required' });
        try {
            const res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `mangapill:read:${chapterId}`, () => mangapill.fetchChapterPages(chapterId), main_1.REDIS_TTL)
                : await mangapill.fetchChapterPages(chapterId);
            reply.status(200).send(res);
        }
        catch {
            reply.status(500).send({
                message: 'Something went wrong. Please try again later.',
            });
        }
    });
};
exports.default = routes;
