"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const extensions_1 = require("@consumet/extensions");
const cache_1 = __importDefault(require("../../utils/cache"));
const main_1 = require("../../main");
const routes = async (fastify, options) => {
    const getComics = new extensions_1.COMICS.GetComics();
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: `Welcome to the getComics provider: check out the provider's website @ ${getComics.toString.baseUrl}`,
            routes: ['/:query'],
            documentation: 'https://docs.consumet.org/#tag/getComics',
        });
    });
    fastify.get('/:query', async (request, reply) => {
        const { comicTitle } = request.query;
        const page = request.query.page || 1;
        if (!comicTitle || comicTitle.length < 4)
            return reply.status(400).send({
                message: 'length of comicTitle must be > 4 characters',
                error: 'short_length',
            });
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `getcomics:search:${comicTitle}:${page}`, async () => await getComics.search(comicTitle, page), main_1.REDIS_TTL)
                : await getComics.search(comicTitle, page);
            return reply.status(200).send(res);
        }
        catch (err) {
            return reply.status(500).send({
                message: 'Something went wrong. Contact developer for help.',
            });
        }
    });
};
exports.default = routes;
