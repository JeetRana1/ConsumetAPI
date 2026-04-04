"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const extensions_1 = require("@consumet/extensions");
const provider_1 = require("../../utils/provider");
const routes = async (fastify, options) => {
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: "Welcome to the mal provider: check out the provider's website @ https://mal.co/",
            routes: ['/:query', '/info/:id', '/watch/:episodeId'],
            documentation: 'https://docs.consumet.org/#tag/mal',
        });
    });
    fastify.get('/:query', async (request, reply) => {
        try {
            const query = request.params.query;
            const page = request.query.page;
            const mal = generateMalMeta();
            const res = await mal.search(query, page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(200).send({ results: [], message: err.message });
        }
    });
    // mal info with episodes
    fastify.get('/info/:id', async (request, reply) => {
        const id = request.params.id;
        const provider = request.query.provider;
        let fetchFiller = request.query.fetchFiller;
        let isDub = request.query.dub;
        const possibleProvider = provider
            ? extensions_1.PROVIDERS_LIST.ANIME.find((p) => p.name.toLowerCase() === provider.toLowerCase())
            : undefined;
        const mal = generateMalMeta(possibleProvider);
        isDub = isDub === 'true' || isDub === '1';
        fetchFiller = fetchFiller === 'true' || fetchFiller === '1';
        try {
            const res = await mal.fetchAnimeInfo(id, isDub, fetchFiller);
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({ message: err.message });
        }
    });
    fastify.get('/watch/:episodeId', async (request, reply) => {
        const episodeId = request.params.episodeId;
        const provider = request.query.provider;
        const possibleProvider = provider
            ? extensions_1.PROVIDERS_LIST.ANIME.find((p) => p.name.toLowerCase() === provider.toLowerCase())
            : undefined;
        const mal = generateMalMeta(possibleProvider);
        try {
            const res = await mal.fetchEpisodeSources(episodeId);
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(404).send({ message: err.message || err });
        }
    });
};
const generateMalMeta = (provider) => {
    return (0, provider_1.configureProvider)(new extensions_1.META.Myanimelist(provider));
};
exports.default = routes;
