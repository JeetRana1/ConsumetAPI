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
const cache_1 = __importDefault(require("../../utils/cache"));
const main_1 = require("../../main");
const outboundProxy_1 = require("../../utils/outboundProxy");
const BASE_URL = 'https://buffstreams.ir';
const HOME_URL = `${BASE_URL}/index7`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const buildHeaders = (referer) => ({
    'User-Agent': UA,
    Referer: referer,
    Origin: new URL(referer).origin,
});
const toAbsoluteUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw)
        return undefined;
    if (/^https?:\/\//i.test(raw))
        return raw;
    if (raw.startsWith('/'))
        return `${BASE_URL}${raw}`;
    return `${BASE_URL}/${raw}`;
};
const slugToTitle = (value) => value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
const parseEvents = (html) => {
    const $ = cheerio.load(html);
    const seen = new Set();
    const events = [];
    $('a[href]').each((_, el) => {
        const href = toAbsoluteUrl($(el).attr('href'));
        if (!href || !href.startsWith(BASE_URL))
            return;
        const url = new URL(href);
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length < 2)
            return;
        const numericId = segments[segments.length - 1];
        if (!/^\d+$/.test(numericId))
            return;
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        const title = text && /live streams/i.test(text)
            ? text.replace(/\s*live streams\s*$/i, '').trim()
            : slugToTitle(segments[segments.length - 2]);
        if (!title || seen.has(href))
            return;
        seen.add(href);
        events.push({
            id: numericId,
            title,
            url: href,
            category: segments[0],
        });
    });
    return events;
};
const extractIframeUrl = (html) => {
    const match = html.match(/<iframe[^>]+id=["']cx-iframe["'][^>]+src=["']([^"']+)/i);
    return toAbsoluteUrl(match?.[1]);
};
const extractHlsUrl = (html) => {
    const directMatch = html.match(/source:\s*window\.atob\(['"]([^'"]+)['"]\)/i);
    if (directMatch?.[1]) {
        try {
            return Buffer.from(directMatch[1], 'base64').toString('utf8');
        }
        catch {
            // Ignore malformed base64 and fall through.
        }
    }
    const plainMatch = html.match(/source:\s*['"]([^'"]+)['"]/i);
    if (plainMatch?.[1])
        return plainMatch[1];
    return undefined;
};
const routes = async (fastify, options) => {
    fastify.get('/', async (_request, reply) => {
        reply.status(200).send({
            intro: `Welcome to the buffstreams provider: check out the provider's website @ ${HOME_URL}`,
            routes: ['/', '/live', '/:query', '/watch'],
            documentation: 'Custom live sports extractor. Use /live to list events and /watch?url=<event-url> to resolve HLS.',
        });
    });
    fastify.get('/live', async (_request, reply) => {
        try {
            const fetchLive = async () => {
                const res = await (0, outboundProxy_1.proxyGet)(HOME_URL, {
                    headers: buildHeaders(HOME_URL),
                });
                return parseEvents(String(res.data || ''));
            };
            const events = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, 'buffstreams:live', fetchLive, main_1.REDIS_TTL)
                : await fetchLive();
            reply.status(200).send({ results: events });
        }
        catch (err) {
            reply.status(500).send({
                message: 'Error fetching live events from Buffstreams',
                error: err.message,
            });
        }
    });
    fastify.get('/:query', async (request, reply) => {
        const query = decodeURIComponent(request.params.query || '').trim();
        try {
            const fetchResults = async () => {
                const res = await (0, outboundProxy_1.proxyGet)(HOME_URL, {
                    headers: buildHeaders(HOME_URL),
                });
                const events = parseEvents(String(res.data || ''));
                const normalized = query.toLowerCase();
                return events.filter((entry) => entry.title.toLowerCase().includes(normalized) ||
                    String(entry.category || '').toLowerCase().includes(normalized));
            };
            const results = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `buffstreams:search:${query.toLowerCase()}`, fetchResults, main_1.REDIS_TTL)
                : await fetchResults();
            reply.status(200).send({ currentPage: 1, hasNextPage: false, results });
        }
        catch (err) {
            reply.status(500).send({
                message: 'Error searching Buffstreams',
                error: err.message,
            });
        }
    });
    fastify.get('/watch', async (request, reply) => {
        const url = toAbsoluteUrl(request.query.url);
        if (!url) {
            return reply.status(400).send({ message: 'url query is required' });
        }
        try {
            const fetchWatch = async () => {
                const eventRes = await (0, outboundProxy_1.proxyGet)(url, {
                    headers: buildHeaders(HOME_URL),
                });
                const eventHtml = String(eventRes.data || '');
                const iframeUrl = extractIframeUrl(eventHtml);
                if (!iframeUrl) {
                    throw new Error('Unable to find Buffstreams embed iframe');
                }
                const embedRes = await (0, outboundProxy_1.proxyGet)(iframeUrl, {
                    headers: buildHeaders(url),
                });
                const embedHtml = String(embedRes.data || '');
                const hlsUrl = extractHlsUrl(embedHtml);
                if (!hlsUrl) {
                    throw new Error('Unable to find HLS source in Buffstreams embed');
                }
                return {
                    headers: {
                        Referer: iframeUrl,
                        Origin: new URL(iframeUrl).origin,
                    },
                    sources: [
                        {
                            url: hlsUrl,
                            quality: 'auto',
                            isM3U8: /\.m3u8(\?|$)/i.test(hlsUrl) || /load-playlist/i.test(hlsUrl),
                        },
                    ],
                    embedURL: iframeUrl,
                };
            };
            const res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `buffstreams:watch:${url}`, fetchWatch, main_1.REDIS_TTL)
                : await fetchWatch();
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({
                message: 'Error fetching sources from Buffstreams',
                error: err.message,
            });
        }
    });
};
exports.default = routes;
