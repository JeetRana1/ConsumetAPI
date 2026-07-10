"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hdstream4uProvider_1 = require("../../providers/custom/hdstream4uProvider");
const routes = async (fastify, options) => {
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: 'HDStream4u / HDHub4u provider',
            routes: ['/search', '/info', '/watch'],
        });
    });
    fastify.get('/search', async (request, reply) => {
        const { query, page } = request.query;
        if (!query)
            return reply.status(400).send({ error: 'query is required' });
        const res = await hdstream4uProvider_1.HdStream4uProvider.search(query, page || 1);
        reply.status(200).send(res);
    });
    fastify.get('/info', async (request, reply) => {
        const { id, type } = request.query;
        if (!id)
            return reply.status(400).send({ error: 'id is required' });
        const res = await hdstream4uProvider_1.HdStream4uProvider.fetchMediaInfo(id, type || 'movie');
        reply.status(200).send(res);
    });
    fastify.get('/watch', async (request, reply) => {
        const { episodeId, server, mediaId } = request.query;
        if (!episodeId)
            return reply.status(400).send({ error: 'episodeId is required' });
        const res = await hdstream4uProvider_1.HdStream4uProvider.fetchSources(episodeId, server, false, { mediaId });
        reply.status(200).send(res);
    });
};
exports.default = routes;
