"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const extensions_1 = require("@consumet/extensions");
const cache_1 = __importDefault(require("../../utils/cache"));
const main_1 = require("../../main");
const provider_1 = require("../../utils/provider");
const animekai = (0, provider_1.configureProvider)(new extensions_1.ANIME.AnimeKai());
const mergeByUrl = (rows) => [...new Map((Array.isArray(rows) ? rows : []).filter(Boolean).map((row) => [String(row?.url || row?.file || row?.src), row])).values()];
const normalizeSource = (source, isDub) => {
    const url = String(source?.url || source?.file || '').trim();
    if (!url)
        return null;
    return {
        ...source,
        url,
        isDub,
        isM3U8: Boolean(source?.isM3U8) || /\.m3u8(\?|$)/i.test(url) || /m3u8-proxy/i.test(url),
    };
};
const normalizeSubtitle = (track) => {
    const url = String(track?.url || track?.file || track?.src || '').trim();
    if (!url)
        return null;
    return {
        ...track,
        url,
        lang: track?.lang || track?.label || track?.language || 'Unknown',
        kind: track?.kind || 'captions',
    };
};
const routes = async (fastify, options) => {
    fastify.get('/info', async (request, reply) => {
        const id = request.query.id;
        if (typeof id === 'undefined') {
            return reply.status(400).send({ message: 'id is required' });
        }
        try {
            const res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `animekai:info:${id}`, async () => await animekai.fetchAnimeInfo(id), main_1.REDIS_TTL)
                : await animekai.fetchAnimeInfo(id);
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({ message: 'Error fetching AnimeKai info', error: err?.message });
        }
    });
    fastify.get('/servers/:episodeId', async (request, reply) => {
        const episodeId = request.params.episodeId;
        const category = (request.query.category || extensions_1.SubOrSub.SUB);
        try {
            const res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `animekai:servers:${episodeId}:${category}`, async () => await animekai.fetchEpisodeServers(episodeId, category), main_1.REDIS_TTL)
                : await animekai.fetchEpisodeServers(episodeId, category);
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({ message: 'Error fetching AnimeKai servers', error: err?.message });
        }
    });
    fastify.get('/watch/:episodeId', async (request, reply) => {
        const episodeId = request.params.episodeId;
        const server = (request.query.server ||
            extensions_1.StreamingServers.MegaUp);
        const category = (request.query.category || extensions_1.SubOrSub.BOTH);
        try {
            const fetchWatch = async () => {
                if (category === extensions_1.SubOrSub.BOTH) {
                    const [subRes, dubRes] = await Promise.allSettled([
                        animekai.fetchEpisodeSources(episodeId, server, extensions_1.SubOrSub.SUB),
                        animekai.fetchEpisodeSources(episodeId, server, extensions_1.SubOrSub.DUB),
                    ]);
                    const sources = [
                        ...(subRes.status === 'fulfilled'
                            ? (Array.isArray(subRes.value?.sources) ? subRes.value.sources : []).map((s) => normalizeSource(s, false))
                            : []),
                        ...(dubRes.status === 'fulfilled'
                            ? (Array.isArray(dubRes.value?.sources) ? dubRes.value.sources : []).map((s) => normalizeSource(s, true))
                            : []),
                    ].filter(Boolean);
                    const subtitles = mergeByUrl([
                        ...(subRes.status === 'fulfilled'
                            ? (Array.isArray(subRes.value?.subtitles) ? subRes.value.subtitles : []).map(normalizeSubtitle)
                            : []),
                        ...(dubRes.status === 'fulfilled'
                            ? (Array.isArray(dubRes.value?.subtitles) ? dubRes.value.subtitles : []).map(normalizeSubtitle)
                            : []),
                    ].filter(Boolean));
                    if (!sources.length) {
                        throw new Error('AnimeKai returned no playable sources');
                    }
                    return {
                        headers: { Referer: 'https://anikai.to/' },
                        sources: mergeByUrl(sources),
                        subtitles,
                        intro: subRes.status === 'fulfilled'
                            ? subRes.value?.intro
                            : (dubRes.status === 'fulfilled' ? dubRes.value?.intro : undefined),
                        outro: subRes.status === 'fulfilled'
                            ? subRes.value?.outro
                            : (dubRes.status === 'fulfilled' ? dubRes.value?.outro : undefined),
                    };
                }
                const single = await animekai.fetchEpisodeSources(episodeId, server, category);
                const sources = mergeByUrl((Array.isArray(single?.sources) ? single.sources : [])
                    .map((s) => normalizeSource(s, category === extensions_1.SubOrSub.DUB))
                    .filter(Boolean));
                const subtitles = mergeByUrl((Array.isArray(single?.subtitles) ? single.subtitles : [])
                    .map(normalizeSubtitle)
                    .filter(Boolean));
                if (!sources.length) {
                    throw new Error('AnimeKai returned no playable sources');
                }
                return {
                    ...(single || {}),
                    headers: { Referer: 'https://anikai.to/' },
                    sources,
                    subtitles,
                };
            };
            const res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `animekai:watch:${episodeId}:${server}:${category}`, fetchWatch, main_1.REDIS_TTL)
                : await fetchWatch();
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({ message: 'Error fetching AnimeKai sources', error: err?.message });
        }
    });
    fastify.get('/:query', async (request, reply) => {
        const query = decodeURIComponent(request.params.query);
        const page = Number(request.query.page || 1);
        try {
            const res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `animekai:search:${query}:${page}`, async () => await animekai.search(query, page), main_1.REDIS_TTL)
                : await animekai.search(query, page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({ message: 'Error searching AnimeKai', error: err?.message });
        }
    });
};
exports.default = routes;
