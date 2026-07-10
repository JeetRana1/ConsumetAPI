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
exports.NetMirrorProvider = void 0;
const cheerio = __importStar(require("cheerio"));
const flixhqFetcher_1 = require("../../utils/flixhqFetcher");
const serviceUrls = {
    nf: { poster: 'poster', episode: 'epimg' }, // Netflix
    pv: { poster: 'pv', episode: 'pvepimg' }, // Prime Video
    hs: { poster: 'hs', episode: 'hsepimg' }, // Hotstar
    dp: { poster: 'hs', episode: 'hsepimg' }, // Disney+
};
const convertRuntimeToMinutes = (runtime) => {
    let totalMinutes = 0;
    const parts = runtime.split(' ');
    for (const part of parts) {
        if (part.endsWith('h')) {
            const hours = parseInt(part.replace('h', '')) || 0;
            totalMinutes += hours * 60;
        }
        else if (part.endsWith('m')) {
            const minutes = parseInt(part.replace('m', '')) || 0;
            totalMinutes += minutes;
        }
    }
    return totalMinutes;
};
class NetMirrorProvider {
    static async search(query, serviceType, page = 1) {
        try {
            const url = `${this.baseUrl}/mobile/${serviceType}/search.php?s=${encodeURIComponent(query)}&t=${this.getUnixTime()}`;
            const cookies = {
                't_hash_t': await this.getCookie(),
                'hd': 'on',
                'ott': serviceType,
            };
            const response = await (0, flixhqFetcher_1.fetcher)(url, false, 'netmirror', {
                headers: { ...this.headers, 'Referer': `${this.baseUrl}/home`, 'Cookie': this.buildCookieString(cookies) },
                timeout: 20000,
            });
            const responseText = String(response?.text || '{}');
            // Check if response is HTML (error page)
            if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
                throw new Error('NetMirror API returned HTML. Possible site issue or CloudFlare block');
            }
            const data = JSON.parse(responseText);
            return data.searchResult.map((result) => ({
                id: result.id,
                title: result.t,
                image: `https://imgcdn.kim/${serviceUrls[serviceType].poster}/v/${result.id}.jpg`,
                url: `/movies/netmirror-${serviceType}/info?id=${result.id}`,
            }));
        }
        catch (error) {
            throw new Error(`NetMirror search failed: ${error.message}`);
        }
    }
    static async getInfo(id, serviceType) {
        try {
            const url = `${this.baseUrl}/mobile/${serviceType}/post.php?id=${id}&t=${this.getUnixTime()}`;
            const cookies = {
                't_hash_t': await this.getCookie(),
                'hd': 'on',
                'ott': serviceType,
            };
            const response = await (0, flixhqFetcher_1.fetcher)(url, false, 'netmirror', {
                headers: { ...this.headers, 'Referer': `${this.baseUrl}/home`, 'Cookie': this.buildCookieString(cookies) },
                timeout: 20000,
            });
            const responseText = String(response?.text || '{}');
            // Check if response is HTML (error page)
            if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
                throw new Error('NetMirror API returned HTML. Possible site issue or CloudFlare block');
            }
            const data = JSON.parse(responseText);
            const episodes = [];
            const title = data.title;
            const cast = data.cast?.split(',').map((c) => c.trim()) || [];
            const genres = data.genre?.split(',').map((g) => g.trim()).filter((g) => g) || [];
            const rating = data.match?.replace('IMDb ', '') || '';
            const runtime = data.runtime ? convertRuntimeToMinutes(data.runtime) : 0;
            if (data.episodes && data.episodes.length > 0 && data.episodes[0]) {
                // It's a TV series
                data.episodes.forEach((ep) => {
                    if (ep) {
                        episodes.push({
                            id: ep.id,
                            title: ep.t,
                            episode: parseInt(ep.ep.replace('E', '')),
                            season: parseInt(ep.s.replace('S', '')),
                            duration: parseInt(ep.time.replace('m', '')),
                        });
                    }
                });
                if (data.nextPageShow === 1 && data.nextPageSeason) {
                    // Load more episodes
                    // This would require additional logic to fetch paginated episodes
                }
                if (data.season) {
                    // Load all seasons
                    data.season.slice(0, -1).forEach((season) => {
                        // Load episodes for this season
                    });
                }
            }
            const type = !data.episodes || !data.episodes[0] ? 'movie' : 'tv';
            return {
                id,
                title,
                type,
                image: `https://imgcdn.kim/${serviceUrls[serviceType].poster}/v/${id}.jpg`,
                background: `https://imgcdn.kim/${serviceUrls[serviceType].poster}/h/${id}.jpg`,
                description: data.desc || '',
                year: data.year,
                rating: parseFloat(rating) || 0,
                genres,
                cast,
                duration: runtime,
                contentRating: data.ua || '',
                episodes: episodes.length > 0 ? episodes : undefined,
                url: `/movies/netmirror-${serviceType}/info?id=${id}`,
            };
        }
        catch (error) {
            throw new Error(`NetMirror getInfo failed: ${error.message}`);
        }
    }
    static async getSources(id, serviceType, title) {
        try {
            const playlistUrl = `${this.baseUrl}/mobile/${serviceType}/playlist.php?id=${id}&t=${title || 'default'}&tm=${this.getUnixTime()}`;
            const cookies = {
                't_hash_t': await this.getCookie(),
                'hd': 'on',
                'ott': serviceType,
            };
            const response = await (0, flixhqFetcher_1.fetcher)(playlistUrl, false, 'netmirror', {
                headers: { ...this.headers, 'Referer': `${this.baseUrl}/home`, 'Cookie': this.buildCookieString(cookies) },
                timeout: 20000,
            });
            const responseText = String(response?.text || '[]');
            // Check if response is HTML (error page)
            if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
                throw new Error('NetMirror API returned HTML. Possible site issue or CloudFlare block');
            }
            let playlist = [];
            try {
                playlist = JSON.parse(responseText);
            }
            catch {
                // If parsing fails, try as array
                playlist = [];
            }
            if (!Array.isArray(playlist)) {
                playlist = [];
            }
            const sources = [];
            const subtitles = [];
            for (const item of playlist) {
                if (!item.sources || !Array.isArray(item.sources))
                    continue;
                for (const source of item.sources) {
                    if (!source.file)
                        continue;
                    sources.push({
                        url: source.file.startsWith('http') ? source.file : `${this.baseUrl}/${source.file}`,
                        quality: source.label || 'auto',
                        type: 'hls',
                        isM3U8: true,
                        headers: {
                            'Referer': `${this.baseUrl}/home`,
                            'User-Agent': this.headers['User-Agent'],
                            'Cookie': 'hd=on',
                        },
                    });
                }
                if (item.tracks && Array.isArray(item.tracks)) {
                    for (const track of item.tracks) {
                        if (track.kind === 'captions' && track.file) {
                            subtitles.push({
                                lang: track.label || 'Unknown',
                                url: this.ensureHttps(track.file),
                            });
                        }
                    }
                }
            }
            return {
                sources: sources.length > 0 ? sources : [],
                subtitles: subtitles,
                headers: {
                    'Referer': `${this.baseUrl}/home`,
                    'User-Agent': this.headers['User-Agent'],
                },
            };
        }
        catch (error) {
            throw new Error(`NetMirror getSources failed: ${error.message}`);
        }
    }
    static async getRecent(serviceType, page = 1) {
        try {
            const url = `${this.baseUrl}/mobile/home?app=1`;
            const cookies = {
                't_hash_t': await this.getCookie(),
                'hd': 'on',
                'ott': serviceType,
            };
            const response = await (0, flixhqFetcher_1.fetcher)(url, false, 'netmirror', {
                headers: { ...this.headers, 'Referer': `${this.baseUrl}/mobile/home?app=1`, 'Cookie': this.buildCookieString(cookies) },
                timeout: 20000,
            });
            const html = String(response?.text || '');
            const $ = cheerio.load(html);
            const results = [];
            $('article, .top10-post').each((_, el) => {
                const $el = $(el);
                const href = $el.find('a').attr('href');
                const title = $el.find('h2, h3, .title').text().trim();
                const image = $el.find('img').attr('src') || $el.find('img').attr('data-src');
                if (href && title) {
                    const match = href.match(/\/(?:movie|series)\/([^\/]+)/);
                    const id = match ? match[1] : '';
                    results.push({
                        id,
                        title,
                        image: this.ensureHttps(image),
                        url: `/movies/netmirror-${serviceType}/info?id=${id}`,
                    });
                }
            });
            return {
                results,
                hasNextPage: results.length > 0,
            };
        }
        catch (error) {
            throw new Error(`NetMirror getRecent failed: ${error.message}`);
        }
    }
    static async getCookie() {
        // Return cached cookie if still valid
        if (this.cookieValue && Date.now() - this.lastCookieTime < this.COOKIE_EXPIRY) {
            return this.cookieValue;
        }
        try {
            // Try to get cookie from home page
            const response = await (0, flixhqFetcher_1.fetcher)(`${this.baseUrl}/home`, false, 'netmirror', {
                headers: { ...this.headers, 'Referer': `${this.baseUrl}/` },
                timeout: 20000,
            });
            const text = String(response?.text || '');
            // Try to extract cookie from response
            const cookieMatch = text.match(/t_hash_t=([^;]+)/);
            if (cookieMatch) {
                this.cookieValue = cookieMatch[1];
                this.lastCookieTime = Date.now();
                return this.cookieValue;
            }
        }
        catch (error) {
            // Continue to fallback
        }
        try {
            // Try alternate URL
            const response = await (0, flixhqFetcher_1.fetcher)(`${this.alternateUrl}/home`, false, 'netmirror', {
                headers: { ...this.headers, 'Referer': `${this.alternateUrl}/` },
                timeout: 20000,
            });
            const text = String(response?.text || '');
            const cookieMatch = text.match(/t_hash_t=([^;]+)/);
            if (cookieMatch) {
                this.cookieValue = cookieMatch[1];
                this.lastCookieTime = Date.now();
                return this.cookieValue;
            }
        }
        catch (error) {
            // Continue to fallback
        }
        // Return cached value if available, or use default
        if (this.cookieValue) {
            return this.cookieValue;
        }
        // Use a generated token as fallback
        this.cookieValue = `bypass_${Math.random().toString(36).substring(2, 15)}`;
        this.lastCookieTime = Date.now();
        return this.cookieValue;
    }
    static buildCookieString(cookies) {
        return Object.entries(cookies)
            .map(([key, value]) => `${key}=${value}`)
            .join('; ');
    }
    static ensureHttps(url) {
        if (!url)
            return '';
        if (url.startsWith('//'))
            return `https:${url}`;
        if (url.startsWith('http'))
            return url;
        return `${this.baseUrl}/${url}`;
    }
}
exports.NetMirrorProvider = NetMirrorProvider;
NetMirrorProvider.baseUrl = 'https://net52.cc';
NetMirrorProvider.alternateUrl = 'https://net22.cc';
NetMirrorProvider.cookieValue = '';
NetMirrorProvider.lastCookieTime = 0;
NetMirrorProvider.COOKIE_EXPIRY = 14 * 60 * 60 * 1000; // 14 hours in milliseconds
NetMirrorProvider.headers = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
    'Cache-Control': 'max-age=0',
    'Connection': 'keep-alive',
    'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="144", "Android WebView";v="144"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Android"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Safari/537.36',
    'X-Requested-With': 'XMLHttpRequest',
};
NetMirrorProvider.getUnixTime = () => Math.floor(Date.now() / 1000);
