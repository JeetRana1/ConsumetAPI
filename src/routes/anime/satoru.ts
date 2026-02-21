import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { AnimeParser, ISearch, IAnimeResult, IAnimeInfo, IEpisodeServer, ISource, MediaFormat, MediaStatus } from '@consumet/extensions/dist/models';
import { load } from 'cheerio';
import Redis from 'ioredis/built';
import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { configureProvider } from '../../utils/provider';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

class SatoruProvider extends AnimeParser {
    name = 'Satoru';
    baseUrl = 'https://satoru.one';
    logo = 'https://satoru.one/satoru-full-logo.png';
    classPath = 'ANIME.Satoru';

    private async fetch(url: string, headers: any = {}): Promise<string> {
        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
        let command = `curl.exe -s -L -H "User-Agent: ${userAgent}"`;
        for (const [key, value] of Object.entries(headers)) {
            if (key.toLowerCase() !== 'user-agent') {
                command += ` -H "${key}: ${value}"`;
            }
        }
        command += ` "${url}"`;
        const { stdout } = await execPromise(command, { maxBuffer: 1024 * 1024 * 50 });
        return stdout;
    }

    async search(query: string, page: number = 1): Promise<ISearch<IAnimeResult>> {
        const data = await this.fetch(`${this.baseUrl}/filter?keyword=${encodeURIComponent(query)}&page=${page}`, {
            'Referer': this.baseUrl,
        });
        const $ = load(data);
        const results: IAnimeResult[] = [];

        $('.flw-item').each((i, el) => {
            const card = $(el);
            const title = card.find('.film-name a').text().trim();
            const href = card.find('.film-name a').attr('href') || '';
            const slug = href.split('/').pop() || '';
            // movieId is the numeric data-id on the poster anchor
            const movieId = card.find('.film-poster-ahref').attr('data-id') || '';
            // id format: "slug:movieId" to carry both pieces of info
            const id = movieId ? `${slug}:${movieId}` : slug;
            const image = card.find('img').attr('data-src') || card.find('img').attr('src');

            const typeStr = card.find('.fdi-item').first().text().trim().toUpperCase();
            let type: MediaFormat | undefined;
            if (typeStr === 'TV') type = MediaFormat.TV;
            else if (typeStr === 'MOVIE') type = MediaFormat.MOVIE;
            else if (typeStr === 'OVA') type = MediaFormat.OVA;
            else if (typeStr === 'ONA') type = MediaFormat.ONA;
            else if (typeStr === 'SPECIAL') type = MediaFormat.SPECIAL;

            results.push({
                id,
                title,
                image,
                url: `${this.baseUrl}/watch/${slug}`,
                type,
            });
        });

        return {
            currentPage: page,
            hasNextPage: $('.pagination .active').next().length > 0,
            results,
        };
    }

