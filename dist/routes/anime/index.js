"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const extensions_1 = require("@consumet/extensions");
const satoru_1 = __importDefault(require("./satoru"));
const justanime_1 = __importDefault(require("./justanime"));
const animesalt_1 = __importDefault(require("./animesalt"));
const animekai_1 = __importDefault(require("./animekai"));
const animetsu_1 = __importDefault(require("./animetsu"));
const routes = async (fastify, options) => {
    await fastify.register(satoru_1.default, { prefix: '/satoru' });
    await fastify.register(justanime_1.default, { prefix: '/justanime' });
    await fastify.register(animesalt_1.default, { prefix: '/animesalt' });
    await fastify.register(animekai_1.default, { prefix: '/animekai' });
    await fastify.register(animetsu_1.default, { prefix: '/animetsu' });
    fastify.get('/', async (request, reply) => {
        reply.status(200).send('Welcome to Consumet Anime 🗾');
    });
    fastify.get('/:animeProvider', async (request, reply) => {
        const queries = {
            animeProvider: '',
            page: 1,
        };
        queries.animeProvider = decodeURIComponent(request.params.animeProvider);
        queries.page = request.query.page;
        if (queries.page < 1)
            queries.page = 1;
        const provider = extensions_1.PROVIDERS_LIST.ANIME.find((provider) => provider.toString.name === queries.animeProvider);
        try {
            if (provider) {
                reply.redirect(`/anime/${provider.toString.name}`);
            }
            else {
                reply
                    .status(404)
                    .send({ message: 'Provider not found, please check the providers list.' });
            }
        }
        catch (err) {
            reply.status(500).send('Something went wrong. Please try again later.');
        }
    });
};
exports.default = routes;
