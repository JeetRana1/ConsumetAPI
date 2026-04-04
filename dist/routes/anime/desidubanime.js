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
const axios_1 = __importDefault(require("axios"));
const cache_1 = __importDefault(require("../../utils/cache"));
const main_1 = require("../../main");
const browserRuntimeExtractor_1 = require("../../utils/browserRuntimeExtractor");
const BASE_URL = 'https://www.desidubanime.me';
const JINA_PREFIX = 'https://r.jina.ai/http://';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const toJinaUrl = (url) => `${JINA_PREFIX}${url.replace(/^https?:\/\//i, '')}`;
const fetchJinaText = async (url, timeoutMs = 45000) => {
    const res = await axios_1.default.get(toJinaUrl(url), {
        timeout: timeoutMs,
        headers: {
            'User-Agent': UA,
        },
    });
    return String(res.data || '');
};
const decodeEscapedText = (input) => {
    return String(input || '')
        .replace(/\\u002F/gi, '/')
        .replace(/\\\//g, '/')
        .replace(/&amp;/gi, '&');
};
const ensureAbsoluteUrl = (value, base) => {
    const raw = String(value || '').trim();
    if (!raw)
        return undefined;
    if (raw.startsWith('//'))
        return `https:${raw}`;
    if (/^https?:\/\//i.test(raw))
        return raw;
    if (base) {
        try {
            return new URL(raw, base).toString();
        }
        catch (_a) {
            return undefined;
        }
    }
    return undefined;
};
const extractDirectMediaUrls = (text) => {
    const out = new Set();
    const decoded = decodeEscapedText(text);
    const patterns = [
        /(https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4|mpd)(?:\?[^\s"'<>]*)?)/gi,
        /["'](?:file|src|url|link)["']\s*:\s*["']([^"']+\.(?:m3u8|mp4|mpd)[^"']*)["']/gi,
    ];
    for (const regex of patterns) {
        let match = null;
        while ((match = regex.exec(decoded)) !== null) {
            const direct = ensureAbsoluteUrl(String(match[1] || match[0] || '').trim());
            if (direct && !direct.toLowerCase().includes('.mpd'))
                out.add(direct);
        }
    }
    return [...out];
};
const extractEmbedUrls = (text, baseUrl) => {
    const out = new Set();
    const decoded = decodeEscapedText(text);
    const patterns = [
        /\((https?:\/\/[^)\s]+)\)/gi,
        /<(https?:\/\/[^>\s]+)>/gi,
        /["'](?:src|href|url|link)["']\s*:\s*["']([^"']+)["']/gi,
        /(?:https?:\/\/|\/\/)[^\s"'<>]+(?:embed|player|stream|watch)[^\s"'<>]*/gi,
    ];
    for (const regex of patterns) {
        let match = null;
        while ((match = regex.exec(decoded)) !== null) {
            const maybe = String(match[1] || match[0] || '').trim();
            const url = ensureAbsoluteUrl(maybe, baseUrl);
            if (!url)
                continue;
            if (/\.m3u8(\?|$)/i.test(url) || /\.mp4(\?|$)/i.test(url) || /\/embed|player|stream/i.test(url)) {
                out.add(url);
            }
        }
    }
    return [...out];
};
const fetchRawText = async (url, referer) => {
    const res = await axios_1.default.get(url, {
        timeout: 20000,
        headers: {
            'User-Agent': UA,
            ...(referer ? { Referer: referer } : {}),
        },
        responseType: 'text',
    });
    return String(res.data || '');
};
const crawlForDirectMedia = async (startUrl, initialReferer, maxDepth = 3) => {
    const queue = [
        { url: startUrl, referer: initialReferer, depth: 0 },
    ];
    const seen = new Set();
    let lastReferer = initialReferer;
    while (queue.length) {
        const current = queue.shift();
        if (!current.url || seen.has(current.url) || current.depth > maxDepth)
            continue;
        seen.add(current.url);
        lastReferer = current.referer || lastReferer || current.url;
        let body = '';
        try {
            body = await fetchRawText(current.url, current.referer);
        }
        catch (_a) {
            continue;
        }
        const direct = extractDirectMediaUrls(body);
        if (direct.length) {
            return { directUrls: direct, lastReferer: current.url };
        }
        const embeds = extractEmbedUrls(body, current.url);
        for (const next of embeds) {
            if (!seen.has(next)) {
                queue.push({
                    url: next,
                    referer: current.url,
                    depth: current.depth + 1,
                });
            }
        }
    }
    return { directUrls: [], lastReferer };
};
const tryDecodeBase64 = (input) => {
    try {
        return Buffer.from(String(input || ''), 'base64').toString('utf8');
    }
    catch (_a) {
        return '';
    }
};
const extractUrlsFromText = (input) => {
    const out = new Set();
    const text = String(input || '');
    const re = /(https?:\/\/[^\s"'<>]+)/gi;
    let m = null;
    while ((m = re.exec(text)) !== null) {
        const u = ensureAbsoluteUrl(String(m[1] || '').trim());
        if (u)
            out.add(u);
    }
    return [...out];
};
const MAX_DESIDUB_WATCH_MS = 30000;
const EMBED_PROBE_TIMEOUT_MS = 7000;
const MAX_PROBE_TARGETS = 6;
const DIRECT_PROBE_SERVERS = new Set(['abyss', 'filemoon', 'streamtape', 'cloud', 'ruby']);
const MAX_EMBED_ENTRIES_TO_TRY = 2;
const withTimeout = async (promise, timeoutMs) => {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(undefined), timeoutMs);
        promise
            .then((value) => {
            clearTimeout(timer);
            resolve(value);
        })
            .catch(() => {
            clearTimeout(timer);
            resolve(undefined);
        });
    });
};
const inferServerFromUrl = (url) => {
    const u = String(url || '').toLowerCase();
    if (!u)
        return 'unknown';
    if (u.includes('rpmstream'))
        return 'mirror';
    if (u.includes('newer.stream') || u.includes('streamp2p'))
        return 'playerx';
    if (u.includes('short.icu') || u.includes('abyss'))
        return 'abyss';
    if (u.includes('filemoon') || u.includes('bysefujedu'))
        return 'filemoon';
    if (u.includes('streamtape'))
        return 'streamtape';
    if (u.includes('krakenfiles'))
        return 'kraken';
    if (u.includes('multimoviesshg') || u.includes('streamhg'))
        return 'streamhg';
    if (u.includes('streamruby') || u.includes('ruby'))
        return 'ruby';
    if (u.includes('cloud'))
        return 'cloud';
    return 'unknown';
};
const normalizeServerName = (raw) => {
    const v = String(raw || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (v.includes('mirror'))
        return 'mirror';
    if (v.includes('playerx') || v.includes('streamp2p'))
        return 'playerx';
    if (v.includes('abyss'))
        return 'abyss';
    if (v.includes('filemoon') || v.includes('bysefujedu'))
        return 'filemoon';
    if (v.includes('streamtape'))
        return 'streamtape';
    if (v.includes('kraken'))
        return 'kraken';
    if (v.includes('streamhg') || v.includes('multimoviesshg'))
        return 'streamhg';
    if (v.includes('cloud'))
        return 'cloud';
    if (v.includes('ruby'))
        return 'ruby';
    return v || 'unknown';
};
const embedServerRank = (server) => {
    const key = normalizeServerName(server);
    if (key === 'abyss')
        return 1;
    if (key === 'filemoon')
        return 2;
    if (key === 'streamtape')
        return 3;
    if (key === 'mirror')
        return 4;
    if (key === 'playerx')
        return 5;
    if (key === 'cloud')
        return 6;
    if (key === 'kraken')
        return 7;
    if (key === 'streamhg')
        return 8;
    if (key === 'ruby')
        return 99;
    return 10;
};
const extractEmbedCandidatesFromWatchPage = async (watchUrl) => {
    let chromium;
    try {
        ({ chromium } = await Promise.resolve().then(() => __importStar(require('playwright'))));
    }
    catch (_a) {
        return [];
    }
    let browser;
    try {
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage'],
        });
        const context = await browser.newContext({
            userAgent: UA,
        });
        const page = await context.newPage();
        await page.goto(watchUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 9000,
        });
        try {
            await page.waitForSelector('[data-embed-id]', { timeout: 3000 });
        }
        catch (_b) {
            // If selector wait fails, we still attempt one extraction pass.
        }
        await page.waitForTimeout(350);
        const embedEntries = await page.$$eval('[data-embed-id]', (els) => els
            .map((el) => {
            var _a;
            return ({
                value: String(((_a = el === null || el === void 0 ? void 0 : el.getAttribute) === null || _a === void 0 ? void 0 : _a.call(el, 'data-embed-id')) || '').trim(),
                label: String((el === null || el === void 0 ? void 0 : el.textContent) || '').trim(),
            });
        })
            .filter((item) => Boolean(item === null || item === void 0 ? void 0 : item.value)));
        await context.close();
        const out = new Map();
        for (const entry of embedEntries) {
            const raw = String((entry === null || entry === void 0 ? void 0 : entry.value) || '');
            const parts = raw.split(':');
            const decoded = tryDecodeBase64(parts[1] || '');
            const decodedServer = tryDecodeBase64(parts[0] || '');
            const server = normalizeServerName((entry === null || entry === void 0 ? void 0 : entry.label) || decodedServer || '');
            for (const u of extractUrlsFromText(decoded)) {
                out.set(u, { server, url: u });
            }
        }
        return [...out.values()].sort((a, b) => embedServerRank(a.server) - embedServerRank(b.server));
    }
    catch (_c) {
        return [];
    }
    finally {
        if (browser) {
            try {
                await browser.close();
            }
            catch (_d) {
                // ignore
            }
        }
    }
};
const resolveGdMirrorInnerCandidates = async (embedUrl) => {
    let chromium;
    try {
        ({ chromium } = await Promise.resolve().then(() => __importStar(require('playwright'))));
    }
    catch (_a) {
        return [];
    }
    let browser;
    try {
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage'],
        });
        const context = await browser.newContext({
            userAgent: UA,
        });
        const page = await context.newPage();
        const helperBodies = [];
        page.on('response', async (res) => {
            var _a;
            try {
                const url = String(((_a = res === null || res === void 0 ? void 0 : res.url) === null || _a === void 0 ? void 0 : _a.call(res)) || '');
                if (!/embedhelper\.php/i.test(url))
                    return;
                helperBodies.push(String((await res.text()) || ''));
            }
            catch (_b) {
                // ignore individual helper parse failures
            }
        });
        await page.goto(embedUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 10000,
        });
        try {
            await page.waitForFunction(() => {
                const g = globalThis;
                return Boolean((g === null || g === void 0 ? void 0 : g.mresult) && Object.keys(g.mresult).length && (g === null || g === void 0 ? void 0 : g.siteUrls));
            }, { timeout: 4000 });
        }
        catch (_b) {
            // fall through: helper body parsing may still recover mirror links.
        }
        await page.waitForTimeout(250);
        const items = await page.evaluate(() => {
            const out = [];
            const mapResult = globalThis.mresult || {};
            const mapSites = globalThis.siteUrls || {};
            const mapNames = globalThis.siteFriendlyNames || {};
            const suffixes = globalThis.urlSuffixesEmbed || {};
            for (const key of Object.keys(mapResult)) {
                const base = String(mapSites[key] || '').trim();
                const id = String(mapResult[key] || '').trim();
                if (!base || !id)
                    continue;
                const sfx = String(suffixes[key] || '').trim();
                const url = `${base}${id}${sfx}`;
                const server = String(mapNames[key] || key || '').trim() || 'unknown';
                out.push({ server, url });
            }
            return out;
        });
        await context.close();
        const dedup = new Map();
        for (const item of items) {
            const server = normalizeServerName(item.server);
            const url = ensureAbsoluteUrl(item.url);
            if (!url)
                continue;
            dedup.set(url, { server, url });
        }
        for (const body of helperBodies) {
            for (const url of extractUrlsFromText(body)) {
                const absolute = ensureAbsoluteUrl(url);
                if (!absolute)
                    continue;
                if (!/https?:\/\//i.test(absolute))
                    continue;
                const server = normalizeServerName(inferServerFromUrl(absolute));
                dedup.set(absolute, { server, url: absolute });
            }
        }
        return [...dedup.values()].sort((a, b) => embedServerRank(a.server) - embedServerRank(b.server));
    }
    catch (_c) {
        return [];
    }
    finally {
        if (browser) {
            try {
                await browser.close();
            }
            catch (_d) {
                // ignore
            }
        }
    }
};
const extractSlug = (animeUrl) => {
    const m = animeUrl.match(/\/anime\/([^\/\s)]+)\/?/i);
    return m ? m[1] : '';
};
const extractEpisodeNumber = (watchSlug) => {
    const m = String(watchSlug).match(/-episode-(\d+)(?:\/)?$/i);
    return m ? Number(m[1]) : 0;
};
const parseSearchResultsFromMarkdown = (md) => {
    const out = [];
    const seen = new Set();
    const regex = /###\s+\[([^\]]+?)\]\((https?:\/\/www\.desidubanime\.me\/anime\/[^)\s]+)\)/gi;
    let m = null;
    while ((m = regex.exec(md)) !== null) {
        const title = String(m[1] || '').trim();
        const url = String(m[2] || '').trim();
        const id = extractSlug(url);
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        out.push({
            id,
            title,
            url,
            type: 'TV',
        });
    }
    return out;
};
const parseInfoFromMarkdown = (id, md) => {
    const titleMatch = md.match(/^Title:\s*(.+?)\s*-\s*Desi Dub Anime/im);
    const title = String((titleMatch === null || titleMatch === void 0 ? void 0 : titleMatch[1]) || id).trim();
    const overviewMatch = md.match(/Overview:([\s\S]+?)(?:\n\n\*|More Season|Episodes|-{3,}|###)/i);
    const description = overviewMatch ? String(overviewMatch[1]).trim() : '';
    const imgMatch = md.match(/!\[Image[^\]]*\]\((https?:\/\/[^\s)]+)\)/i);
    const image = imgMatch === null || imgMatch === void 0 ? void 0 : imgMatch[1];
    const epRegex = /\[!\[Image[^\]]*\]\([^)]+\)\s+(.+?)\s+play_circle_filled\s+Episode\s+(\d+)\]\((https?:\/\/www\.desidubanime\.me\/watch\/[^)\s]+)\s+/gi;
    const episodes = [];
    let em = null;
    while ((em = epRegex.exec(md)) !== null) {
        const epTitle = String(em[1] || '').trim();
        const number = Number(em[2] || 0);
        const url = String(em[3] || '').trim();
        const watchSlug = url
            .replace(/^https?:\/\/www\.desidubanime\.me\/watch\//i, '')
            .replace(/\/+$/, '');
        if (!watchSlug || !number)
            continue;
        episodes.push({
            id: watchSlug,
            number,
            title: epTitle || `Episode ${number}`,
            url,
        });
    }
    episodes.sort((a, b) => a.number - b.number);
    return {
        id,
        title,
        image,
        description,
        episodes,
    };
};
const sanitizeSources = (payload, opts) => {
    const sources = Array.isArray(payload === null || payload === void 0 ? void 0 : payload.sources) ? payload.sources : [];
    const hls = sources.filter((s) => {
        const u = String((s === null || s === void 0 ? void 0 : s.url) || '').toLowerCase();
        if (!u)
            return false;
        if (u.includes('.mpd'))
            return false;
        return !Boolean(s === null || s === void 0 ? void 0 : s.isEmbed) && (Boolean(s === null || s === void 0 ? void 0 : s.isM3U8) || u.includes('.m3u8'));
    });
    const mp4 = sources.filter((s) => {
        const u = String((s === null || s === void 0 ? void 0 : s.url) || '').toLowerCase();
        if (!u || u.includes('.mpd'))
            return false;
        return !Boolean(s === null || s === void 0 ? void 0 : s.isEmbed) && u.includes('.mp4');
    });
    const direct = hls.length ? hls : mp4;
    const allowEmbedIfNoDirect = Boolean(opts === null || opts === void 0 ? void 0 : opts.allowEmbedIfNoDirect);
    const embed = allowEmbedIfNoDirect
        ? sources.filter((s) => {
            const u = String((s === null || s === void 0 ? void 0 : s.url) || '').toLowerCase();
            if (!u || u.includes('.mpd'))
                return false;
            return Boolean(s === null || s === void 0 ? void 0 : s.isEmbed);
        })
        : [];
    const filtered = direct.length ? direct : embed;
    return {
        ...payload,
        sources: filtered,
    };
};
const pickHlsSources = (sources) => {
    return (Array.isArray(sources) ? sources : []).filter((s) => {
        const u = String((s === null || s === void 0 ? void 0 : s.url) || '').toLowerCase();
        if (!u || Boolean(s === null || s === void 0 ? void 0 : s.isEmbed))
            return false;
        if (u.includes('.mpd'))
            return false;
        return Boolean(s === null || s === void 0 ? void 0 : s.isM3U8) || u.includes('.m3u8') || u.includes('m3u8-proxy');
    });
};
const probeCandidatesForHls = async (targets) => {
    if (!targets.length)
        return undefined;
    const uniqueTargets = [...new Map(targets.map((x) => [x.url, x])).values()]
        .filter((x) => DIRECT_PROBE_SERVERS.has(normalizeServerName(x.server)))
        .sort((a, b) => embedServerRank(a.server) - embedServerRank(b.server))
        .slice(0, MAX_PROBE_TARGETS);
    if (!uniqueTargets.length)
        return undefined;
    const settled = await Promise.all(uniqueTargets.map(async (probe) => {
        const pwSources = await withTimeout((0, browserRuntimeExtractor_1.extractDirectSourcesWithPlaywright)(probe.url, probe.url, EMBED_PROBE_TIMEOUT_MS), EMBED_PROBE_TIMEOUT_MS + 1500);
        if (!Array.isArray(pwSources) || !pwSources.length)
            return undefined;
        const clean = sanitizeSources({ headers: { Referer: probe.url }, sources: pwSources });
        const hlsOnly = pickHlsSources((clean === null || clean === void 0 ? void 0 : clean.sources) || []);
        if (!hlsOnly.length)
            return undefined;
        return { probe, sources: hlsOnly };
    }));
    const winners = settled.filter(Boolean);
    if (!winners.length)
        return undefined;
    winners.sort((a, b) => embedServerRank(a.probe.server) - embedServerRank(b.probe.server));
    return winners[0];
};
const pickBestByTitle = (results, title) => {
    const needle = String(title || '').toLowerCase().trim();
    if (!needle)
        return results[0];
    const exact = results.find((r) => String((r === null || r === void 0 ? void 0 : r.title) || '').toLowerCase().trim() === needle);
    if (exact)
        return exact;
    const contains = results.find((r) => String((r === null || r === void 0 ? void 0 : r.title) || '').toLowerCase().includes(needle));
    if (contains)
        return contains;
    return results[0];
};
const routes = async (fastify, _options) => {
    fastify.get('/', async (_, reply) => {
        reply.status(200).send({
            intro: `Welcome to the desidubanime provider: ${BASE_URL}`,
            note: 'Catalog is read from desidubanime.me. On watch failure, fallback is Satoru only.',
            routes: ['/:query', '/info', '/info/:id', '/watch/:episodeId'],
        });
    });
    fastify.get('/:query', async (request, reply) => {
        const query = request.params.query;
        const page = Number(request.query.page || 1);
        try {
            const key = `desidubanime:search:${query}:${page}`;
            const data = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, key, async () => {
                    const md = await fetchJinaText(`${BASE_URL}/search?keyword=${encodeURIComponent(query)}`);
                    return parseSearchResultsFromMarkdown(md);
                }, main_1.REDIS_TTL)
                : parseSearchResultsFromMarkdown(await fetchJinaText(`${BASE_URL}/search?keyword=${encodeURIComponent(query)}`));
            reply.status(200).send({
                currentPage: page,
                hasNextPage: false,
                results: data,
            });
        }
        catch (err) {
            reply.status(500).send({
                message: err.message,
            });
        }
    });
    const infoHandler = async (id, reply) => {
        try {
            const key = `desidubanime:info:${id}`;
            const data = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, key, async () => {
                    const md = await fetchJinaText(`${BASE_URL}/anime/${id}/`);
                    return parseInfoFromMarkdown(id, md);
                }, main_1.REDIS_TTL)
                : parseInfoFromMarkdown(id, await fetchJinaText(`${BASE_URL}/anime/${id}/`));
            reply.status(200).send(data);
        }
        catch (err) {
            reply.status(500).send({
                message: err.message,
            });
        }
    };
    fastify.get('/info', async (request, reply) => {
        const id = String(request.query.id || '').trim();
        if (!id)
            return reply.status(400).send({ message: 'id is required' });
        return infoHandler(id, reply);
    });
    fastify.get('/info/:id', async (request, reply) => {
        const id = String(request.params.id || '').trim();
        if (!id)
            return reply.status(400).send({ message: 'id is required' });
        return infoHandler(id, reply);
    });
    fastify.get('/watch/:episodeId', async (request, reply) => {
        const episodeId = String(request.params.episodeId || '').trim();
        if (!episodeId)
            return reply.status(400).send({ message: 'episodeId is required' });
        try {
            const epNumber = extractEpisodeNumber(episodeId);
            if (!epNumber) {
                return reply.status(404).send({ message: 'Could not parse episode number from id.' });
            }
            const md = await fetchJinaText(`${BASE_URL}/watch/${episodeId}/`, 12000);
            const startedAt = Date.now();
            const deadlineReached = () => Date.now() - startedAt > MAX_DESIDUB_WATCH_MS;
            const watchPageUrl = `${BASE_URL}/watch/${episodeId}/`;
            const directFromMarkdown = extractDirectMediaUrls(md);
            const hlsFromMarkdown = directFromMarkdown.filter((u) => /\.m3u8(\?|$)/i.test(u));
            const markdownDirect = hlsFromMarkdown.length ? hlsFromMarkdown : directFromMarkdown;
            if (markdownDirect.length) {
                return reply.status(200).send({
                    headers: { Referer: watchPageUrl },
                    sources: markdownDirect.map((url) => ({
                        url,
                        quality: 'auto',
                        isM3U8: /\.m3u8(\?|$)/i.test(url),
                        isEmbed: false,
                    })),
                });
            }
            const markdownEmbeds = extractEmbedUrls(md, watchPageUrl);
            for (const embed of markdownEmbeds) {
                const crawled = await crawlForDirectMedia(embed, watchPageUrl, 3);
                if (Array.isArray(crawled.directUrls) && crawled.directUrls.length) {
                    const hls = crawled.directUrls.filter((u) => /\.m3u8(\?|$)/i.test(u));
                    const picked = hls.length ? hls : crawled.directUrls;
                    return reply.status(200).send({
                        headers: { Referer: crawled.lastReferer || watchPageUrl },
                        sources: picked.map((url) => ({
                            url,
                            quality: 'auto',
                            isM3U8: /\.m3u8(\?|$)/i.test(url),
                            isEmbed: false,
                        })),
                        embedURL: embed,
                    });
                }
            }
            // DesiDub watch pages expose server links as base64 data-embed-id values.
            // Decode them in a real browser context, then probe each embed for direct media.
            const runtimeEmbeds = await extractEmbedCandidatesFromWatchPage(watchPageUrl);
            const rubyEmbeds = runtimeEmbeds.filter((e) => normalizeServerName(e.server) === 'ruby');
            const nonRuby = runtimeEmbeds
                .filter((e) => normalizeServerName(e.server) !== 'ruby')
                .sort((a, b) => embedServerRank(a.server) - embedServerRank(b.server))
                .slice(0, MAX_EMBED_ENTRIES_TO_TRY);
            const orderedEmbeds = nonRuby;
            for (const entry of orderedEmbeds) {
                if (deadlineReached())
                    break;
                const isGdMirror = /gdmirrorbot\./i.test(entry.url);
                const directProbeTargets = isGdMirror ? [] : [entry];
                if (isGdMirror) {
                    const expanded = await resolveGdMirrorInnerCandidates(entry.url);
                    const expandedNonRuby = expanded.filter((x) => normalizeServerName(x.server) !== 'ruby');
                    if (expandedNonRuby.length) {
                        directProbeTargets.unshift(...expandedNonRuby);
                    }
                }
                const remainingMs = Math.max(1000, MAX_DESIDUB_WATCH_MS - (Date.now() - startedAt) - 500);
                const winner = await withTimeout(probeCandidatesForHls(directProbeTargets), remainingMs);
                if (winner && Array.isArray(winner.sources) && winner.sources.length) {
                    return reply.status(200).send({
                        headers: { Referer: winner.probe.url },
                        sources: winner.sources,
                        embedURL: winner.probe.url,
                        server: winner.probe.server || entry.server,
                    });
                }
            }
            if (!deadlineReached() && rubyEmbeds.length) {
                const rubyTarget = rubyEmbeds[0];
                const rubyWinner = await withTimeout(probeCandidatesForHls([rubyTarget]), 9000);
                if (rubyWinner && Array.isArray(rubyWinner.sources) && rubyWinner.sources.length) {
                    return reply.status(200).send({
                        headers: { Referer: rubyWinner.probe.url },
                        sources: rubyWinner.sources,
                        embedURL: rubyWinner.probe.url,
                        server: 'ruby',
                    });
                }
            }
            return reply.status(404).send({ message: 'No HLS non-embed sources found from desidubanime mirrors.' });
        }
        catch (err) {
            reply.status(500).send({
                message: err.message,
            });
        }
    });
};
exports.default = routes;
