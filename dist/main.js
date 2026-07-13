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
exports.tmdbApi = exports.REDIS_TTL = exports.redis = void 0;
require('dotenv').config();
const ioredis_1 = __importDefault(require("ioredis"));
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const axios_1 = __importDefault(require("axios"));
const https_1 = __importDefault(require("https"));
const outboundProxy_1 = require("./utils/outboundProxy");
// --- Global Axios Optimization ---
// Solves ECONNRESET and 403 blocks by forcing IPv4 and setting a browser User-Agent
axios_1.default.defaults.httpsAgent = new https_1.default.Agent({ family: 4, keepAlive: true });
axios_1.default.defaults.headers.common['User-Agent'] =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
axios_1.default.defaults.headers.common['Accept'] = 'application/json, text/plain, */*';
const books_1 = __importDefault(require("./routes/books"));
const anime_1 = __importDefault(require("./routes/anime"));
const manga_1 = __importDefault(require("./routes/manga"));
const comics_1 = __importDefault(require("./routes/comics"));
const light_novels_1 = __importDefault(require("./routes/light-novels"));
const movies_1 = __importDefault(require("./routes/movies"));
const meta_1 = __importDefault(require("./routes/meta"));
const news_1 = __importDefault(require("./routes/news"));
const sports_1 = __importDefault(require("./routes/sports"));
const ghoulstreams_1 = __importDefault(require("./routes/ghoulstreams"));
const chalk_1 = __importDefault(require("chalk"));
const utils_1 = __importDefault(require("./utils"));
const streamable_1 = require("./utils/streamable");
const watchTogether_1 = require("./utils/watchTogether");
exports.redis = process.env.REDIS_HOST &&
    new ioredis_1.default({
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT),
        password: process.env.REDIS_PASSWORD,
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
    });
