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
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const axios_1 = __importDefault(require("axios"));
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const crypto_1 = __importDefault(require("crypto"));
const outboundProxy_1 = require("./utils/outboundProxy");
// --- Global Axios Optimization ---
axios_1.default.defaults.httpsAgent = new https_1.default.Agent({ family: 4, keepAlive: true });
axios_1.default.defaults.headers.common['User-Agent'] =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
axios_1.default.defaults.headers.common['Accept'] = 'application/json, text/plain, */*';
// Dedicated keep-alive agents for HLS segment streaming
const hlsHttpAgent = new http_1.default.Agent({ keepAlive: true, maxSockets: 128, maxFreeSockets: 64 });
const hlsHttpsAgent = new https_1.default.Agent({ keepAlive: true, maxSockets: 128, maxFreeSockets: 64, family: 4 });
// Fresh (no keep-alive) agents for flaky direct-IP CDNs (hubstream etc.). Their
// nodes intermittently poison kept-alive TLS sockets, causing
// "write EPROTO ... packet length too long" on reuse. A fresh connection per
// request avoids that at a small TLS-handshake cost.
const hlsHttpsFreshAgent = new https_1.default.Agent({ family: 4, keepAlive: false });
const hlsHttpFreshAgent = new http_1.default.Agent({ keepAlive: false });
// --- HLS segment cache -------------------------------------------------------
// Serve previously-fetched segments instantly so seeks, replays and the
// parallel audio/video fragment streams don't re-hit the upstream CDN, which
// throttles concurrent bursts and intermittently returns 500. Entries are
// keyed by the full upstream URL (tokens are part of the URL), TTL-bounded and
// size-capped to keep memory sane under long sessions.
const HLS_SEGMENT_CACHE_TTL_MS = 10 * 60 * 1000;
const HLS_SEGMENT_CACHE_MAX_ENTRIES = 1600;
const HLS_SEGMENT_CACHE_MAX_BYTES = 240 * 1024 * 1024;
const hlsSegmentCache = new Map();
let hlsSegmentCacheBytes = 0;
function hlsSegmentCacheGet(key) {
    const entry = hlsSegmentCache.get(key);
    if (!entry)
        return undefined;
    if (Date.now() - entry.cachedAt > HLS_SEGMENT_CACHE_TTL_MS) {
        hlsSegmentCache.delete(key);
        hlsSegmentCacheBytes -= entry.buf.length;
        return undefined;
    }
    return entry;
}
function hlsSegmentCacheSet(key, entry) {
    const existing = hlsSegmentCache.get(key);
    if (existing)
        hlsSegmentCacheBytes -= existing.buf.length;
    hlsSegmentCache.set(key, entry);
    hlsSegmentCacheBytes += entry.buf.length;
    while (hlsSegmentCache.size > HLS_SEGMENT_CACHE_MAX_ENTRIES ||
        hlsSegmentCacheBytes > HLS_SEGMENT_CACHE_MAX_BYTES) {
        const oldestKey = hlsSegmentCache.keys().next().value;
        if (!oldestKey)
            break;
        const oldest = hlsSegmentCache.get(oldestKey);
        if (oldest)
            hlsSegmentCacheBytes -= oldest.buf.length;
        hlsSegmentCache.delete(oldestKey);
    }
}
// --- Upstream segment fetch concurrency limiter ------------------------------
// HLS.js fires up to ~8 parallel fragment requests on a seek (video+audio).
// Without a cap the CDN starts dropping/throttling and answers 500. Serialize
// the remaining requests through a FIFO queue.
const UPSTREAM_MAX_CONCURRENCY = 8;
const upstreamQueue = [];
let upstreamActive = 0;
function drainUpstreamQueue() {
    while (upstreamActive < UPSTREAM_MAX_CONCURRENCY && upstreamQueue.length > 0) {
        const next = upstreamQueue.shift();
        if (next)
            next();
    }
}
async function withUpstreamConcurrency(fn) {
    if (upstreamActive < UPSTREAM_MAX_CONCURRENCY) {
        upstreamActive += 1;
        try {
            return await fn();
        }
        finally {
            upstreamActive -= 1;
            drainUpstreamQueue();
        }
    }
    return new Promise((resolve, reject) => {
        upstreamQueue.push(() => {
            upstreamActive += 1;
            fn().then(resolve, reject).finally(() => {
                upstreamActive -= 1;
                drainUpstreamQueue();
            });
        });
    });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// --- HubStream CDN node rotation -------------------------------------------
// HubStream signs its fragment/playlist URLs once and serves them from a pool
// of `{node}.{cdnDomain}` hosts. Both the node prefix and the CDN domain rotate
// over time (e.g. sd8g.auroradigitalworks.shop, sdqm.fusionhorizonworks.site).
// Nodes are unreliable (per-segment 502s, nginx bursts) and a node that starts
// failing usually fails every resource on it for a while. The k/kx signature
// tokens are global to the whole CDN, so the same signed URL can be retried
// verbatim on any other (node, domain) pair.
const HUBSTREAM_CDN_HOST_RE = /^([a-z0-9-]+)\.([a-z0-9-]+\.[a-z]{2,})$/i;
const HUBSTREAM_CDN_PATH_RE = /\/v4\/pl\/([a-z0-9-]+)\.([a-z0-9-]+\.[a-z]{2,})(\/.*)$/i;
const hubstreamNodePrefixes = ['s9r1', 'sd8g', 'sipt', 'sdqm'];
const hubstreamCdnDomains = ['auroradigitalworks.shop', 'fusionhorizonworks.site'];
const addHubstreamNode = (hostname) => {
    const match = String(hostname || '').toLowerCase().match(HUBSTREAM_CDN_HOST_RE);
    const prefix = match?.[1];
    const domain = match?.[2];
    if (!prefix || !domain)
        return;
    if (!hubstreamNodePrefixes.includes(prefix))
        hubstreamNodePrefixes.push(prefix);
    if (!hubstreamCdnDomains.includes(domain))
        hubstreamCdnDomains.push(domain);
};
/**
 * Return equivalent URLs for the given hubstream resource across the known
 * (node, domain) pool. The first entry is always the original URL. Hostname-form
 * (`{node}.{domain}/v4/...`) and path-form
 * (`hubstream.art/v4/pl/{node}.{domain}/...`) are both handled. Rotated
 * candidates prefer the original domain first, then the original prefix.
 */
const hubstreamNodeVariants = (url) => {
    const variants = [url];
    try {
        const parsed = new URL(url);
        let originalPrefix = '';
        let originalDomain = '';
        let hostForm = false;
        const hostMatch = parsed.hostname.match(HUBSTREAM_CDN_HOST_RE);
        if (hostMatch && /^\/v4\//i.test(parsed.pathname)) {
            originalPrefix = hostMatch[1];
            originalDomain = hostMatch[2];
            hostForm = true;
            addHubstreamNode(parsed.hostname);
        }
        else {
            const pathMatch = parsed.pathname.match(HUBSTREAM_CDN_PATH_RE);
            if (pathMatch) {
                originalPrefix = pathMatch[1];
                originalDomain = pathMatch[2];
                addHubstreamNode(`${originalPrefix}.${originalDomain}`);
            }
        }
        if (!originalPrefix || !originalDomain)
            return variants;
        const domains = [originalDomain, ...hubstreamCdnDomains.filter((d) => d !== originalDomain)];
        const prefixes = [originalPrefix, ...hubstreamNodePrefixes.filter((p) => p !== originalPrefix)];
        for (const domain of domains) {
            for (const prefix of prefixes) {
                if (domain === originalDomain && prefix === originalPrefix)
                    continue;
                const host = `${prefix}.${domain}`;
                const candidate = hostForm
                    ? parsed.href.replace(parsed.host, host)
                    : url.replace(`${originalPrefix}.${originalDomain}`, host);
                if (!variants.includes(candidate))
                    variants.push(candidate);
                // Cap the pool so a dead stream can't burn unbounded time.
                if (variants.length >= 9)
                    return variants;
            }
        }
    }
    catch {
        // Not a valid URL — return the original unchanged.
    }
    return variants;
};
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
exports.redis = null;
exports.REDIS_TTL = 3600;
const fastify = (0, fastify_1.default)({
    maxParamLength: 1000,
    logger: true,
});
const MEDIA_PROXY_TOKEN_TTL_SECONDS = 600;
const createMediaProxyToken = () => {
    const secret = String(process.env.MEDIA_PROXY_TOKEN_SECRET || '').trim();
    if (!secret)
        return null;
    const payload = Buffer.from(JSON.stringify({
        exp: Math.floor(Date.now() / 1000) + MEDIA_PROXY_TOKEN_TTL_SECONDS,
    })).toString('base64url');
    const signature = crypto_1.default.createHmac('sha256', secret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
};
exports.tmdbApi = process.env.TMDB_KEY && process.env.TMDB_KEY;
(async () => {
    const PORT = Number(process.env.PORT) || 3000;
    await fastify.register(cors_1.default, {
        origin: true, // Transparently reflect the request origin
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        credentials: true,
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    });
    fastify.get('/media-proxy/token', async (_request, reply) => {
        const token = createMediaProxyToken();
        if (!token)
            return reply.code(503).send({ error: 'Media proxy token service is not configured' });
        return reply.send({ token, expiresIn: MEDIA_PROXY_TOKEN_TTL_SECONDS });
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
    console.log(chalk_1.default.yellowBright('Redis removed. Cache disabled.'));
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
    const isHubstreamSignedCdn = (u) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(u.hostname) && /^\/v4\//.test(u.pathname);
    const rewriteHlsManifest = (manifest, manifestUrl, referer, baseUrl) => {
        const resolveAndProxy = (value, isSegment = false) => {
            const trimmed = String(value || '').trim();
            if (!trimmed)
                return trimmed;
            try {
                // Preserve the provider's page referer for child playlists and segments.
                // Using the parent manifest URL as Referer causes AnimeKai CDN requests to 403.
                const upstreamReferer = referer || manifestUrl;
                const resolved = new URL(trimmed, manifestUrl);
                // HubStream's direct-IP CDN signs every resource with the parent
                // playlist's query params (?v=...). Resolving relative references
                // drops that query, so re-inherit it or the CDN rejects the request
                // (502) and playback stalls.
                if (isHubstreamSignedCdn(new URL(manifestUrl))) {
                    const parent = new URL(manifestUrl);
                    for (const [key, value2] of parent.searchParams) {
                        if (!resolved.searchParams.has(key)) {
                            resolved.searchParams.set(key, value2);
                        }
                    }
                }
                return buildProxyPath(resolved.toString(), upstreamReferer, isSegment, baseUrl);
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
            // AnimeSalt subtitle URLs can be extensionless or end in .js. They may
            // follow an EXTINF line in the manifest, but must not receive the
            // segment marker or the HLS proxy will fetch them as media bytes.
            const isSubtitleResource = /(?:\/p\/|\.(?:vtt|srt|ass|js)(?:\?|$))/i.test(trimmed);
            const isSegment = /^#EXTINF\b/i.test(previousTag) && !isSubtitleResource;
            previousTag = '';
            return resolveAndProxy(trimmed, isSegment);
        })
            .join('\n');
        // AniKoto's shiora/mikora playlists use these CDN segment hosts as
        // playable media despite their ad-like names. The reference proxy
        // preserves them, so only apply the legacy cleanup to other manifests.
        if (!/(?:shiora|mikora|norami|akirax)\./i.test(manifestUrl)) {
            output = output.replace(/#EXTINF:[^\n]*(?:\n#[^\n]*)*\n[^\n]*(?:p1\.ipstatp\.com\/obj\/ad-site-i18n|p\d+-ad-sg\.ibyteimg\.com|p\d+-ad-site-sign-sg\.tiktokcdn\.com)[^\n]*/gi, '');
        }
        // StreamVerse attaches external subtitle tracks itself. Some AnimeSalt
        // manifests advertise their subtitle file as an HLS playlist even though
        // it is a plain subtitle payload, which makes HLS.js abort video startup.
        output = output
            .split('\n')
            .filter((line) => !/^#EXT-X-MEDIA:/i.test(line) || !/TYPE=SUBTITLES/i.test(line))
            .join('\n');
        // Morencius audio playlists go through the proxy alongside video.
        // They are now reliably proxied so keep them available for
        // multi-language selection (English, Hindi, etc.) on the client.
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
        const isAnimeSaltCdn = /^https?:\/\/(?:as-cdn\d+|z\d+)\.(?:top|ac|pro|xyz|click|link|net|cc|org)\//i.test(url);
        // AnimeKai's Megaplay playlists can use a CDN for segments.
        // Those requests are reachable directly but commonly hang through the
        // configured outbound proxies, adding 15 seconds per segment retry.
        const isIbyteCdn = /^https?:\/\/[^/]*\.ibyteimg\.com\//i.test(url);
        const isHubstreamCdn = /^https?:\/\/(?:\d{1,3}\.){3}\d{1,3}\//i.test(url) && /\/v4\//i.test(url);
        const isShioraCdn = /^https?:\/\/(?:megap|vidtub)\.(?:shiora\.(?:top|site)|norami\.top|akirax\.buzz)\//i.test(url)
            || /^https?:\/\/cdn\.watching\.onl\//i.test(url)
            || /^https?:\/\/[^/]*\.akirax\.buzz\//i.test(url)
            || /^https?:\/\/[^/]+\.livedns\.[^/]+\//i.test(url);
        const isAcekCdn = /^https?:\/\/[^/]*\.acek-cdn\.com\//i.test(url);
        const proxyCandidates = isAnimeSaltCdn || isIbyteCdn || isHubstreamCdn || isShioraCdn
            ? ['']
            : isAcekCdn
                ? ['', ...(0, outboundProxy_1.getProxyCandidatesSync)()]
                : [...(0, outboundProxy_1.getProxyCandidatesSync)(), ''];
        let lastError = null;
        const effectiveReferer = (() => {
            const safeReferer = String(referer || '').trim();
            if (!safeReferer)
                return safeReferer;
            // AniKoto's shiora CDN rejects the full Megaplay stream path and only
            // accepts the provider origin as Referer.
            if (/^https?:\/\/cdn\.mewstream\.[^/]+\//i.test(url) ||
                /^https?:\/\/cdn\.watching\.onl\//i.test(url) ||
                /^https?:\/\/[^/]+\.livedns\.[^/]+\//i.test(url) ||
                /^https?:\/\/[^/]*\.akirax\.buzz\//i.test(url) ||
                /^https?:\/\/vidtub\.(?:shiora\.(?:top|site)|akirax\.buzz)\//i.test(url) ||
                /^https?:\/\/(?:megap\.mikora\.top|megap\.norami\.top|megap\.akirax\.buzz)\//i.test(url)) {
                return 'https://megaplay.buzz/';
            }
            const isAnimeSaltSiteReferer = /^https?:\/\/animesalt\.(?:ac|pro|xyz|click)(?:\/|$)/i.test(safeReferer);
            if (isAnimeSaltCdn && isAnimeSaltSiteReferer) {
                return safeReferer;
            }
            return safeReferer;
        })();
        // HubStream signs its URLs per-stream, not per-node, so a node that starts
        // 502ing can be swapped for another node in the same pool. The original node
        // keeps the full retry budget; rotated nodes use a smaller one.
        const nodeVariants = hubstreamNodeVariants(url);
        for (let nodeIdx = 0; nodeIdx < nodeVariants.length; nodeIdx++) {
            const variantUrl = nodeVariants[nodeIdx];
            const isPrimaryNode = nodeIdx === 0;
            for (const proxyUrl of proxyCandidates) {
                // When node rotation is available, burn the least time on a dead node:
                // two quick tries on the original, one on each rotated node. Keep the
                // full 5-attempt budget for non-rotated URLs (unchanged behavior).
                const maxAttempts = nodeVariants.length > 1
                    ? (isPrimaryNode ? 2 : 1)
                    : 5;
                let attempt = 0;
                let lastCandidateError = null;
                while (attempt < maxAttempts) {
                    attempt += 1;
                    // HubStream's direct-IP nodes fail in bursts (nginx 502 / TLS resets).
                    // A longer exponential backoff escapes those windows instead of retrying
                    // straight into the same failure.
                    const backoffMs = nodeVariants.length > 1
                        ? 300
                        : Math.min(3000, 300 * Math.pow(2, attempt - 1));
                    try {
                        const response = await withUpstreamConcurrency(async () => {
                            const proxyOptions = proxyUrl ? (0, outboundProxy_1.toAxiosProxyOptions)(proxyUrl) : {};
                            const omitOrigin = /^https?:\/\/(?:vidtub\.(?:shiora\.(?:top|site)|akirax\.buzz)|megap\.(?:mikora\.top|norami\.top|akirax\.buzz))\//i.test(url);
                            const upstreamOrigin = (() => {
                                if (omitOrigin)
                                    return '';
                                try {
                                    return new URL(effectiveReferer).origin;
                                }
                                catch {
                                    return '';
                                }
                            })();
                            return await axios_1.default.get(variantUrl, {
                                headers: {
                                    Referer: effectiveReferer || 'https://streameeeeee.site/',
                                    ...(upstreamOrigin ? { Origin: upstreamOrigin } : {}),
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                                    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
                                    ...(incomingRange ? { Range: incomingRange } : {}),
                                    ...(isManifest
                                        ? {}
                                        : { Accept: 'video/mp2t,video/mp4,application/octet-stream,*/*' }),
                                    ...(isManifest ? {} : { 'Accept-Encoding': 'identity' }),
                                },
                                timeout: isAcekCdn ? 25000 : isIbyteCdn ? 30000 : isManifest ? 15000 : 10000,
                                responseType: isManifest ? 'text' : 'arraybuffer',
                                validateStatus: (status) => status < 500,
                                ...proxyOptions,
                                // Flaky direct-IP CDNs (hubstream v4): avoid reusing poisoned
                                // keep-alive TLS sockets that fail with `write EPROTO` on reuse.
                                ...(isHubstreamCdn && !proxyUrl
                                    ? { httpAgent: hlsHttpFreshAgent, httpsAgent: hlsHttpsFreshAgent }
                                    : {}),
                            });
                        });
                        const responseContentType = String(response.headers['content-type'] || '');
                        if (response.status >= 400) {
                            lastCandidateError = new Error(`Upstream HLS response (${response.status})`);
                            // Transient 5xx (CDN throttling) benefits from a quick retry.
                            if (response.status >= 500 && attempt < maxAttempts) {
                                await sleep(backoffMs);
                                continue;
                            }
                            break;
                        }
                        if (isManifest &&
                            !isLikelyHlsManifest(String(response.data || ''), responseContentType)) {
                            lastCandidateError = new Error(`Invalid HLS manifest response (${response.status})`);
                            break;
                        }
                        return response;
                    }
                    catch (error) {
                        lastCandidateError = error;
                        const statusCode = Number(error?.response?.status || 0);
                        const isTransient = (statusCode >= 500 && statusCode < 600) || statusCode === 0;
                        if (isTransient && attempt < maxAttempts) {
                            await sleep(backoffMs);
                            continue;
                        }
                        break;
                    }
                }
                lastError = lastCandidateError;
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
        let url = `https://${wildcardPath}${passthroughQuery ? `?${passthroughQuery}` : ''}`;
        // HubStream's hlsmod path wraps the real CDN host in the URL path. Decode
        // it before fetching; requesting the wrapper itself returns 404.
        const hlsmodMatch = url.match(/^https:\/\/hubstream\.(?:art|pw|cc|ink|foo|boo)\/hlsmod\/([^/]+)(\/.*)$/i);
        if (hlsmodMatch) {
            url = `https://${hlsmodMatch[1]}${hlsmodMatch[2]}${passthroughQuery ? `?${passthroughQuery}` : ''}`;
        }
        const incomingRange = String(request.headers.range || '');
        const isManifest = !segmentParam && shouldTreatAsManifestRequest(url, incomingRange);
        const incomingReferer = String(request.headers.referer || request.headers.referrer || '')
            .trim()
            .replace(/#.*$/, '');
        let requestReferer = (refererParam || incomingReferer || 'https://streameeeeee.site/').replace(/#.*$/, '');
        if (/^https?:\/\/cdn\.mewstream\.[^/]+\//i.test(url) ||
            /^https?:\/\/cdn\.watching\.onl\//i.test(url) ||
            /^https?:\/\/[^/]+\.livedns\.[^/]+\//i.test(url) ||
            /^https?:\/\/[^/]*\.akirax\.buzz\//i.test(url) ||
            /^https?:\/\/(?:megap|vidtub)\.(?:shiora\.(?:top|site)|akirax\.buzz)\//i.test(url) ||
            /^https?:\/\/(?:megap\.mikora\.top|megap\.norami\.top|megap\.akirax\.buzz)\//i.test(url)) {
            requestReferer = 'https://megaplay.buzz/';
        }
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
        // Serve cached segments instantly: seeks back, replays and the parallel
        // audio/video fragment streams hit the CDN once instead of on every request.
        if (!isManifest && !incomingRange) {
            const cachedSegment = hlsSegmentCacheGet(url);
            if (cachedSegment) {
                reply.header('Access-Control-Allow-Origin', '*');
                reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
                reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
                reply.header('Content-Type', cachedSegment.contentType || 'application/octet-stream');
                reply.header('Content-Length', cachedSegment.buf.length);
                reply.header('Cache-Control', 'public, max-age=600');
                return reply.send(cachedSegment.buf);
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
            const isKeyResponse = /\/keys\/key\.bin(?:$|\?)/i.test(url);
            const responseIsManifest = isManifest || isLikelyHlsManifest(responseText, responseContentType);
            // If it's an M3U8 manifest, rewrite relative URLs to absolute/proxied URLs.
            // Some AnimeSalt variant playlists are extensionless /hls/<token> URLs, so
            // content sniffing is required instead of relying only on ".m3u8".
            if (responseIsManifest) {
                const hostHeader = request.headers.host || 'localhost:3000';
                const protocol = request.headers['x-forwarded-proto'] || request.protocol || 'https';
                const baseUrl = `${protocol}://${hostHeader}`;
                const content = rewriteHlsManifest(responseText, url, requestReferer, baseUrl);
                // Some Megaplay tokens currently return an ad-only playlist. After
                // removing those ad entries, fail it so the player can try a fallback
                // source instead of retrying an empty 200 response forever.
                const hasMediaUri = content
                    .split('\n')
                    .some((line) => line.trim() && !line.trim().startsWith('#'));
                if (!hasMediaUri && !/(?:shiora|mikora|norami|akirax)\./i.test(url)) {
                    return reply.code(502).send({ error: 'Upstream HLS manifest contains no media segments' });
                }
                reply.header('Content-Type', 'application/vnd.apple.mpegurl');
                reply.header('Access-Control-Allow-Origin', '*');
                reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
                reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
                return reply.send(content);
            }
            // For segments (non-manifest), stream directly using keep-alive agents
            if (!responseIsManifest) {
                if (isKeyResponse && responseBuffer) {
                    const trimmedKey = responseText.replace(/\s+/g, '');
                    if (/^[A-Za-z0-9+/=]+$/.test(trimmedKey) && trimmedKey.length >= 24) {
                        try {
                            const decodedKey = Buffer.from(trimmedKey, 'base64');
                            if (decodedKey.length >= 16 && decodedKey.length < responseBuffer.length) {
                                reply.header('Access-Control-Allow-Origin', '*');
                                reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
                                reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
                                reply.header('Content-Type', 'application/octet-stream');
                                reply.header('Content-Length', decodedKey.length);
                                return reply.send(decodedKey);
                            }
                        }
                        catch {
                            // Fall back to raw key payload when decoding fails.
                        }
                    }
                }
                // Serve the fully-downloaded segment buffer directly. The previous code
                // re-requested the same segment over the wire a second time to stream it,
                // doubling upstream latency/CDN load and amplifying throttling 500s.
                if (responseBuffer) {
                    let contentType = responseContentType || 'application/octet-stream';
                    // Some anime CDNs (e.g. livedns.my) return text/html for binary video
                    // segments. Sniff the first bytes and override to prevent browser errors.
                    if (/^text\/html/i.test(contentType) && responseBuffer.length > 16) {
                        const magic = responseBuffer.subarray(0, 8);
                        const head = magic.toString('ascii');
                        if (head.startsWith('ID3') || head.startsWith('\x00\x00\x00')
                            || magic[0] === 0x47 || magic[0] === 0x1A || magic[0] === 0x00) {
                            contentType = 'video/mp2t';
                        }
                    }
                    const corsHeaders = {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
                        'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    };
                    if (!incomingRange) {
                        hlsSegmentCacheSet(url, {
                            buf: responseBuffer,
                            contentType,
                            cachedAt: Date.now(),
                        });
                        reply.header('Access-Control-Allow-Origin', '*');
                        reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
                        reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
                        reply.header('Content-Type', contentType);
                        reply.header('Content-Length', responseBuffer.length);
                        reply.header('Cache-Control', 'public, max-age=600');
                        return reply.send(responseBuffer);
                    }
                    // Honor byte ranges against the buffered segment.
                    const rangeMatch = /^bytes=(\d*)-(\d*)$/i.exec(incomingRange.trim());
                    const total = responseBuffer.length;
                    if (rangeMatch) {
                        let start = rangeMatch[1] ? Number(rangeMatch[1]) : 0;
                        const endRaw = rangeMatch[2] ? Number(rangeMatch[2]) : total - 1;
                        if (!rangeMatch[1] && rangeMatch[2])
                            start = Math.max(0, total - Number(rangeMatch[2]));
                        const end = Math.min(endRaw, total - 1);
                        if (start <= end && start < total) {
                            const slice = responseBuffer.subarray(start, end + 1);
                            reply.header('Access-Control-Allow-Origin', '*');
                            reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
                            reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
                            reply.header('Content-Type', contentType);
                            reply.header('Content-Range', `bytes ${start}-${end}/${total}`);
                            reply.header('Content-Length', slice.length);
                            reply.header('Accept-Ranges', 'bytes');
                            reply.code(206);
                            return reply.send(slice);
                        }
                        reply.code(416);
                        return reply.send({ error: 'Range not satisfiable' });
                    }
                    void corsHeaders;
                }
                // Stream segment directly via keep-alive agents
                try {
                    const upstreamUrl = new URL(url);
                    const isHttps = upstreamUrl.protocol === 'https:';
                    const transport = isHttps ? https_1.default : http_1.default;
                    const agent = isHttps ? hlsHttpsAgent : hlsHttpAgent;
                    const segmentReq = transport.request({
                        hostname: upstreamUrl.hostname,
                        port: upstreamUrl.port || (isHttps ? 443 : 80),
                        path: upstreamUrl.pathname + upstreamUrl.search,
                        method: 'GET',
                        agent,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                            Referer: requestReferer,
                            ...(incomingRange ? { Range: incomingRange } : {}),
                            ...(cookieParam ? { Cookie: cookieParam } : {}),
                            Accept: 'video/mp2t,video/mp4,application/octet-stream,*/*',
                            'Accept-Encoding': 'identity',
                        },
                    }, (upstreamRes) => {
                        const resHeaders = {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
                            'Access-Control-Allow-Methods': 'GET, OPTIONS',
                            'Content-Type': upstreamRes.headers['content-type'] || 'application/octet-stream',
                        };
                        if (upstreamRes.headers['content-length'])
                            resHeaders['Content-Length'] = upstreamRes.headers['content-length'];
                        if (upstreamRes.headers['content-range'])
                            resHeaders['Content-Range'] = upstreamRes.headers['content-range'];
                        if (upstreamRes.headers['accept-ranges'])
                            resHeaders['Accept-Ranges'] = upstreamRes.headers['accept-ranges'];
                        reply.raw.writeHead(upstreamRes.statusCode || 200, resHeaders);
                        upstreamRes.pipe(reply.raw);
                    });
                    segmentReq.on('error', (err) => {
                        console.error('HLS segment stream error:', err.message);
                        if (!reply.sent) {
                            reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
                            reply.raw.end(JSON.stringify({ error: 'Segment proxy failed' }));
                        }
                    });
                    segmentReq.end();
                    return reply;
                }
                catch (err) {
                    console.error('HLS segment stream error:', err.message);
                    return reply.status(500).send({ error: 'Segment proxy failed' });
                }
            }
            // Should never reach here — all paths in the non-manifest block return above
            return reply.status(500).send({ error: 'Unexpected proxy state' });
        }
        catch (error) {
            console.error('HLS Proxy error:', error.message);
            const upstreamStatus = Number(error?.statusCode || error?.response?.status || 0);
            const status = upstreamStatus >= 400 && upstreamStatus < 600 ? upstreamStatus : 502;
            return reply.status(status).send({
                error: 'Proxy failed',
                ...(upstreamStatus ? { upstreamStatus } : {}),
            });
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
