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
                    
                    let id = '';
                    if (url?.includes('/series/')) {
                        id = url.split('/series/')[1].split('/')[0];
                    } else if (url?.includes('/movies/')) {
                        id = 'movie:' + url.split('/movies/')[1].split('/')[0];
                    }

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
                const isMovie = id.startsWith('movie:');
                const slug = isMovie ? id.replace('movie:', '') : id;
                const type = isMovie ? 'movies' : 'series';

                const res = await proxyGet(`${BASE_URL}/${type}/${slug}/`, {
                    headers: { 'User-Agent': UA }
                });
                const $ = cheerio.load(res.data);
                const title = $('h1').first().text().trim();
                const description = $('.wp-content p').first().text().trim() || $('.description p').first().text().trim();
                const image = $('.poster img').attr('src') || $('.poster img').attr('data-src');

                const genres: string[] = [];
                $('.category a').each((_, el) => {
                    const genre = $(el).text().trim();
                    if (genre && !genres.includes(genre)) {
                        genres.push(genre);
                    }
                });

                const episodes: any[] = [];
                $('article.episodes').each((_, el) => {
                    const epUrl = $(el).find('a.lnk-blk').attr('href');
                    const epId = epUrl?.split('/episode/')[1]?.replace(/\/$/, '');
                    const epTitle = $(el).find('.entry-title').text().trim();
                    const epNumStr = $(el).find('.num-epi').text().trim();
                    
                    // Robust numeric extraction for episode numbers (e.g., "Season 1 Ep 25" -> 25)
                    const numMatch = epNumStr.match(/(\d+)/);
                    const epNumber = numMatch ? parseInt(numMatch[1]) : 0;

                    if (epId) {
                        episodes.push({
                            id: epId,
                            title: epTitle,
                            number: epNumber,
                            url: epUrl
                        });
                    }
                });

                // For movies: if no episodes found in the dedicated episodes list,
                // treat the movie page itself as the single episode.
                if (isMovie && episodes.length === 0) {
                    episodes.push({
                        id: id, // e.g. "movie:jujutsu-kaisen-0"
                        title: title,
                        number: 1,
                        url: `${BASE_URL}/movies/${slug}/`
                    });
                }

                // Sort episodes numerically (ascending) to guarantee ep 1 is always first in the list.
                // This prevents "wrong video" issues when the site's layout varies.
                episodes.sort((a, b) => a.number - b.number);

                return {
                    id,
                    title,
                    description,
                    image: image?.startsWith('//') ? `https:${image}` : image,
                    genres,
                    episodes
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
            const isMovie = episodeId.startsWith('movie:');
            const slug = isMovie ? episodeId.replace('movie:', '') : episodeId;
            const watchUrl = isMovie 
                ? `${BASE_URL}/movies/${slug}/` 
                : `${BASE_URL}/episode/${episodeId}/`;

            const res = await proxyGet(watchUrl, {
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
                    // More robust videoId extraction (handles trailing slashes)
                    const videoId = embedUrl.pathname.split('/').filter(p => !!p && p !== 'v').pop();
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
