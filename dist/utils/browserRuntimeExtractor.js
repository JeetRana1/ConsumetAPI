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
exports.extractDirectSourcesWithPlaywright = exports.extractPlaybackWithPlaywright = exports.getCachedSubtitleText = exports.setCachedHlsManifest = exports.getCachedHlsManifest = void 0;
const DIRECT_MEDIA_REGEX = /(https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4|mkv|mpd)(?:\?[^\s"'<>]*)?)/gi;
const HLS_PROXY_REGEX = /(https?:\/\/[^\s"'<>]+?\/m3u8-proxy\?[^\s"'<>]+|https?:\/\/[^\s"'<>]+?\/getm3u8\/[^\s"'<>]+)/gi;
const SUBTITLE_REGEX = /(https?:\/\/[^\s"'<>]+?\.(?:vtt|srt|ass)(?:\?[^\s"'<>]*)?)/gi;
const subtitleTextCache = new Map();
const SUBTITLE_TEXT_CACHE_MS = 30 * 60 * 1000;
// HLS manifest cache populated during Playwright extraction so the HLS proxy
// can serve the manifest without re-fetching from upstream (avoids short-lived
// token expiration on hubstream.art and similar hosts).
const hlsManifestCache = new Map();
const HLS_MANIFEST_CACHE_MS = 2 * 60 * 1000; // 2 minutes
const getCachedHlsManifest = (url) => {
    const entry = hlsManifestCache.get(url);
    if (!entry)
        return undefined;
    if (Date.now() > entry.expiresAt) {
        hlsManifestCache.delete(url);
        return undefined;
    }
    return { body: entry.body, contentType: entry.contentType };
};
exports.getCachedHlsManifest = getCachedHlsManifest;
const setCachedHlsManifest = (url, body, contentType) => {
    if (!url || !body)
        return;
    hlsManifestCache.set(url, {
        body,
        contentType,
        expiresAt: Date.now() + HLS_MANIFEST_CACHE_MS,
    });
};
exports.setCachedHlsManifest = setCachedHlsManifest;
const PLAYWRIGHT_DEBUG = String(process.env.PLAYWRIGHT_DEBUG || '').toLowerCase() === '1' ||
    String(process.env.PLAYWRIGHT_DEBUG || '').toLowerCase() === 'true';
const isDirectMediaUrl = (value) => {
    const normalized = String(value || '');
    if (!isUsableMediaUrl(normalized))
        return false;
    if (/\.(m3u8|mp4|mkv|mpd)(\?|$)/i.test(normalized))
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
        if (host === 'cdn.plyr.io' && /\/blank\.mp4$/i.test(parsed.pathname))
            return false;
        if (host === 'example.com' || host.endsWith('.example.com'))
            return false;
        if (host === 'voorbeeld.com' || host.endsWith('.voorbeeld.com'))
            return false;
        if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0')
            return false;
        if (host.includes('placeholder') || host.includes('dummy'))
            return false;
        if (/\/video\.mp4$/i.test(parsed.pathname) &&
            /voorbeeld|sample|placeholder|dummy/i.test(normalized))
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
const absoluteUrl = (value, baseUrl) => {
    const normalized = normalizeUrl(value);
    if (!normalized)
        return undefined;
    try {
        return new URL(normalized, baseUrl || normalized).toString();
    }
    catch {
        return normalized;
    }
};
const inferSubtitleLang = (value) => {
    const raw = String(value || '').toLowerCase();
    if (!raw)
        return 'Unknown';
    if (/(^|[^a-z])(en|eng|english)([^a-z]|$)/i.test(raw))
        return 'English';
    if (/(^|[^a-z])(ja|jpn|japanese)([^a-z]|$)/i.test(raw))
        return 'Japanese';
    if (/(^|[^a-z])(hi|hin|hindi)([^a-z]|$)/i.test(raw))
        return 'Hindi';
    if (/(^|[^a-z])(ta|tam|tamil)([^a-z]|$)/i.test(raw))
        return 'Tamil';
    if (/(^|[^a-z])(te|tel|telugu)([^a-z]|$)/i.test(raw))
        return 'Telugu';
    return 'Unknown';
};
const normalizeSubtitleLang = (value, fallbackHint) => {
    const raw = String(value || '').trim();
    const normalized = inferSubtitleLang(raw);
    if (normalized !== 'Unknown')
        return normalized;
    const fallback = inferSubtitleLang(fallbackHint);
    if (fallback !== 'Unknown')
        return fallback;
    return raw || 'Unknown';
};
const getPlaywrightProxy = () => {
    const raw = String(process.env.PLAYWRIGHT_PROXY || process.env.OUTBOUND_PROXY || process.env.PROXY || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)[0];
    if (!raw)
        return undefined;
    try {
        const parsed = new URL(raw);
        const username = decodeURIComponent(parsed.username || '');
        const password = decodeURIComponent(parsed.password || '');
        parsed.username = '';
        parsed.password = '';
        return {
            server: parsed.toString(),
            ...(username ? { username, password } : {}),
        };
    }
    catch {
        return { server: raw };
    }
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
    DIRECT_MEDIA_REGEX.lastIndex = 0;
    while ((match = DIRECT_MEDIA_REGEX.exec(text)) !== null) {
        const url = normalizeUrl(match[1]);
        if (url && isDirectMediaUrl(url))
            found.add(url);
    }
    HLS_PROXY_REGEX.lastIndex = 0;
    while ((match = HLS_PROXY_REGEX.exec(text)) !== null) {
        const url = normalizeUrl(match[1]);
        if (url && isDirectMediaUrl(url))
            found.add(url);
    }
    return [...found];
};
const extractSubtitleInfoUrls = (value) => {
    const found = new Set();
    const addCandidate = (candidate) => {
        const decoded = normalizeUrl(candidate ? decodeURIComponent(String(candidate)) : '');
        if (decoded && /^https?:\/\//i.test(decoded))
            found.add(decoded);
    };
    try {
        const parsed = new URL(value);
        addCandidate(parsed.searchParams.get('sub.info'));
        addCandidate(parsed.searchParams.get('sub'));
        addCandidate(parsed.searchParams.get('subtitles'));
    }
    catch {
        // Fall through to regex parsing.
    }
    const regex = /[?&](?:sub\.info|subtitles?|tracks?)=([^&"'<>]+)/gi;
    let match;
    while ((match = regex.exec(value)) !== null)
        addCandidate(match[1]);
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
        const resolvedLang = normalizeSubtitleLang(lang, normalized);
        const existing = found.get(normalized);
        if (existing && resolvedLang === 'Unknown')
            return;
        found.set(normalized, {
            url: normalized,
            lang: resolvedLang,
            kind,
            default: Boolean(isDefault),
        });
    };
    try {
        const parsed = JSON.parse(text);
        const visit = (value, depth = 0) => {
            if (!value || depth > 4)
                return;
            if (Array.isArray(value)) {
                for (const item of value)
                    visit(item, depth + 1);
                return;
            }
            if (typeof value === 'string') {
                add(value);
                return;
            }
            if (typeof value !== 'object')
                return;
            const url = value.file || value.url || value.src || value.link;
            const kind = String(value.kind || value.type || '').toLowerCase();
            if (url &&
                (!kind || ['caption', 'captions', 'subtitle', 'subtitles', 'sub'].includes(kind))) {
                add(url, value.label || value.lang || value.language || value.name || value.title, value.kind, value.default);
            }
            visit(value.tracks, depth + 1);
            visit(value.subtitles, depth + 1);
            visit(value.captions, depth + 1);
            visit(value.cc, depth + 1);
            visit(value.closedCaptions, depth + 1);
            visit(value.closed_captions, depth + 1);
            visit(value.data, depth + 1);
            visit(value.result, depth + 1);
        };
        visit(parsed);
    }
    catch {
        // Fall back to regex parsing below.
    }
    let match;
    SUBTITLE_REGEX.lastIndex = 0;
    while ((match = SUBTITLE_REGEX.exec(text)) !== null) {
        add(match[1]);
    }
    return [...found.values()];
};
const parseSubtitlesFromValue = (value, baseUrl) => {
    const found = new Map();
    const add = (url, lang, kind, isDefault) => {
        const absolute = absoluteUrl(url, baseUrl);
        if (!absolute || !isUsableMediaUrl(absolute))
            return;
        if (!/\.(vtt|srt|ass)(\?|#|$)/i.test(absolute))
            return;
        const resolvedLang = normalizeSubtitleLang(lang, absolute);
        const existing = found.get(absolute);
        if (existing && resolvedLang === 'Unknown')
            return;
        found.set(absolute, {
            url: absolute,
            lang: resolvedLang,
            kind,
            default: Boolean(isDefault),
        });
    };
    const visit = (node, depth = 0, parentKey = '') => {
        if (!node || depth > 5)
            return;
        if (Array.isArray(node)) {
            for (const item of node)
                visit(item, depth + 1, parentKey);
            return;
        }
        if (typeof node === 'string') {
            if (/subtitle|caption|track|cc/i.test(parentKey))
                add(node, parentKey);
            return;
        }
        if (typeof node !== 'object')
            return;
        const url = node.file || node.url || node.src || node.link;
        const kind = String(node.kind || node.type || '').toLowerCase();
        if (url &&
            (!kind || ['caption', 'captions', 'subtitle', 'subtitles', 'sub'].includes(kind))) {
            add(url, node.label || node.lang || node.language || node.name || node.title, node.kind, node.default);
        }
        const nestedKeys = [
            'tracks',
            'track',
            'subtitle',
            'subtitles',
            'captions',
            'caption',
            'cc',
            'closedCaptions',
            'closed_captions',
            'data',
            'result',
        ];
        for (const key of nestedKeys)
            visit(node[key], depth + 1, key);
        if (/subtitle|caption|track|cc/i.test(parentKey)) {
            for (const [key, child] of Object.entries(node)) {
                if (typeof child === 'string')
                    add(child, key);
            }
        }
    };
    visit(value);
    return [...found.values()];
};
const extractPlaybackWithPlaywright = async (embedUrl, referer, timeoutMs = 12000, options = {}) => {
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
    const discovered = new Map();
    const subtitles = new Map();
    const subtitleInfoUrls = new Set(extractSubtitleInfoUrls(normalizedEmbed));
    let cookieHeader = '';
    let browser;
    const timeout = Math.max(4000, timeoutMs);
    const isVidkingEmbed = /vidking/i.test(normalizedEmbed);
    const isVideasyEmbed = /videasy/i.test(normalizedEmbed);
    const isTpeadEmbed = /tpead\.net\/(?:v|e)\//i.test(normalizedEmbed);
    const isHubstreamEmbed = /hubstream\.(?:art|pw|cc|ink|foo|boo)|watchhd\.upns\.live/i.test(normalizedEmbed);
    const wantsSubtitles = /[?&]sub\.info=/i.test(normalizedEmbed);
    const preferredMirror = String(options.preferredMirror || '').trim();
    let activeMirrorLabel = '';
    const addDiscovered = (url, label) => {
        const normalized = normalizeUrl(url);
        if (!normalized || !isDirectMediaUrl(normalized))
            return;
        const cleanLabel = String(label || activeMirrorLabel || '').trim();
        if (!discovered.has(normalized) || cleanLabel)
            discovered.set(normalized, cleanLabel);
    };
    const addSubtitles = (items) => {
        for (const item of items)
            subtitles.set(item.url, item);
    };
    const addSubtitleUrl = (url, lang = 'Unknown') => {
        const normalized = absoluteUrl(url, normalizedEmbed);
        if (!normalized || !isUsableMediaUrl(normalized))
            return;
        if (!/\.(vtt|srt|ass)(\?|#|$)/i.test(normalized))
            return;
        subtitles.set(normalized, {
            url: normalized,
            lang: normalizeSubtitleLang(lang, normalized),
        });
    };
    const collectSubtitleInfoUrls = (value) => {
        for (const url of extractSubtitleInfoUrls(String(value || '')))
            subtitleInfoUrls.add(url);
    };
    try {
        const playwrightProxy = getPlaywrightProxy();
        browser = await chromium.launch({
            headless: true,
            ...(playwrightProxy ? { proxy: playwrightProxy } : {}),
            args: ['--no-sandbox', '--disable-dev-shm-usage'],
        });
        const context = await browser.newContext({
            extraHTTPHeaders: referer ? { Referer: referer } : undefined,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        });
        const page = await context.newPage();
        await page.route('**/*', (route) => {
            const type = route.request().resourceType?.() || '';
            const url = route.request().url() || '';
            if (['image', 'font', 'stylesheet'].includes(type) || url.includes('google-analytics') || url.includes('googletagmanager') || url.includes('doubleclick')) {
                route.abort().catch(() => { });
            }
            else {
                route.continue().catch(() => { });
            }
        });
        page.on('console', () => { });
        page.on('pageerror', () => { });
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
            try {
                Object.defineProperty(navigator, 'userAgentData', {
                    get: () => ({
                        brands: [
                            { brand: 'Chromium', version: '131' },
                            { brand: 'Google Chrome', version: '131' },
                            { brand: 'Not/A)Brand', version: '99' },
                        ],
                        mobile: false,
                        platform: 'Windows',
                        getHighEntropyValues: async () => ({
                            brands: [
                                { brand: 'Chromium', version: '131' },
                                { brand: 'Google Chrome', version: '131' },
                                { brand: 'Not/A)Brand', version: '99' },
                            ],
                            mobile: false,
                            platform: 'Windows',
                            architecture: 'x86',
                            bitness: '64',
                            model: '',
                            platformVersion: '10.0.0',
                            uaFullVersion: '131.0.0.0',
                        }),
                    }),
                });
            }
            catch {
                // Some browser builds expose userAgentData as non-configurable.
            }
            window.chrome = { runtime: {} };
            const OriginalTextDecoder = window.TextDecoder;
            const originalDecode = OriginalTextDecoder.prototype.decode;
            window.__playbackPayloads = [];
            OriginalTextDecoder.prototype.decode = function (...args) {
                const out = originalDecode.apply(this, args);
                try {
                    if (typeof out === 'string' &&
                        (out.includes('master.m3u8') || out.includes('subtitle') || out.includes('tracks'))) {
                        const store = window.__playbackPayloads;
                        if (Array.isArray(store) && store.length < 20)
                            store.push(out);
                    }
                }
                catch {
                    // ignore hook failures
                }
                return out;
            };
        });
        if (PLAYWRIGHT_DEBUG) {
            page.on('console', (message) => {
                const text = String(message.text?.() || '');
                if (text)
                    console.log(`[Playwright console:${message.type?.() || 'log'}] ${normalizedEmbed} ${text.slice(0, 500)}`);
            });
            page.on('requestfailed', (request) => {
                const failure = request.failure?.();
                console.log(`[Playwright request failed] ${request.url()} ${failure?.errorText || ''}`.trim());
            });
            page.on('response', (response) => {
                const status = Number(response.status?.() || 0);
                if (status >= 400)
                    console.log(`[Playwright response ${status}] ${response.url()}`);
            });
        }
        page.on('request', (request) => {
            const url = request.url();
            addDiscovered(url);
            addSubtitleUrl(url);
            collectSubtitleInfoUrls(url);
        });
        page.on('response', async (response) => {
            try {
                const u = normalizeUrl(response.url());
                addDiscovered(u);
                addSubtitleUrl(u);
                collectSubtitleInfoUrls(u);
                const headers = response.headers() || {};
                const contentType = String(headers['content-type'] || '').toLowerCase();
                const shouldReadBody = contentType.includes('json') ||
                    contentType.includes('javascript') ||
                    contentType.includes('text') ||
                    /\.(m3u8|vtt|srt|ass)(?:$|\?)/i.test(String(u || ''));
                if (!shouldReadBody)
                    return;
                const body = await response.text().catch(() => '');
                for (const parsed of parseUrlsFromText(String(body || '')))
                    addDiscovered(parsed);
                addSubtitles(parseSubtitlesFromText(String(body || '')));
                try {
                    addSubtitles(parseSubtitlesFromValue(JSON.parse(String(body || '')), u || normalizedEmbed));
                }
                catch {
                    // Non-JSON text responses are handled by regex fallback above.
                }
                if (u && /\.(vtt|srt|ass)(\?|$)/i.test(u) && String(body || '').trim()) {
                    setCachedSubtitleText(u, String(body || ''));
                }
                // Capture HLS manifest bodies — they expire quickly on some hosts.
                if (u && /\.m3u8(?:$|\?)/i.test(u) && String(body || '').trim().startsWith('#EXTM3U')) {
                    hlsManifestCache.set(u, {
                        body: String(body || ''),
                        contentType,
                        expiresAt: Date.now() + HLS_MANIFEST_CACHE_MS,
                    });
                }
            }
            catch {
                // Ignore individual response parse failures.
            }
        });
        await page.goto(normalizedEmbed, { waitUntil: 'domcontentloaded', timeout });
        // Trigger player/network activity in common embed pages.
        const triggerPlayerActivity = async () => page
            .evaluate(() => {
            const trigger = (el) => {
                if (!el)
                    return;
                try {
                    el.scrollIntoView({ block: 'center', inline: 'center' });
                }
                catch {
                    // ignore
                }
                try {
                    const clickHandler = el.onclick;
                    if (typeof clickHandler === 'function') {
                        clickHandler.call(el, new MouseEvent('click', {
                            bubbles: true,
                            cancelable: true,
                            view: window,
                        }));
                    }
                }
                catch {
                    // ignore
                }
                try {
                    el.dispatchEvent(new MouseEvent('click', {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                    }));
                }
                catch {
                    // ignore
                }
                try {
                    el.click();
                }
                catch {
                    // ignore
                }
            };
            trigger(document.querySelector('#player-button-container'));
            trigger(document.querySelector('#player-button'));
            trigger(document.querySelector('media-player'));
            trigger(document.querySelector('[data-media-player]'));
            const tpeadLinkEl = document.querySelector('#captchalink') ||
                document.querySelector('#norobotlink') ||
                document.querySelector('#ideoooolink');
            const tpeadVideo = document.querySelector('video');
            let tpeadLink = String(tpeadLinkEl?.textContent || tpeadLinkEl?.innerHTML || '').trim();
            if (tpeadVideo && tpeadLink) {
                if (tpeadLink.startsWith('//'))
                    tpeadLink = `https:${tpeadLink}`;
                else if (tpeadLink.startsWith('/'))
                    tpeadLink = new URL(tpeadLink, location.href).toString();
                if (!/[?&]stream=1(?:&|$)/i.test(tpeadLink)) {
                    tpeadLink += `${tpeadLink.includes('?') ? '&' : '?'}stream=1`;
                }
                try {
                    tpeadVideo.src = tpeadLink;
                    tpeadVideo.load();
                }
                catch {
                    // ignore
                }
            }
            const clickables = Array.from(document.querySelectorAll('#adv, .adblock, .rek, #player-button-container, #player-button, media-player, [data-media-player], button, [role="button"], .jw-icon-playback, .jw-display-icon-container, .play, .vjs-big-play-button, .vjs-play-control, video'));
            for (const el of clickables) {
                trigger(el);
            }
            const video = document.querySelector('video');
            if (video) {
                video.muted = true;
                video.play().catch(() => undefined);
            }
        })
            .catch(() => undefined);
        if (!isVidkingEmbed)
            await triggerPlayerActivity();
        if (isHubstreamEmbed)
            await page.waitForTimeout(800).catch(() => undefined);
        if (isHubstreamEmbed)
            await triggerPlayerActivity();
        if (isTpeadEmbed)
            await page.waitForTimeout(600).catch(() => undefined);
        if (isTpeadEmbed)
            await triggerPlayerActivity();
        if (isVidkingEmbed || isVideasyEmbed) {
            const defaultMirrors = isVideasyEmbed
                ? ['Yoru', 'Cypher', 'Sage', 'Breach', 'Vyse', 'Killjoy', 'Fade', 'Omen', 'Raze']
                : ['Hydrogen', 'Lithium', 'Helium', 'Oxygen'];
            const mirrors = preferredMirror
                ? [
                    ...defaultMirrors.filter((mirror) => mirror.toLowerCase() === preferredMirror.toLowerCase()),
                    ...defaultMirrors.filter((mirror) => mirror.toLowerCase() !== preferredMirror.toLowerCase()),
                ]
                : defaultMirrors;
            for (const mirror of mirrors) {
                activeMirrorLabel = mirror;
                await page
                    .evaluate((target) => {
                    const norm = (value) => value.replace(/\s+/g, ' ').trim().toLowerCase();
                    const wanted = norm(target);
                    const candidates = Array.from(document.querySelectorAll('button, [role="button"], [aria-label], [title], .server, .source, .server-item, .source-item, a, li, div'));
                    const ranked = candidates
                        .map((el) => {
                        const text = norm(el.innerText ||
                            el.textContent ||
                            el.getAttribute('aria-label') ||
                            el.getAttribute('title') ||
                            '');
                        const rect = el.getBoundingClientRect();
                        return { el, text, area: Math.max(1, rect.width * rect.height) };
                    })
                        .filter(({ text, area }) => {
                        if (!text || area <= 1)
                            return false;
                        if (text === wanted)
                            return true;
                        return text.includes(wanted) && text.length <= wanted.length + 24;
                    })
                        .sort((a, b) => {
                        const exactDelta = Number(b.text === wanted) - Number(a.text === wanted);
                        if (exactDelta)
                            return exactDelta;
                        return a.text.length - b.text.length || a.area - b.area;
                    });
                    const hit = ranked[0]?.el;
                    if (!hit)
                        return false;
                    const text = norm(hit.innerText ||
                        hit.textContent ||
                        hit.getAttribute('aria-label') ||
                        hit.getAttribute('title') ||
                        '');
                    if (!text.includes(wanted))
                        return false;
                    hit.scrollIntoView({ block: 'center', inline: 'center' });
                    hit.click();
                    return true;
                }, mirror)
                    .catch(() => false);
                await triggerPlayerActivity();
                await page.waitForTimeout(isVideasyEmbed ? 2400 : 1600).catch(() => undefined);
                if (!isVideasyEmbed &&
                    discovered.size > 0 &&
                    (!wantsSubtitles || subtitles.size > 0))
                    break;
            }
            activeMirrorLabel = '';
        }
        const startedAt = Date.now();
        const finalWaitMs = isVideasyEmbed
            ? Math.min(7000, Math.max(3500, timeout - 2000))
            : Math.min(4500, Math.max(1800, timeout - 2000));
        while (Date.now() - startedAt < finalWaitMs) {
            if (!isVideasyEmbed &&
                discovered.size > 0 &&
                (!wantsSubtitles || subtitles.size > 0))
                break;
            if (isVideasyEmbed && Date.now() - startedAt > 1200)
                await triggerPlayerActivity();
            if (isHubstreamEmbed && Date.now() - startedAt > 900)
                await triggerPlayerActivity();
            await page.waitForTimeout(250);
        }
        try {
            const cookies = await context.cookies().catch(() => []);
            const sourceHosts = new Set();
            for (const candidate of [normalizedEmbed, ...discovered.keys()]) {
                try {
                    sourceHosts.add(new URL(candidate).hostname.toLowerCase());
                }
                catch {
                    // ignore
                }
            }
            const matchingCookies = cookies.filter((cookie) => {
                const domain = String(cookie?.domain || '').replace(/^\./, '').toLowerCase();
                if (!domain)
                    return false;
                for (const host of sourceHosts) {
                    if (host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`))
                        return true;
                }
                return false;
            });
            cookieHeader = matchingCookies
                .map((cookie) => `${cookie.name}=${cookie.value}`)
                .filter(Boolean)
                .join('; ');
        }
        catch {
            // ignore cookie extraction failures
        }
        const domTracks = await page
            .evaluate(() => Array.from(document.querySelectorAll('track')).map((track) => ({
            url: track.src ||
                track.getAttribute('src') ||
                '',
            lang: track.getAttribute('label') ||
                track.getAttribute('srclang') ||
                'Unknown',
            kind: track.getAttribute('kind') || undefined,
            default: track.hasAttribute('default'),
        })))
            .catch(() => []);
        addSubtitles(domTracks
            .map((track) => ({
            ...track,
            url: absoluteUrl(track.url, normalizedEmbed) || '',
        }))
            .filter((track) => /\.(vtt|srt|ass)(\?|#|$)/i.test(String(track.url || ''))));
        const decodedPayloads = await page
            .evaluate(() => window.__playbackPayloads || [])
            .catch(() => []);
        for (const payload of decodedPayloads) {
            for (const parsed of parseUrlsFromText(String(payload || '')))
                addDiscovered(parsed);
            try {
                addSubtitles(parseSubtitlesFromValue(JSON.parse(String(payload || '')), normalizedEmbed));
            }
            catch {
                addSubtitles(parseSubtitlesFromText(String(payload || '')));
            }
        }
        for (const subtitleInfoUrl of [...subtitleInfoUrls]) {
            if (subtitles.size > 0)
                break;
            try {
                const response = await context.request.get(subtitleInfoUrl, {
                    headers: {
                        Referer: normalizedEmbed,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    },
                    timeout: Math.min(6000, Math.max(2500, timeout - (Date.now() - startedAt))),
                });
                if (!response.ok())
                    continue;
                const body = await response.text();
                addSubtitles(parseSubtitlesFromText(body));
                if (/\.(vtt|srt|ass)(\?|$)/i.test(subtitleInfoUrl) && body.trim()) {
                    setCachedSubtitleText(subtitleInfoUrl, body);
                }
            }
            catch {
                // Subtitle manifests are best-effort; playback should not depend on them.
            }
        }
        for (const subtitleInfoUrl of [...subtitleInfoUrls]) {
            if (subtitles.size > 0)
                break;
            let subtitlePage;
            try {
                subtitlePage = await context.newPage();
                await subtitlePage.goto(subtitleInfoUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: Math.min(9000, Math.max(4000, timeout - (Date.now() - startedAt))),
                });
                await subtitlePage.waitForTimeout(1500).catch(() => undefined);
                const body = await subtitlePage.evaluate(() => document.body?.innerText || document.documentElement?.textContent || '');
                addSubtitles(parseSubtitlesFromText(String(body || '')));
                if (/\.(vtt|srt|ass)(\?|$)/i.test(subtitleInfoUrl) && String(body || '').trim()) {
                    setCachedSubtitleText(subtitleInfoUrl, String(body || ''));
                }
            }
            catch {
                // Some subtitle token hosts require challenges we cannot always solve server-side.
            }
            finally {
                if (subtitlePage)
                    await subtitlePage.close().catch(() => undefined);
            }
        }
        // Actively fetch hubstream.art HLS manifests so the proxy can serve from cache.
        // Using page.evaluate(fetch) ensures browser cookies/session are included.
        const hubstreamM3uUrls = [...discovered.keys()].filter((u) => /hubstream\.(?:art|pw|cc|ink|foo|boo)/i.test(u) &&
            /\.m3u8(?:\?|$)/i.test(u));
        for (const m3u8Url of hubstreamM3uUrls) {
            if (hlsManifestCache.has(m3u8Url))
                continue;
            try {
                const body = await page
                    .evaluate(async (url) => {
                    try {
                        const r = await fetch(url, {
                            credentials: 'include',
                            headers: { Referer: document.location.href },
                        });
                        if (!r.ok)
                            return null;
                        return await r.text();
                    }
                    catch {
                        return null;
                    }
                }, m3u8Url)
                    .catch(() => null);
                if (body && String(body).trim().startsWith('#EXTM3U')) {
                    hlsManifestCache.set(m3u8Url, {
                        body: String(body),
                        contentType: 'application/vnd.apple.mpegurl',
                        expiresAt: Date.now() + HLS_MANIFEST_CACHE_MS,
                    });
                }
            }
            catch {
                // Best-effort; playback should not block on manifest prefetch.
            }
        }
        await context.close();
    }
    catch (err) {
        console.error(`[Playwright extractor failed] ${normalizedEmbed}`, err);
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
    const sourceEntries = dropDuplicateHlsVariants([...discovered.keys()])
        .filter((u) => isDirectMediaUrl(u))
        .sort((a, b) => {
        const score = (url) => {
            const label = String(discovered.get(url) || '').toLowerCase();
            return ((/\.m3u8(?:\?|$)/i.test(url) ? 80 : 0) +
                (/\/master\.m3u8(?:\?|$)/i.test(url) ? 25 : 0) +
                (/\/index\.m3u8(?:\?|$)/i.test(url) ? 15 : 0) +
                (/\.mp4(?:\?|$)/i.test(url) ? 20 : 0) +
                (/yoru/.test(label) ? 45 : 0) +
                (/neon/.test(label) ? 40 : 0) +
                (/cypher/.test(label) ? 30 : 0) +
                (/sage/.test(label) ? 20 : 0) +
                (/hydrogen/.test(label) ? 35 : 0) +
                (/lithium/.test(label) ? 30 : 0) +
                (/helium/.test(label) ? 15 : 0) -
                (/oxygen/.test(label) ? 40 : 0));
        };
        return score(b) - score(a);
    });
    const sources = sourceEntries.map((url) => ({
        url,
        quality: discovered.get(url) ? `auto (${discovered.get(url)})` : 'auto',
        server: discovered.get(url) || undefined,
        isM3U8: /\.m3u8(\?|$)/i.test(url) ||
            /\/m3u8-proxy\?/i.test(url) ||
            /\/getm3u8\//i.test(url),
        isEmbed: false,
    }));
    if (PLAYWRIGHT_DEBUG) {
        console.log(`[Playwright extractor result] ${normalizedEmbed} sources=${sources.length} subtitles=${subtitles.size}`);
    }
    return { sources, subtitles: [...subtitles.values()], ...(cookieHeader ? { cookieHeader } : {}) };
};
exports.extractPlaybackWithPlaywright = extractPlaybackWithPlaywright;
const extractDirectSourcesWithPlaywright = async (embedUrl, referer, timeoutMs = 12000) => {
    const playback = await (0, exports.extractPlaybackWithPlaywright)(embedUrl, referer, timeoutMs);
    return playback.sources;
};
exports.extractDirectSourcesWithPlaywright = extractDirectSourcesWithPlaywright;