// Sets default TTL to 1 hour (3600 seconds) if not provided in .env
exports.REDIS_TTL = Number(process.env.REDIS_TTL) || 3600;
const fastify = (0, fastify_1.default)({
    maxParamLength: 1000,
    logger: true,
});
exports.tmdbApi = process.env.TMDB_KEY && process.env.TMDB_KEY;
(async () => {
    const PORT = Number(process.env.PORT) || 3000;
    await fastify.register(cors_1.default, {
        origin: true, // Transparently reflect the request origin
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        credentials: true,
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    });
    fastify.addHook('preSerialization', async (_request, _reply, payload) => {
        return (0, streamable_1.normalizeStreamLinks)(payload);
    });
    if (process.env.NODE_ENV === 'DEMO') {
        console.log(chalk_1.default.yellowBright('DEMO MODE ENABLED'));
        const map = new Map();
        // session duration in milliseconds (5 hours)
        const sessionDuration = 1000 * 60 * 60 * 5;
        fastify.addHook('onRequest', async (request, reply) => {
            const ip = request.ip;
            const session = map.get(ip);
            // check if the requester ip has a session (temporary access)
            if (session) {
                // if session is found, check if the session is expired
                const { expiresIn } = session;
                const currentTime = new Date();
                const sessionTime = new Date(expiresIn);
                // check if the session has been expired
                if (currentTime.getTime() > sessionTime.getTime()) {
                    console.log('session expired');
                    // if expired, delete the session and continue
                    map.delete(ip);
                    // redirect to the demo request page
                    return reply.redirect('/apidemo');
                }
                console.log('session found. expires in', expiresIn);
                if (request.url === '/apidemo')
                    return reply.redirect('/');
                return;
            }
            // if route is not /apidemo, redirect to the demo request page
            if (request.url === '/apidemo')
                return;
            console.log('session not found');
            reply.redirect('/apidemo');
        });
        fastify.post('/apidemo', async (request, reply) => {
            const { ip } = request;
            // check if the requester ip has a session (temporary access)
            const session = map.get(ip);
            if (session)
                return reply.redirect('/');
            // if no session, create a new session
            const expiresIn = new Date(Date.now() + sessionDuration);
            map.set(ip, { expiresIn });
            // redirect to the demo request page
            reply.redirect('/');
        });
        fastify.get('/apidemo', async (_, reply) => {
            return reply.type('application/json').send({
                message: 'Demo access page is disabled in this deployment.',
            });
        });
        // set interval to delete expired sessions every 1 hour
        setInterval(() => {
            const currentTime = new Date();
            for (const [ip, session] of map.entries()) {
                const { expiresIn } = session;
                const sessionTime = new Date(expiresIn);
                // check if the session is expired
                if (currentTime.getTime() > sessionTime.getTime()) {
                    console.log('session expired for', ip);
                    // if expired, delete the session and continue
                    map.delete(ip);
                }
            }
        }, 1000 * 60 * 60);
    }
    console.log(chalk_1.default.green(`Starting server on port ${PORT}... 🚀`));
    if (!process.env.REDIS_HOST) {
        console.warn(chalk_1.default.yellowBright('Redis not found. Cache disabled.'));
    }
    else {
        console.log(chalk_1.default.green(`Redis connected. Default Cache TTL: ${exports.REDIS_TTL} seconds`));
    }
    if (!process.env.TMDB_KEY)
        console.warn(chalk_1.default.yellowBright('TMDB api key not found. the TMDB meta route may not work.'));
    await fastify.register(books_1.default, { prefix: '/books' });
    await fastify.register(anime_1.default, { prefix: '/anime' });
    await fastify.register(manga_1.default, { prefix: '/manga' });
    await fastify.register(comics_1.default, { prefix: '/comics' });
    await fastify.register(light_novels_1.default, { prefix: '/light-novels' });
    await fastify.register(movies_1.default, { prefix: '/movies' });
    await fastify.register(meta_1.default, { prefix: '/meta' });
    await fastify.register(news_1.default, { prefix: '/news' });
    await fastify.register(sports_1.default, { prefix: '/sports' });
    await fastify.register(ghoulstreams_1.default);
    await fastify.register(utils_1.default, { prefix: '/utils' });
    (0, watchTogether_1.registerWatchTogether)(fastify);
    const appendQueryParam = (path, key, value) => {
        const safeValue = String(value || '').trim();
        if (!safeValue)
            return path;
        const joiner = path.includes('?') ? '&' : '?';
        return `${path}${joiner}${encodeURIComponent(key)}=${encodeURIComponent(safeValue)}`;
    };
    const appendRefererParam = (path, referer) => {
        const safeReferer = String(referer || '').trim();
        return appendQueryParam(path, 'referer', safeReferer);
    };
    const buildProxyPath = (targetUrl, referer, isSegment = false, baseUrl) => {
        const raw = String(targetUrl || '').trim();
        if (!raw)
            return raw;
        if (/^\/proxy\/hls\//i.test(raw)) {
            const path = appendRefererParam(raw, referer);
            return baseUrl ? `${baseUrl}${path}` : path;
        }
        try {
            const parsed = new URL(raw);
            let path = `/proxy/hls/${parsed.host}${parsed.pathname}${parsed.search}`;
            path = appendRefererParam(path, referer);
            path = appendQueryParam(path, 'segment', isSegment ? '1' : '');
            return baseUrl ? `${baseUrl}${path}` : path;
        }
        catch {
            return raw;
        }
    };
    const rewriteHlsManifest = (manifest, manifestUrl, referer, baseUrl) => {
        const resolveAndProxy = (value, isSegment = false) => {
            const trimmed = String(value || '').trim();
            if (!trimmed)
                return trimmed;
            try {
                return buildProxyPath(new URL(trimmed, manifestUrl).toString(), referer, isSegment, baseUrl);
            }
            catch {
                return trimmed;
            }
        };
        let output = String(manifest || '');
        output = output.replace(/URI="([^"]+)"/g, (_match, uri) => `URI="${resolveAndProxy(uri)}"`);
        output = output.replace(/URI='([^']+)'/g, (_match, uri) => `URI='${resolveAndProxy(uri)}'`);
        let previousTag = '';
        output = output
            .split('\n')
            .map((line) => {
            const trimmed = line.trim();
            if (!trimmed)
                return line;
            if (trimmed.startsWith('#')) {
                previousTag = trimmed;
                return line;
            }
            if (/^(data:|blob:)/i.test(trimmed))
                return line;
            const isSegment = /^#EXTINF\b/i.test(previousTag);
            previousTag = '';
            return resolveAndProxy(trimmed, isSegment);
        })
            .join('\n');
        return output;
    };
    const isLikelyHlsManifest = (body, contentType) => {
        const text = String(body || '').trim();
        if (!text)
            return false;
        if (/application\/(vnd\.apple\.mpegurl|x-mpegURL)|audio\/x-mpegurl/i.test(String(contentType || ''))) {
            return true;
        }
        return /^#EXTM3U\b/m.test(text);
    };
    const shouldTreatAsManifestRequest = (url, incomingRange) => {
        if (/\.m3u8(?:$|\?)/i.test(url))
            return true;
        if (incomingRange)
            return false;
        if (/(?:ok\.ru|okcdn\.ru)\/.*\/video\//i.test(url))
            return true;
        return /\/(?:hls|oppai)\//i.test(url);
    };
    const fetchHlsResource = async (url, isManifest, incomingRange, referer, cookieHeader) => {
        const proxyCandidates = [...(0, outboundProxy_1.getProxyCandidatesSync)(), ''];
        let lastError = null;
        for (const proxyUrl of proxyCandidates) {
            try {
                const proxyOptions = proxyUrl ? (0, outboundProxy_1.toAxiosProxyOptions)(proxyUrl) : {};
                const upstreamOrigin = (() => {
                    try {
                        return new URL(referer).origin;
                    }
                    catch {
                        return '';
                    }
                })();
                const response = await axios_1.default.get(url, {
                    headers: {
                        Referer: referer || 'https://streameeeeee.site/',
                        ...(upstreamOrigin ? { Origin: upstreamOrigin } : {}),
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
                        ...(incomingRange ? { Range: incomingRange } : {}),
                        ...(isManifest
                            ? {}
                            : { Accept: 'video/mp2t,video/mp4,application/octet-stream,*/*' }),
                        ...(isManifest ? {} : { 'Accept-Encoding': 'identity' }),
                    },
                    timeout: 15000,
                    responseType: isManifest ? 'text' : 'arraybuffer',
                    validateStatus: (status) => status < 500,
                    ...proxyOptions,
                });
                const responseContentType = String(response.headers['content-type'] || '');
                if (isManifest &&
                    !isLikelyHlsManifest(String(response.data || ''), responseContentType)) {
                    lastError = new Error(`Invalid HLS manifest response (${response.status})`);
                    continue;
                }
                return response;
            }
            catch (error) {
                lastError = error;
            }
        }
        throw lastError instanceof Error ? lastError : new Error('HLS proxy failed');
    };
    // HLS Proxy to work around CORS issues
    fastify.get('/proxy/hls/*', async (request, reply) => {
        const rawRequestUrl = String(request.url || '');
        const [rawPath, rawQuery = ''] = rawRequestUrl.split('?');
        const wildcardPath = rawPath.replace(/^\/proxy\/hls\//i, '').trim();
        const refererParam = String(new URLSearchParams(rawQuery).get('referer') || '').trim();
        const cookieParam = String(new URLSearchParams(rawQuery).get('cookie') || '').trim();
        const segmentParam = String(new URLSearchParams(rawQuery).get('segment') || '').trim() === '1';
        const passthroughQuery = rawQuery
            .split('&')
            .filter((part) => part && !/^(referer|segment|cookie)=/i.test(part))
            .join('&');
        const url = `https://${wildcardPath}${passthroughQuery ? `?${passthroughQuery}` : ''}`;
        const incomingRange = String(request.headers.range || '');
        const isManifest = !segmentParam && shouldTreatAsManifestRequest(url, incomingRange);
        const incomingReferer = String(request.headers.referer || request.headers.referrer || '')
            .trim()
            .replace(/#.*$/, '');
        const requestReferer = (refererParam || incomingReferer || 'https://streameeeeee.site/').replace(/#.*$/, '');
        // Serve from Playwright-captured HLS manifest cache to avoid expired tokens.
        if (isManifest && !incomingRange) {
            try {
                const { getCachedHlsManifest } = await Promise.resolve().then(() => __importStar(require('./utils/browserRuntimeExtractor')));
                const cached = getCachedHlsManifest(url);
                if (cached) {
                    const content = rewriteHlsManifest(cached.body, url, requestReferer, `${request.protocol}://${request.headers.host || 'localhost:3000'}`);
                    reply.header('Content-Type', cached.contentType || 'application/vnd.apple.mpegurl');
                    reply.header('Access-Control-Allow-Origin', '*');
                    reply.header('Cache-Control', 'public, max-age=60');
                    return reply.send(content);
                }
            }
            catch {
                // Cache lookup is best-effort.
            }
        }
        try {
            const response = await fetchHlsResource(url, isManifest, incomingRange, requestReferer, cookieParam);
            const responseContentType = String(response.headers['content-type'] || '');
            const responseBuffer = Buffer.isBuffer(response.data)
                ? response.data
                : response.data instanceof ArrayBuffer
                    ? Buffer.from(response.data)
                    : ArrayBuffer.isView(response.data)
                        ? Buffer.from(response.data.buffer, response.data.byteOffset, response.data.byteLength)
                        : null;
            const responseText = responseBuffer
                ? responseBuffer.toString('utf8')
                : String(response.data || '');
            const responseIsManifest = isManifest || isLikelyHlsManifest(responseText, responseContentType);
            // If it's an M3U8 manifest, rewrite relative URLs to absolute/proxied URLs.
            // Some AnimeSalt variant playlists are extensionless /hls/<token> URLs, so
            // content sniffing is required instead of relying only on ".m3u8".
            if (responseIsManifest) {
                const hostHeader = request.headers.host || 'localhost:3000';
                const protocol = request.headers['x-forwarded-proto'] || request.protocol || 'https';
                const baseUrl = `${protocol}://${hostHeader}`;
                const content = rewriteHlsManifest(responseText, url, requestReferer, baseUrl);
                reply.header('Content-Type', 'application/vnd.apple.mpegurl');
                reply.header('Access-Control-Allow-Origin', '*');
                reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
                reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
                return reply.send(content);
            }
            // For other content (segments, etc.), proxy as-is
            reply.header('Access-Control-Allow-Origin', '*');
            reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
            reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
            reply.header('Content-Type', response.headers['content-type'] || 'application/octet-stream');
            if (response.headers['content-length'])
                reply.header('Content-Length', response.headers['content-length']);
            if (response.headers['content-range'])
                reply.header('Content-Range', response.headers['content-range']);
            if (response.headers['accept-ranges'])
                reply.header('Accept-Ranges', response.headers['accept-ranges']);
            // Optional verbose debug to inspect proxied HLS segment responses
            if (String(process.env.HLS_PROXY_DEBUG || '').toLowerCase() === 'true') {
                try {
                    const buf = Buffer.from(response.data || Buffer.alloc(0));
                    console.log('[HLS PROXY DEBUG] url=', url);
                    console.log('[HLS PROXY DEBUG] incoming Range=', incomingRange || '<none>');
                    console.log('[HLS PROXY DEBUG] proxied headers:', {
                        'content-range': response.headers['content-range'],
                        'accept-ranges': response.headers['accept-ranges'],
                        'content-length': response.headers['content-length'],
                        'content-type': response.headers['content-type'],
                    });
                    console.log('[HLS PROXY DEBUG] proxied body byteLength=', buf.length);
                }
                catch (e) {
                    console.log('[HLS PROXY DEBUG] error while logging proxy response', e?.message || String(e));
                }
            }
            return reply.send(Buffer.from(response.data));
        }
        catch (error) {
            console.error('HLS Proxy error:', error.message);
            return reply.status(500).send({ error: 'Proxy failed' });
        }
    });
    try {
        fastify.get('/', (_, rp) => {
            rp.status(200).send(`Welcome to consumet api! 🎉 \n${process.env.NODE_ENV === 'DEMO'
                ? 'This is a demo of the api. You should only use this for testing purposes.'
                : ''}`);
        });
        fastify.get('*', (request, reply) => {
            reply.status(404).send({
                message: '',
                error: 'page not found',
            });
        });
        const shouldUsePortFallback = String(process.env.ALLOW_PORT_FALLBACK || 'false').toLowerCase() === 'true';
        const startServer = async (initialPort, maxRetries = 5) => {
            if (!shouldUsePortFallback) {
                const address = await fastify.listen({ port: initialPort, host: '0.0.0.0' });
                console.log(`server listening on ${address}`);
                return;
            }
            for (let retry = 0; retry <= maxRetries; retry++) {
                const candidatePort = initialPort + retry;
                try {
                    const address = await fastify.listen({ port: candidatePort, host: '0.0.0.0' });
                    if (retry > 0) {
                        console.warn(chalk_1.default.yellowBright(`Port ${initialPort} is busy. Started on fallback port ${candidatePort} instead.`));
                    }
                    console.log(`server listening on ${address}`);
                    return;
                }
                catch (error) {
                    const isPortConflict = error?.code === 'EADDRINUSE';
                    if (!isPortConflict || retry === maxRetries) {
                        throw error;
                    }
                }
            }
        };
        await startServer(PORT);
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
})();
async function handler(req, res) {
    await fastify.ready();
    fastify.server.emit('request', req, res);
}
exports.default = handler;