    async fetchAnimeInfo(id: string): Promise<IAnimeInfo> {
        // id can be "slug:movieId" or just a slug
        const parts = id.split(':');
        const slug = parts[0];
        let movieId = parts[1] || '';

        const data = await this.fetch(`${this.baseUrl}/watch/${slug}`, {
            'Referer': this.baseUrl,
        });
        const $ = load(data);

        // Extract movieId from the inline script: const movieId = 3;
        if (!movieId) {
            const movieIdMatch = data.match(/const movieId = (\d+);/);
            movieId = movieIdMatch ? movieIdMatch[1] : '';
        }

        const animeInfo: IAnimeInfo = {
            id,
            title: $('h2.film-name a.dynamic-name, .anisc-detail h2.film-name a').first().text().trim(),
            image: $('.anisc-poster .film-poster-img').attr('src'),
            description: $('.film-description p.text').text().trim(),
            episodes: [],
        };

        $('.anisc-info .item-title').each((i, el) => {
            const item = $(el);
            const label = item.find('.item-head').text().toLowerCase();
            const value = item.find('.name').text().trim();
            if (label.includes('japanese')) animeInfo.japaneseTitle = value;
            if (label.includes('status')) {
                if (value.includes('Finished')) animeInfo.status = MediaStatus.COMPLETED;
                else if (value.includes('Currently')) animeInfo.status = MediaStatus.ONGOING;
            }
            if (label.includes('premiered')) animeInfo.season = value;
            if (label.includes('duration')) animeInfo.duration = parseInt(value);
        });

        animeInfo.genres = $('.item-list a').map((i, el) => $(el).text().trim()).get();

        if (movieId) {
            // Correct endpoint: /ajax/episode/list/{movieId} (path param, not query)
            const episodeDataStr = await this.fetch(`${this.baseUrl}/ajax/episode/list/${movieId}`, {
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${this.baseUrl}/watch/${slug}`,
            });
            try {
                const episodeData = JSON.parse(episodeDataStr);
                const $eps = load(episodeData.html || '');

                $eps('.ep-item').each((i, el) => {
                    const ep = $eps(el);
                    const epHref = ep.attr('href') || '';
                    const epUrl = epHref.startsWith('http') ? epHref : `${this.baseUrl}${epHref}`;
                    animeInfo.episodes?.push({
                        id: ep.attr('data-id') || '',
                        number: parseFloat(ep.attr('data-number') || '0'),
                        title: ep.find('.ep-name').text().trim() || `Episode ${ep.attr('data-number')}`,
                        url: epUrl,
                    });
                });
            } catch {
                // episode list parse failed, continue with empty list
            }
        }

        return animeInfo;
    }

    async fetchEpisodeServers(episodeId: string): Promise<IEpisodeServer[]> {
        const dataStr = await this.fetch(`${this.baseUrl}/ajax/episode/servers?episodeId=${episodeId}`, {
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': this.baseUrl,
        });
        const data = JSON.parse(dataStr);
        const $ = load(data.html);
        const servers: IEpisodeServer[] = [];

        $('.server-item').each((i, el) => {
            const item = $(el);
            const langText = item.closest('.d-flex').find('span').first().text().trim();
            servers.push({
                name: `${item.find('a').text().trim()} (${langText})`,
                url: item.attr('data-id') || '',
            });
        });

        return servers;
    }

    async fetchEpisodeSources(episodeId: string, serverId?: string): Promise<ISource> {
        if (!serverId) {
            const servers = await this.fetchEpisodeServers(episodeId);
            if (servers.length === 0) throw new Error('No servers found');
            serverId = servers[0].url;
        }
        const dataStr = await this.fetch(`${this.baseUrl}/ajax/episode/sources?id=${serverId}`, {
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': this.baseUrl,
        });
        const data = JSON.parse(dataStr);

        let sources = [
            {
                url: data.link,
                isM3U8: data.link.includes('.m3u8'),
            }
        ];
        let embedURL = data.type === 'iframe' ? data.link : undefined;

        if (embedURL) {
            try {
                // Follow the embed link to see if we can scrape a direct video file from the HTML
                const embedHtml = await this.fetch(embedURL, { 'Referer': this.baseUrl });

                // Try to find m3u8 or mp4
                const m3u8Match = embedHtml.match(/(https?:\/\/[^\s"'<>]+?\.m3u8[^\s"'<>]*)/i);
                if (m3u8Match) {
                    sources = [{ url: m3u8Match[1], isM3U8: true }];
                } else {
                    const mp4Match = embedHtml.match(/(https?:\/\/[^\s"'<>]+?\.mp4[^\s"'<>]*)/i);
                    if (mp4Match) {
                        sources = [{ url: mp4Match[1], isM3U8: false }];
                    }
                }
            } catch (e) {
                // Ignore extraction failures and fallback down to embedURL
            }
        }

        const result: any = {
            headers: { Referer: this.baseUrl },
            sources: sources,
            embedURL: embedURL,
        };
        // Pass through upstream skip timing metadata when available.
        if (data?.intro) result.intro = data.intro;
        if (data?.outro) result.outro = data.outro;
        if (data?.skip) result.skip = data.skip;
        if (data?.skips) result.skips = data.skips;
        if (data?.timestamps) result.timestamps = data.timestamps;
        return result as ISource;
    }
}

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
    const satoru = configureProvider(new SatoruProvider());

    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro:
                "Welcome to the Satoru provider: check out the provider's website @ https://satoru.one/",
            routes: ['/:query', '/info/:id', '/watch/:episodeId', '/servers/:episodeId'],
        });
    });

    fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
        const query = (request.params as { query: string }).query;
        const page = (request.query as { page?: number }).page || 1;

        try {
            let res = redis
                ? await cache.fetch(
                    redis as Redis,
                    `satoru:search:${query}:${page}`,
                    async () => await satoru.search(query, page),
                    REDIS_TTL,
                )
                : await satoru.search(query, page);

            reply.status(200).send(res);
        } catch (err) {
            reply.status(500).send({
                message: (err as Error).message,
            });
        }
    });

    fastify.get('/info/:id', async (request: FastifyRequest, reply: FastifyReply) => {
        const id = (request.params as { id: string }).id;

        try {
            let res = redis
                ? await cache.fetch(
                    redis as Redis,
                    `satoru:info:${id}`,
                    async () => await satoru.fetchAnimeInfo(id),
                    REDIS_TTL,
                )
                : await satoru.fetchAnimeInfo(id);

            reply.status(200).send(res);
        } catch (err) {
            reply
                .status(500)
                .send({ message: (err as Error).message });
        }
    });

    fastify.get(
        '/watch/:episodeId',
        async (request: FastifyRequest, reply: FastifyReply) => {
            const episodeId = (request.params as { episodeId: string }).episodeId;
            const serverId = (request.query as { serverId?: string }).serverId;

            try {
                let res = redis
                    ? await cache.fetch(
                        redis as Redis,
                        `satoru:watch:${episodeId}:${serverId}`,
                        async () => await satoru.fetchEpisodeSources(episodeId, serverId),
                        REDIS_TTL,
                    )
                    : await satoru.fetchEpisodeSources(episodeId, serverId);

                reply.status(200).send(res);
            } catch (err) {
                reply
                    .status(500)
                    .send({ message: (err as Error).message });
            }
        },
    );

    fastify.get(
        '/servers/:episodeId',
        async (request: FastifyRequest, reply: FastifyReply) => {
            const episodeId = (request.params as { episodeId: string }).episodeId;

            try {
                let res = redis
                    ? await cache.fetch(
                        redis as Redis,
                        `satoru:servers:${episodeId}`,
                        async () => await satoru.fetchEpisodeServers(episodeId),
                        REDIS_TTL,
                    )
                    : await satoru.fetchEpisodeServers(episodeId);

                reply.status(200).send(res);
            } catch (err) {
                reply
                    .status(500)
                    .send({ message: (err as Error).message });
            }
        },
    );
};

export default routes;
