"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const node_http_1 = __importDefault(require("node:http"));
const node_https_1 = __importDefault(require("node:https"));
const buffstreams_1 = require("../providers/sports/buffstreams");
const racing_1 = require("../providers/sports/racing");
const livesport_helper_1 = require("../providers/sports/livesport-helper");
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const AVAILABILITY_TTL_MS = 1000 * 60 * 45;
const WATCH_LOOKUP_TTL_MS = 1000 * 20;
const streamAvailability = new Map();
const watchLookupCache = new Map();
const watchLookupInFlight = new Map();
const isAbsoluteHttpUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());
const getQueryValue = (query, ...keys) => {
    const map = new Map();
    for (const [key, value] of Object.entries(query || {}))
        map.set(String(key).toLowerCase(), value);
    for (const key of keys) {
        const value = map.get(String(key).toLowerCase());
        if (value !== undefined && value !== null)
            return String(value).trim();
    }
    return '';
};
const dropConditionalHeaders = (headers) => {
    const filtered = {};
    for (const [key, value] of Object.entries(headers)) {
        const lower = key.toLowerCase();
        if (lower === 'if-none-match' ||
            lower === 'if-modified-since' ||
            lower === 'if-match' ||
            lower === 'if-unmodified-since') {
            continue;
        }
        filtered[key] = value;
    }
    return filtered;
};
const setCorsHeaders = (reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range, Origin, Referer, User-Agent, Accept, Accept-Encoding');
    reply.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    reply.header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
};
const streamUpstreamToReply = async (targetUrl, headers, reply) => {
    const url = new URL(targetUrl);
    const client = url.protocol === 'https:' ? node_https_1.default : node_http_1.default;
    return await new Promise((resolve, reject) => {
        const req = client.request(targetUrl, {
            method: 'GET',
            headers,
        }, (res) => {
            reply.status(res.statusCode || 200);
            for (const [key, value] of Object.entries(res.headers)) {
                if (value === undefined)
                    continue;
                if (key.toLowerCase() === 'transfer-encoding')
                    continue;
                reply.header(key, value);
            }
            setCorsHeaders(reply);
            res.on('error', reject);
            reply.raw.on('close', () => req.destroy());
            res.pipe(reply.raw);
            res.on('end', resolve);
        });
        req.on('error', reject);
        req.end();
    });
};
const pruneAvailability = () => {
    const now = Date.now();
    for (const [id, value] of streamAvailability.entries()) {
        if (!value?.updatedAt || now - value.updatedAt > AVAILABILITY_TTL_MS) {
            streamAvailability.delete(id);
        }
    }
};
const getAvailabilitySnapshot = () => {
    pruneAvailability();
    const snapshot = {};
    for (const [id, value] of streamAvailability.entries())
        snapshot[id] = value;
    return snapshot;
};
const setStreamAvailability = (id, isLive, reason = '') => {
    const key = String(id || '').trim();
    if (!key)
        return;
    streamAvailability.set(key, {
        isLive: Boolean(isLive),
        reason: String(reason || ''),
        updatedAt: Date.now(),
    });
};
const getCachedLookup = async (key, fetcher, ttlMs = WATCH_LOOKUP_TTL_MS) => {
    const cacheKey = String(key || '').trim();
    const now = Date.now();
    const cached = watchLookupCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        return cached.value;
    }
    const inflight = watchLookupInFlight.get(cacheKey);
    if (inflight)
        return inflight;
    const promise = (async () => {
        try {
            const value = await fetcher();
            watchLookupCache.set(cacheKey, { expiresAt: Date.now() + ttlMs, value });
            return value;
        }
        finally {
            watchLookupInFlight.delete(cacheKey);
        }
    })();
    watchLookupInFlight.set(cacheKey, promise);
    return promise;
};
const buildHlsProxyPath = (targetUrl, referer = '') => {
    const hostEnd = targetUrl.indexOf('/', targetUrl.indexOf('://') + 3);
    if (hostEnd === -1)
        return `/proxy/hls/${new URL(targetUrl).host}/`;
    const qsStart = targetUrl.indexOf('?', hostEnd);
    const rawPath = qsStart >= 0 ? targetUrl.slice(hostEnd, qsStart) : targetUrl.slice(hostEnd);
    const rawQuery = qsStart >= 0 ? targetUrl.slice(qsStart + 1) : '';
    const host = new URL(targetUrl).host;
    const newQuery = referer
        ? `${rawQuery}${rawQuery ? '&' : ''}referer=${encodeURIComponent(referer)}`
        : rawQuery;
    return `/proxy/hls/${host}${rawPath}${newQuery ? `?${newQuery}` : ''}`;
};
const noStoreHeaders = async (_request, reply) => {
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    reply.header('Pragma', 'no-cache');
    reply.header('Expires', '0');
    reply.header('Surrogate-Control', 'no-store');
};
const routes = async (fastify, _options) => {
    const buffstreams = new buffstreams_1.BuffStreams();
    const racing = new racing_1.Racing();
    fastify.addHook('onRequest', async (request, reply) => {
        if (request.url.startsWith('/api/')) {
            await noStoreHeaders(request, reply);
        }
    });
    fastify.post('/api/search', async (request, reply) => {
        try {
            const { query, date } = request.body || {};
            let results = await buffstreams.search(String(query || ''), {
                date: String(date || '') || undefined,
            });
            for (const result of results || []) {
                if (result?.isLive === true) {
                    setStreamAvailability(String(result.id || result.url || ''), true, 'source_available');
                }
            }
            return reply.send({ success: true, data: results });
        }
        catch (error) {
            return reply.send({ success: false, error: error?.message || 'search_failed' });
        }
    });
    fastify.get('/api/stream-statuses', async (_request, reply) => {
        return reply.send({ success: true, data: getAvailabilitySnapshot() });
    });
    fastify.post('/api/report-stream-status', async (request, reply) => {
        try {
            const { id, isLive, reason } = request.body || {};
            setStreamAvailability(String(id || ''), Boolean(isLive), String(reason || 'reported'));
            return reply.send({ success: true });
        }
        catch (error) {
            return reply.send({ success: false, error: error?.message || 'report_failed' });
        }
    });
    fastify.post('/api/fetchInfo', async (request, reply) => {
        try {
            const { id } = request.body || {};
            const target = String(id || '').trim();
            const cacheKey = `fetchInfo:${target}`;
            const isRacing = /fullraces|formula-1|nascar|indycar|motogp|racing/i.test(target);
            const info = await getCachedLookup(cacheKey, async () => isRacing
                ? await racing.fetchMediaInfo(target)
                : await buffstreams.fetchMediaInfo(target));
            return reply.send({ success: true, data: info });
        }
        catch (error) {
            return reply.send({ success: false, error: error?.message || 'fetch_info_failed' });
        }
    });
    fastify.post('/api/fetchSources', async (request, reply) => {
        try {
            const { eventUrl, embedUrl } = request.body || {};
            const target = String(eventUrl || embedUrl || '').trim();
            const cacheKey = `fetchSources:${target}`;
            const isRacing = /fullraces|formula-1|nascar|indycar|motogp|racing/i.test(target);
            let data = await getCachedLookup(cacheKey, async () => isRacing
                ? await racing.fetchEpisodeSources(target)
                : await buffstreams.fetchEpisodeSources(target));
            if (Array.isArray(data?.sources) && data.sources.length > 0) {
                setStreamAvailability(target, true, 'source_available');
            }
            return reply.send({ success: true, data });
        }
        catch (error) {
            return reply.send({
                success: false,
                error: error?.message || 'fetch_sources_failed',
            });
        }
    });
    fastify.post('/api/matchDetails', async (request, reply) => {
        try {
            const { title, sport } = request.body || {};
            if (!title)
                return reply.send({ success: false, error: 'title required' });
            const client = axios_1.default.create();
            const cacheKey = `matchDetails:${String(title || '').trim()}:${String(sport || 'sports')
                .trim()
                .toLowerCase()}`;
            const data = await getCachedLookup(cacheKey, async () => livesport_helper_1.LiveSportHelper.getLiveStats(client, String(title), String(sport || 'sports')));
            return reply.send({ success: true, data: data || null });
        }
        catch (error) {
            return reply.send({
                success: true,
                data: null,
                error: error?.message || 'match_details_failed',
            });
        }
    });
    fastify.get('/api/livesport-directory', async (_request, reply) => {
        try {
            const client = axios_1.default.create();
            const data = await livesport_helper_1.LiveSportHelper.getGlobalDirectory(client);
            const matches = data?.matches || [];
            if (matches.length > 0) {
                return reply.send({ success: true, data: { matches } });
            }
            throw new Error('empty directory');
        }
        catch (error) {
            return reply.send({
                success: true,
                data: { matches: [] },
                error: error?.message || 'livesport_directory_failed',
            });
        }
    });
    fastify.get('/api/racing/catalog', async (request, reply) => {
        try {
            const category = String(request.query?.category || '').trim();
            const data = await racing.fetchCatalogLatest({
                query: category === 'racing' ? '' : category,
                forceRefresh: false,
            });
            return reply.send({ success: true, data });
        }
        catch (error) {
            return reply.send({
                success: true,
                data: [],
                error: error?.message || 'racing_catalog_failed',
            });
        }
    });
    fastify.get('/api/racing/watch', async (request, reply) => {
        try {
            const episodeId = String(request.query?.episodeId ||
                request.query?.url ||
                '').trim();
            if (!episodeId)
                return reply.send({
                    success: false,
                    error: 'episodeId required',
                    data: { sources: [] },
                });
            const data = await racing.fetchEpisodeSources(episodeId);
            return reply.send({ success: true, data });
        }
        catch (error) {
            return reply.send({
                success: true,
                data: { sources: [] },
                error: error?.message || 'racing_watch_failed',
            });
        }
    });
    fastify.get('/api/media-proxy', async (request, reply) => {
        try {
            const query = request.query;
            const targetUrl = getQueryValue(query, 'url', 'URL');
            const referer = getQueryValue(query, 'referer', 'Referer');
            const rootReferer = getQueryValue(query, 'root_referer', 'rootReferer', 'root-referer');
            const origin = getQueryValue(query, 'origin', 'Origin');
            const userAgent = getQueryValue(query, 'user_agent', 'user-agent', 'User-Agent');
            if (!targetUrl || !isAbsoluteHttpUrl(targetUrl)) {
                return reply.status(400).send('Invalid or missing target URL parameter');
            }
            const outboundHeaders = dropConditionalHeaders({
                Referer: referer || rootReferer || 'https://streameeeeee.site/',
                ...(origin ? { Origin: origin } : {}),
                'User-Agent': userAgent || USER_AGENT,
                Accept: 'application/vnd.apple.mpegurl,text/plain,video/*,audio/*,*/*;q=0.8',
                'Accept-Encoding': 'identity',
                ...(request.headers.range ? { Range: String(request.headers.range) } : {}),
            });
            setCorsHeaders(reply);
            reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            reply.header('Pragma', 'no-cache');
            reply.header('Expires', '0');
            reply.removeHeader('etag');
            reply.removeHeader('last-modified');
            return await streamUpstreamToReply(targetUrl, outboundHeaders, reply);
        }
        catch (error) {
            setCorsHeaders(reply);
            return reply.status(500).send(error?.message || 'media_proxy_failed');
        }
    });
    fastify.get('/api/image-proxy', async (request, reply) => {
        try {
            const targetUrl = String(request.query.url || '').trim();
            if (!targetUrl || !isAbsoluteHttpUrl(targetUrl)) {
                return reply.status(400).send('Invalid or missing image URL');
            }
            const query = request.query;
            const referer = getQueryValue(query, 'referer', 'Referer') || 'https://www.flashscore.com/';
            const response = await axios_1.default.get(targetUrl, {
                responseType: 'arraybuffer',
                timeout: 8000,
                headers: {
                    'User-Agent': USER_AGENT,
                    Referer: referer,
                    Accept: 'image/*,*/*;q=0.8',
                },
                validateStatus: (status) => status < 500,
            });
            reply.header('Access-Control-Allow-Origin', '*');
            reply.header('Cache-Control', 'public, max-age=86400');
            if (response.headers['content-type'])
                reply.header('Content-Type', response.headers['content-type']);
            return reply.status(response.status).send(Buffer.from(response.data));
        }
        catch (error) {
            reply.header('Access-Control-Allow-Origin', '*');
            reply.header('Cache-Control', 'public, max-age=3600');
            reply.header('Content-Type', 'image/svg+xml');
            return reply.status(200).send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="%23666"><circle cx="24" cy="24" r="24" fill="%23333"/><text x="24" y="24" text-anchor="middle" dominant-baseline="central" font-size="20" fill="%23666">?</text></svg>');
        }
    });
};
exports.default = routes;
