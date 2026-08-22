"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const extensions_1 = require("@consumet/extensions");
const routes = async (fastify, _options) => {
    const createProvider = () => new extensions_1.ANIME.AniKoto();
    const provider = createProvider();
    fastify.get('/', async (_request, reply) => reply.send({ provider: 'anikoto', baseUrl: provider.toString.baseUrl }));
    fastify.get('/:query', async (request, reply) => {
        try {
            return reply.send(await provider.search(String(request.params.query), Number(request.query?.page) || 1));
        }
        catch (error) {
            return reply.status(502).send({ message: error?.message || 'AniKoto search failed' });
        }
    });
    fastify.get('/info', async (request, reply) => {
        try {
            return reply.send(await provider.fetchAnimeInfo(String(request.query?.id || '')));
        }
        catch (error) {
            return reply.status(502).send({ message: error?.message || 'AniKoto info failed' });
        }
    });
    fastify.get('/watch/:episodeId', async (request, reply) => {
        try {
            const episodeId = String(request.params.episodeId);
            const server = request.query?.server;
            let result;
            try {
                result = await createProvider().fetchEpisodeSources(episodeId, server);
            }
            catch (firstError) {
                // AniKoto's provider can retain stale extractor state. Recreate it once,
                // matching the recovery users previously got by restarting the API.
                request.log.warn({ err: firstError, episodeId }, 'AniKoto watch retry with fresh provider');
                result = await createProvider().fetchEpisodeSources(episodeId, server);
            }
            const sources = Array.isArray(result?.sources)
                ? result.sources
                : Array.isArray(result?.sub?.sources)
                    ? result.sub.sources
                    : null;
            if (sources) {
                const megaplay = sources.filter((source) => /megap\.mikora\.top/i.test(String(source?.url || '')));
                if (megaplay.length) {
                    if (Array.isArray(result?.sources))
                        result.sources = megaplay;
                    else
                        result.sub.sources = megaplay;
                }
            }
            return reply.send(result);
        }
        catch (error) {
            return reply.status(502).send({ message: error?.message || 'AniKoto source extraction failed' });
        }
    });
};
exports.default = routes;
