"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const extensions_1 = require("@consumet/extensions");
const provider_1 = require("../../utils/provider");
const routes = async (fastify, options) => {
    fastify.get('/', (_, rp) => {
        const anilist = generateAnilistMangaMeta();
        rp.status(200).send({
            intro: `Welcome to the anilist manga provider: check out the provider's website @ ${anilist.provider.toString().baseUrl || 'https://anilist.co/'}`,
            routes: ['/:query', '/info/:id', '/read'],
            documentation: 'https://docs.consumet.org/#tag/anilist',
        });
    });
    fastify.get('/:query', async (request, reply) => {
        try {
            const query = request.params.query;
            const anilist = generateAnilistMangaMeta();
            const res = await anilist.search(query);
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(200).send({ results: [], message: err.message });
        }
    });
    fastify.get('/info/:id', async (request, reply) => {
        const id = request.params.id;
        const provider = request.query.provider;
        const possibleProvider = provider
            ? extensions_1.PROVIDERS_LIST.MANGA.find((p) => p.name.toLowerCase() === provider.toLowerCase())
            : undefined;
        const anilist = generateAnilistMangaMeta(possibleProvider);
        if (typeof id === 'undefined')
            return reply.status(400).send({ message: 'id is required' });
        try {
            const res = await anilist.fetchMangaInfo(id);
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({ message: err.message || 'Something went wrong.' });
        }
    });
    fastify.get('/read', async (request, reply) => {
        const chapterId = request.query.chapterId;
        const provider = request.query.provider;
        const possibleProvider = provider
            ? extensions_1.PROVIDERS_LIST.MANGA.find((p) => p.name.toLowerCase() === provider.toLowerCase())
            : undefined;
        const anilist = generateAnilistMangaMeta(possibleProvider);
        if (typeof chapterId === 'undefined')
            return reply.status(400).send({ message: 'chapterId is required' });
        try {
            const res = await anilist.fetchChapterPages(chapterId);
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({ message: err.message || 'Something went wrong.' });
        }
    });
    fastify.get('/chapters/:id', async (request, reply) => {
        const id = request.params.id;
        const provider = request.query.provider;
        const possibleProvider = provider
            ? extensions_1.PROVIDERS_LIST.MANGA.find((p) => p.name.toLowerCase() === provider.toLowerCase())
            : undefined;
        const anilist = generateAnilistMangaMeta(possibleProvider);
        if (typeof id === 'undefined')
            return reply.status(400).send({ message: 'id is required' });
        try {
            const res = await anilist.fetchChaptersList(id);
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({ message: err.message || 'Something went wrong.' });
        }
    });
};
const generateAnilistMangaMeta = (provider) => {
    return (0, provider_1.configureProvider)(new extensions_1.META.Anilist.Manga(provider));
};
exports.default = routes;
