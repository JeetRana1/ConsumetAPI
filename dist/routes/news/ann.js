"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const extensions_1 = require("@consumet/extensions");
const routes = async (fastify, options) => {
    const ann = new extensions_1.NEWS.ANN();
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: "Welcome to the Anime News Network provider: check out the provider's website @ https://www.animenewsnetwork.com/",
            routes: ['/recent-feeds', '/info'],
            documentation: 'https://docs.consumet.org/#tag/animenewsnetwork',
        });
    });
    fastify.get('/recent-feeds', async (req, reply) => {
        let { topic } = req.query;
        try {
            const feeds = await ann.fetchNewsFeeds(topic);
            reply.status(200).send(feeds);
        }
        catch (e) {
            reply.status(500).send({
                message: e.message,
            });
        }
    });
    fastify.get('/info', async (req, reply) => {
        const { id } = req.query;
        if (typeof id === 'undefined')
            return reply.status(400).send({
                message: 'id is required',
            });
        try {
            const info = await ann.fetchNewsInfo(id);
            reply.status(200).send(info);
        }
        catch (error) {
            reply.status(500).send({
                message: error.message,
            });
        }
    });
};
exports.default = routes;
