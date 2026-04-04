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
exports.extractMoontvRuntimeCandidates = void 0;
const axios_1 = __importDefault(require("axios"));
const cheerio_1 = require("cheerio");
const cache_1 = __importDefault(require("../../utils/cache"));
const main_1 = require("../../main");
const browserRuntimeExtractor_1 = require("../../utils/browserRuntimeExtractor");
const unifiedPlayback_1 = require("../../utils/unifiedPlayback");
const BASE_URL = 'https://moontv.to';
const isDirectMediaUrl = (value) => /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(value || '')) || /\/m3u8-proxy\?/i.test(String(value || ''));
const isLikelyEmbedUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw)
        return false;
    if (isDirectMediaUrl(raw))
        return false;
    try {
        const parsed = new URL(normalizeUrl(raw));
        const host = parsed.hostname.toLowerCase();
        const path = parsed.pathname.toLowerCase();
        if (host.includes('googleapis.com') ||
            host.includes('gstatic.com') ||
            host.includes('cloudflare.com') ||
            host.includes('fontawesome.com')) {
            return false;
        }
        if (/\.(css|js|woff2?|ttf|otf|svg|png|jpe?g|gif|webp)(\?|$)/i.test(path)) {
            return false;
        }
        return /\b(embed|player|stream|video|source|watch|iframe)\b/i.test(path);
    }
    catch {
        return false;
    }
};
const normalizeUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw)
        return '';
    if (/^https?:\/\//i.test(raw))
        return raw;
    if (raw.startsWith('//'))
        return `https:${raw}`;
    if (raw.startsWith('/'))
        return `${BASE_URL}${raw}`;
    return `${BASE_URL}/${raw.replace(/^\/+/, '')}`;
};
const normalizeMoviePath = (value) => {
    const raw = String(value || '').trim();
    if (!raw)
        return null;
    let path = raw;
    if (/^https?:\/\//i.test(path)) {
        try {
            path = new URL(path).pathname;
        }
        catch {
            return null;
        }
    }
    path = path.split('?')[0].split('#')[0].trim();
    if (!path.startsWith('/'))
        path = `/${path}`;
    if (!path.startsWith('/movie/'))
        return null;
    return path;
};
const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const parseBoolean = (value) => {
    const raw = String(value ?? '')
        .trim()
        .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
};
const parseUrlsFromText = (text) => {
    const found = new Set();
    const input = String(text || '');
    const patterns = [
        /(https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4|mpd)(?:\?[^\s"'<>]*)?)/gi,
        /(https?:\/\/[^\s"'<>]+?\/m3u8-proxy\?[^\s"'<>]+)/gi,
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(input)) !== null) {
            const url = normalizeUrl(String(match[1] || '').trim());
            if (url)
                found.add(url);
        }
    }
    return [...found];
};
const normalizeForCompare = (value) => {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};
const tokenize = (value) => {
    const seen = new Set();
    const tokens = normalizeForCompare(value)
        .split(' ')
        .map((part) => part.trim())
        .filter((part) => part.length >= 2);
    const result = [];
    for (const token of tokens) {
        if (seen.has(token))
            continue;
        seen.add(token);
        result.push(token);
    }
    return result;
};
const scoreTitleMatch = (query, title) => {
    const q = normalizeForCompare(query);
    const t = normalizeForCompare(title);
    if (!q)
        return 1;
    if (!t)
        return 0;
    if (q === t)
        return 1;
    if (t.includes(q))
        return 0.97;
    const compactQ = q.replace(/\s+/g, '');
    const compactT = t.replace(/\s+/g, '');
    if (compactQ && compactT && compactT.includes(compactQ))
        return 0.95;
    const qTokens = tokenize(q);
    if (qTokens.length === 0)
        return 0;
    const tTokens = tokenize(t);
    if (tTokens.length === 0)
        return 0;
    let scoreUnits = 0;
    for (const qToken of qTokens) {
        if (tTokens.includes(qToken)) {
            scoreUnits += 1;
            continue;
        }
        const hasPartial = tTokens.some((tToken) => {
            if (qToken.length < 4 || tToken.length < 4)
                return false;
            return tToken.includes(qToken) || qToken.includes(tToken);
        });
        if (hasPartial)
            scoreUnits += 0.5;
    }
    const coverage = scoreUnits / qTokens.length;
    return Math.min(0.92, coverage);
};
const uniqBy = (items, keyer) => {
    const seen = new Set();
    const result = [];
    for (const item of items) {
        const key = keyer(item);
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        result.push(item);
    }
    return result;
};
const fetchHtml = async (path) => {
    const url = normalizeUrl(path);
    const { data } = await axios_1.default.get(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Referer: BASE_URL,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: 20000,
    });
    return String(data || '');
};
const parseMovieCards = (html) => {
    const $ = (0, cheerio_1.load)(html);
    const results = [];
    $('.movies .item').each((_, el) => {
        const href = cleanText($(el).find('a.poster').attr('href') || '') ||
            cleanText($(el).find('a.title').attr('href') || '');
        if (!href.startsWith('/movie/'))
            return;
        const title = cleanText($(el).find('a.title').first().text());
        const poster = cleanText($(el).find('a.poster img').attr('data-src') || '') ||
            cleanText($(el).find('a.poster img').attr('src') || '');
        const quality = cleanText($(el).find('.quality').first().text());
        const infoParts = $(el)
            .find('.detail .info span')
            .toArray()
            .map((node) => cleanText($(node).text()))
            .filter(Boolean);
        const year = infoParts.find((part) => /^\d{4}$/.test(part));
        results.push({
            id: href.replace(/^\/movie\//, ''),
            title,
            url: href,
            image: normalizeUrl(poster),
            type: 'Movie',
            quality: quality || undefined,
            releaseDate: year || undefined,
        });
    });
    return uniqBy(results, (item) => String(item?.id || item?.url || ''));
};
const parseHasNextPage = (html, page) => {
    const regex = new RegExp(`(?:\\?|&)page=${page + 1}(?:[^\\d]|$)`);
    return regex.test(html);
};
const parseMovieInfo = (moviePath, html) => {
    const $ = (0, cheerio_1.load)(html);
    const title = cleanText($('.movie-info .title').first().text()) || cleanText($('title').first().text());
    const description = cleanText($('.movie-info .desc').first().text());
    const poster = cleanText($('.detail-start img').first().attr('src') || '') ||
        cleanText($('.detail-start img').first().attr('data-src') || '');
    const backdropStyle = cleanText($('.watch-bg').first().attr('style') || '');
    const backdropMatch = backdropStyle.match(/url\(['"]?([^'"\)]+)['"]?\)/i);
    const backdrop = backdropMatch ? normalizeUrl(backdropMatch[1]) : undefined;
    const infoParts = $('.movie-info .metadata span')
        .toArray()
        .map((node) => cleanText($(node).text()))
        .filter(Boolean);
    const releaseDate = infoParts.find((part) => /^\d{4}$/.test(part));
    const quality = infoParts.find((part) => /^(hd|cam|ts|hdrip|web[- ]?dl|sd)/i.test(part));
    const watchDataMatch = html.match(/x-data="Watch\(\{\s*detail:\s*\{([\s\S]*?)\}\s*,\s*requestSeason:/i);
    const titleIdMatch = watchDataMatch?.[1]?.match(/id:\s*'([^']+)'/i);
    return {
        id: moviePath.replace(/^\/movie\//, ''),
        title,
        url: moviePath,
        image: normalizeUrl(poster),
        cover: backdrop,
        description,
        type: 'Movie',
        releaseDate,
        quality,
        titleId: titleIdMatch?.[1] || undefined,
    };
};
const sortSources = (sources) => {
    const deduped = uniqBy((Array.isArray(sources) ? sources : []).filter((s) => isDirectMediaUrl(String(s?.url || ''))), (s) => String(s?.url || ''));
    deduped.sort((a, b) => {
        const aUrl = String(a?.url || '').toLowerCase();
        const bUrl = String(b?.url || '').toLowerCase();
        const aRank = /\.m3u8(\?|$)|m3u8-proxy/.test(aUrl) ? 3 : /\.mpd(\?|$)/.test(aUrl) ? 2 : 1;
        const bRank = /\.m3u8(\?|$)|m3u8-proxy/.test(bUrl) ? 3 : /\.mpd(\?|$)/.test(bUrl) ? 2 : 1;
        return bRank - aRank;
    });
    return deduped;
};
const toSource = (url) => ({
    url,
    quality: 'auto',
    isM3U8: /\.m3u8(\?|$)|\/m3u8-proxy\?/i.test(url),
    isEmbed: false,
});
const buildSearchResults = async (query, page) => {
    const pagesToFetch = query ? [page, page + 1] : [page];
    const moviePages = await Promise.all(pagesToFetch.map((p) => fetchHtml(`/movie?page=${p}`)));
    const homeHtml = await fetchHtml('/home');
    const merged = uniqBy([...moviePages.flatMap((html) => parseMovieCards(html)), ...parseMovieCards(homeHtml)], (item) => String(item?.id || ''));
    const normalizedQuery = normalizeForCompare(query);
    const scored = normalizedQuery
        ? merged
            .map((item) => ({ item, score: scoreTitleMatch(normalizedQuery, String(item?.title || '')) }))
            .filter((entry) => entry.score >= 0.45)
            .sort((a, b) => b.score - a.score)
            .map((entry) => entry.item)
        : merged;
    return {
        currentPage: page,
        hasNextPage: parseHasNextPage(moviePages[0] || '', page),
        results: scored,
    };
};
const extractMoontvRuntimeCandidates = async (movieUrl, options) => {
    let chromium;
    try {
        ({ chromium } = await Promise.resolve().then(() => __importStar(require('playwright'))));
    }
    catch {
        return { directUrls: [], embedUrls: [], apiUrls: [], linkIds: [] };
    }
    const direct = new Set();
    const embeds = new Set();
    const apis = new Set();
    const linkIds = new Set();
    let episodeSlug;
    let episodeToken;
    let browser;
    const fastMode = !!options?.fastMode;
    try {
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage'],
        });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            extraHTTPHeaders: { Referer: movieUrl },
        });
        const page = await context.newPage();
        const collectUrl = (value, options) => {
            const u = normalizeUrl(value);
            if (!u)
                return;
            const allowEmbedHeuristics = options?.allowEmbedHeuristics !== false;
            if (/\/api\/v1\//i.test(u))
                apis.add(u);
            if (isDirectMediaUrl(u)) {
                direct.add(u);
                return;
            }
            const isMoontvHost = /https?:\/\/(?:www\.)?(?:moontv\.to|static\.moontv\.to)\//i.test(u);
            if (allowEmbedHeuristics && !isMoontvHost && isLikelyEmbedUrl(u)) {
                embeds.add(u);
            }
        };
        page.on('request', (request) => {
            collectUrl(String(request.url() || ''), { allowEmbedHeuristics: true });
        });
        page.on('response', async (response) => {
            try {
                collectUrl(String(response.url() || ''), { allowEmbedHeuristics: true });
                const headers = response.headers() || {};
                const contentType = String(headers['content-type'] || '').toLowerCase();
                if (contentType.includes('json') ||
                    contentType.includes('javascript') ||
                    contentType.includes('text')) {
                    const text = String(await response.text());
                    if (/\/api\/v1\/episodes\//i.test(String(response.url() || '')) && contentType.includes('json')) {
                        try {
                            const data = JSON.parse(text);
                            const episodeUrl = String(response.url() || '');
                            const tokenFromUrl = cleanText(new URL(episodeUrl).searchParams.get('_') || '');
                            if (tokenFromUrl)
                                episodeToken = tokenFromUrl;
                            const links = Array.isArray(data?.result?.links) ? data.result.links : [];
                            for (const link of links) {
                                const id = cleanText(String(link?.id || ''));
                                if (id)
                                    linkIds.add(id);
                            }
                            const slug = cleanText(String(data?.result?.slug || data?.result?.number || ''));
                            if (slug)
                                episodeSlug = slug;
                        }
                        catch {
                            // Ignore malformed JSON payloads.
                        }
                    }
                    const mediaMatches = parseUrlsFromText(text);
                    for (const found of mediaMatches)
                        collectUrl(found, { allowEmbedHeuristics: false });
                }
            }
            catch {
                // Ignore response parse failures.
            }
        });
        await page.goto(movieUrl, {
            waitUntil: 'domcontentloaded',
            timeout: fastMode ? 20000 : 30000,
        });
        await page.waitForTimeout(fastMode ? 800 : 1500);
        await page.evaluate(() => {
            const selectors = [
                '.player-btn',
                '.show-player-btn',
                '.movie-sv .section-tab button',
                '.section-tab button',
            ];
            for (const selector of selectors) {
                const nodes = Array.from(document.querySelectorAll(selector));
                for (const node of nodes.slice(0, 8)) {
                    try {
                        node.click();
                    }
                    catch {
                        // Ignore click failures.
                    }
                }
            }
            const video = document.querySelector('video');
            if (video) {
                video.muted = true;
                video.play().catch(() => undefined);
            }
        }).catch(() => undefined);
        await page.waitForTimeout(fastMode ? 3500 : 9000);
        if (linkIds.size > 0 && episodeToken) {
            const resolved = await page.evaluate(async ({ ids, token }) => {
                const urls = [];
                for (const id of ids) {
                    try {
                        const endpoint = `/api/v1/links/${encodeURIComponent(id)}?_=${encodeURIComponent(token)}`;
                        const response = await fetch(endpoint, { credentials: 'include' });
                        const text = await response.text();
                        // Broadly match all URLs returned in the payload (m3u8, mp4, embedded iframes, json urls, etc)
                        const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
                        for (const match of matches) {
                            urls.push(String(match || ''));
                        }
                    }
                    catch {
                        // Ignore single endpoint failures.
                    }
                }
                return urls;
            }, { ids: [...linkIds].slice(0, 10), token: episodeToken });
            for (const candidate of resolved || []) {
                collectUrl(String(candidate || ''), { allowEmbedHeuristics: true });
            }
        }
        await context.close();
    }
    catch {
        // Swallow runtime extraction failures and return what we have.
    }
    finally {
        if (browser) {
            try {
                await browser.close();
            }
            catch {
                // Ignore close failure.
            }
        }
    }
    return {
        directUrls: [...direct],
        embedUrls: [...embeds],
        apiUrls: [...apis],
        linkIds: [...linkIds],
        episodeSlug,
    };
};
exports.extractMoontvRuntimeCandidates = extractMoontvRuntimeCandidates;
const routes = async (fastify, options) => {
    fastify.get('/', (_, reply) => {
        reply.status(200).send({
            intro: `Welcome to the MoonTV movie provider @ ${BASE_URL}`,
            routes: ['/:query', '/info', '/watch', '/recent-movies', '/trending'],
        });
    });
    fastify.get('/:query', async (request, reply) => {
        const query = decodeURIComponent(request.params.query || '').trim();
        const page = Number(request.query.page || 1);
        const safePage = Number.isFinite(page) && page > 0 ? page : 1;
        try {
            const cacheKey = `moontv:search:${query}:${safePage}`;
            const response = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, cacheKey, async () => await buildSearchResults(query, safePage), main_1.REDIS_TTL)
                : await buildSearchResults(query, safePage);
            reply.status(200).send(response);
        }
        catch (error) {
            reply.status(500).send({
                message: error instanceof Error ? error.message : 'Failed to search MoonTV.',
            });
        }
    });
    fastify.get('/recent-movies', async (request, reply) => {
        const page = Number(request.query.page || 1);
        const safePage = Number.isFinite(page) && page > 0 ? page : 1;
        try {
            const cacheKey = `moontv:recent-movies:${safePage}`;
            const response = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, cacheKey, async () => {
                    const html = await fetchHtml(`/movie?page=${safePage}`);
                    return {
                        currentPage: safePage,
                        hasNextPage: parseHasNextPage(html, safePage),
                        results: parseMovieCards(html),
                    };
                }, main_1.REDIS_TTL)
                : await (async () => {
                    const html = await fetchHtml(`/movie?page=${safePage}`);
                    return {
                        currentPage: safePage,
                        hasNextPage: parseHasNextPage(html, safePage),
                        results: parseMovieCards(html),
                    };
                })();
            reply.status(200).send(response);
        }
        catch (error) {
            reply.status(500).send({
                message: error instanceof Error ? error.message : 'Failed to fetch recent MoonTV movies.',
            });
        }
    });
    fastify.get('/trending', async (_, reply) => {
        try {
            const cacheKey = 'moontv:trending';
            const response = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, cacheKey, async () => {
                    const html = await fetchHtml('/home');
                    return { results: parseMovieCards(html).slice(0, 25) };
                }, main_1.REDIS_TTL)
                : await (async () => {
                    const html = await fetchHtml('/home');
                    return { results: parseMovieCards(html).slice(0, 25) };
                })();
            reply.status(200).send(response);
        }
        catch (error) {
            reply.status(500).send({
                message: error instanceof Error ? error.message : 'Failed to fetch MoonTV trending movies.',
            });
        }
    });
    fastify.get('/info', async (request, reply) => {
        const id = String(request.query.id || '').trim();
        const moviePath = normalizeMoviePath(id);
        if (!moviePath) {
            return reply.status(400).send({
                message: 'id is required and must be a MoonTV movie path/url.',
            });
        }
        try {
            const cacheKey = `moontv:info:${moviePath}`;
            const response = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, cacheKey, async () => {
                    const html = await fetchHtml(moviePath);
                    return parseMovieInfo(moviePath, html);
                }, main_1.REDIS_TTL)
                : await (async () => {
                    const html = await fetchHtml(moviePath);
                    return parseMovieInfo(moviePath, html);
                })();
            reply.status(200).send(response);
        }
        catch (error) {
            reply.status(500).send({
                message: error instanceof Error ? error.message : 'Failed to fetch MoonTV movie info.',
            });
        }
    });
    fastify.get('/watch', async (request, reply) => {
        const rawId = String(request.query.id || '').trim() ||
            String(request.query.episodeId || '').trim() ||
            String(request.query.mediaId || '').trim();
        const moviePath = normalizeMoviePath(rawId);
        const directOnly = parseBoolean(request.query.directOnly);
        if (!moviePath) {
            return reply.status(400).send({
                message: 'id (or episodeId/mediaId) is required and must point to a MoonTV movie path/url.',
            });
        }
        const movieUrl = normalizeUrl(moviePath);
        try {
            const cacheKey = `moontv:watch:${moviePath}`;
            const response = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, cacheKey, async () => {
                    const directFromPage = await (0, browserRuntimeExtractor_1.extractDirectSourcesWithPlaywright)(movieUrl, movieUrl, directOnly ? 12000 : 18000);
                    const runtime = await (0, exports.extractMoontvRuntimeCandidates)(movieUrl, {
                        fastMode: directOnly,
                    });
                    const fromRuntimeDirect = runtime.directUrls.map(toSource);
                    const fromRuntimeEmbeds = [];
                    if (!directOnly) {
                        for (const embedUrl of runtime.embedUrls.slice(0, 4)) {
                            const extracted = await (0, browserRuntimeExtractor_1.extractDirectSourcesWithPlaywright)(embedUrl, movieUrl, 15000);
                            for (const source of extracted)
                                fromRuntimeEmbeds.push(source);
                        }
                    }
                    const sources = sortSources([
                        ...directFromPage,
                        ...fromRuntimeDirect,
                        ...fromRuntimeEmbeds,
                    ]);
                    if (sources.length === 0) {
                        const fallbackEmbeds = uniqBy([...runtime.embedUrls.filter(isLikelyEmbedUrl), `${movieUrl}#ep=1`].filter(Boolean), (url) => String(url)).map((url) => ({
                            url,
                            quality: 'embed',
                            isM3U8: false,
                            isEmbed: true,
                        }));
                        if (fallbackEmbeds.length === 0) {
                            throw new Error('No direct CDN/video/HLS streams could be extracted from MoonTV for this title (MoonTV may require signed link resolution).');
                        }
                        return (0, unifiedPlayback_1.withUnifiedPlayback)({
                            headers: { Referer: movieUrl },
                            source: 'moontv',
                            movie: moviePath,
                            directOnly,
                            fallbackMode: 'embed',
                            sources: fallbackEmbeds,
                            runtime: {
                                checkedEmbeds: runtime.embedUrls.slice(0, 8),
                                apiEndpoints: runtime.apiUrls.slice(0, 8),
                                linkIds: runtime.linkIds.slice(0, 8),
                            },
                        });
                    }
                    return (0, unifiedPlayback_1.withUnifiedPlayback)({
                        headers: { Referer: movieUrl },
                        source: 'moontv',
                        movie: moviePath,
                        directOnly,
                        sources,
                        runtime: {
                            checkedEmbeds: runtime.embedUrls.slice(0, 4),
                            apiEndpoints: runtime.apiUrls.slice(0, 8),
                            linkIds: runtime.linkIds.slice(0, 8),
                        },
                    });
                }, main_1.REDIS_TTL)
                : await (async () => {
                    const directFromPage = await (0, browserRuntimeExtractor_1.extractDirectSourcesWithPlaywright)(movieUrl, movieUrl, directOnly ? 12000 : 18000);
                    const runtime = await (0, exports.extractMoontvRuntimeCandidates)(movieUrl, {
                        fastMode: directOnly,
                    });
                    const fromRuntimeDirect = runtime.directUrls.map(toSource);
                    const fromRuntimeEmbeds = [];
                    if (!directOnly) {
                        for (const embedUrl of runtime.embedUrls.slice(0, 4)) {
                            const extracted = await (0, browserRuntimeExtractor_1.extractDirectSourcesWithPlaywright)(embedUrl, movieUrl, 15000);
                            for (const source of extracted)
                                fromRuntimeEmbeds.push(source);
                        }
                    }
                    const sources = sortSources([
                        ...directFromPage,
                        ...fromRuntimeDirect,
                        ...fromRuntimeEmbeds,
                    ]);
                    if (sources.length === 0) {
                        const fallbackEmbeds = uniqBy([...runtime.embedUrls.filter(isLikelyEmbedUrl), `${movieUrl}#ep=1`].filter(Boolean), (url) => String(url)).map((url) => ({
                            url,
                            quality: 'embed',
                            isM3U8: false,
                            isEmbed: true,
                        }));
                        if (fallbackEmbeds.length === 0) {
                            throw new Error('No direct CDN/video/HLS streams could be extracted from MoonTV for this title (MoonTV may require signed link resolution).');
                        }
                        return (0, unifiedPlayback_1.withUnifiedPlayback)({
                            headers: { Referer: movieUrl },
                            source: 'moontv',
                            movie: moviePath,
                            directOnly,
                            fallbackMode: 'embed',
                            sources: fallbackEmbeds,
                            runtime: {
                                checkedEmbeds: runtime.embedUrls.slice(0, 8),
                                apiEndpoints: runtime.apiUrls.slice(0, 8),
                                linkIds: runtime.linkIds.slice(0, 8),
                            },
                        });
                    }
                    return (0, unifiedPlayback_1.withUnifiedPlayback)({
                        headers: { Referer: movieUrl },
                        source: 'moontv',
                        movie: moviePath,
                        directOnly,
                        sources,
                        runtime: {
                            checkedEmbeds: runtime.embedUrls.slice(0, 4),
                            apiEndpoints: runtime.apiUrls.slice(0, 8),
                            linkIds: runtime.linkIds.slice(0, 8),
                        },
                    });
                })();
            reply.status(200).send(response);
        }
        catch (error) {
            reply.status(404).send({
                message: error instanceof Error ? error.message : 'Failed to fetch MoonTV watch sources.',
            });
        }
    });
};
exports.default = routes;
