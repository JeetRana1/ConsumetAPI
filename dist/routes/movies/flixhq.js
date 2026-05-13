"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cache_1 = __importDefault(require("../../utils/cache"));
const main_1 = require("../../main");
const flixhqProvider_1 = require("../../providers/custom/flixhqProvider");
const isDirectMediaUrl = (value) => /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(value || '')) || /\/m3u8-proxy\?/i.test(String(value || ''));
const isUsableSourceUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw || /^blob:/i.test(raw))
        return false;
    try {
        const parsed = new URL(raw);
        const host = parsed.hostname.toLowerCase();
        if (host === 'example.com' || host.endsWith('.example.com'))
            return false;
        if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0')
            return false;
        if (host.includes('placeholder') || host.includes('dummy'))
            return false;
        return true;
    }
    catch {
        return false;
    }
};
const buildProxyHlsUrl = (request, sourceUrl) => {
    const raw = String(sourceUrl || '').trim();
    if (!raw)
        return raw;
    if (/^\/proxy\/hls\//i.test(raw)) {
        let host = String(request.headers.host || '').trim();
        if (!host)
            return raw;
        // Normalize localhost:80 to 127.0.0.1:3000 for internal calls
        if (host === 'localhost:80' || host === 'localhost') {
            host = '127.0.0.1:3000';
        }
        return `${request.protocol}://${host}${raw}`;
    }
    try {
        const parsed = new URL(raw);
        let host = String(request.headers.host || '').trim();
        if (!host)
            return raw;
        // Normalize localhost:80 to 127.0.0.1:3000 for internal calls
        if (host === 'localhost:80' || host === 'localhost') {
            host = '127.0.0.1:3000';
        }
        return `${request.protocol}://${host}/proxy/hls/${parsed.host}${parsed.pathname}${parsed.search}`;
    }
    catch {
        return raw;
    }
};
const sortAndLimitSources = (rawSources) => {
    const usable = rawSources.filter((item) => isUsableSourceUrl(String(item?.url || '')));
    const deduped = usable.filter((item, idx, arr) => arr.findIndex((v) => String(v?.url || '') === String(item?.url || '')) === idx);
    const hasMasterForBase = new Set(deduped
        .map((source) => String(source?.url || ''))
        .filter((url) => /\/master\.m3u8(?:\?|$)/i.test(url))
        .map((url) => url.replace(/\/master\.m3u8(?:\?.*)?$/i, '')));
    const collapsed = deduped.filter((source) => {
        const url = String(source?.url || '');
        const base = url.replace(/\/index-[^/]+\.m3u8(?:\?.*)?$/i, '');
        return !hasMasterForBase.has(base) || /\/master\.m3u8(?:\?|$)/i.test(url);
    });
    const direct = collapsed
        .filter((s) => isDirectMediaUrl(String(s?.url || '')))
        .sort((a, b) => {
        const score = (source) => {
            const url = String(source?.url || '');
            return ((/\.m3u8(?:\?|$)/i.test(url) || source?.isM3U8 ? 50 : 0) +
                (/\/master\.m3u8(?:\?|$)/i.test(url) || /\/index\.m3u8(?:\?|$)/i.test(url) ? 20 : 0) -
                (/\.mp4(?:\?|$)/i.test(url) ? 10 : 0));
        };
        return score(b) - score(a);
    });
    const nonDirect = collapsed.filter((s) => !isDirectMediaUrl(String(s?.url || '')));
    return [...direct.slice(0, 8), ...nonDirect.slice(0, 2)];
};
const routes = async (fastify, options) => {
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: `Welcome to the custom FlixHQ provider`,
            routes: [
                '/:query',
                '/search',
                '/info',
                '/watch',
                '/home',
                '/popular-movies',
                '/popular-tv',
                '/top-movies',
                '/top-tv',
                '/upcoming',
                '/servers',
            ],
            documentation: 'https://docs.consumet.org/#tag/flixhq',
        });
    });
    fastify.get('/home', async (request, reply) => {
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:home`, async () => await flixhqProvider_1.FlixHQProvider.fetchHome(), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.fetchHome();
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/:query', async (request, reply) => {
        const query = decodeURIComponent(request.params.query);
        const page = request.query.page || 1;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:search:${query}:${page}`, async () => await flixhqProvider_1.FlixHQProvider.search(query, page), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.search(query, page);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.post('/search', async (request, reply) => {
        const { query } = request.body;
        const page = 1; // Default to page 1 for POST
        if (!query) {
            return reply.status(400).send({ error: 'Query is required' });
        }
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:search:${query}:${page}`, async () => await flixhqProvider_1.FlixHQProvider.search(query, page), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.search(query, page);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/popular-movies', async (request, reply) => {
        const page = request.query.page || 1;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:popular-movies:${page}`, async () => await flixhqProvider_1.FlixHQProvider.fetchPopularMovies(page), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.fetchPopularMovies(page);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/popular-tv', async (request, reply) => {
        const page = request.query.page || 1;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:popular-tv:${page}`, async () => await flixhqProvider_1.FlixHQProvider.fetchPopularTv(page), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.fetchPopularTv(page);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/top-movies', async (request, reply) => {
        const page = request.query.page || 1;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:top-movies:${page}`, async () => await flixhqProvider_1.FlixHQProvider.fetchTopMovies(page), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.fetchTopMovies(page);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/top-tv', async (request, reply) => {
        const page = request.query.page || 1;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:top-tv:${page}`, async () => await flixhqProvider_1.FlixHQProvider.fetchTopTv(page), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.fetchTopTv(page);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/upcoming', async (request, reply) => {
        const page = request.query.page || 1;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:upcoming:${page}`, async () => await flixhqProvider_1.FlixHQProvider.fetchUpcoming(page), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.fetchUpcoming(page);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/info', async (request, reply) => {
        const id = request.query.id;
        if (typeof id === 'undefined') {
            return reply.status(400).send({ message: 'id is required' });
        }
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:info:${id}`, async () => await flixhqProvider_1.FlixHQProvider.fetchMediaInfo(id), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.fetchMediaInfo(id);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/servers', async (request, reply) => {
        const episodeId = request.query.episodeId;
        if (typeof episodeId === 'undefined') {
            return reply.status(400).send({ message: 'episodeId is required' });
        }
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:servers:${episodeId}`, async () => await flixhqProvider_1.FlixHQProvider.fetchServers(episodeId), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.fetchServers(episodeId);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/watch', async (request, reply) => {
        const episodeId = request.query.episodeId;
        const server = request.query.server || 'megacloud';
        if (typeof episodeId === 'undefined') {
            return reply.status(400).send({ message: 'episodeId is required' });
        }
        try {
            // Debug: log incoming request headers
            const hostHeader = String(request.headers.host || '').trim();
            const protocol = request.protocol;
            console.log('[FlixHQ Watch] Request host:', hostHeader, 'protocol:', protocol);
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixhq:watch:v3:${episodeId}:${server}`, async () => await flixhqProvider_1.FlixHQProvider.fetchSources(episodeId, server), main_1.REDIS_TTL)
                : await flixhqProvider_1.FlixHQProvider.fetchSources(episodeId, server);
            if (res && res.sources) {
                res.sources = sortAndLimitSources(res.sources).map((source) => {
                    const url = String(source?.url || '');
                    const shouldProxy = /\.(m3u8|mpd)(\?|$)/i.test(url) || Boolean(source?.isM3U8);
                    if (!shouldProxy)
                        return source;
                    return {
                        ...source,
                        url: buildProxyHlsUrl(request, url),
                        requiresProxy: false,
                    };
                });
            }
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
};
exports.default = routes;
