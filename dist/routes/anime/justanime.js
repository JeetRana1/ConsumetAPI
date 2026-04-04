"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const outboundProxy_1 = require("../../utils/outboundProxy");
const cache_1 = __importDefault(require("../../utils/cache"));
const main_1 = require("../../main");
const anilist_1 = __importDefault(require("@consumet/extensions/dist/providers/meta/anilist"));
const anilist = new anilist_1.default();
const resolveAniListIdByTitle = async (title) => {
    const query = String(title || '').trim();
    if (!query)
        return null;
    try {
        const searchRes = await anilist.search(query, 1, 1);
        return String(searchRes?.results?.[0]?.id || '').trim() || null;
    }
    catch {
        return null;
    }
};
const JUSTANIME_BASE = 'https://core.justanime.to/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const routes = async (fastify, options) => {
    fastify.get('/:query', async (request, reply) => {
        const query = request.params.query;
        try {
            const res = await (0, outboundProxy_1.proxyGet)(`${JUSTANIME_BASE}/search/suggestions?query=${encodeURIComponent(query)}`, {
                headers: { 'User-Agent': UA, 'Referer': 'https://justanime.to/', 'Origin': 'https://justanime.to' }
            });
            const payload = res.data;
            const rows = Array.isArray(payload)
                ? payload
                : Array.isArray(payload?.results)
                    ? payload.results
                    : Array.isArray(payload?.data?.results)
                        ? payload.data.results
                        : Array.isArray(payload?.data)
                            ? payload.data
                            : [];
            const enrichedRows = await Promise.all(rows.map(async (row) => {
                const title = String(row?.title || row?.name || row?.romaji || row?.english || '').trim();
                if (!title)
                    return row;
                const anilistId = main_1.redis
                    ? await cache_1.default.fetch(main_1.redis, `justanime:anilist:title:${title}`, async () => await resolveAniListIdByTitle(title), main_1.REDIS_TTL)
                    : await resolveAniListIdByTitle(title);
                return anilistId ? { ...row, anilistId } : row;
            }));
            if (Array.isArray(payload)) {
                return reply.status(200).send(enrichedRows);
            }
            if (Array.isArray(payload?.results)) {
                return reply.status(200).send({ ...payload, results: enrichedRows });
            }
            if (Array.isArray(payload?.data?.results)) {
                return reply.status(200).send({
                    ...payload,
                    data: {
                        ...payload.data,
                        results: enrichedRows,
                    },
                });
            }
            if (Array.isArray(payload?.data)) {
                return reply.status(200).send({ ...payload, data: enrichedRows });
            }
            reply.status(200).send(payload);
        }
        catch (err) {
            console.error('JustAnime search error:', err.message);
            reply.status(200).send({ currentPage: 1, hasNextPage: false, results: [] });
        }
    });
    fastify.get('/info', async (request, reply) => {
        const id = request.query.id;
        try {
            const fetchInfo = async () => {
                const [infoRes, epRes] = await Promise.all([
                    (0, outboundProxy_1.proxyGet)(`${JUSTANIME_BASE}/anime/${id}`, {
                        headers: { 'User-Agent': UA, 'Referer': 'https://justanime.to/', 'Origin': 'https://justanime.to' }
                    }),
                    (0, outboundProxy_1.proxyGet)(`${JUSTANIME_BASE}/anime/${id}/episodes`, {
                        headers: { 'User-Agent': UA, 'Referer': 'https://justanime.to/', 'Origin': 'https://justanime.to' }
                    })
                ]);
                const info = infoRes.data?.data;
                const episodes = (epRes.data?.data || []).map((ep) => ({
                    id: `${id}$episode$${ep.number}`,
                    number: ep.number,
                    title: ep.title,
                    isFiller: ep.isFiller
                }));
                const anilistId = await resolveAniListIdByTitle(info?.title || id);
                console.log('info is', info);
                console.log('episodes is', episodes);
                return {
                    ...info,
                    episodes,
                    anilistId
                };
            };
            const res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `justanime:info:${id}`, fetchInfo, main_1.REDIS_TTL)
                : await fetchInfo();
            reply.status(200).send(res);
        }
        catch (err) {
            console.error('JustAnime info error:', err.message);
            reply.status(200).send({ id, title: '', episodes: [] });
        }
    });
    fastify.get('/watch/:episodeId', async (request, reply) => {
        const episodeId = request.params.episodeId;
        // Format: anilistId$episode$number
        const parts = episodeId.split('$episode$');
        const id = parts[0];
        const ep = parts[1] || '1';
        try {
            const fetchWatch = async () => {
                const res = await (0, outboundProxy_1.proxyGet)(`${JUSTANIME_BASE}/watch/${id}/episode/${ep}/hianime`, {
                    headers: { 'User-Agent': UA, 'Referer': 'https://justanime.to/', 'Origin': 'https://justanime.to' }
                });
                const data = res.data;
                const sub = data.sub?.sources || { sources: [], tracks: [] };
                const dub = data.dub?.sources || { sources: [], tracks: [] };
                const sources = [
                    ...(sub.sources || []).map((s) => ({
                        url: s.file,
                        quality: 'Subbed',
                        isM3U8: String(s.file).includes('.m3u8'),
                        isSub: true
                    })),
                    ...(dub.sources || []).map((s) => ({
                        url: s.file,
                        quality: 'Dubbed',
                        isM3U8: String(s.file).includes('.m3u8'),
                        isSub: false
                    }))
                ];
                const subtitles = [
                    ...(sub.tracks || []).map((t) => ({ ...t, url: t.file })),
                    ...(dub.tracks || []).map((t) => ({ ...t, url: t.file }))
                ];
                return {
                    headers: { Referer: 'https://justanime.to/' },
                    sources,
                    subtitles,
                    intro: data.sub?.intro || data.dub?.intro,
                    outro: data.sub?.outro || data.dub?.outro
                };
            };
            const res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `justanime:watch:${episodeId}`, fetchWatch, main_1.REDIS_TTL)
                : await fetchWatch();
            reply.status(200).send(res);
        }
        catch (err) {
            console.error('JustAnime watch error:', err.message);
            reply.status(200).send({ sources: [], subtitles: [] });
        }
    });
};
exports.default = routes;
