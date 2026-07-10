"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeParseUrl = exports.withInflightDedupe = exports.refreshExpiredToken = exports.isExpiredToken = exports.markExpiredToken = exports.getInflightRequests = exports.resolveMediaUrl = exports.buildMediaRequestHeaders = exports.extractWithScrapling = exports.getScraplingBaseUrl = exports.isScraplingWorkerAvailable = exports.isScraplingEnabled = exports.normalizeScraplingQuery = void 0;
const SCRAPLING_BASE_URL = String(process.env.SCRAPLING_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const SCRAPLING_TIMEOUT_MS = Number(process.env.SCRAPLING_TIMEOUT_MS || '') || 6000;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const inflightRequests = new Map();
const tokenRefreshRequests = new Map();
const expiredTokens = new Set();
const normalizeScraplingQuery = (query = {}) => {
    const out = {};
    for (const [key, value] of Object.entries(query || {})) {
        out[key.toLowerCase()] = String(value ?? '').trim();
    }
    return out;
};
exports.normalizeScraplingQuery = normalizeScraplingQuery;
const buildTargetUrl = (input) => {
    const raw = String(input || '').trim();
    if (!raw)
        return raw;
    try {
        return new URL(raw).toString();
    }
    catch {
        return raw;
    }
};
const fetchJson = async (url, timeoutMs) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
        });
        if (!response.ok)
            return null;
        return (await response.json());
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(timeout);
    }
};
const isScraplingEnabled = () => String(process.env.SCRAPLING_ENABLED || 'true').toLowerCase() !== 'false';
exports.isScraplingEnabled = isScraplingEnabled;
const isScraplingWorkerAvailable = async () => Boolean(await fetchJson(`${SCRAPLING_BASE_URL}/health`, 1200));
exports.isScraplingWorkerAvailable = isScraplingWorkerAvailable;
const getScraplingBaseUrl = () => SCRAPLING_BASE_URL;
exports.getScraplingBaseUrl = getScraplingBaseUrl;
const extractWithScrapling = async (options) => {
    if (!(0, exports.isScraplingEnabled)())
        return null;
    const targetUrl = buildTargetUrl(options.url);
    if (!targetUrl)
        return null;
    const params = new URLSearchParams();
    params.set('url', targetUrl);
    if (options.referer)
        params.set('referer', String(options.referer));
    if (options.origin)
        params.set('origin', String(options.origin));
    if (options.userAgent)
        params.set('user_agent', String(options.userAgent));
    const requestKey = `${SCRAPLING_BASE_URL}/extract?${params.toString()}`;
    const existing = inflightRequests.get(requestKey);
    if (existing)
        return existing;
    const pending = fetchJson(requestKey, options.timeoutMs || SCRAPLING_TIMEOUT_MS);
    inflightRequests.set(requestKey, pending);
    try {
        return await pending;
    }
    finally {
        inflightRequests.delete(requestKey);
    }
};
exports.extractWithScrapling = extractWithScrapling;
const buildMediaRequestHeaders = (query = {}) => {
    const normalized = (0, exports.normalizeScraplingQuery)(query);
    const headers = {
        'User-Agent': normalized['user-agent'] || normalized.ua || DEFAULT_USER_AGENT,
        Accept: normalized.accept || 'application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*',
        'Accept-Language': normalized['accept-language'] || 'en-US,en;q=0.9',
    };
    const referer = normalized.referer || normalized.referrer;
    const origin = normalized.origin;
    if (referer)
        headers.Referer = referer;
    if (origin)
        headers.Origin = origin;
    if (normalized.authorization)
        headers.Authorization = normalized.authorization;
    if (normalized.range)
        headers.Range = normalized.range;
    return headers;
};
exports.buildMediaRequestHeaders = buildMediaRequestHeaders;
const resolveMediaUrl = (value) => buildTargetUrl(value);
exports.resolveMediaUrl = resolveMediaUrl;
const getInflightRequests = () => inflightRequests;
exports.getInflightRequests = getInflightRequests;
const markExpiredToken = (value) => {
    const key = String(value || '').trim();
    if (key)
        expiredTokens.add(key);
};
exports.markExpiredToken = markExpiredToken;
const isExpiredToken = (value) => expiredTokens.has(String(value || '').trim());
exports.isExpiredToken = isExpiredToken;
const refreshExpiredToken = async (token, refresh) => {
    const key = String(token || '').trim();
    if (!key || tokenRefreshRequests.has(key))
        return tokenRefreshRequests.get(key) || Promise.resolve();
    const pending = (async () => {
        try {
            await refresh();
            expiredTokens.delete(key);
        }
        finally {
            tokenRefreshRequests.delete(key);
        }
    })();
    tokenRefreshRequests.set(key, pending);
    return pending;
};
exports.refreshExpiredToken = refreshExpiredToken;
const withInflightDedupe = async (key, task) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey)
        return task();
    const existing = inflightRequests.get(normalizedKey);
    if (existing)
        return existing;
    const pending = task();
    inflightRequests.set(normalizedKey, pending);
    try {
        return await pending;
    }
    finally {
        inflightRequests.delete(normalizedKey);
    }
};
exports.withInflightDedupe = withInflightDedupe;
const safeParseUrl = (value) => {
    try {
        return new URL((0, exports.resolveMediaUrl)(value));
    }
    catch {
        return null;
    }
};
exports.safeParseUrl = safeParseUrl;
