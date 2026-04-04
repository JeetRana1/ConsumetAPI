"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const models_1 = require("@consumet/extensions/dist/models");
const anilist_1 = __importDefault(require("@consumet/extensions/dist/providers/meta/anilist"));
const models_2 = require("@consumet/extensions/dist/models");
const cache_1 = __importDefault(require("../../utils/cache"));
const main_1 = require("../../main");
const animepahe_1 = __importDefault(require("@consumet/extensions/dist/providers/anime/animepahe"));
const streamable_1 = require("../../utils/streamable");
const provider_1 = require("../../utils/provider");
const outboundProxy_1 = require("../../utils/outboundProxy");
const routes = async (fastify, options) => {
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: "Welcome to the anilist provider: check out the provider's website @ https://anilist.co/",
            routes: ['/:query', '/info/:id', '/watch/:episodeId'],
            documentation: 'https://docs.consumet.org/#tag/anilist',
        });
    });
    fastify.get('/:query', async (request, reply) => {
        try {
            const anilist = generateAnilistMeta();
            const query = request.params.query;
            const page = request.query.page;
            const perPage = request.query.perPage;
            const res = await anilist.search(query, page, perPage);
            reply.status(200).send(res);
        }
        catch (err) {
            console.error('[Anilist] Search error:', err?.message || err);
            reply.status(200).send({ results: [], message: err?.message || 'Search failed' });
        }
    });
    fastify.get('/advanced-search', async (request, reply) => {
        const query = request.query.query;
        const page = request.query.page;
        const perPage = request.query.perPage;
        const type = request.query.type;
        let genres = request.query.genres;
        const id = request.query.id;
        const format = request.query.format;
        let sort = request.query.sort;
        const status = request.query.status;
        const year = request.query.year;
        const season = request.query.season;
        const countryOfOrigin = request.query.countryOfOrigin;
        const anilist = generateAnilistMeta();
        if (genres) {
            try {
                const parsedGenres = JSON.parse(genres);
                parsedGenres.forEach((genre) => {
                    if (!Object.values(models_1.Genres).includes(genre)) {
                        // We'll just skip invalid genres or handle specifically
                    }
                });
                genres = parsedGenres;
            }
            catch {
                genres = undefined;
            }
        }
        if (sort) {
            try {
                sort = JSON.parse(sort);
            }
            catch {
                sort = undefined;
            }
        }
        if (season) {
            if (!['WINTER', 'SPRING', 'SUMMER', 'FALL'].includes(season))
                return reply.status(400).send({ message: `${season} is not a valid season` });
        }
        const res = await anilist.advancedSearch(query, type, page, perPage, format, sort, genres, id, year, status, season, countryOfOrigin);
        reply.status(200).send(res);
    });
    fastify.get('/trending', async (request, reply) => {
        const page = request.query.page;
        const perPage = request.query.perPage;
        const anilist = generateAnilistMeta();
        main_1.redis
            ? reply
                .status(200)
                .send(await cache_1.default.fetch(main_1.redis, `anilist:trending;${page};${perPage}`, async () => await anilist.fetchTrendingAnime(page, perPage), 60 * 60))
            : reply.status(200).send(await anilist.fetchTrendingAnime(page, perPage));
    });
    fastify.get('/popular', async (request, reply) => {
        const page = request.query.page;
        const perPage = request.query.perPage;
        const anilist = generateAnilistMeta();
        main_1.redis
            ? reply
                .status(200)
                .send(await cache_1.default.fetch(main_1.redis, `anilist:popular;${page};${perPage}`, async () => await anilist.fetchPopularAnime(page, perPage), 60 * 60))
            : reply.status(200).send(await anilist.fetchPopularAnime(page, perPage));
    });
    fastify.get('/airing-schedule', async (request, reply) => {
        const page = request.query.page;
        const perPage = request.query.perPage;
        const weekStart = request.query.weekStart;
        const weekEnd = request.query.weekEnd;
        const notYetAired = request.query.notYetAired;
        const anilist = generateAnilistMeta();
        const _weekStart = Math.ceil(Date.now() / 1000);
        const res = await anilist.fetchAiringSchedule(page ?? 1, perPage ?? 20, weekStart ?? _weekStart, weekEnd ?? _weekStart + 604800, notYetAired ?? true);
        reply.status(200).send(res);
    });
    fastify.get('/genre', async (request, reply) => {
        const genres = request.query.genres;
        const page = request.query.page;
        const perPage = request.query.perPage;
        const anilist = generateAnilistMeta();
        if (typeof genres === 'undefined')
            return reply.status(400).send({ message: 'genres is required' });
        try {
            const parsedGenres = JSON.parse(genres);
            const res = await anilist.fetchAnimeGenres(parsedGenres, page, perPage);
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(400).send({ message: 'Invalid genres data' });
        }
    });
    fastify.get('/recent-episodes', async (request, reply) => {
        const provider = request.query.provider;
        const page = request.query.page;
        const perPage = request.query.perPage;
        const anilist = generateAnilistMeta(provider);
        const res = await anilist.fetchRecentEpisodes(provider, page, perPage);
        reply.status(200).send(res);
    });
    fastify.get('/random-anime', async (request, reply) => {
        const anilist = generateAnilistMeta();
        const res = await anilist.fetchRandomAnime().catch(() => {
            return reply.status(404).send({ message: 'Anime not found' });
        });
        reply.status(200).send(res);
    });
    fastify.get('/servers/:id', async (request, reply) => {
        const id = request.params.id;
        const provider = request.query.provider;
        let anilist = generateAnilistMeta(provider);
        const res = await anilist.fetchEpisodeServers(id);
        reply.status(200).send(res);
    });
    fastify.get('/episodes/:id', async (request, reply) => {
        const today = new Date();
        const dayOfWeek = today.getDay();
        const id = request.params.id;
        const provider = request.query.provider;
        let fetchFiller = request.query.fetchFiller;
        let dub = request.query.dub;
        let anilist = generateAnilistMeta(provider);
        dub = (dub === 'true' || dub === '1');
        fetchFiller = (fetchFiller === 'true' || fetchFiller === '1');
        try {
            if (main_1.redis) {
                const data = await cache_1.default.fetch(main_1.redis, `anilist:episodes;${id};${dub};${fetchFiller};${anilist.provider.name.toLowerCase()}`, async () => anilist.fetchEpisodesListById(id, dub, fetchFiller), dayOfWeek === 0 || dayOfWeek === 6 ? 60 * 120 : (60 * 60) / 2);
                reply.status(200).send(data);
            }
            else {
                const data = await anilist.fetchEpisodesListById(id, dub, fetchFiller);
                reply.status(200).send(data);
            }
        }
        catch (err) {
            return reply.status(404).send({ message: 'Anime not found' });
        }
    });
    fastify.get('/data/:id', async (request, reply) => {
        const id = request.params.id;
        const anilist = generateAnilistMeta();
        const res = await anilist.fetchAnilistInfoById(id);
        reply.status(200).send(res);
    });
    fastify.get('/info/:id', async (request, reply) => {
        const id = request.params.id;
        const today = new Date();
        const dayOfWeek = today.getDay();
        const provider = request.query.provider;
        let fetchFiller = request.query.fetchFiller;
        let isDub = request.query.dub;
        let anilist = generateAnilistMeta(provider);
        isDub = (isDub === 'true' || isDub === '1');
        fetchFiller = (fetchFiller === 'true' || fetchFiller === '1');
        try {
            if (main_1.redis) {
                const data = await cache_1.default.fetch(main_1.redis, `anilist:info;${id};${isDub};${fetchFiller};${anilist.provider.name.toLowerCase()}`, async () => anilist.fetchAnimeInfo(id, isDub, fetchFiller), dayOfWeek === 0 || dayOfWeek === 6 ? 60 * 120 : (60 * 60) / 2);
                reply.status(200).send(data);
            }
            else {
                const data = await anilist.fetchAnimeInfo(id, isDub, fetchFiller);
                reply.status(200).send(data);
            }
        }
        catch (err) {
            reply.status(500).send({ message: err.message });
        }
    });
    fastify.get('/character/:id', async (request, reply) => {
        const id = request.params.id;
        const anilist = generateAnilistMeta();
        const res = await anilist.fetchCharacterInfoById(id);
        reply.status(200).send(res);
    });
    fastify.get('/watch/:episodeId', async (request, reply) => {
        const episodeId = request.params.episodeId;
        const provider = request.query.provider;
        const server = request.query.server;
        let isDub = request.query.dub;
        if (server && !Object.values(models_2.StreamingServers).includes(server))
            return reply.status(400).send('Invalid server');
        isDub = (isDub === 'true' || isDub === '1');
        let anilist = generateAnilistMeta(provider);
        try {
            const fetchSources = async (selectedServer) => {
                return provider === 'zoro'
                    ? await anilist.fetchEpisodeSources(episodeId, selectedServer, isDub ? models_1.SubOrSub.DUB : models_1.SubOrSub.SUB)
                    : await anilist.fetchEpisodeSources(episodeId, selectedServer);
            };
            if (main_1.redis) {
                const data = await cache_1.default.fetch(main_1.redis, `anilist:watch;${episodeId};${anilist.provider.name.toLowerCase()};${server};${isDub ? 'dub' : 'sub'}`, async () => await (0, streamable_1.fetchWithServerFallback)(fetchSources, server), 600);
                reply.status(200).send(data);
            }
            else {
                const data = await (0, streamable_1.fetchWithServerFallback)(fetchSources, server);
                reply.status(200).send(data);
            }
        }
        catch (err) {
            reply.status(500).send({ message: 'Something went wrong.' });
        }
    });
    fastify.get('/staff/:id', async (request, reply) => {
        const id = request.params.id;
        const anilist = generateAnilistMeta();
        try {
            if (main_1.redis) {
                const data = await cache_1.default.fetch(main_1.redis, `anilist:staff;${id}`, async () => await anilist.fetchStaffById(Number(id)), 60 * 60);
                reply.status(200).send(data);
            }
            else {
                const data = await anilist.fetchStaffById(Number(id));
                reply.status(200).send(data);
            }
        }
        catch (err) {
            reply.status(404).send({ message: err.message });
        }
    });
    fastify.get('/favorites', async (request, reply) => {
        const type = request.query.type;
        const headers = request.headers;
        if (!headers.authorization) {
            return reply.status(401).send({ message: 'Authorization header is required' });
        }
        const anilist = generateAnilistMeta();
        try {
            const res = await anilist.fetchFavoriteList(headers.authorization, type);
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({ message: err.message });
        }
    });
};
const generateAnilistMeta = (provider = undefined) => {
    const proxies = (0, outboundProxy_1.getProxyCandidatesSync)();
    const url = proxies.length > 0 ? (proxies.length === 1 ? proxies[0] : proxies) : [];
    return new anilist_1.default((0, provider_1.configureProvider)(new animepahe_1.default()), {
        url: url,
    });
};
exports.default = routes;
