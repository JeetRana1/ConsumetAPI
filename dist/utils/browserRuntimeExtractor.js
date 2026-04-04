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
exports.extractDirectSourcesWithPlaywright = void 0;
const DIRECT_MEDIA_REGEX = /(https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4|mpd)(?:\?[^\s"'<>]*)?)/gi;
const HLS_PROXY_REGEX = /(https?:\/\/[^\s"'<>]+?\/m3u8-proxy\?[^\s"'<>]+|https?:\/\/[^\s"'<>]+?\/getm3u8\/[^\s"'<>]+)/gi;
const isDirectMediaUrl = (value) => {
    const normalized = String(value || '');
    if (/\.(m3u8|mp4|mpd)(\?|$)/i.test(normalized))
        return true;
    if (/\/m3u8-proxy\?/i.test(normalized))
        return true;
    if (/m3u8-proxy/i.test(normalized) && /[?&]url=/i.test(normalized))
        return true;
    if (/\/getm3u8\//i.test(normalized))
        return true;
    if (normalized.startsWith('blob:'))
        return true;
    return false;
};
const normalizeUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw)
        return undefined;
    if (raw.startsWith('//'))
        return `https:${raw}`;
    return raw;
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
const extractDirectSourcesWithPlaywright = async (embedUrl, referer, timeoutMs = 12000) => {
    const normalizedEmbed = normalizeUrl(embedUrl);
    if (!normalizedEmbed)
        return [];
    let chromium;
    try {
        ({ chromium } = await Promise.resolve().then(() => __importStar(require('playwright'))));
    }
    catch {
        return [];
    }
    const discovered = new Set();
    let browser;
    const timeout = Math.max(4000, timeoutMs);
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
        await page.waitForTimeout(Math.min(7000, Math.max(2500, timeout - 2000)));
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
    return [...discovered]
        .filter((u) => isDirectMediaUrl(u))
        .map((url) => ({
        url,
        quality: 'auto',
        isM3U8: /\.m3u8(\?|$)/i.test(url) || /\/m3u8-proxy\?/i.test(url) || /\/getm3u8\//i.test(url),
        isEmbed: false,
    }));
};
exports.extractDirectSourcesWithPlaywright = extractDirectSourcesWithPlaywright;
