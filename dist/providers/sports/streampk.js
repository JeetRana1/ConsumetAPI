"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamPk = void 0;
const models_1 = require("@consumet/extensions/dist/models");
const extensions_1 = require("@consumet/extensions");
const KNOWN_DOMAINS = ['https://streampk.org'];
class StreamPk extends models_1.MovieParser {
    constructor() {
        super(...arguments);
        this.name = 'StreamPk';
        this.logo = '';
        this.classPath = 'SPORTS.StreamPk';
        this.supportedTypes = new Set([extensions_1.TvType.MOVIE, extensions_1.TvType.TVSERIES]);
        this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
        this.categoryToPath = {
            soccer: '/soccer', nba: '/nba', nfl: '/nfl',
            mma: '/ufc', boxing: '/ufc', fighting: '/ufc',
            f1: '/f1', nhl: '/nhl', mlb: '/mlb',
            ncaa: '/football', wnba: '/nba',
        };
        this.fixtureKeyToUrlPath = {
            football: 'soccer', basketball: 'nba', 'american-football': 'nfl',
            ufc: 'ufc', 'formula-1': 'f1', baseball: 'mlb', hockey: 'nhl',
        };
        this.fixtureKeyToCategory = {
            football: 'soccer', basketball: 'nba', 'american-football': 'nfl',
            ufc: 'mma', 'formula-1': 'f1', baseball: 'mlb', hockey: 'nhl',
        };
    }
    get baseUrl() { return KNOWN_DOMAINS[0]; }
    extractRscString(html) {
        let combined = '';
        const re = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            combined += m[1].replace(/\\([\\"])/g, '$1');
        }
        return combined;
    }
    extractStreamLinks(html) {
        const combined = this.extractRscString(html);
        const startRe = /"matchData"\s*:\s*(\{)/;
        const m = startRe.exec(combined);
        if (!m)
            return [];
        try {
            const start = m.index + m[0].length - 1;
            let depth = 1, i = start;
            while (depth > 0 && i < combined.length - 1) {
                i++;
                if (combined[i] === '{')
                    depth++;
                else if (combined[i] === '}')
                    depth--;
            }
            if (depth !== 0)
                return [];
            const matchData = JSON.parse(combined.substring(start, i + 1));
            if (matchData.streamLinks && Array.isArray(matchData.streamLinks)) {
                return matchData.streamLinks
                    .filter((s) => s.isActive !== false && s.link)
                    .map((s, i) => ({
                    name: s.streamer || s.playerName || `Player ${i + 1}`,
                    url: String(s.link).trim(),
                    streamer: s.streamer || '',
                }));
            }
        }
        catch { }
        return [];
    }
    extractMatchItems(html) {
        const combined = this.extractRscString(html);
        const items = [];
        const startRe = /"matchItem":\s*(\{)/g;
        let m;
        while ((m = startRe.exec(combined)) !== null) {
            try {
                const start = m.index + m[0].length - 1;
                let depth = 1, i = start;
                while (depth > 0 && i < combined.length - 1) {
                    i++;
                    if (combined[i] === '{')
                        depth++;
                    else if (combined[i] === '}')
                        depth--;
                }
                if (depth !== 0)
                    continue;
                const obj = JSON.parse(combined.substring(start, i + 1));
                if (!obj.matchSlug || !obj.teamA)
                    continue;
                const after = combined.substring(i + 1);
                const fkMatch = after.match(/"fixtureLinkKey"\s*:\s*"([^"]+)"/);
                const fixtureKey = fkMatch ? fkMatch[1] : 'soccer';
                items.push({
                    id: obj._id || obj.matchSlug,
                    title: `${obj.teamA} vs ${obj.teamB}`,
                    url: `${this.baseUrl}/${this.fixtureKeyToUrlPath[fixtureKey] || fixtureKey}/${obj.matchSlug}`,
                    isLive: obj.isLive === true,
                    isEnded: obj.isEnded === true,
                    matchDate: obj.matchDate,
                    teamA: obj.teamA,
                    teamB: obj.teamB,
                    category: this.fixtureKeyToCategory[fixtureKey] || fixtureKey,
                    sectionTitle: obj.pageTitle || fixtureKey,
                });
            }
            catch { }
        }
        return items;
    }
    async search(query, _options) {
        try {
            const q = String(query || '').trim().toLowerCase();
            const path = (!q || q === 'all' || q === '') ? '' : (this.categoryToPath[q] || `/${q}`);
            const pageUrl = `${this.baseUrl}${path}`;
            const resp = await fetch(pageUrl, {
                headers: { 'User-Agent': this.userAgent, Referer: this.baseUrl, Origin: this.baseUrl },
                signal: AbortSignal.timeout(15000),
            });
            if (!resp.ok)
                return [];
            const html = await resp.text();
            return this.extractMatchItems(html);
        }
        catch {
            return [];
        }
    }
    async fetchMediaInfo(id) {
        try {
            const resp = await fetch(id, {
                headers: { 'User-Agent': this.userAgent, Referer: id, Origin: this.baseUrl },
                signal: AbortSignal.timeout(15000),
            });
            if (!resp.ok)
                return null;
            const html = await resp.text();
            const links = this.extractStreamLinks(html);
            const sources = links.map(l => ({
                url: l.url,
                name: l.name,
                isM3U8: false,
                isDirect: false,
                headers: { 'User-Agent': this.userAgent, Referer: id, Origin: this.baseUrl },
            }));
            return {
                sources,
                subtitles: [],
                embedUrl: sources[0]?.url || '',
            };
        }
        catch {
            return null;
        }
    }
    async fetchEpisodeSources(id) {
        return this.fetchMediaInfo(id);
    }
    async fetchEpisodeServers(_) {
        return [];
    }
}
exports.StreamPk = StreamPk;
