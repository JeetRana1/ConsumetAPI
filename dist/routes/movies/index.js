"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const extensions_1 = require("@consumet/extensions");
const hdstream4u_1 = __importDefault(require("./hdstream4u"));
const routes = async (fastify, options) => {
    await fastify.register(hdstream4u_1.default, { prefix: '/hdstream4u' });
    fastify.get('/', async (request, reply) => {
        reply.status(200).send('Welcome to Consumet Movies and TV Shows');
    });
    fastify.get('/:movieProvider', async (request, reply) => {
        const queries = {
            movieProvider: '',
            page: 1,
        };
        queries.movieProvider = decodeURIComponent(request.params.movieProvider);
        queries.page = request.query.page;
        if (queries.page < 1)
            queries.page = 1;
        const provider = extensions_1.PROVIDERS_LIST.MOVIES.find((provider) => provider.toString.name === queries.movieProvider);
        try {
            if (provider) {
                reply.redirect(`/movies/${provider.toString.name}`);
            }
            else {
                reply
                    .status(404)
                    .send({ message: 'Page not found, please check the providers list.' });
            }
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Please try again later.' });
        }
    });
    // Legacy route support for players calling /movies/:id/:title
    fastify.get('/:id/:title', async (request, reply) => {
        const { id, title } = request.params;
        // We assume it's a movie if called on /movies/
        return reply.redirect(`/meta/tmdb/watch?id=${id}&type=movie&provider=hdstream4u`);
    });
};
exports.default = routes;
