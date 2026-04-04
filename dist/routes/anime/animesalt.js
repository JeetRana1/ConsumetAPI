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
const cheerio = __importStar(require("cheerio"));
const outboundProxy_1 = require("../../utils/outboundProxy");
const cache_1 = __importDefault(require("../../utils/cache"));
const main_1 = require("../../main");
const anilist_1 = __importDefault(require("@consumet/extensions/dist/providers/meta/anilist"));
const BASE_URL = 'https://animesalt.ac';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const routes = async (fastify, options) => {
    // ─── Search ──────────────────────────────────────────────────────────────────
    fastify.get('/:query', async (request, reply) => {
        const query = request.params.query;
        const requestedTypeRaw = String(request.query.type || '').toLowerCase();
        const requestedType = requestedTypeRaw === 'movie'
            ? 'movie'
            : requestedTypeRaw === 'tv' || requestedTypeRaw === 'series'
                ? 'tv'
                : '';
        try {
            const fetchSearch = async () => {
                const res = await (0, outboundProxy_1.proxyGet)(`${BASE_URL}/?s=${encodeURIComponent(query)}`, {
                    headers: { 'User-Agent': UA }
                });
                const $ = cheerio.load(res.data);
                const results = [];
                $('article.movies').each((_, el) => {
                    const title = $(el).find('h2').text().trim();
                    const url = $(el).find('a.lnk-blk').attr('href');
                    const image = $(el).find('img').attr('data-src') || $(el).find('img').attr('src');
                    let id = '';
                    let mediaType = '';
                    if (url?.includes('/series/')) {
                        id = url.split('/series/')[1].split('/')[0];
                        mediaType = 'tv';
                    }
                    else if (url?.includes('/movies/')) {
                        id = 'movie:' + url.split('/movies/')[1].split('/')[0];
                        mediaType = 'movie';
                    }
                    if (id && mediaType) {
                        if (requestedType && mediaType !== requestedType)
                            return;
                        results.push({
                            id,
                            title,
                            type: mediaType,
                            url,
                            image: image?.startsWith('//') ? `https:${image}` : image
                        });
                    }
                });
                // Add AniList IDs in parallel
                const anilistPromises = results.map(async (result) => {
                    try {
                        const anilistId = main_1.redis ? await cache_1.default.fetch(main_1.redis, `anilist:title:${result.title}`, async () => {
                            const anilist = new anilist_1.default();
                            const searchRes = await anilist.search(result.title, 1, 1);
                            return searchRes.results[0]?.id || null;
                        }, main_1.REDIS_TTL) : null;
                        if (anilistId)
                            result.anilistId = anilistId;
                    }
                    catch (e) {
                        console.error('Failed to get AniList ID for', result.title, e.message);
                    }
                });
                await Promise.all(anilistPromises);
                return results;
            };
            const cacheType = requestedType || 'all';
            const results = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `animesalt:search:${query}:${cacheType}`, fetchSearch, main_1.REDIS_TTL)
                : await fetchSearch();
            reply.status(200).send(results);
        }
        catch (err) {
            reply.status(500).send({ message: 'Error searching AnimeSalt', error: err.message });
        }
    });
    // ─── Info ─────────────────────────────────────────────────────────────────────
    fastify.get('/info', async (request, reply) => {
        const id = request.query.id;
        try {
            const fetchInfo = async () => {
                const isMovie = id.startsWith('movie:');
                const slug = isMovie ? id.replace('movie:', '') : id;
                const type = isMovie ? 'movies' : 'series';
                const res = await (0, outboundProxy_1.proxyGet)(`${BASE_URL}/${type}/${slug}/`, {
                    headers: { 'User-Agent': UA }
                });
                const $ = cheerio.load(res.data);
                const title = $('h1').first().text().trim();
                const description = $('.wp-content p').first().text().trim() || $('.description p').first().text().trim();
                const image = $('.poster img').attr('src') || $('.poster img').attr('data-src');
                const genres = [];
                $('.category a').each((_, el) => {
                    const genre = $(el).text().trim();
                    if (genre && !genres.includes(genre)) {
                        genres.push(genre);
                    }
                });
                const episodes = [];
                const seasonsMap = new Map();
                const seasonTabCounts = new Map();
                const parseSeasonEpisode = (value) => {
                    const match = String(value || '').match(/(?:^|\D)(\d+)\s*x\s*(\d+)(?:\D|$)/i);
                    if (!match)
                        return { season: 1, episode: 0 };
                    return {
                        season: Number(match[1]) || 1,
                        episode: Number(match[2]) || 0,
                    };
                };
                // AnimeSalt renders season tabs like "Season 2 • 1-23 (23)".
                // Parse these counts so we can expose all seasons even when the page only
                // renders one season's episode cards server-side.
                $('a[href="javascript:void(0)"]').each((_, el) => {
                    const label = $(el).text().replace(/\s+/g, ' ').trim();
                    const m = label.match(/Season\s*(\d+)\s*[•\-–]?\s*(?:\d+\s*[-–]\s*)?(\d+)\s*\((\d+)\)/i);
                    if (!m)
                        return;
                    const seasonNo = Number(m[1]);
                    const rangeEnd = Number(m[2]);
                    const totalInParens = Number(m[3]);
                    const total = Number.isFinite(totalInParens) && totalInParens > 0
                        ? totalInParens
                        : rangeEnd;
                    if (Number.isFinite(seasonNo) && seasonNo > 0 && Number.isFinite(total) && total > 0) {
                        seasonTabCounts.set(seasonNo, total);
                    }
                });
                $('article.episodes').each((_, el) => {
                    const epUrl = $(el).find('a.lnk-blk').attr('href');
                    const epId = epUrl?.split('/episode/')[1]?.replace(/\/$/, '');
                    const epTitle = $(el).find('.entry-title').text().trim();
                    const epNumStr = $(el).find('.num-epi').text().trim();
                    const parsedFromId = parseSeasonEpisode(epId || '');
                    const parsedFromTitle = parseSeasonEpisode(epTitle || '');
                    // Robust numeric extraction for episode numbers (e.g., "Season 1 Ep 25" -> 25)
                    const numMatch = epNumStr.match(/(\d+)/);
                    const epNumber = numMatch ? parseInt(numMatch[1]) : 0;
                    const seasonNumber = parsedFromId.season || parsedFromTitle.season || 1;
                    const episodeNumber = parsedFromId.episode || epNumber || parsedFromTitle.episode || 0;
                    if (epId) {
                        const episodeEntry = {
                            id: epId,
                            title: epTitle,
                            number: episodeNumber,
                            season: seasonNumber,
                            seasonNo: seasonNumber,
                            seasonNumber,
                            url: epUrl,
                        };
                        episodes.push(episodeEntry);
                        if (!seasonsMap.has(seasonNumber)) {
                            seasonsMap.set(seasonNumber, {
                                season: seasonNumber,
                                seasonNo: seasonNumber,
                                seasonNumber,
                                name: `Season ${seasonNumber}`,
                                episodes: [],
                            });
                        }
                        seasonsMap.get(seasonNumber).episodes.push(episodeEntry);
                    }
                });
                // If AnimeSalt only rendered one season in server HTML, synthesize missing
                // season episodes from tab counts using deterministic IDs (slug-SxE).
                // This ensures clients can list/select every season/episode.
                if (!isMovie && seasonTabCounts.size > 0) {
                    for (const [seasonNo, count] of seasonTabCounts.entries()) {
                        if (!seasonsMap.has(seasonNo)) {
                            seasonsMap.set(seasonNo, {
                                season: seasonNo,
                                seasonNo,
                                seasonNumber: seasonNo,
                                name: `Season ${seasonNo}`,
                                episodes: [],
                            });
                        }
                        const bucket = seasonsMap.get(seasonNo);
                        const existingIds = new Set((Array.isArray(bucket?.episodes) ? bucket.episodes : [])
                            .map((ep) => String(ep?.id || '').trim().toLowerCase())
                            .filter(Boolean));
                        for (let epNo = 1; epNo <= count; epNo += 1) {
                            const syntheticId = `${slug}-${seasonNo}x${epNo}`.toLowerCase();
                            if (existingIds.has(syntheticId))
                                continue;
                            const entry = {
                                id: `${slug}-${seasonNo}x${epNo}`,
                                title: `Episode ${epNo}`,
                                number: epNo,
                                season: seasonNo,
                                seasonNo,
                                seasonNumber: seasonNo,
                                url: `${BASE_URL}/episode/${slug}-${seasonNo}x${epNo}/`,
                            };
                            episodes.push(entry);
                            bucket.episodes.push(entry);
                        }
                    }
                }
                // Best-effort title hydration for placeholder entries.
                // AnimeSalt often renders only one season server-side; when we synthesize
                // missing seasons, we can still fetch each episode page to extract real titles.
                const parseEpisodePageTitle = (html, fallbackTitle) => {
                    const $$ = cheerio.load(html || '');
                    const candidates = [
                        $$('meta[property="og:title"]').attr('content') || '',
                        $$('meta[name="twitter:title"]').attr('content') || '',
                        $$('.entry-title').first().text().trim() || '',
                        $$('h1').first().text().trim() || '',
                        $$('h2').first().text().trim() || '',
                    ]
                        .map((v) => String(v || '').replace(/\s+/g, ' ').trim())
                        .filter(Boolean);
                    for (const raw of candidates) {
                        let cleaned = raw
                            .replace(/\s*[-|]\s*Anime\s*Salt\s*$/i, '')
                            .replace(/\s*\|\s*Anime\s*Salt\s*$/i, '')
                            .replace(/\s+/g, ' ')
                            .trim();
                        if (!cleaned)
                            continue;
                        if (/^episode\s*\d+$/i.test(cleaned))
                            continue;
                        if (/^watching:/i.test(cleaned))
                            continue;
                        return cleaned;
                    }
                    return fallbackTitle;
                };
                const needsHydration = episodes
                    .filter((ep) => {
                    const title = String(ep?.title || '').trim();
                    return !title || /^episode\s*\d+$/i.test(title);
                })
                    .filter((ep) => String(ep?.url || '').startsWith(BASE_URL))
                    // Hard cap to avoid overloading upstream in one request.
                    .slice(0, 160);
                if (needsHydration.length > 0) {
                    const concurrency = 8;
                    const workers = Array.from({ length: Math.min(concurrency, needsHydration.length) }, () => (async () => {
                        while (needsHydration.length > 0) {
                            const ep = needsHydration.shift();
                            if (!ep?.url)
                                continue;
                            try {
                                const epRes = await (0, outboundProxy_1.proxyGet)(ep.url, {
                                    headers: { 'User-Agent': UA, 'Referer': `${BASE_URL}/series/${slug}/` }
                                });
                                ep.title = parseEpisodePageTitle(String(epRes?.data || ''), String(ep.title || '').trim() || `Episode ${ep.number || 0}`);
                            }
                            catch (_e) {
                                // Keep fallback title if per-episode fetch fails.
                            }
                        }
                    })());
                    await Promise.allSettled(workers);
                }
                // For movies: if no episodes found in the dedicated episodes list,
                // treat the movie page itself as the single episode.
                if (isMovie && episodes.length === 0) {
                    episodes.push({
                        id: id, // e.g. "movie:jujutsu-kaisen-0"
                        title: title,
                        number: 1,
                        url: `${BASE_URL}/movies/${slug}/`
                    });
                }
                // Sort episodes by season, then episode, to preserve AnimeSalt's season mapping.
                episodes.sort((a, b) => {
                    const seasonDiff = Number(a.season || a.seasonNo || a.seasonNumber || 0) - Number(b.season || b.seasonNo || b.seasonNumber || 0);
                    if (seasonDiff !== 0)
                        return seasonDiff;
                    return Number(a.number || 0) - Number(b.number || 0);
                });
                const seasons = Array.from(seasonsMap.values())
                    .map((season) => ({
                    ...season,
                    episodes: Array.isArray(season.episodes)
                        ? season.episodes.sort((a, b) => Number(a.number || 0) - Number(b.number || 0))
                        : [],
                }))
                    .sort((a, b) => Number(a.season || a.seasonNo || 0) - Number(b.season || b.seasonNo || 0));
                // Add AniList ID
                let anilistId = null;
                try {
                    anilistId = main_1.redis ? await cache_1.default.fetch(main_1.redis, `anilist:title:${title}`, async () => {
                        const anilist = new anilist_1.default();
                        const searchRes = await anilist.search(title, 1, 1);
                        return searchRes.results[0]?.id || null;
                    }, main_1.REDIS_TTL) : null;
                }
                catch (e) {
                    console.error('Failed to get AniList ID for', title, e.message);
                }
                return {
                    id,
                    title,
                    description,
                    image: image?.startsWith('//') ? `https:${image}` : image,
                    genres,
                    seasons,
                    episodes,
                    anilistId
                };
            };
            const info = main_1.redis
                ? await cache_1.default.fetch(main_1.redis, `animesalt:info:${id}:v4`, fetchInfo, main_1.REDIS_TTL)
                : await fetchInfo();
            reply.status(200).send(info);
        }
        catch (err) {
            reply.status(500).send({ message: 'Error fetching info from AnimeSalt', error: err.message });
        }
    });
    // ─── Watch ────────────────────────────────────────────────────────────────────
    fastify.get('/watch/:episodeId', async (request, reply) => {
        const episodeId = request.params.episodeId;
        try {
            const isMovie = episodeId.startsWith('movie:');
            const slug = isMovie ? episodeId.replace('movie:', '') : episodeId;
            const watchUrl = isMovie
                ? `${BASE_URL}/movies/${slug}/`
                : `${BASE_URL}/episode/${episodeId}/`;
            const res = await (0, outboundProxy_1.proxyGet)(watchUrl, {
                headers: { 'User-Agent': UA }
            });
            const $ = cheerio.load(res.data);
            const sources = [];
            const subtitles = [];
            // ── Server 1 (as-cdn21.top) ──────────────────────────────────────────
            const iframe1 = $('#options-0 iframe').attr('data-src') || $('#options-0 iframe').attr('src');
            if (iframe1) {
                try {
                    const embedUrl = new URL(iframe1);
                    // More robust videoId extraction (handles trailing slashes)
                    const videoId = embedUrl.pathname.split('/').filter(p => !!p && p !== 'v').pop();
                    const origin = embedUrl.origin;
                    // Step 1 – load the player page to obtain session cookies
                    const pageRes = await (0, outboundProxy_1.proxyGet)(iframe1, {
                        headers: { 'User-Agent': UA, 'Referer': BASE_URL }
                    });
                    const cookies = pageRes.headers['set-cookie']
                        ?.map((c) => c.split(';')[0])
                        .join('; ') || '';
                    const subMatch = pageRes.data.match(/var\s+playerjsSubtitle\s*=\s*(["'])(.+?)\1/);
                    if (subMatch) {
                        const rawSubtitleStr = subMatch[2];
                        const parts = rawSubtitleStr.split(',');
                        for (const part of parts) {
                            const langMatch = part.match(/^\[(.*?)\](.*)$/);
                            if (langMatch) {
                                subtitles.push({
                                    lang: langMatch[1],
                                    url: langMatch[2],
                                    referer: iframe1
                                });
                            }
                        }
                    }
                    // Step 2 – POST to getVideo API for the signed m3u8 URL
                    const apiRes = await (0, outboundProxy_1.proxyPost)(`${origin}/player/index.php?data=${videoId}&do=getVideo`, `hash=${videoId}&r=${encodeURIComponent(BASE_URL)}`, {
                        headers: {
                            'User-Agent': UA,
                            'Referer': iframe1,
                            'X-Requested-With': 'XMLHttpRequest',
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Cookie': cookies
                        }
                    });
                    if (apiRes.data?.videoSource) {
                        // Return the raw signed m3u8 URL with the iframe as referer.
                        // The player's proxiedStreamUrl() wraps it in /utils/proxy,
                        // and the proxy's m3u8 rewriter rewrites all segment URLs.
                        sources.push({
                            url: String(apiRes.data.videoSource),
                            isM3U8: true,
                            quality: 'Default',
                            referer: iframe1
                        });
                    }
                    else {
                        // Fallback: return the iframe itself
                        sources.push({
                            url: iframe1,
                            isIframe: true,
                            quality: 'Server 1 (Iframe)'
                        });
                    }
                }
                catch (_e) {
                    sources.push({
                        url: iframe1,
                        isIframe: true,
                        quality: 'Server 1 (Iframe)'
                    });
                }
            }
            reply.status(200).send({
                headers: { Referer: BASE_URL },
                sources,
                subtitles
            });
        }
        catch (err) {
            reply.status(500).send({ message: 'Error fetching sources from AnimeSalt', error: err.message });
        }
    });
};
exports.default = routes;
