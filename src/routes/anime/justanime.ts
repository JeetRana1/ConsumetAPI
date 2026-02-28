import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { proxyGet } from '../../utils/outboundProxy';
import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { Redis } from 'ioredis';

const JUSTANIME_BASE = 'https://backend.justanime.to/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const COMMON_HEADERS = { 'User-Agent': UA, Referer: 'https://justanime.to/', Origin: 'https://justanime.to' };

const fetchJustAnime = async (path: string) =>
  proxyGet(`${JUSTANIME_BASE}${path}`, { headers: COMMON_HEADERS });

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
    const searchJustAnime = async (query: string) => {
        const encoded = encodeURIComponent(query);
        const candidates = [
            `/search/suggestions?query=${encoded}`,
            `/search?query=${encoded}`,
            `/anime/search?query=${encoded}`,
        ];

        let lastErr: any = null;
        for (const path of candidates) {
            try {
                return await fetchJustAnime(path);
            } catch (err: any) {
                lastErr = err;
            }
        }
        throw lastErr || new Error('JustAnime search failed');
    };

    fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
        const query = (request.params as { query: string }).query;
        try {
            const res = await searchJustAnime(query);
            const payload = res?.data?.data ?? res?.data ?? [];
            reply.status(200).send(payload);
        } catch (err: any) {
            console.error('JustAnime search error:', err.message);
            reply.status(500).send({ message: 'Error searching JustAnime', error: err.message });
        }
    });

    fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
        const id = (request.query as { id: string }).id;
        try {
            const fetchInfo = async () => {
                const [infoRes, epRes] = await Promise.all([
                    fetchJustAnime(`/anime/${id}`),
                    fetchJustAnime(`/anime/${id}/episodes`)
                ]);

                const infoPayload = (infoRes?.data?.data ?? infoRes?.data ?? {}) as any;
                const rawEpisodes = epRes?.data?.data ?? epRes?.data?.episodes ?? epRes?.data ?? [];
                const episodes = (Array.isArray(rawEpisodes) ? rawEpisodes : []).map((ep: any) => ({
                    id: `${id}$episode$${ep.number}`,
                    number: ep.number,
                    title: ep.title,
                    isFiller: ep.isFiller
                }));

                return {
                    ...(typeof infoPayload === 'object' && infoPayload ? infoPayload : {}),
                    episodes
                };
            };

            const res = redis
                ? await cache.fetch(
                    redis as Redis,
                    `justanime:info:${id}`,
                    fetchInfo,
                    REDIS_TTL
                )
                : await fetchInfo();

            reply.status(200).send(res);
        } catch (err: any) {
            console.error('JustAnime info error:', err.message);
            reply.status(500).send({ message: 'Error fetching info from JustAnime', error: err.message });
        }
    });

    fastify.get('/watch/:episodeId', async (request: FastifyRequest, reply: FastifyReply) => {
        const episodeId = (request.params as { episodeId: string }).episodeId;
        // Format: anilistId$episode$number
        const parts = episodeId.split('$episode$');
        const id = parts[0];
        const ep = parts[1] || '1';

        try {
            const fetchWatch = async () => {
                const res = await fetchJustAnime(`/watch/${id}/episode/${ep}/hianime`);

                const data = (res?.data?.data ?? res?.data ?? {}) as any;
                if (Array.isArray(data?.sources) && data.sources.length > 0) {
                    return {
                        headers: { Referer: 'https://justanime.to/' },
                        sources: data.sources,
                        subtitles: data.subtitles || [],
                        intro: data.intro,
                        outro: data.outro
                    };
                }
                const sub = data.sub?.sources || { sources: [], tracks: [] };
                const dub = data.dub?.sources || { sources: [], tracks: [] };

                const sources = [
                    ...(sub.sources || []).map((s: any) => ({
                        url: s.file,
                        quality: 'Subbed',
                        isM3U8: String(s.file).includes('.m3u8'),
                        isSub: true
                    })),
                    ...(dub.sources || []).map((s: any) => ({
                        url: s.file,
                        quality: 'Dubbed',
                        isM3U8: String(s.file).includes('.m3u8'),
                        isSub: false
                    }))
                ];

                const subtitles = [
                    ...(sub.tracks || []).map((t: any) => ({ ...t, url: t.file })),
                    ...(dub.tracks || []).map((t: any) => ({ ...t, url: t.file }))
                ];

                return {
                    headers: { Referer: 'https://justanime.to/' },
                    sources,
                    subtitles,
                    intro: data.sub?.intro || data.dub?.intro,
                    outro: data.sub?.outro || data.dub?.outro
                };
            };

            const res = redis
                ? await cache.fetch(
                    redis as Redis,
                    `justanime:watch:${episodeId}`,
                    fetchWatch,
                    REDIS_TTL
                )
                : await fetchWatch();

            reply.status(200).send(res);
        } catch (err: any) {
            console.error('JustAnime watch error:', err.message);
            reply.status(500).send({ message: 'Error fetching sources from JustAnime', error: err.message });
        }
    });
};

export default routes;
