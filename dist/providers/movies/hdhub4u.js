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
exports.HDHub4U = void 0;
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const models_1 = require("@consumet/extensions/dist/models");
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const STREAM_HOSTS = [
    'hubstream.art',
    'hubstream.pw',
    'hubstream.cc',
    'hdstream4u.com',
    'hdstream4u.in',
    'hubcloud.foo',
    'hubcloud.boo',
    'hubcloud.ink',
    'hubdrive.space',
    'gadgetsweb.xyz',
    'gamerxyt.com',
];
const GATE_HOSTS = [
    ...STREAM_HOSTS,
    'hubdrive.fit',
    'hubdrive.art',
    'hubdrive.foo',
    'hubdrive.space',
    'hblinks.co',
    'tech.unblockedgames.world',
    'gamerxyt.com',
];
const RAW_FILE_HOSTS = [
    'r2.dev',
    'googleusercontent.com',
];
const cleanText = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\[[^\]]*]/g, '')
    .trim();
const dedupe = (items, keyFn) => {
    const seen = new Set();
    return items.filter((item) => {
        const key = keyFn(item);
        if (!key || seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
};
const parseMaybeJsonString = (value) => {
    try {
        return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
    }
    catch {
        return value;
    }
};
class HDHub4U extends models_1.MovieParser {
    constructor() {
        super(...arguments);
        this.name = 'HDHub4U';
        this.baseUrl = 'https://new1.hdhub4u.cl';
        this.classPath = 'MOVIES.HDHub4U';
        this.supportedTypes = new Set([models_1.TvType.MOVIE, models_1.TvType.TVSERIES]);
        this.requestConfig = {
            timeout: 20000,
            maxRedirects: 5,
            validateStatus: (status) => status >= 200 && status < 400,
            headers: {
                'User-Agent': USER_AGENT,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        };
    }
    absoluteUrl(url, base = this.baseUrl) {
        const raw = String(url || '').trim();
        if (!raw)
            return '';
        try {
            return new URL(raw, base).toString();
        }
        catch {
            return raw;
        }
    }
    mediaIdFromUrl(url) {
        const absolute = this.absoluteUrl(url);
        try {
            const parsed = new URL(absolute);
            const baseHost = new URL(this.baseUrl).hostname.toLowerCase();
            if (parsed.hostname.toLowerCase() !== baseHost)
                return absolute;
            return `${parsed.pathname.replace(/^\/+|\/+$/g, '')}${parsed.search || ''}`;
        }
        catch {
            return String(url || '').replace(/^\/+|\/+$/g, '');
        }
    }
    mediaUrlFromId(mediaId) {
        const raw = String(mediaId || '').trim();
        if (/^https?:\/\//i.test(raw))
            return raw;
        return this.absoluteUrl(`/${raw.replace(/^\/+/, '')}`);
    }
    async get(url, referer = this.baseUrl) {
        const response = await axios_1.default.get(url, {
            ...this.requestConfig,
            responseType: 'text',
            headers: {
                ...this.requestConfig.headers,
                Referer: referer,
            },
        });
        return String(response.data || '');
    }
    async search(query, page = 1) {
        const searchUrl = `${this.baseUrl}/?s=${encodeURIComponent(query)}`;
        const html = await this.get(searchUrl);
        const $ = cheerio.load(html);
        const results = [];
        $('article, .post, .latestPost, .gridlove-post, .entry, .blog-entry').each((_, el) => {
            const anchor = $(el).find('h2 a, h3 a, .entry-title a, a[rel="bookmark"], a').first();
            const href = anchor.attr('href') || '';
            const title = cleanText(anchor.text() || $(el).find('h2, h3, .entry-title').first().text());
            if (!href || !title)
                return;
            const image = $(el).find('img').first().attr('data-src') ||
                $(el).find('img').first().attr('data-lazy-src') ||
                $(el).find('img').first().attr('src') ||
                '';
            results.push({
                id: this.mediaIdFromUrl(href),
                title,
                url: this.absoluteUrl(href),
                image: this.absoluteUrl(image, href),
                type: /(?:season|episode|series|web[\s-]*series)/i.test(title) ? models_1.TvType.TVSERIES : models_1.TvType.MOVIE,
            });
        });
        const domResults = dedupe(results, (item) => String(item.id || item.url || ''));
        if (domResults.length > 0) {
            return {
                currentPage: page,
                hasNextPage: $('a.next, .pagination .next, a[rel="next"]').length > 0,
                results: domResults,
            };
        }
        return await this.searchPingora(query, page);
    }
    async searchPingora(query, page = 1) {
        const apiUrl = new URL('https://search.pingora.fyi/collections/post/documents/search');
        apiUrl.searchParams.set('q', query);
        apiUrl.searchParams.set('query_by', 'post_title,category,stars,director,imdb_id');
        apiUrl.searchParams.set('query_by_weights', '4,2,2,2,4');
        apiUrl.searchParams.set('sort_by', 'sort_by_date:desc');
        apiUrl.searchParams.set('limit', '15');
        apiUrl.searchParams.set('highlight_fields', 'none');
        apiUrl.searchParams.set('use_cache', 'true');
        apiUrl.searchParams.set('page', String(page));
        apiUrl.searchParams.set('analytics_tag', new Date().toISOString().slice(0, 10));
        const response = await axios_1.default.get(apiUrl.toString(), {
            ...this.requestConfig,
            responseType: 'json',
            headers: {
                ...this.requestConfig.headers,
                Accept: 'application/json, text/plain, */*',
                Origin: this.baseUrl,
                Referer: `${this.baseUrl}/?s=${encodeURIComponent(query)}`,
            },
        });
        const hits = Array.isArray(response.data?.hits) ? response.data.hits : [];
        const results = hits
            .map((hit) => hit?.document || {})
            .map((doc) => {
            const permalink = String(doc.permalink || doc.url || '').trim();
            const title = cleanText(String(doc.post_title || doc.title || ''));
            if (!permalink || !title)
                return null;
            return {
                id: this.mediaIdFromUrl(permalink),
                title,
                url: this.absoluteUrl(permalink),
                image: this.absoluteUrl(String(doc.post_thumbnail || doc.image || ''), permalink),
                type: /(?:season|episode|series|web[\s-]*series)/i.test(title) ? models_1.TvType.TVSERIES : models_1.TvType.MOVIE,
            };
        })
            .filter(Boolean);
        const found = Number(response.data?.found || results.length);
        return {
            currentPage: page,
            hasNextPage: page * 15 < found,
            results: dedupe(results, (item) => String(item.id || item.url || '')),
        };
    }
    async fetchMediaInfo(mediaId) {
        const pageUrl = this.mediaUrlFromId(mediaId);
        const html = await this.get(pageUrl);
        const $ = cheerio.load(html);
        const title = cleanText($('h1.entry-title, h1.post-title, .entry-title, h1').first().text() ||
            $('meta[property="og:title"]').attr('content') ||
            mediaId);
        const image = this.absoluteUrl($('meta[property="og:image"]').attr('content') ||
            $('.entry-content img, article img').first().attr('src') ||
            '', pageUrl);
        const description = cleanText($('meta[property="og:description"]').attr('content') ||
            $('.entry-content p, .post-content p, article p').first().text());
        const episodes = this.extractEpisodes($, pageUrl);
        const movieWatchUrl = this.extractWatchLinks($, pageUrl)[0] || pageUrl;
        return {
            id: this.mediaIdFromUrl(pageUrl),
            title,
            url: pageUrl,
            image,
            description,
            type: episodes.length > 1 ? models_1.TvType.TVSERIES : models_1.TvType.MOVIE,
            releaseDate: this.extractYear(title),
            episodes: episodes.length
                ? episodes.map((episode) => ({
                    id: episode.id,
                    title: episode.title,
                    number: episode.number,
                    url: episode.url,
                }))
                : [{
                        id: this.mediaIdFromUrl(movieWatchUrl),
                        title: title || 'Movie',
                        number: 1,
                        url: movieWatchUrl,
                    }],
        };
    }
    async fetchEpisodeServers(episodeId) {
        return [{
                name: 'HDHub4U',
                url: this.mediaUrlFromId(episodeId),
            }];
    }
    async fetchEpisodeSources(episodeId, mediaId) {
        const startUrl = this.mediaUrlFromId(episodeId || mediaId || '');
        const resolved = await this.resolveToPlayer(startUrl, mediaId ? this.mediaUrlFromId(mediaId) : this.baseUrl);
        if (this.isRawVideoUrl(resolved.playerUrl)) {
            return {
                headers: {
                    ...(resolved.origin ? { Origin: resolved.origin } : {}),
                    Referer: resolved.referer,
                    'User-Agent': USER_AGENT,
                },
                sources: [{
                        url: resolved.playerUrl,
                        quality: this.qualityFromUrl(resolved.playerUrl),
                        isM3U8: /\.m3u8(?:[?#]|$)/i.test(resolved.playerUrl),
                    }],
                subtitles: [],
            };
        }
        const playerHtml = await this.get(resolved.playerUrl, resolved.referer);
        const parsed = this.extractRawSourceConfig(playerHtml, resolved.playerUrl);
        if (!parsed.sources.length) {
            throw new Error('HDHub4U: no raw playable streams found');
        }
        return {
            headers: {
                ...parsed.headers,
                ...(resolved.origin ? { Origin: resolved.origin } : {}),
                Referer: resolved.playerUrl,
                'User-Agent': USER_AGENT,
            },
            sources: parsed.sources,
            subtitles: parsed.subtitles,
        };
    }
    extractYear(title) {
        return String(title || '').match(/\b(19|20)\d{2}\b/)?.[0];
    }
    extractWatchLinks($, pageUrl) {
        const links = [];
        const contentRoot = $('.entry-content, .post-content, article, main').first();
        const root = (contentRoot.length ? contentRoot : $('body'));
        root.find('a[href]').each((_, el) => {
            const href = this.absoluteUrl($(el).attr('href') || '', pageUrl);
            const text = cleanText($(el).text()).toLowerCase();
            if (!href)
                return;
            if (this.isGateUrl(href) || /watch\s*online|download|480p|720p|1080p|2160p/i.test(text)) {
                links.push(href);
            }
        });
        return dedupe(links, (item) => item);
    }
    extractEpisodes($, pageUrl) {
        const links = this.extractWatchLinks($, pageUrl);
        const episodes = [];
        for (const href of links) {
            const label = cleanText($(`a[href="${href}"]`).first().text()) || href;
            if (!this.isGateUrl(href))
                continue;
            const episodeMatch = label.match(/(?:episode|ep)\s*(\d+)/i) || href.match(/(?:episode|ep)[-/]?(\d+)/i);
            if (!episodeMatch && !/episode|season|web[\s-]*series/i.test(label + href))
                continue;
            const number = Number(episodeMatch?.[1] || episodes.length + 1);
            episodes.push({
                id: this.mediaIdFromUrl(href),
                title: label || `Episode ${number}`,
                number,
                url: href,
            });
        }
        return dedupe(episodes, (item) => item.id).sort((a, b) => a.number - b.number);
    }
    extractCandidateUrls(html, baseUrl) {
        const urls = [];
        const $ = cheerio.load(html);
        $('a[href], iframe[src], source[src], video[src]').each((_, el) => {
            const raw = $(el).attr('href') || $(el).attr('src') || '';
            const absolute = this.absoluteUrl(raw, baseUrl);
            if (absolute)
                urls.push(absolute);
        });
        const patterns = [
            /https?:\\?\/\\?\/[^"'\\\s<>]+/gi,
            /(?:file|sources?|hls|playlist|url)\s*[:=]\s*["']([^"']+)["']/gi,
        ];
        for (const pattern of patterns) {
            for (const match of html.matchAll(pattern)) {
                const raw = parseMaybeJsonString(String(match[1] || match[0] || '').replace(/\\\//g, '/'));
                urls.push(this.absoluteUrl(raw, baseUrl));
            }
        }
        const decodedGate = this.extractEncodedGateUrl(html, baseUrl);
        if (decodedGate)
            urls.push(decodedGate);
        return dedupe(urls.filter((url) => /^https?:\/\//i.test(url)), (item) => item);
    }
    rot13(value) {
        return String(value || '').replace(/[a-zA-Z]/g, (char) => {
            const code = char.charCodeAt(0) + 13;
            const limit = char <= 'Z' ? 90 : 122;
            return String.fromCharCode(limit >= code ? code : code - 26);
        });
    }
    base64Decode(value) {
        return Buffer.from(String(value || ''), 'base64').toString('utf8');
    }
    extractEncodedGateUrl(html, baseUrl) {
        const token = html.match(/s\(['"]o['"]\s*,\s*['"]([^'"]+)['"]/i)?.[1];
        if (!token)
            return '';
        try {
            let payload = this.base64Decode(token);
            payload = this.base64Decode(payload);
            payload = this.rot13(payload);
            payload = this.base64Decode(payload);
            const parsed = JSON.parse(payload);
            const next = parsed?.o ? this.base64Decode(String(parsed.o)) : '';
            return next ? this.absoluteUrl(next, baseUrl) : '';
        }
        catch {
            return '';
        }
    }
    isStreamHost(url) {
        try {
            const host = new URL(url).hostname.toLowerCase();
            return STREAM_HOSTS.some((streamHost) => host === streamHost || host.endsWith(`.${streamHost}`));
        }
        catch {
            return false;
        }
    }
    isGateUrl(url) {
        try {
            const host = new URL(url).hostname.toLowerCase();
            return GATE_HOSTS.some((gateHost) => host === gateHost || host.endsWith(`.${gateHost}`));
        }
        catch {
            return false;
        }
    }
    isRawVideoUrl(url) {
        const raw = String(url || '');
        if (/\.(m3u8|mp4|mkv)(?:[?#]|$)/i.test(raw))
            return true;
        try {
            const host = new URL(raw).hostname.toLowerCase();
            return RAW_FILE_HOSTS.some((rawHost) => host === rawHost || host.endsWith(`.${rawHost}`));
        }
        catch {
            return false;
        }
    }
    async resolveToPlayer(startUrl, referer) {
        let currentUrl = startUrl;
        let currentReferer = referer;
        for (let i = 0; i < 6; i++) {
            if (this.isRawVideoUrl(currentUrl)) {
                return {
                    playerUrl: currentUrl,
                    referer: currentReferer,
                    origin: this.safeOrigin(currentReferer),
                };
            }
            if (/\/v\/[^/?#]+/i.test(currentUrl) && /hubstream/i.test(currentUrl)) {
                return {
                    playerUrl: currentUrl,
                    referer: currentReferer,
                    origin: this.safeOrigin(currentReferer),
                };
            }
            const html = await this.get(currentUrl, currentReferer);
            const candidates = this.extractCandidateUrls(html, currentUrl);
            const player = candidates.find((url) => this.isRawVideoUrl(url)) ||
                candidates.find((url) => /hubstream\.[^/]+\/v\//i.test(url)) ||
                candidates.find((url) => /hdstream4u\.[^/]+\/file\//i.test(url)) ||
                candidates.find((url) => this.isGateUrl(url)) ||
                candidates.find((url) => this.isStreamHost(url));
            if (!player || player === currentUrl)
                break;
            currentReferer = currentUrl;
            currentUrl = player;
        }
        return {
            playerUrl: currentUrl,
            referer: currentReferer,
            origin: this.safeOrigin(currentReferer),
        };
    }
    extractRawSourceConfig(html, playerUrl) {
        const sources = this.extractStreams(html, playerUrl);
        const subtitles = this.extractSubtitles(html, playerUrl);
        const headers = this.extractHeaders(html, playerUrl);
        return {
            sources,
            subtitles,
            headers,
        };
    }
    extractStreams(html, playerUrl) {
        const candidates = this.extractCandidateUrls(html, playerUrl);
        const streams = [];
        for (const url of candidates) {
            this.addRawSource(streams, url, undefined, playerUrl);
        }
        for (const script of this.extractScriptBodies(html)) {
            this.extractSourceArrays(script, playerUrl).forEach((source) => this.addRawSource(streams, source.url, source.quality, playerUrl));
            this.extractPlayerSetupFiles(script, playerUrl).forEach((source) => this.addRawSource(streams, source.url, source.quality, playerUrl));
        }
        return dedupe(streams, (item) => item.url);
    }
    addRawSource(streams, rawUrl, label, baseUrl = this.baseUrl) {
        const url = this.absoluteUrl(String(rawUrl || '').replace(/\\\//g, '/'), baseUrl);
        if (!this.isRawVideoUrl(url))
            return;
        streams.push({
            url,
            quality: this.cleanQualityLabel(label || this.qualityFromUrl(url)),
            isM3U8: /\.m3u8(?:[?#]|$)/i.test(url),
        });
    }
    extractScriptBodies(html) {
        const scripts = [];
        const $ = cheerio.load(html);
        $('script').each((_, el) => {
            const body = $(el).html();
            if (body)
                scripts.push(body);
        });
        scripts.push(html);
        return scripts;
    }
    extractSourceArrays(script, playerUrl) {
        const found = [];
        const arrayPatterns = [
            /sources\s*:\s*\[([\s\S]*?)]/gi,
            /"sources"\s*:\s*\[([\s\S]*?)]/gi,
            /source\s*:\s*\[([\s\S]*?)]/gi,
        ];
        for (const pattern of arrayPatterns) {
            for (const match of script.matchAll(pattern)) {
                const block = match[1] || '';
                for (const item of block.matchAll(/\{([\s\S]*?)}/g)) {
                    const objectBody = item[1] || '';
                    const file = this.extractObjectString(objectBody, 'file') ||
                        this.extractObjectString(objectBody, 'url') ||
                        this.extractObjectString(objectBody, 'src');
                    if (!file)
                        continue;
                    found.push({
                        url: this.absoluteUrl(file.replace(/\\\//g, '/'), playerUrl),
                        quality: this.extractObjectString(objectBody, 'label') ||
                            this.extractObjectString(objectBody, 'quality') ||
                            this.extractObjectString(objectBody, 'type'),
                    });
                }
            }
        }
        return found;
    }
    extractPlayerSetupFiles(script, playerUrl) {
        const found = [];
        const filePatterns = [
            /(?:window\.)?playerSetup\s*=\s*\{[\s\S]*?(?:file|url|src)\s*:\s*["']([^"']+)["'][\s\S]*?}/gi,
            /(?:file|url|src)\s*:\s*["']([^"']+\.(?:m3u8|mp4|mkv)(?:\?[^"']*)?)["']/gi,
            /["']file["']\s*:\s*["']([^"']+\.(?:m3u8|mp4|mkv)(?:\?[^"']*)?)["']/gi,
        ];
        for (const pattern of filePatterns) {
            for (const match of script.matchAll(pattern)) {
                found.push({
                    url: this.absoluteUrl(String(match[1] || '').replace(/\\\//g, '/'), playerUrl),
                });
            }
        }
        return found;
    }
    extractObjectString(objectBody, key) {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = objectBody.match(new RegExp(`["']?${escaped}["']?\\s*:\\s*["']([^"']+)["']`, 'i'));
        return match?.[1];
    }
    extractHeaders(html, playerUrl) {
        const headers = {};
        const origin = html.match(/(?:origin|Origin)\s*[:=]\s*["']([^"']+)["']/)?.[1] ||
            this.safeOrigin(playerUrl);
        const referer = html.match(/(?:referer|referrer|Referer)\s*[:=]\s*["']([^"']+)["']/)?.[1];
        if (origin)
            headers.Origin = origin;
        if (referer)
            headers.Referer = this.absoluteUrl(referer, playerUrl);
        return headers;
    }
    safeOrigin(url) {
        try {
            return new URL(url).origin;
        }
        catch {
            return undefined;
        }
    }
    qualityFromUrl(url) {
        const quality = String(url || '').match(/(?:^|[^\d])([1-9]\d{2,3})p(?:[^\d]|$)/i)?.[1];
        if (quality)
            return `${quality}p`;
        if (/master\.m3u8/i.test(url))
            return 'auto';
        if (/\.mkv(?:[?#]|$)/i.test(url))
            return 'mkv';
        return /\.m3u8/i.test(url) ? 'default' : 'default';
    }
    cleanQualityLabel(label) {
        const raw = cleanText(label);
        const quality = raw.match(/([1-9]\d{2,3})p/i)?.[1];
        if (quality)
            return `${quality}p`;
        if (/hindi/i.test(raw))
            return 'Hindi';
        if (/english/i.test(raw))
            return 'English';
        if (/auto|default|hls|m3u8/i.test(raw))
            return 'default';
        return raw || 'default';
    }
    extractSubtitles(html, playerUrl) {
        const subtitles = [];
        const add = (url, label = 'English') => {
            const absolute = this.absoluteUrl(url.replace(/\\\//g, '/'), playerUrl);
            if (!/\.(vtt|srt)(?:[?#]|$)/i.test(absolute))
                return;
            subtitles.push({ url: absolute, lang: this.cleanTrackLabel(label) });
        };
        for (const match of html.matchAll(/tracks?\s*:\s*\[([\s\S]*?)]/gi)) {
            const block = match[1];
            for (const track of block.matchAll(/\{([\s\S]*?)}/g)) {
                const file = track[1].match(/file\s*:\s*["']([^"']+)["']/i)?.[1];
                const label = track[1].match(/(?:label|kind|srclang)\s*:\s*["']([^"']+)["']/i)?.[1];
                if (file)
                    add(file, label || 'English');
            }
        }
        for (const match of html.matchAll(/["']([^"']+\.(?:vtt|srt)(?:\?[^"']*)?)["']/gi)) {
            add(match[1], 'English');
        }
        return dedupe(subtitles, (item) => `${item.lang}:${item.url}`);
    }
    cleanTrackLabel(label) {
        const raw = cleanText(label).toLowerCase();
        if (/hin|hindi/.test(raw))
            return 'Hindi';
        if (/eng|english/.test(raw))
            return 'English';
        if (/tam|tamil/.test(raw))
            return 'Tamil';
        if (/tel|telugu/.test(raw))
            return 'Telugu';
        if (/mal|malayalam/.test(raw))
            return 'Malayalam';
        if (/kan|kannada/.test(raw))
            return 'Kannada';
        return cleanText(label) || 'English';
    }
}
exports.HDHub4U = HDHub4U;
exports.default = HDHub4U;
