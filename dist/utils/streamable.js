"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchWithServerFallback = exports.hasDirectPlayableSource = exports.MOVIE_SERVER_FALLBACKS = exports.normalizeStreamLinks = void 0;
const models_1 = require("@consumet/extensions/dist/models");
const STREAMABLE_URL_REGEX = /(\.m3u8|\.mpd|\.mp4)(\?|$)|manifest|playlist|googlevideo|akamaized|cloudfront|cdn|vidstreaming|megacloud/i;
const normalizeUrl = (url) => {
    if (!url)
        return undefined;
    const trimmed = url.trim();
    if (!trimmed)
        return undefined;
    if (trimmed.startsWith('//'))
        return `https:${trimmed}`;
    return trimmed;
};
const normalizeDownload = (download) => {
    if (typeof download === 'string')
        return normalizeUrl(download) ?? download;
    if (Array.isArray(download)) {
        for (const item of download) {
            if (item && typeof item === 'object' && 'url' in item) {
                const url = normalizeUrl(item.url);
                if (url)
                    item.url = url;
            }
        }
    }
    return download;
};
const normalizeStreamLinks = (payload) => {
    if (!payload || typeof payload !== 'object')
        return payload;
    if (Array.isArray(payload)) {
        for (const item of payload)
            (0, exports.normalizeStreamLinks)(item);
        return payload;
    }
    const record = payload;
    if (Array.isArray(record.sources)) {
        for (const source of record.sources) {
            if (!source || typeof source !== 'object')
                continue;
            const src = source;
            const url = normalizeUrl(src.url);
            if (url)
                src.url = url;
        }
    }
    if (Array.isArray(record.subtitles)) {
        for (const subtitle of record.subtitles) {
            if (!subtitle || typeof subtitle !== 'object')
                continue;
            const sub = subtitle;
            const url = normalizeUrl(sub.url);
            if (url)
                sub.url = url;
        }
    }
    if ('download' in record) {
        record.download = normalizeDownload(record.download);
    }
    if ('embedURL' in record && typeof record.embedURL === 'string') {
        record.embedURL = normalizeUrl(record.embedURL) ?? record.embedURL;
    }
    for (const value of Object.values(record)) {
        if (value && typeof value === 'object')
            (0, exports.normalizeStreamLinks)(value);
    }
    return payload;
};
exports.normalizeStreamLinks = normalizeStreamLinks;
const hasUsableStreamSources = (payload) => {
    if (!payload || typeof payload !== 'object')
        return false;
    const record = payload;
    if (!Array.isArray(record.sources))
        return false;
    return record.sources.some((source) => {
        if (!source || typeof source !== 'object')
            return false;
        const video = source;
        const url = normalizeUrl(video.url);
        if (!url)
            return false;
        return Boolean(video.isM3U8 || video.isDASH || STREAMABLE_URL_REGEX.test(url));
    });
};
const DEFAULT_SERVER_FALLBACKS = [
    models_1.StreamingServers.VidStreaming,
    models_1.StreamingServers.VidCloud,
    models_1.StreamingServers.UpCloud,
    models_1.StreamingServers.MegaCloud,
    models_1.StreamingServers.VideoStr,
    models_1.StreamingServers.VizCloud,
    models_1.StreamingServers.MixDrop,
    models_1.StreamingServers.Mp4Upload,
    models_1.StreamingServers.StreamTape,
];
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const envAttemptTimeout = Number(process.env.STREAMABLE_ATTEMPT_TIMEOUT_MS || '');
const DEFAULT_ATTEMPT_TIMEOUT_MS = Number.isFinite(envAttemptTimeout) && envAttemptTimeout > 0
    ? envAttemptTimeout
    : (IS_PRODUCTION ? 4500 : 7000);
