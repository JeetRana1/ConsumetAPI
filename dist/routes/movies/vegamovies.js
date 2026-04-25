"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vegamoviesProvider_1 = require("../../providers/custom/vegamoviesProvider");
const routes = async (fastify, options) => {
    // GET /movies/vegamovies/
    fastify.get('/', async (request, reply) => {
        try {
            const { page = 1 } = request.query;
            const data = await vegamoviesProvider_1.VegamoviesProvider.getRecent(Number(page));
            reply.status(200).send(data);
        }
        catch (err) {
            reply.status(500).send({ message: err.message || 'Something went wrong.' });
        }
    });
    // GET /movies/vegamovies/:query
    fastify.get('/:query', async (request, reply) => {
        const { query } = request.params;
        const { page = 1 } = request.query;
        try {
            const data = await vegamoviesProvider_1.VegamoviesProvider.search(query, Number(page));
            reply.status(200).send(data);
        }
        catch (err) {
            reply.status(500).send({ message: err.message || 'Something went wrong.' });
        }
    });
    // GET /movies/vegamovies/search?q=avengers&page=1
    fastify.get('/search', async (request, reply) => {
        const { q, query, page = 1 } = request.query;
        const searchQuery = q || query;
        if (!searchQuery) {
            return reply.status(400).send({ message: 'Query parameter "q" is required.' });
        }
        try {
            const data = await vegamoviesProvider_1.VegamoviesProvider.search(searchQuery, Number(page));
            reply.status(200).send(data);
        }
        catch (err) {
            reply.status(500).send({ message: err.message || 'Something went wrong.' });
        }
    });
    // GET /movies/vegamovies/info?id=426-avengers-endgame-2019-hindi-dual-audio-720p
    fastify.get('/info', async (request, reply) => {
        const { id } = request.query;
        if (!id) {
            return reply.status(400).send({ message: 'Query parameter "id" is required.' });
        }
        try {
            const data = await vegamoviesProvider_1.VegamoviesProvider.getInfo(id);
            reply.status(200).send(data);
        }
        catch (err) {
            reply.status(500).send({ message: err.message || 'Something went wrong.' });
        }
    });
    // GET /movies/vegamovies/watch?id=tt4154796&season=1&episode=1
    // id can be: IMDB ID (tt...) or a vegamovies slug
    fastify.get('/watch', async (request, reply) => {
        const { id, season, episode } = request.query;
        if (!id) {
            return reply.status(400).send({ message: 'Query parameter "id" (IMDB ID or slug) is required.' });
        }
        try {
            const data = await vegamoviesProvider_1.VegamoviesProvider.getSources(id, season ? Number(season) : undefined, episode ? Number(episode) : undefined);
            reply.status(200).send(data);
        }
        catch (err) {
            reply.status(500).send({ message: err.message || 'Something went wrong.' });
        }
    });
};
exports.default = routes;
