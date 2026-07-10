"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const netmirrorProvider_1 = require("../../providers/custom/netmirrorProvider");
const routes = async (fastify, options) => {
    // GET /movies/netmirror-nf/
    fastify.get('/', async (request, reply) => {
        try {
            const { page = 1 } = request.query;
            const data = await netmirrorProvider_1.NetMirrorProvider.getRecent('nf', Number(page));
            reply.status(200).send(data);
        }
        catch (err) {
            reply.status(500).send({ message: err.message || 'Something went wrong.' });
        }
    });
    // GET /movies/netmirror-nf/:query
    fastify.get('/:query', async (request, reply) => {
        const { query } = request.params;
        const { page = 1 } = request.query;
        try {
            const data = await netmirrorProvider_1.NetMirrorProvider.search(query, 'nf', Number(page));
            reply.status(200).send(data);
        }
        catch (err) {
            reply.status(500).send({ message: err.message || 'Something went wrong.' });
        }
    });
    // GET /movies/netmirror-nf/search?q=avengers&page=1
    fastify.get('/search', async (request, reply) => {
        const { q, query, page = 1 } = request.query;
        const searchQuery = q || query;
        if (!searchQuery) {
            return reply.status(400).send({ message: 'Query parameter "q" is required.' });
        }
        try {
            const data = await netmirrorProvider_1.NetMirrorProvider.search(searchQuery, 'nf', Number(page));
            reply.status(200).send(data);
        }
        catch (err) {
            reply.status(500).send({ message: err.message || 'Something went wrong.' });
        }
    });
    // GET /movies/netmirror-nf/info?id=some-netflix-id
    fastify.get('/info', async (request, reply) => {
        const { id } = request.query;
        if (!id) {
            return reply.status(400).send({ message: 'Query parameter "id" is required.' });
        }
        try {
            const data = await netmirrorProvider_1.NetMirrorProvider.getInfo(id, 'nf');
            reply.status(200).send(data);
        }
        catch (err) {
            reply.status(500).send({ message: err.message || 'Something went wrong.' });
        }
    });
    // GET /movies/netmirror-nf/watch?id=netflix-id&title=optional-title
    fastify.get('/watch', async (request, reply) => {
        const { id, title } = request.query;
        if (!id) {
            return reply.status(400).send({ message: 'Query parameter "id" is required.' });
        }
        try {
            const data = await netmirrorProvider_1.NetMirrorProvider.getSources(id, 'nf', title);
            reply.status(200).send(data);
        }
        catch (err) {
            reply.status(500).send({ message: err.message || 'Something went wrong.' });
        }
    });
};
exports.default = routes;
