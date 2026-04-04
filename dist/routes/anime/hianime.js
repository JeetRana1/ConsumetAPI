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
const extensions_1 = require("@consumet/extensions");
const models_1 = require("@consumet/extensions/dist/models");
const cheerio_1 = require("cheerio");
const cache_1 = __importDefault(require("../../utils/cache"));
const main_1 = require("../../main");
const streamable_1 = require("../../utils/streamable");
const provider_1 = require("../../utils/provider");
const browserRuntimeExtractor_1 = require("../../utils/browserRuntimeExtractor");
const outboundProxy_1 = require("../../utils/outboundProxy");
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HIANIME_BASE_URLS = ['https://hianime.to', 'https://hianime.sx', 'https://9animetv.to'];
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const WATCH_ATTEMPT_TIMEOUT_MS = IS_PRODUCTION ? 8000 : 12000;
const EMBED_CHECK_TIMEOUT_MS = IS_PRODUCTION ? 8000 : 10000;
const SERVER_HTML_TIMEOUT_MS = IS_PRODUCTION ? 9000 : 12000;
const EMBED_EXTRACT_TIMEOUT_MS = IS_PRODUCTION ? 7000 : 9000;
const BROWSER_SUBTITLE_TIMEOUT_MS = IS_PRODUCTION ? 9000 : 13000;
const serverIdMap = {
    [models_1.StreamingServers.VidCloud]: '1',
    [models_1.StreamingServers.VidStreaming]: '4',
    [models_1.StreamingServers.StreamSB]: '5',
    [models_1.StreamingServers.StreamTape]: '3',
};
const getEpisodeNumberFromId = (episodeId) => {
    const after = episodeId.split('$episode$')[1] || '';
    return after.split('$')[0] || '';
};
const watchUrlFromEpisodeId = (baseUrl, episodeId) => `${baseUrl}/watch/${episodeId.replace('$episode$', '?ep=').replace(/\$auto|\$sub|\$dub/gi, '')}`;
const subtitleUrlRegex = /https?:\/\/[^\s"'<>]+?\.(?:vtt|srt)(?:\?[^\s"'<>]*)?/gi;
const parseSubtitleUrlsFromText = (text) => {
    const out = new Set();
    let m;
    while ((m = subtitleUrlRegex.exec(String(text || ''))) !== null) {
        const url = String(m[0] || '').trim();
        if (url)
            out.add(url);
    }
    return [...out];
};
const subtitleLangFromUrl = (url) => {
    const u = String(url || '').toLowerCase();
    if (/(^|[\/._-])(en|eng|english)([\/._-]|$)/i.test(u))
        return 'English';
    if (/(^|[\/._-])(ja|jpn|japanese)([\/._-]|$)/i.test(u))
        return 'Japanese';
    if (/(^|[\/._-])(es|spa|spanish)([\/._-]|$)/i.test(u))
        return 'Spanish';
    if (/(^|[\/._-])(fr|fre|french)([\/._-]|$)/i.test(u))
        return 'French';
    return 'Unknown';
};
const fetchHianimeSubtitlesViaBrowser = async (baseUrl, episodeId) => {
    let chromium;
    try {
        ({ chromium } = await Promise.resolve().then(() => __importStar(require('playwright'))));
    }
    catch {
        return [];
    }
    const watchUrl = watchUrlFromEpisodeId(baseUrl, episodeId);
    const found = new Set();
    let browser;
    try {
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage'],
        });
        const context = await browser.newContext({ userAgent: UA });
        const page = await context.newPage();
        page.on('request', (req) => {
            const u = String(req.url?.() || req.url || '').trim();
            if (!u)
                return;
            if (/\.vtt(\?|$)|\.srt(\?|$)/i.test(u))
                found.add(u);
        });
        page.on('response', async (res) => {
            try {
                const u = String(res.url?.() || '').trim();
                if (u && /\.vtt(\?|$)|\.srt(\?|$)/i.test(u))
                    found.add(u);
                const ct = String((res.headers?.()['content-type'] || '')).toLowerCase();
                if (ct.includes('json') || ct.includes('javascript') || ct.includes('text')) {
                    const body = String((await res.text()) || '');
                    for (const sub of parseSubtitleUrlsFromText(body))
                        found.add(sub);
                }
            }
            catch {
                // ignore
            }
        });
        await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: BROWSER_SUBTITLE_TIMEOUT_MS });
        await page.waitForTimeout(3500);
        await context.close();
    }
    catch {
        // ignore browser failures
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
    return [...found].map((url) => ({
        lang: subtitleLangFromUrl(url),
        url,
        kind: 'captions',
    }));
};
const extractServerDataIds = (serversHtml, server, category) => {
    const $ = (0, cheerio_1.load)(serversHtml || '');
    // Prefer server-id 4 by default on HiAnime; server-id 1 often returns stale/dead embeds.
    const desiredServerId = serverIdMap[server] || serverIdMap[models_1.StreamingServers.VidStreaming];
    const collectForType = (type) => {
        const scoped = $(`.ps_-block.ps_-block-sub.servers-${type} .server-item`);
        const all = scoped
            .map((_, el) => ({
            serverId: String($(el).attr('data-server-id') || ''),
            dataId: String($(el).attr('data-id') || ''),
        }))
            .get()
            .filter((entry) => !!entry.dataId);
        // Try preferred server first, then fall back to the rest for resilience.
        const preferred = all.filter((entry) => entry.serverId === desiredServerId).map((entry) => entry.dataId);
        const fallback = all.filter((entry) => entry.serverId !== desiredServerId).map((entry) => entry.dataId);
        return [...preferred, ...fallback];
    };
    if (category === models_1.SubOrSub.BOTH) {
        const ids = [...collectForType('sub'), ...collectForType('dub')];
        return [...new Set(ids)];
    }
    return category === models_1.SubOrSub.DUB ? collectForType('dub') : collectForType('sub');
};
const toDirectPlayableSources = (sources) => (Array.isArray(sources) ? sources : []).filter((s) => {
    const u = String(s?.url || '').toLowerCase();
    if (!u)
        return false;
    if (Boolean(s?.isEmbed))
        return false;
    return Boolean(s?.isM3U8) || u.includes('.m3u8') || u.includes('m3u8-proxy') || u.includes('.mp4');
});
const fetchHianimeViaAjaxFallback = async (baseUrl, episodeId, server, category) => {
    if (!episodeId.includes('$episode$')) {
        throw new Error('Invalid episode id');
    }
    const epNum = getEpisodeNumberFromId(episodeId);
    if (!epNum)
        throw new Error('Invalid episode id');
    const referer = watchUrlFromEpisodeId(baseUrl, episodeId);
    const commonHeaders = {
        'User-Agent': UA,
        Referer: referer,
        'X-Requested-With': 'XMLHttpRequest',
    };
    const serversRes = await (0, outboundProxy_1.proxyGet)(`${baseUrl}/ajax/v2/episode/servers?episodeId=${epNum}`, {
        headers: commonHeaders,
    });
    const dataIds = extractServerDataIds(serversRes?.data?.html || '', server, category);
    if (!dataIds.length)
        throw new Error('Could not resolve HiAnime server id');
    const sources = [];
    const subtitles = [];
    for (const dataId of dataIds) {
        const sourceMeta = await (0, outboundProxy_1.proxyGet)(`${baseUrl}/ajax/v2/episode/sources?id=${encodeURIComponent(dataId)}`, {
            headers: commonHeaders,
        });
        const embedLink = sourceMeta?.data?.link;
        if (!embedLink)
            continue;
        let crawlrSources = [];
        let crawlrTracks = [];
        try {
            const crawlrUrl = `https://crawlr.cc/9D7F1B3E8?url=${encodeURIComponent(embedLink)}`;
            const crawlrRes = await (0, outboundProxy_1.proxyGet)(crawlrUrl, { headers: { 'User-Agent': UA } });
            const crawlrData = crawlrRes?.data || {};
            crawlrSources = Array.isArray(crawlrData?.sources) ? crawlrData.sources : [];
            crawlrTracks = Array.isArray(crawlrData?.tracks) ? crawlrData.tracks : [];
        }
        catch (_) {
            // Continue to iframe fallback checks below.
        }
        crawlrSources.forEach((s) => {
            if (!s?.url)
                return;
            sources.push({
                url: s.url,
                quality: s.quality || 'auto',
                isM3U8: String(s.url).includes('.m3u8'),
            });
        });
        crawlrTracks.forEach((t) => {
            const url = t?.file || t?.url || t?.src;
            if (!url)
                return;
            subtitles.push({
                lang: t?.label || t?.language || 'Unknown',
                url,
                kind: t?.kind || 'captions',
            });
        });
        // Try extracting direct stream URLs from embed page before keeping embed fallback.
        if (!crawlrSources.length) {
            try {
                const extracted = await (0, browserRuntimeExtractor_1.extractDirectSourcesWithPlaywright)(embedLink, referer, EMBED_EXTRACT_TIMEOUT_MS);
                extracted.forEach((s) => {
                    const u = String(s?.url || '').toLowerCase();
                    if (!u || u.includes('.mpd'))
                        return;
                    if (!(Boolean(s?.isM3U8) || u.includes('.m3u8') || u.includes('m3u8-proxy') || u.includes('.mp4')))
                        return;
                    sources.push({
                        url: s.url,
                        quality: s.quality || 'auto',
                        isM3U8: Boolean(s?.isM3U8) || u.includes('.m3u8') || u.includes('m3u8-proxy'),
                        isEmbed: false,
                    });
                });
            }
            catch (_) {
                // Continue to iframe fallback checks below.
            }
        }
        // Do not keep iframe/embed fallbacks. HiAnime should return only direct playable sources.
    }
    const dedupSources = [...new Map(toDirectPlayableSources(sources).map((s) => [String(s.url), s])).values()];
    let dedupSubs = [...new Map(subtitles.map((s) => [String(s.url), s])).values()];
    if (!dedupSubs.length) {
        try {
            const browserSubs = await fetchHianimeSubtitlesViaBrowser(baseUrl, episodeId);
            if (browserSubs.length) {
                dedupSubs = [...new Map(browserSubs.map((s) => [String(s.url), s])).values()];
            }
        }
        catch {
            // ignore subtitle browser fallback failures
        }
    }
    if (!dedupSources.length) {
        throw new Error('HiAnime fallback returned no direct playable sources');
    }
    return {
        sources: dedupSources,
        subtitles: dedupSubs,
        headers: { Referer: referer },
    };
};
const hasSources = (payload) => !!payload && Array.isArray(payload.sources) && payload.sources.length > 0;
const mergeSubtitles = (primary, secondary) => {
    const p = Array.isArray(primary) ? primary : [];
    const s = Array.isArray(secondary) ? secondary : [];
    const merged = [...p, ...s].filter((row) => row && (row.url || row.file || row.src));
    return [...new Map(merged.map((row) => [String(row.url || row.file || row.src), row])).values()];
};
const withMergedSubtitles = (payload, subtitles) => {
    const merged = mergeSubtitles(payload?.subtitles, subtitles);
    return {
        ...(payload || {}),
        subtitles: merged,
    };
};
const hasDirectPlayableSource = (payload) => !!payload &&
    Array.isArray(payload.sources) &&
    payload.sources.some((s) => {
        const u = String(s?.url || '').toLowerCase();
        const isM3U8 = !!s?.isM3U8 || u.includes('.m3u8');
        const isMp4 = u.includes('.mp4');
        const isEmbed = !!s?.isEmbed;
        return (isM3U8 || isMp4) && !isEmbed;
    });
