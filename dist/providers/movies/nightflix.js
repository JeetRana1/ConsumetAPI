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
exports.NightFlix = void 0;
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const models_1 = require("@consumet/extensions/dist/models");
const browserRuntimeExtractor_1 = require("../../utils/browserRuntimeExtractor");
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TMDB_API = process.env.TMDB_KEY || '9e7096a7575623aa30c66e9cc987e411';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';
const SERVERS = [
    {
        id: 1,
        name: 'Vidgod',
        rank: 3,
        movie: 'https://vidgod.net/movie/',
        tv: 'https://vidgod.net/tv/',
    },
    {
        id: 2,
        name: 'Vidin',
        rank: 4,
        movie: 'https://flix-production-2166.up.railway.app/player2/movie/',
        tv: 'https://flix-production-2166.up.railway.app/player2/tv/',
    },
    {
        id: 3,
        name: 'Vidme',
        rank: 1,
        movie: 'https://flix-production-2166.up.railway.app/player3/movie/',
        tv: 'https://flix-production-2166.up.railway.app/player3/tv/',
    },
    {
        id: 4,
        name: 'Vidru',
        rank: 2,
        movie: 'https://vaplayer.ru/embed/movie/',
        tv: 'https://vaplayer.ru/embed/tv/',
    },
];
const cleanText = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
const uniqBy = (items, keyFn) => {
    const seen = new Set();
    return items.filter((item) => {
        const key = keyFn(item);
        if (!key || seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
};
class NightFlix extends models_1.MovieParser {
    constructor() {
        super(...arguments);
        this.name = 'NightFlix';
        this.baseUrl = 'https://nightflix.to';
        this.classPath = 'MOVIES.NightFlix';
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
        this.streamHeaders = {
            Referer: `${this.baseUrl}/`,
            'User-Agent': USER_AGENT,
        };
    }
    async search(query, page = 1) {
        const search = cleanText(query);
        if (!search)
            return { currentPage: page, hasNextPage: false, results: [] };
        const response = await axios_1.default.get(`${TMDB_BASE}/search/multi`, {
            ...this.requestConfig,
            responseType: 'json',
            params: {
                api_key: TMDB_API,
                query: search,
                page,
                include_adult: false,
                language: 'en-US',
            },
            headers: {
                ...this.requestConfig.headers,
                Accept: 'application/json, text/plain, */*',
                Referer: `${this.baseUrl}/search?q=${encodeURIComponent(search)}`,
            },
        });
        const results = (Array.isArray(response.data?.results) ? response.data.results : [])
            .filter((item) => item?.media_type === 'movie' || item?.media_type === 'tv')
            .map((item) => {
            const type = item.media_type === 'tv' ? 'tv' : 'movie';
            const title = cleanText(item.title || item.name || item.original_title || item.original_name || '');
            if (!item.id || !title)
                return null;
            return {
                id: `${type}/${item.id}`,
                title,
                url: `${this.baseUrl}/${type}/${item.id}`,
                image: this.tmdbImage(item.poster_path),
                releaseDate: String(item.release_date || item.first_air_date || '').slice(0, 4) || undefined,
                type: type === 'tv' ? models_1.TvType.TVSERIES : models_1.TvType.MOVIE,
            };
        })
            .filter(Boolean);
        return {
            currentPage: page,
            hasNextPage: page < Number(response.data?.total_pages || page),
            results,
        };
    }
    async fetchMediaInfo(mediaId) {
        const parsed = this.parseMediaId(mediaId);
        const tmdb = await this.fetchTmdbInfo(parsed.type, parsed.tmdbId);
        const title = cleanText(tmdb.title || tmdb.name || tmdb.original_title || tmdb.original_name || parsed.tmdbId);
        if (parsed.type === 'movie') {
            return {
                id: `movie/${parsed.tmdbId}`,
                title,
                url: `${this.baseUrl}/movie/${parsed.tmdbId}`,
                image: this.tmdbImage(tmdb.poster_path),
                cover: this.tmdbImage(tmdb.backdrop_path, 'original'),
                description: cleanText(tmdb.overview || ''),
                rating: Number(tmdb.vote_average || 0),
                releaseDate: String(tmdb.release_date || '').slice(0, 4) || undefined,
                duration: tmdb.runtime ? `${tmdb.runtime} min` : undefined,
                genres: Array.isArray(tmdb.genres) ? tmdb.genres.map((genre) => genre.name).filter(Boolean) : [],
                type: models_1.TvType.MOVIE,
                episodes: [
                    {
                        id: this.buildEpisodeId({ type: 'movie', tmdbId: parsed.tmdbId }),
                        title,
                        number: 1,
                        url: `${this.baseUrl}/watch/movie/${parsed.tmdbId}`,
                        streamTokens: this.buildStreamTokens('movie', parsed.tmdbId),
                    },
                ],
            };
        }
        const seasons = (Array.isArray(tmdb.seasons) ? tmdb.seasons : [])
            .filter((season) => Number(season.season_number) > 0)
            .map((season) => ({
            season: Number(season.season_number),
            image: this.tmdbImage(season.poster_path),
            episodes: Array.from({ length: Number(season.episode_count || 0) }, (_, index) => {
                const episode = index + 1;
                return {
                    id: this.buildEpisodeId({ type: 'tv', tmdbId: parsed.tmdbId, season: Number(season.season_number), episode }),
                    title: `Episode ${episode}`,
                    number: episode,
                    season: Number(season.season_number),
                    url: `${this.baseUrl}/watch/tv/${parsed.tmdbId}?season=${season.season_number}&episode=${episode}`,
                    streamTokens: this.buildStreamTokens('tv', parsed.tmdbId, Number(season.season_number), episode),
                };
            }),
        }));
        const episodes = seasons.flatMap((season) => season.episodes);
        return {
            id: `tv/${parsed.tmdbId}`,
            title,
            url: `${this.baseUrl}/tv/${parsed.tmdbId}`,
            image: this.tmdbImage(tmdb.poster_path),
            cover: this.tmdbImage(tmdb.backdrop_path, 'original'),
            description: cleanText(tmdb.overview || ''),
            rating: Number(tmdb.vote_average || 0),
            releaseDate: String(tmdb.first_air_date || '').slice(0, 4) || undefined,
            genres: Array.isArray(tmdb.genres) ? tmdb.genres.map((genre) => genre.name).filter(Boolean) : [],
            type: models_1.TvType.TVSERIES,
            totalEpisodes: episodes.length || Number(tmdb.number_of_episodes || 0),
            seasons,
            episodes,
        };
    }
    async fetchEpisodeServers(episodeId) {
        const parsed = this.parseEpisodeId(episodeId);
        return SERVERS.map((server) => ({
            name: server.name,
            url: this.buildServerUrl(server, parsed),
        }));
    }
    async fetchEpisodeSources(episodeId, mediaId) {
        const parsed = this.parseEpisodeId(episodeId || mediaId || '');
        const settled = await Promise.all(SERVERS.map(async (server) => {
            try {
                const embedUrl = this.buildServerUrl(server, parsed);
                const resolved = await this.extractFromServer(server, embedUrl);
                return {
                    server,
                    embedUrl,
                    sources: resolved.sources,
                    subtitles: resolved.subtitles,
                };
            }
            catch {
                return {
                    server,
                    embedUrl: this.buildServerUrl(server, parsed),
                    sources: [],
                    subtitles: [],
                };
            }
        }));
        const ordered = settled.sort((a, b) => a.server.rank - b.server.rank);
        const sources = uniqBy(ordered.flatMap((result) => result.sources.map((source) => ({
            ...source,
            quality: source.quality || result.server.name,
        }))), (source) => source.url);
        if (!sources.length)
            throw new Error('NightFlix: no raw playable streams found');
        return {
            headers: this.streamHeaders,
            sources,
            subtitles: uniqBy(ordered.flatMap((result) => result.subtitles), (subtitle) => `${subtitle.lang}:${subtitle.url}`),
            embedURL: ordered.find((result) => result.sources.length)?.embedUrl,
        };
    }
    parseMediaId(mediaId) {
        const raw = String(mediaId || '').trim();
        const match = raw.match(/(?:nightflix\.to\/)?(?:watch\/)?(movie|tv)\/(\d+)/i);
        if (match)
            return { type: match[1].toLowerCase(), tmdbId: match[2] };
        if (/^\d+$/.test(raw))
            return { type: 'movie', tmdbId: raw };
        throw new Error('NightFlix: invalid TMDB media id');
    }
    parseEpisodeId(episodeId) {
        const raw = String(episodeId || '').trim();
        const json = this.parseJsonEpisodeId(raw);
        if (json)
            return json;
        const tvMatch = raw.match(/(?:nightflix:)?tv[/:](\d+)(?:[/:](\d+)[/:](\d+)|[?&]season=(\d+)[&]episode=(\d+))?/i);
        if (tvMatch) {
            return {
                type: 'tv',
                tmdbId: tvMatch[1],
                season: Number(tvMatch[2] || tvMatch[4] || 1),
                episode: Number(tvMatch[3] || tvMatch[5] || 1),
            };
        }
        const movieMatch = raw.match(/(?:nightflix:)?movie[/:](\d+)/i);
        if (movieMatch)
            return { type: 'movie', tmdbId: movieMatch[1] };
        if (/^\d+$/.test(raw))
            return { type: 'movie', tmdbId: raw };
        throw new Error('NightFlix: invalid episode id');
    }
    parseJsonEpisodeId(raw) {
        if (!raw.startsWith('{'))
            return undefined;
        try {
            const parsed = JSON.parse(raw);
            if ((parsed.type === 'movie' || parsed.type === 'tv') && parsed.tmdbId) {
                return {
                    type: parsed.type,
                    tmdbId: String(parsed.tmdbId),
                    season: parsed.season ? Number(parsed.season) : undefined,
                    episode: parsed.episode ? Number(parsed.episode) : undefined,
                };
            }
        }
        catch {
            return undefined;
        }
        return undefined;
    }
    buildEpisodeId(payload) {
        if (payload.type === 'movie')
            return `nightflix:movie/${payload.tmdbId}`;
        return `nightflix:tv/${payload.tmdbId}/${payload.season || 1}/${payload.episode || 1}`;
    }
    buildStreamTokens(type, tmdbId, season = 1, episode = 1) {
        const parsed = { type, tmdbId, season, episode };
        return Object.fromEntries(SERVERS.map((server) => [server.name, this.buildServerUrl(server, parsed)]));
    }
    buildServerUrl(server, payload) {
        const base = payload.type === 'movie' ? server.movie : server.tv;
        if (payload.type === 'movie')
            return `${base}${payload.tmdbId}`;
        return `${base}${payload.tmdbId}/${payload.season || 1}/${payload.episode || 1}`;
    }
    async fetchTmdbInfo(type, tmdbId) {
        const response = await axios_1.default.get(`${TMDB_BASE}/${type}/${tmdbId}`, {
            ...this.requestConfig,
            responseType: 'json',
            params: {
                api_key: TMDB_API,
                language: 'en-US',
                append_to_response: type === 'tv' ? 'credits,recommendations,similar' : 'credits,recommendations,similar',
            },
            headers: {
                ...this.requestConfig.headers,
                Accept: 'application/json, text/plain, */*',
                Referer: `${this.baseUrl}/${type}/${tmdbId}`,
            },
        });
        if (!response.data?.id)
            throw new Error(`NightFlix: ${type}/${tmdbId} not found`);
        return response.data;
    }
    async extractFromServer(server, embedUrl) {
        const visited = new Set();
        const sources = [];
        const subtitles = [];
        let currentUrl = embedUrl;
        for (let depth = 0; depth < 3; depth++) {
            if (visited.has(currentUrl))
                break;
            visited.add(currentUrl);
            if (this.isRawVideoUrl(currentUrl)) {
                sources.push(this.toVideo(currentUrl, server.name));
                break;
            }
            const html = await this.get(currentUrl, this.baseUrl);
            sources.push(...this.extractVideoUrls(html, currentUrl, server.name));
            subtitles.push(...this.extractSubtitles(html, currentUrl));
            if (sources.length)
                break;
            const nextEmbed = this.extractNestedEmbeds(html, currentUrl).find((url) => !visited.has(url));
            if (!nextEmbed)
                break;
            currentUrl = nextEmbed;
        }
        if (!sources.length) {
            const playback = await (0, browserRuntimeExtractor_1.extractPlaybackWithPlaywright)(embedUrl, this.baseUrl, 18000).catch(() => ({
                sources: [],
                subtitles: [],
            }));
            sources.push(...playback.sources.map((source) => ({
                url: source.url,
                quality: `${server.name} ${source.quality || 'auto'}`.trim(),
                isM3U8: source.isM3U8,
            })));
            subtitles.push(...playback.subtitles.map((subtitle) => ({
                url: subtitle.url,
                lang: subtitle.lang,
            })));
        }
        return {
            sources: uniqBy(sources, (source) => source.url),
            subtitles: uniqBy(subtitles, (subtitle) => `${subtitle.lang}:${subtitle.url}`),
        };
    }
    async get(url, referer = this.baseUrl) {
        const response = await axios_1.default.get(url, {
            ...this.requestConfig,
            responseType: 'text',
            headers: {
                ...this.requestConfig.headers,
                Referer: `${referer.replace(/\/+$/, '')}/`,
            },
        });
        return String(response.data || '');
    }
    extractVideoUrls(html, baseUrl, serverName) {
        const urls = this.extractCandidateUrls(html, baseUrl).filter((url) => this.isRawVideoUrl(url));
        return uniqBy(urls.map((url) => this.toVideo(url, serverName)), (source) => source.url);
    }
    extractNestedEmbeds(html, baseUrl) {
        const $ = cheerio.load(html);
        const urls = [];
        $('iframe[src], source[src], video[src], a[href]').each((_, el) => {
            urls.push(this.absoluteUrl($(el).attr('src') || $(el).attr('href') || '', baseUrl));
        });
        return uniqBy(urls.filter((url) => /^https?:\/\//i.test(url) && !this.isRawVideoUrl(url)), (url) => url);
    }
    extractCandidateUrls(html, baseUrl) {
        const normalized = this.decodeHtml(String(html || '').replace(/\\\//g, '/'));
        const urls = [];
        for (const match of normalized.matchAll(/https?:\/\/[^\s"'<>\\]+/gi)) {
            urls.push(this.cleanCandidateUrl(match[0]));
        }
        for (const match of normalized.matchAll(/(?:file|url|src|hls|source|playlist)\s*[:=]\s*["']([^"']+)["']/gi)) {
            urls.push(this.absoluteUrl(match[1], baseUrl));
        }
        try {
            const $ = cheerio.load(normalized);
            $('iframe[src], source[src], video[src], track[src], a[href]').each((_, el) => {
                urls.push(this.absoluteUrl($(el).attr('src') || $(el).attr('href') || '', baseUrl));
            });
        }
        catch {
            // Ignore malformed markup inside packed player scripts.
        }
        return uniqBy(urls
            .map((url) => this.cleanCandidateUrl(url))
            .filter((url) => /^https?:\/\//i.test(url)), (url) => url);
    }
    extractSubtitles(html, baseUrl) {
        const subtitles = [];
        const add = (url, lang = 'English') => {
            const absolute = this.cleanCandidateUrl(this.absoluteUrl(url.replace(/\\\//g, '/'), baseUrl));
            if (!/\.(vtt|srt)(?:[?#]|$)/i.test(absolute))
                return;
            subtitles.push({ url: absolute, lang: this.cleanTrackLabel(lang) });
        };
        const normalized = String(html || '').replace(/\\\//g, '/');
        for (const match of normalized.matchAll(/tracks?\s*:\s*\[([\s\S]*?)]/gi)) {
            for (const track of match[1].matchAll(/\{([\s\S]*?)}/g)) {
                const file = track[1].match(/(?:file|url|src)\s*:\s*["']([^"']+)["']/i)?.[1];
                const label = track[1].match(/(?:label|kind|srclang|lang)\s*:\s*["']([^"']+)["']/i)?.[1];
                if (file)
                    add(file, label || 'English');
            }
        }
        for (const match of normalized.matchAll(/["']([^"']+\.(?:vtt|srt)(?:\?[^"']*)?)["']/gi)) {
            add(match[1], 'English');
        }
        return uniqBy(subtitles, (subtitle) => `${subtitle.lang}:${subtitle.url}`);
    }
    toVideo(url, serverName) {
        return {
            url: this.cleanCandidateUrl(url),
            quality: `${serverName} ${this.qualityFromUrl(url)}`.trim(),
            isM3U8: /\.m3u8(?:[?#]|$)/i.test(url),
        };
    }
    isRawVideoUrl(url) {
        return /\.(m3u8|mp4)(?:[?#]|$)/i.test(String(url || ''));
    }
    qualityFromUrl(url) {
        const quality = String(url || '').match(/(?:^|[^\d])([1-9]\d{2,3})p(?:[^\d]|$)/i)?.[1];
        if (quality)
            return `${quality}p`;
        if (/master\.m3u8/i.test(url))
            return 'auto';
        return /\.m3u8/i.test(url) ? 'hls' : 'default';
    }
    cleanTrackLabel(label) {
        const raw = cleanText(label).toLowerCase();
        if (/hin|hindi/.test(raw))
            return 'Hindi';
        if (/eng|english|subtitle/.test(raw))
            return 'English';
        if (/spa|spanish/.test(raw))
            return 'Spanish';
        if (/fre|french/.test(raw))
            return 'French';
        return cleanText(label) || 'English';
    }
    tmdbImage(path, size = 'w500') {
        return path ? `${IMAGE_BASE}/${size}${path}` : undefined;
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
    cleanCandidateUrl(url) {
        return this.decodeHtml(String(url || ''))
            .replace(/\\u0026/g, '&')
            .replace(/[),.;\]}]+$/g, '')
            .trim();
    }
    decodeHtml(value) {
        return value
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#x27;/g, "'")
            .replace(/&#39;/g, "'");
    }
}
exports.NightFlix = NightFlix;
exports.default = NightFlix;