exports.MOVIE_SERVER_FALLBACKS = [
    models_1.StreamingServers.VidStreaming,
    models_1.StreamingServers.VidCloud,
    models_1.StreamingServers.UpCloud,
    models_1.StreamingServers.MegaCloud,
    models_1.StreamingServers.VideoStr,
    models_1.StreamingServers.VizCloud,
    models_1.StreamingServers.MixDrop,
    models_1.StreamingServers.Mp4Upload,
    models_1.StreamingServers.StreamTape,
];
const withTimeout = async (promise, timeoutMs) => {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
        return promise;
    return await Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Provider attempt timed out after ${timeoutMs}ms`)), timeoutMs)),
    ]);
};
const scoreSourceUrl = (source) => {
    if (!source || typeof source !== 'object')
        return -1000;
    const entry = source;
    const url = String(normalizeUrl(entry.url) || '').toLowerCase();
    if (!url)
        return -1000;
    let score = 0;
    const isEmbed = Boolean(entry.isEmbed);
    const isM3U8 = Boolean(entry.isM3U8) || url.includes('.m3u8');
    const isDASH = Boolean(entry.isDASH) || url.includes('.mpd');
    const isMp4 = url.includes('.mp4');
    if (isEmbed)
        score -= 100;
    if (url.includes('kaa.lt/intro.mp4') || url.endsWith('/intro.mp4'))
        score -= 250;
    if (url.includes('/trailer') || url.includes('/preview'))
        score -= 180;
    if (isMp4)
        score += 90;
    if (isM3U8)
        score += 70;
    if (isDASH)
        score += 60;
    if (url.includes('googlevideo') || url.includes('akamaized') || url.includes('cloudfront'))
        score += 20;
    if (url.includes('megacloud') || url.includes('/embed'))
        score -= 25;
    return score;
};
const hasDirectPlayableSource = (payload) => {
    if (!payload || typeof payload !== 'object')
        return false;
    const record = payload;
    if (!Array.isArray(record.sources))
        return false;
    return record.sources.some((source) => scoreSourceUrl(source) >= 60);
};
exports.hasDirectPlayableSource = hasDirectPlayableSource;
const sortSourcesByPlayability = (payload) => {
    if (!payload || typeof payload !== 'object')
        return payload;
    const record = payload;
    if (!Array.isArray(record.sources))
        return payload;
    record.sources.sort((a, b) => scoreSourceUrl(b) - scoreSourceUrl(a));
    return payload;
};
const fetchWithServerFallback = async (fetcher, preferredServer, fallbackServers = DEFAULT_SERVER_FALLBACKS, options = {}) => {
    const attemptTimeoutMs = Number(options.attemptTimeoutMs || DEFAULT_ATTEMPT_TIMEOUT_MS);
    const requireDirectPlayable = Boolean(options.requireDirectPlayable);
    const candidates = [
        preferredServer,
        ...fallbackServers,
    ].filter((server, index, list) => list.indexOf(server) === index);
    let lastError = undefined;
    let firstResponse = undefined;
    let firstWithSources = undefined;
    let bestDirectResponse = undefined;
    for (const server of candidates) {
        try {
            const response = sortSourcesByPlayability((0, exports.normalizeStreamLinks)(await withTimeout(fetcher(server), attemptTimeoutMs)));
            if (typeof firstResponse === 'undefined')
                firstResponse = response;
            if (hasUsableStreamSources(response) && typeof firstWithSources === 'undefined') {
                firstWithSources = response;
                // Fast-path: for non-direct-only requests, return the first usable stream
                // instead of waiting on additional slower providers/servers.
                if (!requireDirectPlayable)
                    return response;
            }
            if ((0, exports.hasDirectPlayableSource)(response)) {
                bestDirectResponse = response;
                break;
            }
        }
        catch (err) {
            lastError = err;
        }
    }
    if (typeof bestDirectResponse !== 'undefined')
        return bestDirectResponse;
    if (requireDirectPlayable) {
        throw lastError ?? new Error('No direct playable stream found (embed-only sources were skipped).');
    }
    if (typeof firstWithSources !== 'undefined')
        return firstWithSources;
    if (typeof firstResponse !== 'undefined')
        return firstResponse;
    throw lastError ?? new Error('Failed to fetch stream sources.');
};
exports.fetchWithServerFallback = fetchWithServerFallback;
