"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const extensions_1 = require("@consumet/extensions");
const cache_1 = __importDefault(require("../../utils/cache"));
const main_1 = require("../../main");
const routes = (fastify, options) => __awaiter(void 0, void 0, void 0, function* () {
    const managreader = new extensions_1.MANGA.MangaReader();
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: `Welcome to the Mangapill provider: check out the provider's website @ ${managreader.toString.baseUrl}`,
            routes: ['/:query', '/info', '/read'],
            documentation: 'https://docs.consumet.org/#tag/mangapill',
        });
    });
    fastify.get('/:query', (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const query = request.params.query;
        try {
            let res = main_1.redis
                ? yield cache_1.default.fetch(main_1.redis, `mangareader:search:${query}`, () => __awaiter(void 0, void 0, void 0, function* () { return yield managreader.search(query); }), main_1.REDIS_TTL)
                : yield managreader.search(query);
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({
                message: 'Something went wrong. Contact developer for help.',
            });
        }
    }));
    fastify.get('/info', (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const id = request.query.id;
        if (typeof id === 'undefined')
            return reply.status(400).send({ message: 'id is required' });
        try {
            let res = main_1.redis
                ? yield cache_1.default.fetch(main_1.redis, `mangareader:info:${id}`, () => __awaiter(void 0, void 0, void 0, function* () { return yield managreader.fetchMangaInfo(id); }), main_1.REDIS_TTL)
                : yield managreader.fetchMangaInfo(id);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    }));
    fastify.get('/read', (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const chapterId = request.query.chapterId;
        if (typeof chapterId === 'undefined')
            return reply.status(400).send({ message: 'chapterId is required' });
        try {
            let res = main_1.redis
                ? yield cache_1.default.fetch(main_1.redis, `mangareader:read:${chapterId}`, () => __awaiter(void 0, void 0, void 0, function* () { return yield managreader.fetchChapterPages(chapterId); }), main_1.REDIS_TTL)
                : yield managreader.fetchChapterPages(chapterId);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    }));
});
exports.default = routes;
