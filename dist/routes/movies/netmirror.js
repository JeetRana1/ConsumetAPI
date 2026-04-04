"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cache_1 = __importDefault(require("../../utils/cache"));
const main_1 = require("../../main");
const NETMIRROR_BASE_URL = process.env.NETMIRROR_BASE_URL || 'https://net20.cc';
const NETMIRROR_T_HASH_T = process.env.NETMIRROR_T_HASH_T;
const NETMIRROR_DEFAULT_OTT = process.env.NETMIRROR_OTT || 'nf';
const parseJson = (res) => __awaiter(void 0, void 0, void 0, function* () {
    const text = yield res.text();
    try {
        return JSON.parse(text);
    }
    catch (_a) {
        throw new Error(`Invalid JSON response (${res.status})`);
    }
});
const getCookies = (ott) => __awaiter(void 0, void 0, void 0, function* () {
    var _b;
    const initRes = yield fetch(`${NETMIRROR_BASE_URL}/p.php`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'init=1',
    });
    const setCookie = initRes.headers.get('set-cookie') || '';
    if (!setCookie)
        throw new Error('NetMirror cookie bootstrap failed');
    const tHash = ((_b = /t_hash=([^;]+)/i.exec(setCookie)) === null || _b === void 0 ? void 0 : _b[1]) || '';
    const cookieParts = [];
    if (NETMIRROR_T_HASH_T)
        cookieParts.push(`t_hash_t=${NETMIRROR_T_HASH_T}`);
    cookieParts.push(`t_hash=${tHash}`);
    cookieParts.push(`ott=${ott || NETMIRROR_DEFAULT_OTT}`);
    return cookieParts.join('; ');
});
const netmirrorGet = (path, ott) => __awaiter(void 0, void 0, void 0, function* () {
    const cookie = yield getCookies(ott || NETMIRROR_DEFAULT_OTT);
    const res = yield fetch(`${NETMIRROR_BASE_URL}${path}`, {
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
            Referer: `${NETMIRROR_BASE_URL}/home`,
            Cookie: cookie,
        },
    });
    if (!res.ok) {
        throw new Error(`NetMirror request failed: ${res.status}`);
    }
    return parseJson(res);
});
const parseEpisodeNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
};
const toQuality = (label) => {
    const val = String(label || '').toLowerCase();
    if (val.includes('full') || val.includes('1080'))
        return '1080p';
    if (val.includes('mid') || val.includes('720'))
        return '720p';
    if (val.includes('low') || val.includes('480'))
        return '480p';
    return 'auto';
};
const mapSubtitles = (tracks) => {
    if (!Array.isArray(tracks))
        return [];
    return tracks
        .filter((track) => String((track === null || track === void 0 ? void 0 : track.kind) || '').toLowerCase() === 'captions')
        .map((track) => ({
        url: String(track.file || '').startsWith('//') ? `https:${track.file}` : track.file,
        lang: track.label || track.language || 'Unknown',
    }))
        .filter((track) => Boolean(track.url));
};
const routes = (fastify, options) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.get('/', (_, reply) => {
        reply.status(200).send({
            intro: `Welcome to the netmirror provider: extraction pipeline @ ${NETMIRROR_BASE_URL}`,
            routes: [
                '/:query',
                '/info',
                '/watch',
                '/recent-shows',
                '/recent-movies',
                '/trending',
                '/servers',
            ],
            documentation: 'https://docs.consumet.org/#tag/movies',
        });
    });
    fastify.get('/:query', (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const query = decodeURIComponent(request.params.query || '');
        const page = Number(request.query.page || 1);
        const ott = String(request.query.ott || NETMIRROR_DEFAULT_OTT);
        const cacheKey = `netmirror:search:${query}:${page}:${ott}`;
        try {
            const res = main_1.redis
                ? yield cache_1.default.fetch(main_1.redis, cacheKey, () => __awaiter(void 0, void 0, void 0, function* () { return yield netmirrorGet(`/search.php?s=${encodeURIComponent(query)}&t=x`, ott); }), main_1.REDIS_TTL)
                : yield netmirrorGet(`/search.php?s=${encodeURIComponent(query)}&t=x`, ott);
            const rows = Array.isArray(res === null || res === void 0 ? void 0 : res.searchResult) ? res.searchResult : [];
            const results = rows.map((item) => ({
                id: item.id,
                title: item.t,
                image: `https://imgcdn.kim/poster/342/${item.id}.jpg`,
                type: 'MOVIE',
            }));
            reply.status(200).send({
                currentPage: page,
                hasNextPage: false,
                results,
            });
        }
        catch (err) {
            reply.status(500).send({ message: err instanceof Error ? err.message : String(err) });
        }
    }));
    fastify.get('/info', (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const id = request.query.id;
        const ott = String(request.query.ott || NETMIRROR_DEFAULT_OTT);
        if (!id)
            return reply.status(400).send({ message: 'id is required' });
        const cacheKey = `netmirror:info:${id}:${ott}`;
        try {
            let data = main_1.redis
                ? yield cache_1.default.fetch(main_1.redis, cacheKey, () => __awaiter(void 0, void 0, void 0, function* () { return yield netmirrorGet(`/post.php?id=${encodeURIComponent(id)}&t=x`, ott); }), main_1.REDIS_TTL)
                : yield netmirrorGet(`/post.php?id=${encodeURIComponent(id)}&t=x`, ott);
            // NetMirror may return anti-bot payloads for post.php ("Invalid User").
            // Fallback to a minimal info payload so clients can still use id for /watch.
            if (String((data === null || data === void 0 ? void 0 : data.status) || '').toLowerCase() === 'n') {
                const search = yield netmirrorGet(`/search.php?s=${encodeURIComponent(id)}&t=x`, ott);
                const match = (Array.isArray(search === null || search === void 0 ? void 0 : search.searchResult) ? search.searchResult.find((r) => r.id === id) : undefined) ||
                    (Array.isArray(search === null || search === void 0 ? void 0 : search.searchResult) ? search.searchResult[0] : undefined);
                data = {
                    title: (match === null || match === void 0 ? void 0 : match.t) || id,
                    type: 'm',
                    genre: '',
                    runtime: '',
                    desc: '',
                    m_desc: '',
                    year: '',
                    episodes: [{ id, t: (match === null || match === void 0 ? void 0 : match.t) || id, s: 'S1', ep: '1' }],
                };
            }
            const isTv = String((data === null || data === void 0 ? void 0 : data.type) || '').toLowerCase() === 't';
            const episodes = Array.isArray(data === null || data === void 0 ? void 0 : data.episodes) && data.episodes.length
                ? data.episodes.map((ep) => ({
                    id: ep.id,
                    title: ep.t,
                    number: parseEpisodeNumber(ep.ep),
                    season: parseEpisodeNumber(String(ep.s || '').replace(/^s/i, '')),
                    description: ep.ep_desc || '',
                    duration: ep.time || '',
                }))
                : [
                    {
                        id,
                        title: (data === null || data === void 0 ? void 0 : data.title) || (isTv ? 'Episode 1' : 'Full Movie'),
                    },
                ];
            reply.status(200).send({
                id,
                title: (data === null || data === void 0 ? void 0 : data.title) || '',
                image: `https://imgcdn.kim/poster/780/${id}.jpg`,
                cover: `https://imgcdn.kim/poster/1920/${id}.jpg`,
                type: isTv ? 'TV Series' : 'Movie',
                genres: String((data === null || data === void 0 ? void 0 : data.genre) || '')
                    .split(',')
                    .map((g) => g.trim())
                    .filter(Boolean),
                duration: (data === null || data === void 0 ? void 0 : data.runtime) || '',
                description: (data === null || data === void 0 ? void 0 : data.desc) || (data === null || data === void 0 ? void 0 : data.m_desc) || '',
                year: (data === null || data === void 0 ? void 0 : data.year) || '',
                episodes,
            });
        }
        catch (err) {
            reply.status(500).send({ message: err instanceof Error ? err.message : String(err) });
        }
    }));
    fastify.get('/watch', (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const episodeId = request.query.episodeId;
        const ott = String(request.query.ott || NETMIRROR_DEFAULT_OTT);
        if (!episodeId)
            return reply.status(400).send({ message: 'episodeId is required' });
        const cacheKey = `netmirror:watch:${episodeId}:${ott}`;
        try {
            const playlistRows = main_1.redis
                ? yield cache_1.default.fetch(main_1.redis, cacheKey, () => __awaiter(void 0, void 0, void 0, function* () {
                    return yield netmirrorGet(`/playlist.php?id=${encodeURIComponent(episodeId)}&t=Video&tm=${Date.now()}`, ott);
                }), main_1.REDIS_TTL)
                : yield netmirrorGet(`/playlist.php?id=${encodeURIComponent(episodeId)}&t=Video&tm=${Date.now()}`, ott);
            const playlist = Array.isArray(playlistRows) ? playlistRows[0] : undefined;
            const rows = Array.isArray(playlist === null || playlist === void 0 ? void 0 : playlist.sources) ? playlist.sources : [];
            const sources = rows
                .map((source) => {
                const file = String(source.file || '').trim();
                if (!file)
                    return null;
                const fullUrl = file.startsWith('http') ? file : `${NETMIRROR_BASE_URL}${file}`;
                return {
                    url: fullUrl,
                    quality: toQuality(source.label),
                    isM3U8: /\.m3u8(\?|$)/i.test(fullUrl) || true,
                };
            })
                .filter(Boolean);
            if (!sources.length) {
                return reply.status(404).send({ message: 'No sources found for this episode' });
            }
            const subtitles = mapSubtitles(playlist === null || playlist === void 0 ? void 0 : playlist.tracks);
            reply.status(200).send({
                headers: { Referer: `${NETMIRROR_BASE_URL}/` },
                sources,
                subtitles,
            });
        }
        catch (err) {
            reply.status(404).send({ message: err instanceof Error ? err.message : String(err) });
        }
    }));
    fastify.get('/servers', (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const episodeId = request.query.episodeId;
        if (!episodeId)
            return reply.status(400).send({ message: 'episodeId is required' });
        reply.status(200).send([
            {
                name: 'NetMirror',
                url: `${NETMIRROR_BASE_URL}/playlist.php?id=${encodeURIComponent(episodeId)}`,
            },
        ]);
    }));
    fastify.get('/recent-movies', (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const ott = String(request.query.ott || NETMIRROR_DEFAULT_OTT);
        const cacheKey = `netmirror:recent-movies:${ott}`;
        try {
            const res = main_1.redis
                ? yield cache_1.default.fetch(main_1.redis, cacheKey, () => __awaiter(void 0, void 0, void 0, function* () { return yield netmirrorGet('/search.php?s=new&t=x', ott); }), main_1.REDIS_TTL)
                : yield netmirrorGet('/search.php?s=new&t=x', ott);
            const rows = Array.isArray(res === null || res === void 0 ? void 0 : res.searchResult) ? res.searchResult : [];
            reply.status(200).send(rows.map((item) => ({
                id: item.id,
                title: item.t,
                image: `https://imgcdn.kim/poster/342/${item.id}.jpg`,
                type: 'MOVIE',
            })));
        }
        catch (err) {
            reply.status(500).send({ message: err instanceof Error ? err.message : String(err) });
        }
    }));
    fastify.get('/recent-shows', (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        // NetMirror API does not split "recent shows" separately; reuse recent list.
        const ott = String(request.query.ott || NETMIRROR_DEFAULT_OTT);
        const cacheKey = `netmirror:recent-shows:${ott}`;
        try {
            const res = main_1.redis
                ? yield cache_1.default.fetch(main_1.redis, cacheKey, () => __awaiter(void 0, void 0, void 0, function* () { return yield netmirrorGet('/search.php?s=new&t=x', ott); }), main_1.REDIS_TTL)
                : yield netmirrorGet('/search.php?s=new&t=x', ott);
            const rows = Array.isArray(res === null || res === void 0 ? void 0 : res.searchResult) ? res.searchResult : [];
            reply.status(200).send(rows.map((item) => ({
                id: item.id,
                title: item.t,
                image: `https://imgcdn.kim/poster/342/${item.id}.jpg`,
                type: 'TV Series',
            })));
        }
        catch (err) {
            reply.status(500).send({ message: err instanceof Error ? err.message : String(err) });
        }
    }));
    fastify.get('/trending', (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const ott = String(request.query.ott || NETMIRROR_DEFAULT_OTT);
        const cacheKey = `netmirror:trending:${ott}`;
        try {
            const res = main_1.redis
                ? yield cache_1.default.fetch(main_1.redis, cacheKey, () => __awaiter(void 0, void 0, void 0, function* () { return yield netmirrorGet('/search.php?s=new&t=x', ott); }), main_1.REDIS_TTL)
                : yield netmirrorGet('/search.php?s=new&t=x', ott);
            const rows = (Array.isArray(res === null || res === void 0 ? void 0 : res.searchResult) ? res.searchResult : []).slice(0, 10);
            reply.status(200).send(rows.map((item) => ({
                id: item.id,
                title: item.t,
                image: `https://imgcdn.kim/poster/342/${item.id}.jpg`,
                type: 'MOVIE',
            })));
        }
        catch (err) {
            reply.status(500).send({ message: err instanceof Error ? err.message : String(err) });
        }
    }));
});
exports.default = routes;
