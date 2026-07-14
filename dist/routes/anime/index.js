"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const extensions_1 = require("@consumet/extensions");
const animesalt_1 = __importDefault(require("./animesalt"));
const routes = async (fastify, options) => {
    await fastify.register(animesalt_1.default, { prefix: '/animesalt' });
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
