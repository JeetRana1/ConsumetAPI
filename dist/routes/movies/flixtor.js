"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cheerio = __importStar(require("cheerio"));
const models_1 = require("@consumet/extensions/dist/models");
const playwright_1 = require("playwright");
const cache_1 = __importDefault(require("../../utils/cache"));
const main_1 = require("../../main");
const streamable_1 = require("../../utils/streamable");
class Flixtor {
    constructor() {
        this.baseUrl = 'https://flixtor.mov';
        this.browser = null;
        this.browserPromise = null;
    }
    get toString() {
        return {
            name: 'flixtor',
            baseUrl: this.baseUrl,
            lang: 'en',
        };
    }
    async getBrowser() {
        if (this.browser)
            return this.browser;
        if (this.browserPromise)
            return this.browserPromise;
        this.browserPromise = playwright_1.chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }).then(b => {
            this.browser = b;
            this.browserPromise = null;
            return b;
        });
        return this.browserPromise;
    }
    async renderPage(url, waitForStreams = false) {
        let page;
        try {
            const browser = await this.getBrowser();
            page = await browser.newPage();
            await page.setViewportSize({ width: 1280, height: 720 });
            // Set a shorter timeout for navigation
            await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => { });
            if (waitForStreams) {
                // Wait for stream data to load or timeout after 3 seconds
                await Promise.race([
                    page.waitForSelector('[data-src], [data-url], [data-file], iframe[src*="embed"]', { timeout: 3000 }).catch(() => { }),
                    page.waitForTimeout(2000),
                ]);
            }
            else {
                await page.waitForTimeout(1500);
            }
            const content = await page.content();
            await page.close().catch(() => { });
            return content;
        }
        catch (err) {
            // Close the page if it's still open
            if (page) {
                page.close().catch(() => { });
            }
            // Reset browser on error
            if (this.browser) {
                this.browser.close().catch(() => { });
                this.browser = null;
            }
            throw err;
        }
    }
    async search(query, page = 1) {
        try {
            // Since /filter returns 404, we'll use /movie as default catalog
            // For better search, you'd want to implement JavaScript search via Playwright
            const url = `${this.baseUrl}/movie?page=${page}`;
            const html = await this.renderPage(url);
            const $ = cheerio.load(html);
            const results = [];
            const queryLower = query.toLowerCase();
            // Extract all movie links and filter by query
            $('a[href*="/movie/"]').each((_, el) => {
                const text = $(el).text().trim();
                const href = $(el).attr('href') || '';
                // Filter by search query
                if (text.toLowerCase().includes(queryLower)) {
                    const id = href.split('/').filter(p => p).pop() || text.replace(/\s+/g, '-');
                    // Avoid duplicates
                    if (!results.find(r => r.id === id)) {
                        results.push({
                            id,
                            title: text,
                            image: undefined,
                            url: `${this.baseUrl}${href}`,
                        });
                    }
                }
            });
            // If no results from filtering, just return all movies up to 20
            if (results.length === 0) {
                $('a[href*="/movie/"]').slice(0, 20).each((_, el) => {
                    const text = $(el).text().trim();
                    const href = $(el).attr('href') || '';
                    const id = href.split('/').filter(p => p).pop() || text.replace(/\s+/g, '-');
                    results.push({
                        id,
                        title: text,
                        image: undefined,
                        url: `${this.baseUrl}${href}`,
                    });
                });
            }
            return { page, results: results.slice(0, 20) };
        }
        catch (err) {
            throw new Error(`Failed to search Flixtor: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async fetchMediaInfo(id) {
        try {
            const url = `${this.baseUrl}/movie/${id}`;
            const html = await this.renderPage(url);
            const $ = cheerio.load(html);
            // Extract title from various possible selectors
            const title = $('h1, .title, [class*="title"]').first().text().trim() || id.replace(/-/g, ' ');
            // Try to find movie info
            const description = $('[class*="description"], [class*="plot"], p').first().text().trim();
            // Try various image selectors
            const image = $('img[alt*="poster"], img[src*="poster"], img').first().attr('src');
            return {
                id,
                title,
                image,
                description,
                rating: undefined,
                releaseDate: undefined,
                duration: undefined,
                genres: [],
                episodes: [],
                url,
            };
        }
        catch (err) {
            throw new Error(`Failed to fetch media info: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async fetchEpisodeSources(episodeId, mediaId, server) {
        try {
            const url = `${this.baseUrl}/movie/${mediaId || episodeId}`;
            const html = await this.renderPage(url, true); // Wait for streams to load
            const $ = cheerio.load(html);
            const sources = [];
            // Extract embed URLs from common patterns
            // Look for streamtape, vidstream, streamlare, upstream, etc.
            const embedUrls = [];
            // Check for iframe embeds
            $('iframe').each((_, el) => {
                const src = $(el).attr('src') || '';
                if (src && (src.includes('streamtape') ||
                    src.includes('vidstream') ||
                    src.includes('streamlare') ||
                    src.includes('upstream') ||
                    src.includes('vidlox') ||
                    src.includes('embed') ||
                    src.includes('play'))) {
                    embedUrls.push(src);
                }
            });
            // Look for script tags that might contain stream URLs
            $('script').each((_, el) => {
                const content = $(el).html() || '';
                // Extract embed URLs from script patterns
                const embedMatches = content.match(/(?:https?:)?\/\/[a-zA-Z0-9.-]+\/(e|embed|play|watch|v)\/?[a-zA-Z0-9._\-/]+/gi) || [];
                embedMatches.forEach((match) => {
                    if (!match.includes('data:')) {
                        embedUrls.push(match.startsWith('//') ? 'https:' + match : match);
                    }
                });
                // Look for m3u8 URLs in script content
                const m3u8Matches = content.match(/https?[^"'<>\s]+\.m3u8[^"'<>\s]*/gi) || [];
                m3u8Matches.forEach((match) => {
                    sources.push({
                        url: match,
                        quality: 'auto',
                        isM3u8: true,
                        server: 'direct',
                    });
                });
                // Look for mp4 URLs in script content
                const mp4Matches = content.match(/https?[^"'<>\s]+\.mp4[^"'<>\s]*/gi) || [];
                mp4Matches.forEach((match) => {
                    sources.push({
                        url: match,
                        quality: '720',
                        isM3u8: false,
                        server: 'direct',
                    });
                });
            });
            // Extract unique embed URLs and add them as sources
            embedUrls.forEach((embedUrl) => {
                const uniqueUrl = new Set(embedUrls).size > 0 && !sources.find(s => s.url === embedUrl);
                if (uniqueUrl) {
                    sources.push({
                        url: embedUrl,
                        quality: 'embed',
                        isM3u8: false,
                        server: 'embed',
                    });
                }
            });
            // Extract from data attributes
            $('[data-src], [data-url], [data-file], [data-embed]').each((_, el) => {
                const $el = $(el);
                const url = $el.attr('data-src') || $el.attr('data-url') || $el.attr('data-file') || $el.attr('data-embed') || '';
                if (url && (url.includes('m3u8') || url.includes('mp4') || url.includes('embed') || url.includes('streamtape') || url.includes('vidstream'))) {
                    sources.push({
                        url,
                        quality: 'auto',
                        isM3u8: url.includes('m3u8'),
                        server: 'source',
                    });
                }
            });
            // Deduplicate sources by URL
            const uniqueSources = Array.from(new Map(sources.map((s) => [s.url, s])).values());
            return {
                sources: uniqueSources,
                embedURL: uniqueSources.find((s) => s.server === 'embed')?.url || null,
                headers: {
                    Referer: url,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
            };
        }
        catch (err) {
            throw new Error(`Failed to fetch episode sources: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async fetchRecentMovies(page = 1) {
        try {
            const url = `${this.baseUrl}/movie?page=${page}`;
            const html = await this.renderPage(url);
            const $ = cheerio.load(html);
            const results = [];
            $('a[href*="/movie/"]').each((_, el) => {
                const text = $(el).text().trim();
                const href = $(el).attr('href') || '';
                const id = href.split('/').filter(p => p).pop() || text.replace(/\s+/g, '-');
                if (text && !results.find(r => r.id === id)) {
                    results.push({
                        id,
                        title: text,
                        image: undefined,
                        url: `${this.baseUrl}${href}`,
                    });
                }
            });
            return { page, results: results.slice(0, 50) };
        }
        catch (err) {
            throw new Error(`Failed to fetch recent movies: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async fetchRecentTvShows(page = 1) {
        try {
            const url = `${this.baseUrl}/tv?page=${page}`;
            const html = await this.renderPage(url);
            const $ = cheerio.load(html);
            const results = [];
            $('a[href*="/tv/"]').each((_, el) => {
                const text = $(el).text().trim();
                const href = $(el).attr('href') || '';
                const id = href.split('/').filter(p => p).pop() || text.replace(/\s+/g, '-');
                if (text && !results.find(r => r.id === id)) {
                    results.push({
                        id,
                        title: text,
                        image: undefined,
                        url: `${this.baseUrl}${href}`,
                    });
                }
            });
            return { page, results: results.slice(0, 50) };
        }
        catch (err) {
            throw new Error(`Failed to fetch recent TV shows: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async fetchTrendingMovies(page = 1) {
        try {
            return this.fetchRecentMovies(page);
        }
        catch (err) {
            throw new Error(`Failed to fetch trending movies: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async fetchTrendingTvShows(page = 1) {
        try {
            return this.fetchRecentTvShows(page);
        }
        catch (err) {
            throw new Error(`Failed to fetch trending TV shows: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
const isDirectMediaUrl = (value) => /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(value || '')) || /\/m3u8-proxy\?/i.test(String(value || ''));
const parseResolution = (value) => {
    const text = String(value || '');
    const byP = text.match(/(?:^|\D)(\d{3,4})p(?:\D|$)/i);
    if (byP)
        return Number(byP[1]);
    const byX = text.match(/(?:^|\D)(\d{3,4})x\d{3,4}(?:\D|$)/i);
    if (byX)
        return Number(byX[1]);
    if (/4k|2160/i.test(text))
        return 2160;
    return 0;
};
const sourceRank = (source, fastStart = true) => {
    const url = String(source?.url || '').toLowerCase();
    const qualityText = String(source?.quality || '');
    const resolution = parseResolution(qualityText || url);
    let score = 0;
    if (/\.m3u8(\?|$)/.test(url) || /m3u8-proxy/.test(url))
        score += 3000;
    else if (/\.mpd(\?|$)/.test(url))
        score += 2000;
    else if (/\.mp4(\?|$)/.test(url))
        score += 1000;
    if (fastStart) {
        if (resolution > 0)
            score += Math.max(0, 1200 - resolution);
    }
    else {
        score += resolution;
    }
    if (/backup|alt|mirror/.test(String(source?.server || '').toLowerCase()))
        score -= 100;
    return score;
};
const sortAndLimitSources = (rawSources, fastStart = true) => {
    const deduped = rawSources.filter((item, idx, arr) => arr.findIndex((v) => String(v?.url || '') === String(item?.url || '')) === idx);
    const direct = deduped.filter((s) => isDirectMediaUrl(String(s?.url || '')));
    const nonDirect = deduped.filter((s) => !isDirectMediaUrl(String(s?.url || '')));
    direct.sort((a, b) => sourceRank(b, fastStart) - sourceRank(a, fastStart));
    return [...direct.slice(0, 8), ...nonDirect.slice(0, 2)];
};
const routes = async (fastify, options) => {
    const flixtor = new Flixtor();
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: `Welcome to the flixtor provider: check out the provider's website @ ${flixtor.toString.baseUrl}`,
            routes: [
                '/:query',
                '/info',
                '/watch',
                '/recent-shows',
                '/recent-movies',
                '/trending',
            ],
            documentation: 'https://docs.consumet.org/#tag/flixtor',
        });
    });
    fastify.get('/:query', async (request, reply) => {
        const query = decodeURIComponent(request.params.query);
        const page = request.query.page;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixtor:${query}:${page}`, async () => await flixtor.search(query, page ? page : 1), main_1.REDIS_TTL)
                : await flixtor.search(query, page ? page : 1);
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({
                message: 'Failed to search Flixtor. Please try again later.',
            });
        }
    });
    fastify.get('/recent-shows', async (request, reply) => {
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixtor:recent-shows`, async () => await flixtor.fetchRecentTvShows(), main_1.REDIS_TTL)
                : await flixtor.fetchRecentTvShows();
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({
                message: 'Failed to fetch recent TV shows.',
            });
        }
    });
    fastify.get('/recent-movies', async (request, reply) => {
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixtor:recent-movies`, async () => await flixtor.fetchRecentMovies(), main_1.REDIS_TTL)
                : await flixtor.fetchRecentMovies();
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({
                message: 'Failed to fetch recent movies.',
            });
        }
    });
    fastify.get('/trending', async (request, reply) => {
        const type = request.query.type;
        try {
            if (!type) {
                const moviesData = await flixtor.fetchTrendingMovies();
                const tvData = await flixtor.fetchTrendingTvShows();
                const res = {
                    results: [
                        ...(moviesData?.results || []),
                        ...(tvData?.results || []),
                    ],
                };
                return reply.status(200).send(res);
            }
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixtor:trending:${type}`, async () => type === 'tv'
                    ? await flixtor.fetchTrendingTvShows()
                    : await flixtor.fetchTrendingMovies(), main_1.REDIS_TTL)
                : type === 'tv'
                    ? await flixtor.fetchTrendingTvShows()
                    : await flixtor.fetchTrendingMovies();
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({
                message: 'Failed to fetch trending content.',
            });
        }
    });
    fastify.get('/info', async (request, reply) => {
        const id = request.query.id;
        if (typeof id === 'undefined')
            return reply.status(400).send({
                message: 'id is required',
            });
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixtor:info:${id}`, async () => await flixtor.fetchMediaInfo(id), main_1.REDIS_TTL)
                : await flixtor.fetchMediaInfo(id);
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({
                message: 'Failed to fetch media info.',
            });
        }
    });
    fastify.get('/watch', async (request, reply) => {
        const episodeId = request.query.episodeId;
        const mediaId = request.query.mediaId;
        const server = request.query.server;
        const fastStartRaw = String(request.query.fastStart || 'true')
            .toLowerCase()
            .trim();
        const fastStart = fastStartRaw !== '0' && fastStartRaw !== 'false' && fastStartRaw !== 'no';
        if (typeof episodeId === 'undefined')
            return reply.status(400).send({ message: 'episodeId is required' });
        if (typeof mediaId === 'undefined')
            return reply.status(400).send({ message: 'mediaId is required' });
        if (server && !Object.values(models_1.StreamingServers).includes(server))
            return reply.status(400).send({ message: 'Invalid server query' });
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `flixtor:watch:${episodeId}:${mediaId}:${server}`, async () => await (0, streamable_1.fetchWithServerFallback)(async (selectedServer) => await flixtor.fetchEpisodeSources(episodeId, mediaId, selectedServer), server, streamable_1.MOVIE_SERVER_FALLBACKS), main_1.REDIS_TTL)
                : await (0, streamable_1.fetchWithServerFallback)(async (selectedServer) => await flixtor.fetchEpisodeSources(episodeId, mediaId, selectedServer), server, streamable_1.MOVIE_SERVER_FALLBACKS);
            if (Array.isArray(res?.sources)) {
                res.sources = sortAndLimitSources(res.sources, fastStart);
            }
            reply.status(200).send(res);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            reply.status(404).send({ message });
        }
    });
};
exports.default = routes;
