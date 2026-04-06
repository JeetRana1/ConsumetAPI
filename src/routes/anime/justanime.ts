import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { proxyGet } from '../../utils/outboundProxy';
import { toAxiosProxyOptions } from '../../utils/outboundProxy';
import axios from 'axios';
import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { Redis } from 'ioredis';
import Anilist from '@consumet/extensions/dist/providers/meta/anilist';

const anilist = new Anilist();

const resolveAniListIdByTitle = async (title: string): Promise<string | null> => {
    const query = String(title || '').trim();
    if (!query) return null;
    try {
        const searchRes = await anilist.search(query, 1, 1);
        return String(searchRes?.results?.[0]?.id || '').trim() || null;
    } catch {
        return null;
    }
};

const JUSTANIME_BASE = 'https://core.justanime.to/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Proxy-aware GET for JustAnime.
 * Priority: JUSTANIME_PROXY env var -> global OUTBOUND_PROXIES/PROXY -> direct.
 * Set JUSTANIME_PROXY=http://host:port in your .env to route JustAnime traffic
 * through a proxy when running locally.
 */
const jaGet = async (url: string, config: import('axios').AxiosRequestConfig = {}) => {
    const jaProxy = String(process.env.JUSTANIME_PROXY || '').trim();
    if (jaProxy) {
        try {
            const proxyOpts = toAxiosProxyOptions(jaProxy);
            return await axios.get(url, { ...config, ...(proxyOpts as any) });
        } catch {
            // fall through to global proxy / direct
        }
    }
    return proxyGet(url, config);
};


const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
    fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
        const query = (request.params as { query: string }).query;
        try {
            const res = await jaGet(`${JUSTANIME_BASE}/search/suggestions?query=${encodeURIComponent(query)}`, {
                headers: { 'User-Agent': UA, 'Referer': 'https://justanime.to/', 'Origin': 'https://justanime.to' }
            });
            const payload: any = res.data;

            const rows: any[] = Array.isArray(payload)
                ? payload
                : Array.isArray(payload?.results)
                    ? payload.results
                    : Array.isArray(payload?.data?.results)
                        ? payload.data.results
                        : Array.isArray(payload?.data)
                            ? payload.data
                            : [];

            const enrichedRows = await Promise.all(
                rows.map(async (row: any) => {
                    // row.title may be a nested object {english, romaji, native}
                    const titleObj = row?.title;
                    const title = typeof titleObj === 'string'
                        ? titleObj.trim()
                        : String(titleObj?.english || titleObj?.romaji || titleObj?.native || row?.name || '').trim();
                    if (!title) return row;
                    const anilistId = redis
                        ? await cache.fetch(
                            redis as Redis,
                            `justanime:anilist:title:${title}`,
                            async () => await resolveAniListIdByTitle(title),
                            REDIS_TTL,
                        )
                        : await resolveAniListIdByTitle(title);
                    return anilistId ? { ...row, anilistId } : row;
                }),
            );

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
        } catch (err: any) {
            console.error('JustAnime search error:', err.message);
            reply.status(200).send({ currentPage: 1, hasNextPage: false, results: [] });
        }
    });

    fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
        const id = (request.query as { id: string }).id;
        try {
            const fetchInfo = async () => {
                const [infoRes, epRes] = await Promise.all([
                    jaGet(`${JUSTANIME_BASE}/anime/${id}`, {
                        headers: { 'User-Agent': UA, 'Referer': 'https://justanime.to/', 'Origin': 'https://justanime.to' }
                    }),
                    jaGet(`${JUSTANIME_BASE}/anime/${id}/episodes`, {
                        headers: { 'User-Agent': UA, 'Referer': 'https://justanime.to/', 'Origin': 'https://justanime.to' }
                    })
                ]);

                const info = infoRes.data?.data;
                const episodes = (epRes.data?.data || []).map((ep: any) => ({
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
            reply.status(200).send({ id, title: '', episodes: [] });
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
                const res = await jaGet(`${JUSTANIME_BASE}/watch/${id}/episode/${ep}/hianime`, {
                    headers: { 'User-Agent': UA, 'Referer': 'https://justanime.to/', 'Origin': 'https://justanime.to' }
                });

                const data = res.data;
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
            reply.status(200).send({ sources: [], subtitles: [] });
        }
    });
};

export default routes;
