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
    const mangadex = (0, provider_1.configureProvider)(new extensions_1.MANGA.MangaDex());
    const fetchChapterPagesWithFallback = async (chapterId) => {
        return await mangadex.fetchChapterPages(chapterId);
    };
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: `Welcome to the mangadex provider: check out the provider's website @ ${mangadex.toString.baseUrl}`,
            routes: ['/:query', '/info/:id', '/read/:chapterId'],
            documentation: 'https://docs.consumet.org/#tag/mangadex',
        });
    });
    // --- SEARCH ---
    fastify.get('/:query', async (request, reply) => {
        const { query } = request.params;
        const { page } = request.query;
        try {
            const res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `mangadex:search:${query}:${page ?? 1}`, () => mangadex.search(query, page), main_1.REDIS_TTL)
                : await mangadex.search(query, page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({
                message: 'Something went wrong. Please try again later.',
            });
        }
    });
    // --- INFO ---
    fastify.get('/info/:id', async (request, reply) => {
        const id = decodeURIComponent(request.params.id);
        try {
            const res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `mangadex:info:${id}`, () => mangadex.fetchMangaInfo(id), main_1.REDIS_TTL)
                : await mangadex.fetchMangaInfo(id);
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({
                message: 'Something went wrong. Please try again later.',
            });
        }
    });
    // --- READ CHAPTER ---
    fastify.get('/read/:chapterId', async (request, reply) => {
        const { chapterId } = request.params;
        try {
            const res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `mangadex:read:${chapterId}`, () => fetchChapterPagesWithFallback(chapterId), main_1.REDIS_TTL)
                : await fetchChapterPagesWithFallback(chapterId);
            reply.status(200).send(res);
        }
        catch (err) {
            console.log('Error reading chapter:', chapterId, err);
            reply.status(500).send({
                message: 'Something went wrong. Please try again later.',
            });
        }
    });
};
exports.default = routes;
