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
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractDirectSourcesWithPlaywright = exports.extractPlaybackWithPlaywright = exports.getCachedSubtitleText = void 0;
const DIRECT_MEDIA_REGEX = /(https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4|mpd)(?:\?[^\s"'<>]*)?)/gi;
const HLS_PROXY_REGEX = /(https?:\/\/[^\s"'<>]+?\/m3u8-proxy\?[^\s"'<>]+|https?:\/\/[^\s"'<>]+?\/getm3u8\/[^\s"'<>]+)/gi;
const SUBTITLE_REGEX = /(https?:\/\/[^\s"'<>]+?\.(?:vtt|srt|ass)(?:\?[^\s"'<>]*)?)/gi;
const subtitleTextCache = new Map();
const SUBTITLE_TEXT_CACHE_MS = 30 * 60 * 1000;
const isDirectMediaUrl = (value) => {
    const normalized = String(value || '');
    if (!isUsableMediaUrl(normalized))
        return false;
    if (/\.(m3u8|mp4|mpd)(\?|$)/i.test(normalized))
        return true;
    if (/\/m3u8-proxy\?/i.test(normalized))
        return true;
    if (/m3u8-proxy/i.test(normalized) && /[?&]url=/i.test(normalized))
        return true;
    if (/\/getm3u8\//i.test(normalized))
        return true;
    return false;
};
const isUsableMediaUrl = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized)
        return false;
    if (/^blob:/i.test(normalized))
        return false;
    try {
        const parsed = new URL(normalized.startsWith('//') ? `https:${normalized}` : normalized);
        const host = parsed.hostname.toLowerCase();
        if (host === 'example.com' || host.endsWith('.example.com'))
            return false;
        if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0')
            return false;
        if (host.includes('placeholder') || host.includes('dummy'))
            return false;
    }
    catch {
        return false;
    }
    return true;
};
const dropDuplicateHlsVariants = (urls) => {
    const hasMasterForBase = new Set(urls
        .filter((url) => /\/master\.m3u8(?:\?|$)/i.test(url))
        .map((url) => url.replace(/\/master\.m3u8(?:\?.*)?$/i, '')));
    return urls.filter((url) => {
        const base = url.replace(/\/index-[^/]+\.m3u8(?:\?.*)?$/i, '');
        return !hasMasterForBase.has(base) || /\/master\.m3u8(?:\?|$)/i.test(url);
    });
};
const normalizeUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw)
        return undefined;
    if (raw.startsWith('//'))
        return `https:${raw}`;
    return raw;
};
const getSubtitleCacheKeys = (url) => {
    const normalized = normalizeUrl(url);
    if (!normalized)
        return [];
    const keys = new Set([normalized]);
    try {
        const parsed = new URL(normalized);
        keys.add(`${parsed.origin}${parsed.pathname}`);
    }
    catch {
        // ignore
    }
    return [...keys];
};
const getCachedSubtitleText = (url) => {
    for (const key of getSubtitleCacheKeys(url)) {
        const cached = subtitleTextCache.get(key);
        if (!cached)
            continue;
        if (cached.expiresAt <= Date.now()) {
            subtitleTextCache.delete(key);
            continue;
        }
        return cached.value;
    }
    return undefined;
};
exports.getCachedSubtitleText = getCachedSubtitleText;
const setCachedSubtitleText = (url, value) => {
    if (!value || !getSubtitleCacheKeys(url).length)
        return;
    for (const key of getSubtitleCacheKeys(url)) {
        subtitleTextCache.set(key, {
            value,
            expiresAt: Date.now() + SUBTITLE_TEXT_CACHE_MS,
        });
    }
};
const parseUrlsFromText = (text) => {
    const found = new Set();
    let match;
    while ((match = DIRECT_MEDIA_REGEX.exec(text)) !== null) {
        const url = normalizeUrl(match[1]);
        if (url && isDirectMediaUrl(url))
            found.add(url);
    }
    while ((match = HLS_PROXY_REGEX.exec(text)) !== null) {
        const url = normalizeUrl(match[1]);
        if (url && isDirectMediaUrl(url))
            found.add(url);
    }
    return [...found];
};
const parseSubtitlesFromText = (text) => {
    const found = new Map();
    const add = (url, lang, kind, isDefault) => {
        const normalized = normalizeUrl(url);
        if (!normalized || !isUsableMediaUrl(normalized))
            return;
        if (!/\.(vtt|srt|ass)(\?|$)/i.test(normalized))
            return;
        const existing = found.get(normalized);
        if (existing && (!lang || lang === 'Unknown'))
            return;
        found.set(normalized, {
            url: normalized,
            lang: String(lang || 'Unknown'),
            kind,
            default: Boolean(isDefault),
        });
    };
    try {
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed?.tracks)
                ? parsed.tracks
                : Array.isArray(parsed?.subtitles)
                    ? parsed.subtitles
                    : [];
        for (const item of list) {
            add(item?.file || item?.url || item?.src, item?.label || item?.lang || item?.language, item?.kind, item?.default);
        }
    }
    catch {
        // Fall back to regex parsing below.
    }
    let match;
    while ((match = SUBTITLE_REGEX.exec(text)) !== null) {
        add(match[1]);
    }
    return [...found.values()];
};
const extractPlaybackWithPlaywright = async (embedUrl, referer, timeoutMs = 12000) => {
    const normalizedEmbed = normalizeUrl(embedUrl);
    if (!normalizedEmbed)
        return { sources: [], subtitles: [] };
    let chromium;
    try {
        ({ chromium } = await Promise.resolve().then(() => __importStar(require('playwright'))));
    }
    catch {
        return { sources: [], subtitles: [] };
    }
    const discovered = new Set();
    const subtitles = new Map();
    let browser;
    const timeout = Math.max(4000, timeoutMs);
    const addSubtitles = (items) => {
        for (const item of items)
            subtitles.set(item.url, item);
    };
    try {
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage'],
        });
        const context = await browser.newContext({
            extraHTTPHeaders: referer ? { Referer: referer } : undefined,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        });
        const page = await context.newPage();
        page.on('request', (request) => {
            const u = normalizeUrl(request.url());
            if (u && isDirectMediaUrl(u))
                discovered.add(u);
        });
        page.on('response', async (response) => {
            try {
                const u = normalizeUrl(response.url());
                if (u && isDirectMediaUrl(u))
                    discovered.add(u);
                const headers = response.headers() || {};
                const contentType = String(headers['content-type'] || '').toLowerCase();
                if (contentType.includes('json') || contentType.includes('javascript') || contentType.includes('text')) {
                    const body = await response.text();
                    for (const parsed of parseUrlsFromText(String(body || '')))
                        discovered.add(parsed);
                    addSubtitles(parseSubtitlesFromText(String(body || '')));
                    if (u && /\.(vtt|srt|ass)(\?|$)/i.test(u) && String(body || '').trim()) {
                        setCachedSubtitleText(u, String(body || ''));
                    }
                }
            }
            catch {
                // Ignore individual response parse failures.
            }
        });
        await page.goto(normalizedEmbed, { waitUntil: 'domcontentloaded', timeout });
        // Trigger player/network activity in common embed pages.
        await page.evaluate(() => {
            const clickables = Array.from(document.querySelectorAll('#adv, .adblock, .rek, button, .jw-icon-playback, .jw-display-icon-container, .play, .vjs-big-play-button, .vjs-play-control, video'));
            for (const el of clickables) {
                try {
                    el.click();
                }
                catch {
                    // ignore
                }
            }
            const video = document.querySelector('video');
            if (video) {
                video.muted = true;
                video.play().catch(() => undefined);
            }
        }).catch(() => undefined);
        const wantsSubtitles = /[?&]sub\.info=/i.test(normalizedEmbed);
        const startedAt = Date.now();
        while (Date.now() - startedAt < Math.min(4500, Math.max(1800, timeout - 2000))) {
            if (discovered.size > 0 && (!wantsSubtitles || subtitles.size > 0))
                break;
            await page.waitForTimeout(250);
        }
        await context.close();
    }
    catch {
        // Swallow browser failures and return empty set.
    }
    finally {
        if (browser) {
            try {
                await browser.close();
            }
            catch {
                // ignore
            }
        }
    }
    const sources = dropDuplicateHlsVariants([...discovered])
        .filter((u) => isDirectMediaUrl(u))
        .sort((a, b) => {
        const score = (url) => (/\.m3u8(?:\?|$)/i.test(url) ? 50 : 0) +
            (/\/master\.m3u8(?:\?|$)/i.test(url) || /\/index\.m3u8(?:\?|$)/i.test(url) ? 20 : 0) -
            (/\.mp4(?:\?|$)/i.test(url) ? 10 : 0);
        return score(b) - score(a);
    })
        .map((url) => ({
        url,
        quality: 'auto',
        isM3U8: /\.m3u8(\?|$)/i.test(url) || /\/m3u8-proxy\?/i.test(url) || /\/getm3u8\//i.test(url),
        isEmbed: false,
    }));
    return { sources, subtitles: [...subtitles.values()] };
};
exports.extractPlaybackWithPlaywright = extractPlaybackWithPlaywright;
const extractDirectSourcesWithPlaywright = async (embedUrl, referer, timeoutMs = 12000) => {
    const playback = await (0, exports.extractPlaybackWithPlaywright)(embedUrl, referer, timeoutMs);
    return playback.sources;
};
exports.extractDirectSourcesWithPlaywright = extractDirectSourcesWithPlaywright;
