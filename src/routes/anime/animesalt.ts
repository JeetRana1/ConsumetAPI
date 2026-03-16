import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import * as cheerio from 'cheerio';
import { proxyGet, proxyPost } from '../../utils/outboundProxy';
import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { Redis } from 'ioredis';


const BASE_URL = 'https://animesalt.ac';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
    // ─── Search ──────────────────────────────────────────────────────────────────
    fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
        const query = (request.params as { query: string }).query;
        try {
            const fetchSearch = async () => {
                const res = await proxyGet(`${BASE_URL}/?s=${encodeURIComponent(query)}`, {
                    headers: { 'User-Agent': UA }
                });
                const $ = cheerio.load(res.data);
                const results: any[] = [];

                $('article.movies').each((_, el) => {
                    const title = $(el).find('h2').text().trim();
                    const url = $(el).find('a.lnk-blk').attr('href');
                    const image = $(el).find('img').attr('data-src') || $(el).find('img').attr('src');
                    const id = url?.split('/series/')[1]?.replace('/', '');

                    if (id) {
                        results.push({
                            id,
                            title,
                            url,
                            image: image?.startsWith('//') ? `https:${image}` : image
                        });
                    }
                });

                return results;
            };

            const results = redis
                ? await cache.fetch(redis as Redis, `animesalt:search:${query}`, fetchSearch, REDIS_TTL)
                : await fetchSearch();

            reply.status(200).send(results);
        } catch (err: any) {
            reply.status(500).send({ message: 'Error searching AnimeSalt', error: err.message });
        }
    });

    // ─── Info ─────────────────────────────────────────────────────────────────────
    fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
        const id = (request.query as { id: string }).id;
        try {
            const fetchInfo = async () => {
                const res = await proxyGet(`${BASE_URL}/series/${id}/`, {
                    headers: { 'User-Agent': UA }
                });
                const $ = cheerio.load(res.data);
                const title = $('h1').first().text().trim();
                const description = $('.wp-content p').first().text().trim() || $('.description p').first().text().trim();
                const image = $('.poster img').attr('src') || $('.poster img').attr('data-src');

                const genres: string[] = [];
                $('.hentry.series .category a').each((_, el) => {
                    genres.push($(el).text().trim());
                });

                const episodes: any[] = [];
                $('article.episodes').each((_, el) => {
                    const epUrl = $(el).find('a.lnk-blk').attr('href');
                    const epId = epUrl?.split('/episode/')[1]?.replace('/', '');
                    const epTitle = $(el).find('.entry-title').text().trim();
                    const epNum = $(el).find('.num-epi').text().trim();
                    if (epId) {
                        episodes.push({
                            id: epId,
                            title: epTitle,
                            number: parseInt(epNum) || 0,
                            url: epUrl
                        });
                    }
                });

                return {
                    id,
                    title,
                    description,
                    image: image?.startsWith('//') ? `https:${image}` : image,
                    genres,
                    episodes // Already in ascending order (ep 1 first)
                };
            };

            const info = redis
                ? await cache.fetch(redis as Redis, `animesalt:info:${id}`, fetchInfo, REDIS_TTL)
                : await fetchInfo();

            reply.status(200).send(info);
        } catch (err: any) {
            reply.status(500).send({ message: 'Error fetching info from AnimeSalt', error: err.message });
        }
    });

    // ─── Watch ────────────────────────────────────────────────────────────────────
    fastify.get('/watch/:episodeId', async (request: FastifyRequest, reply: FastifyReply) => {
        const episodeId = (request.params as { episodeId: string }).episodeId;
        try {
            // AnimeSalt m3u8 URLs are signed (md5 + expires) — never cache.
            // Return the raw signed URL; the player's proxiedStreamUrl() wraps it
            // in /utils/proxy with the correct Referer, and the proxy rewrites all
            // variant/segment URLs so HLS.js never touches the CDN directly.

            const res = await proxyGet(`${BASE_URL}/episode/${episodeId}/`, {
                headers: { 'User-Agent': UA }
            });
            const $ = cheerio.load(res.data);
            const sources: any[] = [];
            const subtitles: any[] = [];

            // ── Server 1 (as-cdn21.top) ──────────────────────────────────────────
            const iframe1 = $('#options-0 iframe').attr('data-src') || $('#options-0 iframe').attr('src');
            if (iframe1) {
                try {
                    const embedUrl = new URL(iframe1);
                    const videoId = embedUrl.pathname.split('/').pop();
                    const origin = embedUrl.origin;

                    // Step 1 – load the player page to obtain session cookies
                    const pageRes = await proxyGet(iframe1, {
                        headers: { 'User-Agent': UA, 'Referer': BASE_URL }
                    });
                    const cookies = (pageRes.headers['set-cookie'] as string[] | undefined)
                        ?.map((c: string) => c.split(';')[0])
                        .join('; ') || '';

                    const subMatch = pageRes.data.match(/var\s+playerjsSubtitle\s*=\s*(["'])(.+?)\1/);
                    if (subMatch) {
                        const rawSubtitleStr = subMatch[2];
                        const parts = rawSubtitleStr.split(',');
                        for (const part of parts) {
                            const langMatch = part.match(/^\[(.*?)\](.*)$/);
                            if (langMatch) {
                                subtitles.push({
                                    lang: langMatch[1],
                                    url: langMatch[2],
                                    referer: iframe1
                                });
                            }
                        }
                    }

                    // Step 2 – POST to getVideo API for the signed m3u8 URL
                    const apiRes = await proxyPost(
                        `${origin}/player/index.php?data=${videoId}&do=getVideo`,
                        `hash=${videoId}&r=${encodeURIComponent(BASE_URL)}`,
                        {
                            headers: {
                                'User-Agent': UA,
                                'Referer': iframe1,
                                'X-Requested-With': 'XMLHttpRequest',
                                'Content-Type': 'application/x-www-form-urlencoded',
                                'Cookie': cookies
                            }
                        }
                    );

                    if (apiRes.data?.videoSource) {
                        // Return the raw signed m3u8 URL with the iframe as referer.
                        // The player's proxiedStreamUrl() wraps it in /utils/proxy,
                        // and the proxy's m3u8 rewriter rewrites all segment URLs.
                        sources.push({
                            url: String(apiRes.data.videoSource),
                            isM3U8: true,
                            quality: 'Default',
                            referer: iframe1
                        });
                    } else {
                        // Fallback: return the iframe itself
                        sources.push({
                            url: iframe1,
                            isIframe: true,
                            quality: 'Server 1 (Iframe)'
                        });
                    }
                } catch (_e) {
                    sources.push({
                        url: iframe1,
                        isIframe: true,
                        quality: 'Server 1 (Iframe)'
                    });
                }
            }

            reply.status(200).send({
                headers: { Referer: BASE_URL },
                sources,
                subtitles
            });
        } catch (err: any) {
            reply.status(500).send({ message: 'Error fetching sources from AnimeSalt', error: err.message });
        }
    });
};

export default routes;