const resolveDirectFromEmbedPayload = async (payload, referer) => {
    const sources = Array.isArray(payload?.sources) ? payload.sources : [];
    const embedUrls = sources
        .filter((s) => Boolean(s?.isEmbed))
        .map((s) => String(s?.url || '').trim())
        .filter((url) => /^https?:\/\//i.test(url))
        .slice(0, 2);
    if (!embedUrls.length)
        return payload;
    const directSources = [];
    for (const embedUrl of embedUrls) {
        try {
            const extracted = await (0, browserRuntimeExtractor_1.extractDirectSourcesWithPlaywright)(embedUrl, referer || embedUrl, EMBED_EXTRACT_TIMEOUT_MS);
            extracted.forEach((s) => {
                const u = String(s?.url || '').toLowerCase();
                if (!u || u.includes('.mpd'))
                    return;
                if (!(Boolean(s?.isM3U8) || u.includes('.m3u8') || u.includes('m3u8-proxy') || u.includes('.mp4')))
                    return;
                directSources.push({
                    ...s,
                    isEmbed: false,
                    isM3U8: Boolean(s?.isM3U8) || u.includes('.m3u8') || u.includes('m3u8-proxy'),
                });
            });
        }
        catch {
            // ignore single embed extraction failure
        }
    }
    if (!directSources.length)
        return payload;
    const dedupDirect = [...new Map(toDirectPlayableSources(directSources).map((s) => [String(s.url), s])).values()];
    return {
        ...payload,
        sources: dedupDirect,
    };
};
const getAnimeSearchNameFromEpisodeId = (episodeId) => String(episodeId.split('$episode$')[0] || '')
    .replace(/-(tv|movie|ova|ona|special)(-\d+)?$/i, '')
    .replace(/-\d+$/, '')
    .replace(/-/g, ' ')
    .replace(/\b(tv|movie|ova|ona|special)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const getEpisodeOrdinalFromServersHtml = async (baseUrl, episodeId) => {
    try {
        const epNum = getEpisodeNumberFromId(episodeId);
        if (!epNum)
            return null;
        const referer = `${baseUrl}/watch/${episodeId.replace('$episode$', '?ep=').replace(/\$auto|\$sub|\$dub/gi, '')}`;
        const res = await (0, outboundProxy_1.proxyGet)(`${baseUrl}/ajax/v2/episode/servers?episodeId=${epNum}`, {
            headers: {
                'User-Agent': UA,
                Referer: referer,
                'X-Requested-With': 'XMLHttpRequest',
            },
            timeout: SERVER_HTML_TIMEOUT_MS,
        });
        const html = String(res?.data?.html || '');
        const m = html.match(/Episode\s*<\/b>\s*<\/strong>|Episode\s*<b>\s*(\d+)/i) || html.match(/Episode\s+(\d+)/i);
        const n = Number((m && (m[1] || m[0]?.match(/(\d+)/)?.[1])) || 0);
        return Number.isFinite(n) && n > 0 ? n : null;
    }
    catch (_) {
        return null;
    }
};
const extractSubtitleRows = (payload) => {
    const all = [
        ...(Array.isArray(payload?.subtitles) ? payload.subtitles : []),
        ...(Array.isArray(payload?.captions) ? payload.captions : []),
        ...(Array.isArray(payload?.tracks) ? payload.tracks : []),
    ];
    const rows = all
        .map((row) => {
        const url = row?.url || row?.file || row?.src;
        if (!url || typeof url !== 'string')
            return null;
        return {
            lang: String(row?.lang || row?.label || row?.language || 'Unknown'),
            url: String(url),
            kind: String(row?.kind || 'captions'),
        };
    })
        .filter(Boolean);
    return [...new Map(rows.map((row) => [String(row.url), row])).values()];
};
const routes = async (fastify, options) => {
    const hianime = (0, provider_1.configureProvider)(new extensions_1.ANIME.Hianime());
    const tryWithBaseUrlFallback = async (worker) => {
        const configured = String(hianime.baseUrl || '').trim();
        const candidates = [configured, ...HIANIME_BASE_URLS].filter((url, idx, arr) => !!url && arr.indexOf(url) === idx);
        let lastError = null;
        for (const baseUrl of candidates) {
            try {
                hianime.baseUrl = baseUrl;
                return await worker(baseUrl);
            }
            catch (err) {
                lastError = err;
            }
        }
        throw lastError || new Error('Failed to fetch sources from HiAnime domains.');
    };
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: `Welcome to the hianime provider: check out the provider's website @ ${hianime.toString.baseUrl}`,
            routes: [
                '/:query',
                '/info',
                '/watch/:episodeId',
                '/advanced-search',
                '/top-airing',
                '/most-popular',
                '/most-favorite',
                '/latest-completed',
                '/recently-updated',
                '/recently-added',
                '/top-upcoming',
                '/studio/:studio',
                '/subbed-anime',
                '/dubbed-anime',
                '/movie',
                '/tv',
                '/ova',
                '/ona',
                '/special',
                '/genres',
                '/genre/:genre',
                '/schedule',
                '/spotlight',
                '/search-suggestions/:query',
            ],
            documentation: 'https://docs.consumet.org/#tag/hianime',
        });
    });
    fastify.get('/info', async (request, reply) => {
        const id = request.query.id;
        if (typeof id === 'undefined')
            return reply.status(400).send({ message: 'id is required' });
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:info:${id}`, async () => await hianime.fetchAnimeInfo(id), main_1.REDIS_TTL)
                : await hianime.fetchAnimeInfo(id);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/watch/:episodeId', async (request, reply) => {
        const episodeId = request.params.episodeId;
        const server = request.query.server;
        const category = (request.query.category || models_1.SubOrSub.BOTH);
        if (typeof episodeId === 'undefined')
            return reply.status(400).send({ message: 'episodeId is required' });
        try {
            if (category === 'both') {
                let lastBaseUrl = hianime.baseUrl || HIANIME_BASE_URLS[0];
                let res;
                let hianimeSubs = [];
                try {
                    res = await tryWithBaseUrlFallback(async (baseUrl) => {
                        lastBaseUrl = baseUrl;
                        const [subRes, dubRes] = await Promise.allSettled([
                            (0, streamable_1.fetchWithServerFallback)(async (selectedServer) => await hianime.fetchEpisodeSources(episodeId, selectedServer, models_1.SubOrSub.SUB), server, undefined, { attemptTimeoutMs: WATCH_ATTEMPT_TIMEOUT_MS }),
                            (0, streamable_1.fetchWithServerFallback)(async (selectedServer) => await hianime.fetchEpisodeSources(episodeId, selectedServer, models_1.SubOrSub.DUB), server, undefined, { attemptTimeoutMs: WATCH_ATTEMPT_TIMEOUT_MS }),
                        ]);
                        const sources = [];
                        const subtitles = [];
                        if (subRes.status === 'fulfilled' && hasSources(subRes.value)) {
                            sources.push(...subRes.value.sources.map((s) => ({ ...s, isDub: false })));
                            subtitles.push(...(subRes.value.subtitles || []));
                        }
                        if (dubRes.status === 'fulfilled' && hasSources(dubRes.value)) {
                            sources.push(...dubRes.value.sources.map((s) => ({ ...s, isDub: true })));
                            subtitles.push(...(dubRes.value.subtitles || []));
                        }
                        if (sources.length > 0) {
                            hianimeSubs = [...new Set(subtitles.map((s) => JSON.stringify(s)))].map((s) => JSON.parse(s));
                            return {
                                sources,
                                subtitles: hianimeSubs,
                                intro: subRes.status === 'fulfilled'
                                    ? subRes.value.intro
                                    : (dubRes.status === 'fulfilled' ? dubRes.value.intro : undefined),
                                outro: subRes.status === 'fulfilled'
                                    ? subRes.value.outro
                                    : (dubRes.status === 'fulfilled' ? dubRes.value.outro : undefined),
                            };
                        }
                        return await fetchHianimeViaAjaxFallback(baseUrl, episodeId, server || models_1.StreamingServers.VidStreaming, models_1.SubOrSub.BOTH);
                    });
                    hianimeSubs = mergeSubtitles(hianimeSubs, res?.subtitles);
                }
                catch (_) {
                    throw _;
                }
                if (!hasDirectPlayableSource(res)) {
                    res = await resolveDirectFromEmbedPayload(res, `${lastBaseUrl}/watch/${episodeId.replace('$episode$', '?ep=').replace(/\$auto|\$sub|\$dub/gi, '')}`);
                }
                res = {
                    ...(res || {}),
                    sources: toDirectPlayableSources(res?.sources),
                };
                if (!Array.isArray(res?.sources) || !res.sources.length) {
                    throw new Error('HiAnime returned no direct playable sources');
                }
                reply.status(200).send(res);
                return;
            }
            let res;
            let lastBaseUrl = hianime.baseUrl || HIANIME_BASE_URLS[0];
            let hianimeSubs = [];
            const fetchWatch = async () => await tryWithBaseUrlFallback(async (baseUrl) => {
                lastBaseUrl = baseUrl;
                try {
                    const primary = await (0, streamable_1.fetchWithServerFallback)(async (selectedServer) => await hianime.fetchEpisodeSources(episodeId, selectedServer, category), server, undefined, { attemptTimeoutMs: WATCH_ATTEMPT_TIMEOUT_MS });
                    if (hasSources(primary))
                        return primary;
                }
                catch (_) {
                    // Ignore and try ajax fallback below.
                }
                const ajaxRes = await fetchHianimeViaAjaxFallback(baseUrl, episodeId, server || models_1.StreamingServers.VidStreaming, category);
                hianimeSubs = mergeSubtitles(hianimeSubs, ajaxRes?.subtitles);
                return ajaxRes;
            });
            try {
                res = main_1.redis
                    ? await cache_1.default.fetch(main_1.redis, `hianime:watch:${episodeId}:${server}:${category}`, async () => await fetchWatch(), main_1.REDIS_TTL)
                    : await fetchWatch();
            }
            catch (_) {
                throw _;
            }
            if (!hasDirectPlayableSource(res)) {
                res = await resolveDirectFromEmbedPayload(res, `${lastBaseUrl}/watch/${episodeId.replace('$episode$', '?ep=').replace(/\$auto|\$sub|\$dub/gi, '')}`);
            }
            res = {
                ...(res || {}),
                sources: toDirectPlayableSources(res?.sources),
            };
            if (!Array.isArray(res?.sources) || !res.sources.length) {
                throw new Error('HiAnime returned no direct playable sources');
            }
            reply.status(200).send(res);
        }
        catch (err) {
            reply.status(500).send({
                message: 'Something went wrong. Contact developer for help.',
                error: err.message,
            });
        }
    });
    fastify.get('/genres', async (request, reply) => {
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:genres`, async () => await hianime.fetchGenres(), main_1.REDIS_TTL)
                : await hianime.fetchGenres();
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/schedule', async (request, reply) => {
        const date = request.query.date;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:schedule:${date}`, async () => await hianime.fetchSchedule(date), main_1.REDIS_TTL)
                : await hianime.fetchSchedule(date);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/spotlight', async (request, reply) => {
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:spotlight`, async () => await hianime.fetchSpotlight(), main_1.REDIS_TTL)
                : await hianime.fetchSpotlight();
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/search-suggestions/:query', async (request, reply) => {
        const query = request.params.query;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:suggestions:${query}`, async () => await hianime.fetchSearchSuggestions(query), main_1.REDIS_TTL)
                : await hianime.fetchSearchSuggestions(query);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/advanced-search', async (request, reply) => {
        const queryParams = request.query;
        const { page = 1, type, status, rated, score, season, language, startDate, endDate, sort, genres, } = queryParams;
        try {
            // Explicitly typed to avoid implicit any errors
            let parsedStartDate;
            let parsedEndDate;
            if (startDate) {
                const [year, month, day] = startDate.split('-').map(Number);
                parsedStartDate = { year, month, day };
            }
            if (endDate) {
                const [year, month, day] = endDate.split('-').map(Number);
                parsedEndDate = { year, month, day };
            }
            const genresArray = genres ? genres.split(',') : undefined;
            // Create a unique key based on all parameters
            const cacheKey = `hianime:advanced-search:${JSON.stringify(queryParams)}`;
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, cacheKey, async () => await hianime.fetchAdvancedSearch(page, type, status, rated, score, season, language, parsedStartDate, parsedEndDate, sort, genresArray), main_1.REDIS_TTL)
                : await hianime.fetchAdvancedSearch(page, type, status, rated, score, season, language, parsedStartDate, parsedEndDate, sort, genresArray);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/top-airing', async (request, reply) => {
        const page = request.query.page;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:top-airing:${page}`, async () => await hianime.fetchTopAiring(page), main_1.REDIS_TTL)
                : await hianime.fetchTopAiring(page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/most-popular', async (request, reply) => {
        const page = request.query.page;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:most-popular:${page}`, async () => await hianime.fetchMostPopular(page), main_1.REDIS_TTL)
                : await hianime.fetchMostPopular(page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/most-favorite', async (request, reply) => {
        const page = request.query.page;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:most-favorite:${page}`, async () => await hianime.fetchMostFavorite(page), main_1.REDIS_TTL)
                : await hianime.fetchMostFavorite(page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/latest-completed', async (request, reply) => {
        const page = request.query.page;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:latest-completed:${page}`, async () => await hianime.fetchLatestCompleted(page), main_1.REDIS_TTL)
                : await hianime.fetchLatestCompleted(page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/recently-updated', async (request, reply) => {
        const page = request.query.page;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:recently-updated:${page}`, async () => await hianime.fetchRecentlyUpdated(page), main_1.REDIS_TTL)
                : await hianime.fetchRecentlyUpdated(page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/recently-added', async (request, reply) => {
        const page = request.query.page;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:recently-added:${page}`, async () => await hianime.fetchRecentlyAdded(page), main_1.REDIS_TTL)
                : await hianime.fetchRecentlyAdded(page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/top-upcoming', async (request, reply) => {
        const page = request.query.page;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:top-upcoming:${page}`, async () => await hianime.fetchTopUpcoming(page), main_1.REDIS_TTL)
                : await hianime.fetchTopUpcoming(page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/studio/:studio', async (request, reply) => {
        const studio = request.params.studio;
        const page = request.query.page;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:studio:${studio}:${page}`, async () => await hianime.fetchStudio(studio, page), main_1.REDIS_TTL)
                : await hianime.fetchStudio(studio, page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/subbed-anime', async (request, reply) => {
        const page = request.query.page;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:subbed:${page}`, async () => await hianime.fetchSubbedAnime(page), main_1.REDIS_TTL)
                : await hianime.fetchSubbedAnime(page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/dubbed-anime', async (request, reply) => {
        const page = request.query.page;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:dubbed:${page}`, async () => await hianime.fetchDubbedAnime(page), main_1.REDIS_TTL)
                : await hianime.fetchDubbedAnime(page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/movie', async (request, reply) => {
        const page = request.query.page;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:movie:${page}`, async () => await hianime.fetchMovie(page), main_1.REDIS_TTL)
                : await hianime.fetchMovie(page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/tv', async (request, reply) => {
        const page = request.query.page;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:tv:${page}`, async () => await hianime.fetchTV(page), main_1.REDIS_TTL)
                : await hianime.fetchTV(page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/ova', async (request, reply) => {
        const page = request.query.page;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:ova:${page}`, async () => await hianime.fetchOVA(page), main_1.REDIS_TTL)
                : await hianime.fetchOVA(page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/ona', async (request, reply) => {
        const page = request.query.page;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:ona:${page}`, async () => await hianime.fetchONA(page), main_1.REDIS_TTL)
                : await hianime.fetchONA(page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/special', async (request, reply) => {
        const page = request.query.page;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:special:${page}`, async () => await hianime.fetchSpecial(page), main_1.REDIS_TTL)
                : await hianime.fetchSpecial(page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/genre/:genre', async (request, reply) => {
        const genre = request.params.genre;
        const page = request.query.page;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:genre:${genre}:${page}`, async () => await hianime.genreSearch(genre, page), main_1.REDIS_TTL)
                : await hianime.genreSearch(genre, page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
    fastify.get('/:query', async (request, reply) => {
        const query = request.params.query;
        const page = request.query.page;
        try {
            let res = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `hianime:search:${query}:${page}`, async () => await hianime.search(query, page), main_1.REDIS_TTL)
                : await hianime.search(query, page);
            reply.status(200).send(res);
        }
        catch (err) {
            reply
                .status(500)
                .send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
};
exports.default = routes;
