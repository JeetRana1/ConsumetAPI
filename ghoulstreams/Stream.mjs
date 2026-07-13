import { Provider } from './Provider.mjs';
import { load as cheerioLoad } from 'cheerio';

const BUFFSTREAMS_KNOWN_DOMAINS = [
    ...(globalThis.process?.env?.BUFFSTREAMS_BASE_URL ? [globalThis.process.env.BUFFSTREAMS_BASE_URL.replace(/\/+$/, '')] : []),
    'https://buffstreams.ir',
    'https://buffstreams.sx',
];

let buffstreamsResolvedUrl = BUFFSTREAMS_KNOWN_DOMAINS[0];
let buffstreamsProbing = null;
let buffstreamsLastProbe = 0;
const BUFFSTREAMS_PROBE_TTL = 2 * 60 * 1000;
let buffstreamsProbeBackoff = 0;

async function probeBuffstreamsDomain(url) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(`${url}/index7`, {
            method: 'HEAD',
            redirect: 'manual',
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
        });
        clearTimeout(timeout);
        return res.ok || res.status === 403 || res.status === 429;
    } catch { return false; }
}

async function probeAllBuffstreams() {
    const results = await Promise.allSettled(
        BUFFSTREAMS_KNOWN_DOMAINS.map(async (domain) => {
            const ok = await probeBuffstreamsDomain(domain);
            return ok ? domain : null;
        })
    );
    for (const r of results) {
        if (r.status === 'fulfilled' && r.value) return r.value;
    }
    return BUFFSTREAMS_KNOWN_DOMAINS[0];
}

function ensureBuffstreamsProbe() {
    if (buffstreamsProbing) return;
    if (Date.now() - buffstreamsLastProbe < BUFFSTREAMS_PROBE_TTL) return;
    buffstreamsProbing = probeAllBuffstreams().then(url => {
        buffstreamsResolvedUrl = url;
        buffstreamsLastProbe = Date.now();
        buffstreamsProbeBackoff = 0;
        buffstreamsProbing = null;
    }).catch(() => {
        buffstreamsProbeBackoff = Math.min(buffstreamsProbeBackoff + 1, 4);
        buffstreamsProbing = null;
    });
}

async function forceBuffstreamsProbe() {
    try {
        const url = await probeAllBuffstreams();
        buffstreamsResolvedUrl = url;
        buffstreamsLastProbe = Date.now();
        buffstreamsProbeBackoff = 0;
        buffstreamsProbing = null;
        return url;
    } catch {
        if (buffstreamsProbeBackoff < 4) buffstreamsProbeBackoff++;
        buffstreamsProbing = null;
        return buffstreamsResolvedUrl;
    }
}

let buffstreamsRoundRobinIndex = 0;

function getBuffstreamsBaseUrl() {
    const envOverride = globalThis.process?.env?.BUFFSTREAMS_BASE_URL;
    if (envOverride) return envOverride.replace(/\/+$/, '');
    ensureBuffstreamsProbe();
    if (Date.now() - buffstreamsLastProbe < BUFFSTREAMS_PROBE_TTL && buffstreamsResolvedUrl) {
        return buffstreamsResolvedUrl;
    }
    return BUFFSTREAMS_KNOWN_DOMAINS[0];
}

class BuffStreams extends Provider {
    constructor() {
        super();
        this.name = 'BuffStreams';
        this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
        this.backendApiBase = (globalThis.process?.env?.CONSUMET_API_BASE || globalThis.process?.env?.SITE_API_BASE || 'http://localhost:3000').replace(/\/$/, '');
        this._categoryLogos = {
            soccer: '/images/soccer.webp?v3e32',
            f1: '/images/f1.webp?v3e32',
            nfl: '/images/nfl.webp?v3e32',
            nhl: '/images/nhl.webp?v3e32',
            mlb: '/images/mlb.webp?v3e32',
            mma: '/images/ufc.webp?v3e32',
            boxing: '/images/boxing.webp?v3e32',
            nba: '/images/nba.webp?v3e32',
            wnba: '/images/wnba.webp?v3e32',
            wwe: '/images/wwe.webp?v3e32',
            ncaa: '/images/ncaa.webp?v3e32',
            sports: '/images/mlb.webp?v3e32'
        };
    }

    get baseUrl() { return getBuffstreamsBaseUrl(); }
    get homeUrl() { return `${this.baseUrl}/index7`; }
    get directoryUrls() { return [this.homeUrl, `${this.baseUrl}/index18`]; }
    get categoryLogos() { return this._categoryLogos; }
    get categoryPages() {
        const b = this.baseUrl;
        return {
            nfl: `${b}/nflstreams2`,
            soccer: `${b}/soccer-live-streams`,
            mma: `${b}/mmastreams2`,
            boxing: `${b}/boxingstreams2`,
            f1: `${b}/f1streams2`,
            nba: `${b}/nbastreams2`,
            nhl: `${b}/nhlstreams2`,
            mlb: `${b}/mlb-live-streams`,
            ncaa: `${b}/ncaastreams`
        };
    }

    buildHeaders(referer) {
        const origin = (() => {
            try { return new URL(referer).origin; } catch { return this.baseUrl; }
        })();
        return { 'User-Agent': this.userAgent, 'Referer': referer, 'Origin': origin };
    }

    async supportsHead(url, referer = this.homeUrl) {
        try {
            const response = await fetch(url, { method: 'HEAD', headers: this.buildHeaders(referer) });
            return response.ok || response.status === 405 || response.status === 403 ? response : null;
        } catch {
            return null;
        }
    }

    stripUnneededHtml(value) {
        return String(value || '')
            .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
            .replace(/<script\b[\s\S]*?<\/script>/gi, '')
            .replace(/<style\b[\s\S]*?<\/style>/gi, '')
            .replace(/<footer\b[\s\S]*?<\/footer>/gi, '')
            .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '');
    }

    async readTextLean(response, {
        maxBytes = 512 * 1024,
        stopWhen = null,
        strip = true
    } = {}) {
        if (!response.body || typeof response.body.getReader !== 'function') {
            const text = await response.text();
            return strip ? this.stripUnneededHtml(text.slice(0, maxBytes)) : text.slice(0, maxBytes);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let received = 0;
        let output = '';

        try {
            while (received < maxBytes) {
                const { done, value } = await reader.read();
                if (done) break;
                received += value.byteLength;
                output += decoder.decode(value, { stream: true });
                if (strip) output = this.stripUnneededHtml(output);
                if (typeof stopWhen === 'function' && stopWhen(output)) break;
            }
            output += decoder.decode();
        } finally {
            try { await reader.cancel(); } catch { }
        }

        return strip ? this.stripUnneededHtml(output) : output;
    }

    async fetchLeanHtml(url, referer = this.homeUrl, options = {}) {
        const headers = {
            ...this.buildHeaders(referer),
            'Accept': 'text/html,application/xhtml+xml',
            'Range': `bytes=0-${Math.max(0, (options.maxBytes || 512 * 1024) - 1)}`
        };
        const response = await fetch(url, { headers });
        if (!response.ok && response.status !== 206) throw new Error(`HTTP error! status: ${response.status}`);
        return this.readTextLean(response, options);
    }

    toAbsoluteUrl(value, fallbackBase = this.baseUrl) {
        const raw = String(value || '').trim();
        if (!raw) return null;
        try { return new URL(raw, fallbackBase).toString(); } catch { return null; }
    }

    slugToTitle(value) {
        return String(value || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (char) => char.toUpperCase());
    }

    normalizeSearchQuery(value) {
        return String(value || '')
            .replace(/\b(?:in progress|live|upcoming|finished|not started)\b/ig, ' ')
            .replace(/\bvs\.?\b/ig, ' ')
            .replace(/\bat\b/ig, ' ')
            .replace(/\b@\b/g, ' ')
            .replace(/[^a-z0-9]+/ig, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    async resolveEventUrl(value) {
        const normalized = this.toAbsoluteUrl(value, this.baseUrl);
        if (!normalized) return null;

        try {
            const parsed = new URL(normalized);
            const slug = parsed.pathname.split('/').filter(Boolean).pop() || '';
            const slugQuery = this.normalizeSearchQuery(this.slugToTitle(slug));
            const rawQuery = this.normalizeSearchQuery(value);
            const query = slugQuery || rawQuery;

            if (!query) return normalized;

            const queryTokens = query.split(' ').filter(Boolean);
            const scoreResults = async (results) => {
                if (!Array.isArray(results) || !results.length) return null;
                let best = null;
                let bestScore = 0;
                for (const result of results) {
                    const title = this.normalizeSearchQuery(result?.title || '');
                    const urlText = this.normalizeSearchQuery(result?.url || '');
                    const haystack = `${title} ${urlText}`;
                    const score = queryTokens.reduce((count, token) => count + (haystack.includes(token) ? 1 : 0), 0);
                    if (score > bestScore && result?.url) {
                        best = result;
                        bestScore = score;
                    }
                }
                return best?.url || null;
            };

            const queryMatch = await scoreResults(await this.search(query));
            if (queryMatch) return queryMatch;

            const catalogMatch = await scoreResults(await this.search('all'));
            return catalogMatch || normalized;
        } catch {
            return normalized;
        }
    }
    cleanText(value) {
        return String(value || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&nbsp;/g, ' ')
            .replace(/&#039;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/\s+/g, ' ')
            .trim();
    }

    textToInt(value) {
        const match = String(value || '').match(/-?\d+/);
        return match ? Number.parseInt(match[0], 10) : null;
    }

    firstBlockAfterLabel(html, labels = [], maxLength = 160000) {
        const source = String(html || '');
        const lower = source.toLowerCase();
        const indexes = labels
            .map((label) => lower.indexOf(String(label || '').toLowerCase()))
            .filter((index) => index >= 0);
        if (!indexes.length) return source.slice(0, maxLength);
        const start = Math.max(0, Math.min(...indexes) - 8000);
        return source.slice(start, start + maxLength);
    }

    extractLiveState(title = '', statusText = '', rowHtml = '') {
        try {
            const normalizeStatusSource = (value) => this.cleanText(value)
                .replace(/\blive streams?(?:\s+links)?\b/ig, ' ')
                .replace(/\bwatch(?:\s+live)?\b/ig, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const rowText = normalizeStatusSource(rowHtml);
            const haystack = [statusText, title, rowText].map(normalizeStatusSource).filter(Boolean).join(' ');
            const exactTimeMatch = haystack.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\s*(?:AM|PM)?(?:\s*[A-Z]{2,4})?\b/i);
            const periodPatterns = [
                /\bIN\s*PROGRESS\b/i,
                /\b(?:1ST|2ND)\s*HALF\b/i,
                /\bHALF\s*TIME\b|\bHALFTIME\b/i,
                /\b(?:1ST|2ND|3RD|4TH)\s*QUARTER\b/i,
                /\bQ[1-4]\b/i,
                /\b(?:1ST|2ND|3RD)\s*PERIOD\b/i,
                /\bOVERTIME\b|\bOT\b/i,
                /\bTOP\s+\d+(?:ST|ND|RD|TH)?\b|\bBOTTOM\s+\d+(?:ST|ND|RD|TH)?\b/i,
                /\bLIVE\b/i
            ];
            const periodMatch = periodPatterns.map((pattern) => haystack.match(pattern)).find(Boolean);
            const styledPeriodMatch = rowHtml.match(/<(?:span|div|strong|b)[^>]*(?:color\s*:\s*(?:red|green|#(?:f00|ff|0f|00)|rgb\()|font-weight\s*:\s*(?:600|700|bold)|badge|status|period|live)[^>]*>([\s\S]{0,80}?)<\/(?:span|div|strong|b)>/i);
            const styledText = normalizeStatusSource(styledPeriodMatch?.[1] || '');
            const styledIsPeriod = /\bIN\s*PROGRESS\b|\b(?:1ST|2ND)\s*HALF\b|\bHALFTIME\b|\bQUARTER\b|\bQ[1-4]\b|\bPERIOD\b|\bLIVE\b|\bOT\b/i.test(styledText);
            const periodText = styledIsPeriod ? styledText.toUpperCase() : (periodMatch?.[0] || '').replace(/\s+/g, ' ').trim().toUpperCase();
            const isLive = Boolean(periodText && !/\bNOT\s*STARTED\b|\bUPCOMING\b/i.test(periodText));
            return {
                isLive,
                periodText,
                exactTime: exactTimeMatch ? exactTimeMatch[0].replace(/\s+/g, ' ').trim() : ''
            };
        } catch {
            return { isLive: false, periodText: '', exactTime: '' };
        }
    }

    inferType(url, sectionTitle = '') {
        const lower = `${url || ''} ${sectionTitle || ''}`.toLowerCase();
        if (lower.includes('/wnba/') || lower.includes('wnba')) return 'wnba';
        if (lower.includes('/wwe/') || lower.includes('wwe')) return 'wwe';
        if (lower.includes('/cfl/') || lower.includes('cfl')) return 'cfl';
        if (lower.includes('/nba/') || lower.includes('nba')) return 'nba';
        if (lower.includes('/nhl/') || lower.includes('nhl')) return 'nhl';
        if (lower.includes('/mlb/') || lower.includes('baseball') || lower.includes('mlb')) return 'mlb';
        if (lower.includes('/nfl/') || lower.includes('nfl')) return 'nfl';
        if (lower.includes('/boxing/') || lower.includes('boxing')) return 'boxing';
        if (lower.includes('/mma/') || lower.includes('mma') || lower.includes('ufc')) return 'mma';
        if (lower.includes('/soccer') || lower.includes('/football') || lower.includes('soccer') || lower.includes('fa cup') || lower.includes('premier league') || lower.includes('laliga') || lower.includes('serie a') || lower.includes('world cup') || lower.includes('world championship')) return 'soccer';
        if (lower.includes('/f1/') || lower.includes('formula 1') || lower.includes('f1') || lower.includes('nascar') || lower.includes('indycar')) return 'f1';
        if (lower.includes('/ncaa/') || lower.includes('/cfb') || lower.includes('ncaa')) return 'ncaa';
        return 'sports';
    }

    getCategoryLogo(type) {
        const raw = this.categoryLogos[type] || this.categoryLogos.sports;
        return this.toAbsoluteUrl(raw, this.baseUrl);
    }

    extractExactTime(value) {
        const match = String(value || '').match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)(?:\s*(?:ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT|UTC|GMT|CEST|CET|BST|IST|MSK|JST|AEST|AEDT|AWST|NZST|NZDT|SGT|HKT|CST\s+Asia|EEST|EET|WEST|WET|CAT|EAT|SAST|BRT|ART|CLT)?)?\b/i);
        return match ? match[0].replace(/\s+/g, ' ').trim() : '';
    }

    buildEasternEventStartMs(exactTime, canonicalDate) {
        const dateMatch = String(canonicalDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const timeMatch = String(exactTime || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)(?:\s*(ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT|UTC|GMT))?/i);
        if (!dateMatch || !timeMatch) return 0;
        let hours = Number(timeMatch[1]) % 12;
        const minutes = Number(timeMatch[2]);
        if (String(timeMatch[3] || '').toUpperCase() === 'PM') hours += 12;
        const year = Number(dateMatch[1]);
        const month = Number(dateMatch[2]) - 1;
        const day = Number(dateMatch[3]);
        const zoneToken = String(timeMatch[4] || 'UTC').toUpperCase().replace(/\s+ASIA/i, '');
        const zoneOffsetHours =
            zoneToken.startsWith('CT') ? 5 :
            zoneToken.startsWith('MT') ? 6 :
            zoneToken.startsWith('PT') ? 7 :
            (zoneToken === 'UTC' || zoneToken === 'GMT') ? 0 :
            zoneToken === 'CEST' || zoneToken === 'CET' || zoneToken === 'BST' || zoneToken === 'WEST' || zoneToken === 'WET' || zoneToken === 'CAT' || zoneToken === 'EAT' || zoneToken === 'SAST' ? 2 :
            zoneToken === 'EEST' || zoneToken === 'EET' || zoneToken === 'IST' || zoneToken === 'MSK' ? 3 :
            zoneToken === 'SGT' || zoneToken === 'HKT' || zoneToken === 'AWST' || zoneToken === 'CST' ? 8 :
            zoneToken === 'JST' || zoneToken === 'KST' ? 9 :
            zoneToken === 'AEST' || zoneToken === 'AEDT' || zoneToken === 'NZST' || zoneToken === 'NZDT' ? 11 :
            zoneToken === 'BRT' || zoneToken === 'ART' ? 3 :
            zoneToken === 'CLT' ? 4 :
            zoneToken === 'ET' || zoneToken === 'EST' || zoneToken === 'EDT' ? 4 :
            0;
        const resultMs = Date.UTC(year, month, day, hours + zoneOffsetHours, minutes, 0, 0);
        // For AM times that are >8h in the past, the canonicalDate likely refers to next day (event cross midnight)
        const isAmTime = String(timeMatch[3] || '').toUpperCase() === 'AM' && hours < 12;
        if (isAmTime && resultMs < Date.now() - (8 * 60 * 60 * 1000)) {
            const nextDayMs = Date.UTC(year, month, day + 1, hours + zoneOffsetHours, minutes, 0, 0);
            if (nextDayMs > Date.now() - (2 * 60 * 60 * 1000)) return nextDayMs;
        }
        return resultMs;
    }

    fillSiblingScheduleData(streams) {
        const sectionDateMap = new Map();
        for (const stream of streams) {
            const key = String(stream?.sectionTitle || '').trim().toLowerCase();
            const canonicalDate = String(stream?.canonicalEventDate || '').trim();
            if (key && canonicalDate && !sectionDateMap.has(key)) sectionDateMap.set(key, canonicalDate);
        }
        return streams.map((stream) => {
            const sectionKey = String(stream?.sectionTitle || '').trim().toLowerCase();
            const canonicalDate = String(stream?.canonicalEventDate || sectionDateMap.get(sectionKey) || '').trim();
            const exactTime = this.extractExactTime(stream?.liveState?.exactTime || stream?.statusText || stream?.title || '');
            if (canonicalDate && exactTime) {
                const computedMs = this.buildEasternEventStartMs(exactTime, canonicalDate);
                const existingMs = Number(stream?.eventStartUtcMs || 0);
                if (computedMs && computedMs > Date.now() - (2 * 60 * 60 * 1000)) {
                    // Use exactTime computation as fallback when probe has no epoch data
                    if (!existingMs) {
                        const countdownSeconds = Math.floor((computedMs - Date.now()) / 1000);
                        return {
                            ...stream,
                            canonicalEventDate: canonicalDate || stream?.canonicalEventDate,
                            eventStartUtcMs: computedMs,
                            countdownSeconds,
                            isLocked: countdownSeconds > 0 ? true : stream?.isLocked,
                            lockReason: countdownSeconds > 0 ? 'countdown-timer' : stream?.lockReason
                        };
                    }
                }
            }
            // Keep existing valid data if no better computation available
            if (stream?.canonicalEventDate && Number(stream?.eventStartUtcMs || 0) > 0) return stream;
            if (canonicalDate && !stream?.canonicalEventDate) {
                return { ...stream, canonicalEventDate: canonicalDate };
            }
            return stream;
        });
    }

    inferLiveState(title, statusText, sectionTitle) {
        const liveState = this.extractLiveState(title, statusText);
        if (liveState.isLive) return true;

        const statusHaystack = `${statusText || ''} ${title || ''}`.toLowerCase();
        if (/\bin progress\b|\blive\b|\b1st half\b|\b2nd half\b|\bhalftime\b|\bquarter\b|\bq[1-4]\b|\bperiod\b|\bovertime\b|\bot\极\binnings?\b|\btop \d+(st|nd|rd|th)?\b|\bbottom \d+(st|nd|rd|th)?\b|\bpractice\b|\bqualifying\b|\bsprint\b|\bfp\d*\b|\bfree practice\b|\bsprint shootout\b|\bwarm.?up\b|\bpre.?race\b|\bpost.?race\b|\bsession\b/i.test(statusHaystack)) return true;

        const scheduleHaystack = `${statusText || ''}`.toLowerCase();
        if (/from now|tomorrow|today at|am et|pm et|upcoming/.test(scheduleHaystack)) return false;
        if (/\b\d+\s+(?:second|seconds|minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago\b/i.test(scheduleHaystack)) return false;

        const fullHaystack = `${title || ''} ${statusText || ''} ${sectionTitle || ''}`.toLowerCase();
        return /\bin progress\b|\blive\b|\b1st half\b|\b2nd half\b|\bhalftime\b|\bquarter\b|\bq[1-4]\b|\bperiod\b|\bovertime\b|\bot\b|\binnings?\b|\btop \d+(st|nd|rd|th)?\b|\bbottom \d+(st|nd|rd|th)?\b|\bpractice\b|\bqualifying\b|\bsprint\b|\bfp\d*\b|\bfree practice\b|\bsprint shootout\b|\b极warm.?up\b|\bpre.?race\b|\bpost.?race\b|\bsession\b/i.test(fullHaystack);
    }

    parseCompetitionItem(itemHtml, fallbackImage, sectionTitle) {
        const hrefMatch = itemHtml.match(/<a[^>]+href=["']([^"']+)["']/i);
        const url = this.toAbsoluteUrl(hrefMatch?.[1], this.baseUrl);
        if (!url) return null;

        const anchorHtml = itemHtml.match(/<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] || itemHtml;
        const type = this.inferType(url, sectionTitle);

        const compactTitle = this.cleanText(anchorHtml.match(/<div[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');
        const compactMeta = this.cleanText(anchorHtml.match(/<small[^>]*>([\s\S]*?)<\/small>/i)?.[1] || '');

        if (compactTitle) {
            const liveState = this.extractLiveState(compactTitle, compactMeta, itemHtml);
            return {
                id: url,
                title: compactTitle,
                url,
                type,
                image: fallbackImage || this.getCategoryLogo(type),
                categoryImage: this.getCategoryLogo(type),
                statusText: compactMeta,
                liveState,
                isLive: liveState.isLive || this.inferLiveState(compactTitle, compactMeta, sectionTitle)
            };
        }

        const nameMatches = [...anchorHtml.matchAll(/<span[^>]*class=["'][^"']*name[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)]
            .map((match) => this.cleanText(match[1]))
            .filter(Boolean);
        const statusMatch = anchorHtml.match(/<(?:time|span)[^>]*class=["'][^"']*competition-cell-status[^"']*["'][^>]*>([\s\S]*?)<\/(?:time|span)>/i);
        const status = this.cleanText(statusMatch?.[1] || '');
        const sideA = nameMatches[0] || '';
        const sideB = nameMatches[1] || '';
        const title = [sideA, status, sideB].filter(Boolean).join(' ').trim() || this.slugToTitle(url);
        const liveState = this.extractLiveState(title, status, itemHtml);

        return {
            id: url,
            title,
            url,
            type,
            image: fallbackImage || this.getCategoryLogo(type),
            categoryImage: this.getCategoryLogo(type),
            statusText: status,
            liveState,
            isLive: liveState.isLive || this.inferLiveState(title, status, sectionTitle)
        };
    }

    parseCompetitionBlock(blockHtml, fallbackImage, sectionTitle) {
        const streams = [];
        const itemMatches = [...blockHtml.matchAll(/<li\b[\s\S]*?<\/li>/gi)];
        for (const match of itemMatches) {
            const parsed = this.parseCompetitionItem(match[0], fallbackImage, sectionTitle);
            if (parsed) streams.push(parsed);
        }
        return streams;
    }

    parseStreamsFromHTML(html) {
        const sections = [];
        const seen = new Set();
        const tournamentStartRegex = /<div\b[^>]*class=["'][^"']*top-tournament[^"']*["'][^>]*>/gi;
        const starts = [...html.matchAll(tournamentStartRegex)].map((match) => match.index).filter((index) => Number.isFinite(index));

        for (let i = 0; i < starts.length; i += 1) {
            const block = html.slice(starts[i], starts[i + 1] || html.length);
            const headingEnd = block.search(/<ul\b[^>]*class=["'][^"']*competitions[^"']*["'][^>]*>/i);
            const headingBlock = headingEnd >= 0 ? block.slice(0, headingEnd) : block;
            const listOpenMatch = block.match(/<ul\b[^>]*class=["'][^"']*competitions[^"']*["'][^>]*>/i);
            if (!listOpenMatch) continue;
            const listStart = (listOpenMatch.index || 0) + listOpenMatch[0].length;
            const listEnd = block.indexOf('</ul>', listStart);
            const listBlock = listEnd >= 0 ? block.slice(listStart, listEnd) : block.slice(listStart);
            const imageMatch = headingBlock.match(/<img[^>]+src=["']([^"']+)["']/i);
            const titleMatch = headingBlock.match(/<h2[^>]*class=["'][^"']*league-name[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i)
                || headingBlock.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i);
            const sectionImage = this.toAbsoluteUrl(imageMatch?.[1], this.baseUrl);
            const sectionTitle = this.cleanText(titleMatch?.[1] || 'Live Streams');
            const entries = this.parseCompetitionBlock(listBlock, sectionImage, sectionTitle);
            for (const entry of entries) {
                if (seen.has(entry.url)) continue;
                seen.add(entry.url);
                sections.push({ ...entry, sectionTitle, tournamentImage: sectionImage });
            }
        }
        return sections;
    }

    mergeStreams(streamGroups) {
        const merged = [];
        const seen = new Set();
        for (const group of streamGroups) {
            for (const stream of group) {
                const key = stream.url || stream.id;
                if (!key || seen.has(key)) continue;
                seen.add(key);
                merged.push(stream);
            }
        }
        return merged;
    }

    _deepProbeCache = new Map();
    _DEEP_PROBE_TTL_MS = 5 * 60 * 1000;
    _DEEP_PROBE_CONCURRENCY = 4;
    _probeInFlight = new Map();

    _getDeepProbeCache(streamId) {
        const cached = this._deepProbeCache.get(streamId);
        if (!cached) return null;
        if (Date.now() - cached.probedAt > this._DEEP_PROBE_TTL_MS) {
            this._deepProbeCache.delete(streamId);
            return null;
        }
        return cached;
    }

    _setDeepProbeCache(streamId, data) {
        this._deepProbeCache.set(streamId, { ...data, probedAt: Date.now() });
    }

    async deepProbeStream(streamUrl) {
        const probeId = String(streamUrl || '').trim();
        if (!probeId) return null;
        const cached = this._getDeepProbeCache(probeId);
        if (cached) return cached;
        if (this._probeInFlight.has(probeId)) return this._probeInFlight.get(probeId);
        const promise = (async () => {
            try {
                const rawHtml = await this.fetchRawHtml(probeId, this.homeUrl, {
                    maxBytes: 256 * 1024,
                    stopWhen: (text) => /<\/html>/i.test(text)
                });
                const html = this.stripUnneededHtml(rawHtml);
                const result = { canonicalEventDate: '', eventStartUtcMs: 0, countdownSeconds: -1, hasActiveStream: false, isLocked: false, lockReason: '' };
                const dateText = html.match(/<img[^>]+>\s*<span[^>]*>(\d{4}-\d{2}-\d{2})<\/span>/i)
                    || html.match(/<[^>]*class=["'][^"']*date[^"']*["'][^>]*>([^<]*\d{4}-\d{2}-\d{2}[^<]*)<\/[^>]*>/i)
                    || html.match(/>\s*(?:<[^>]+>\s*)*(\d{4}-\d{2}-\d{2})\s*</i);
                if (dateText?.[1]) result.canonicalEventDate = dateText[1].trim();
                const epochMatch = rawHtml.match(/var\s+countDownDate\s*=\s*(\d{10,13})\s*\*\s*1000/i)
                    || rawHtml.match(/(?:countDownDate|countdownTarget|eventStart|startAt|startTime|eventStartUtc)["']?\s*[:=]\s*["']?(\d{10,13})\b/i)
                    || rawHtml.match(/(?:countDownDate|countdownTarget|eventStart|startAt|startTime|eventStartUtc)["']?\s*[:=]\s*["']?(\d{10,13})\s*\*\s*1000/i);
                if (epochMatch) {
                    const rawTs = parseInt(epochMatch[1], 10);
                    const tsMs = rawTs < 1e12 ? rawTs * 1000 : rawTs;
                    const nowMs = Date.now();
                    const diffMs = tsMs - nowMs;
                    if (diffMs > 0 && diffMs < 7 * 24 * 60 * 60 * 1000) {
                        result.eventStartUtcMs = tsMs;
                        const totalSecs = Math.floor(diffMs / 1000);
                        result.countdownSeconds = totalSecs;
                        result.isLocked = true;
                        result.lockReason = 'countdown-timer';
                    }
                } else {
                    const countdownFromScripts = result.eventStartUtcMs > 0 ? null : this.extractCountdownFromScripts(rawHtml);
                    const countdownMatch = result.eventStartUtcMs > 0 ? null : (countdownFromScripts ? ['', String(countdownFromScripts.h), String(countdownFromScripts.m), String(countdownFromScripts.s)] : html.match(/\b(\d{2}):(\d{2}):(\d{2})\b/));
                    if (countdownMatch) {
                        const h = parseInt(countdownMatch[1], 10);
                        const m = parseInt(countdownMatch[2], 10);
                        const s = parseInt(countdownMatch[3], 10);
                        result.countdownSeconds = (h * 3600) + (m * 60) + s;
                        result.isLocked = true;
                        result.lockReason = 'countdown-timer';
                    }
                }
                const hasM3u8 = /src\s*[:=]\s*["']?[^"'\s]*\.m3u8/i.test(rawHtml)
                    || /(?:file|source|manifest|streamUrl)\s*[:=]\s*["']?[^"'\s]*\.m3u8/i.test(rawHtml)
                    || /https?:\/\/[^"'\s]+\.m3u8(?:\?[^"'\s]*)?/i.test(rawHtml);
                const pageText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
                const hasInProgress = /\bIN\s*PROGRESS\b|\b2ND\s*QUARTER\b|\b1ST\s*QUARTER\b|\b3RD\s*QUARTER\b|\b4TH\s*QUARTER\b|\b1ST\s*HALF\b|\b2ND\s*HALF\b|\bHALFTIME\b|\bOVERTIME\b|\bHALF\s*TIME\b|\bTOP\s+\d+\b|\bBOTTOM\s+\d+\b|\bINNING\b/i.test(pageText);
                const hasLiveScore = /<span[^>]*class=["'][^"']*score[^"']*["'][^>]*>\s*\d+\s*<\/span>/i.test(rawHtml);
                if (hasM3u8 || (hasInProgress && hasLiveScore)) {
                    result.hasActiveStream = true;
                    result.isLive = true;
                    result.isLocked = false;
                    result.lockReason = 'early-broadcast';
                }
                this._setDeepProbeCache(probeId, result);
                return result;
            } catch (err) {
                console.warn(`[Stream.js] Deep probe failed for ${probeId}:`, err?.message || err);
                return { canonicalEventDate: '', countdownSeconds: -1, hasActiveStream: false, isLocked: false, lockReason: 'probe-error' };
            } finally {
                this._probeInFlight.delete(probeId);
            }
        })();
        this._probeInFlight.set(probeId, promise);
        return promise;
    }

    extractCountdownFromScripts(rawHtml) {
        if (!rawHtml) return null;
        const scriptBlocks = rawHtml.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
        for (const block of scriptBlocks) {
            const inner = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
            const explicitCountdown = inner.match(/["']?(?:countdown|countdownSeconds|countdownLeft|timeLeft|timeRemaining|secondsLeft|secondsRemaining)["']?\s*[:=]\s*(\d{3,6})\b/i);
            if (explicitCountdown) {
                const totalSeconds = parseInt(explicitCountdown[1], 10);
                if (totalSeconds > 60 && totalSeconds < 86400) {
                    const h = Math.floor(totalSeconds / 3600);
                    const m = Math.floor((totalSeconds % 3600) / 60);
                    const s = totalSeconds % 60;
                    return { h, m, s };
                }
            }
            const explicitHMS = inner.match(/["']?(?:countdown|countdownSeconds|countdownLeft|timeLeft|timeRemaining)["']?\s*[:=]\s*["']?(\d{1,2})\s*[:\-,/]\s*(\d{1,2})\s*[:\-,/]\s*(\d{1,2})["']?/i);
            if (explicitHMS) {
                const h = parseInt(explicitHMS[1], 10);
                const m = parseInt(explicitHMS[2], 10);
                const s = parseInt(explicitHMS[3], 10);
                if (h < 48 && m < 60 && s < 60 && (h * 3600 + m * 60 + s) > 60) return { h, m, s };
            }
            const timestampCountdown = inner.match(/["']?(?:startAt|eventStart|startTime|eventStartUtc|countdownTarget)["']?\s*[:=]\s*(\d{10,13})\b/i);
            if (timestampCountdown) {
                const ts = parseInt(timestampCountdown[1], 10);
                const now = Date.now();
                const diffMs = (ts > 1e12 ? ts : ts * 1000) - now;
                if (diffMs > 60000 && diffMs < 86400000) {
                    const totalSeconds = Math.floor(diffMs / 1000);
                    const h = Math.floor(totalSeconds / 3600);
                    const m = Math.floor((totalSeconds % 3600) / 60);
                    const s = totalSeconds % 60;
                    return { h, m, s };
                }
            }
        }
        return null;
    }

    fetchRawHtml(url, referer = this.homeUrl, options = {}) {
        const headers = {
            ...this.buildHeaders(referer),
            'Accept': 'text/html,application/xhtml+xml',
            'Range': `bytes=0-${Math.max(0, (options.maxBytes || 512 * 1024) - 1)}`
        };
        return (async () => {
            const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
            if (!response.ok && response.status !== 206) throw new Error(`HTTP error! status: ${response.status}`);
            return this.readTextLean(response, { ...options, strip: false });
        })();
    }

    async batchDeepProbe(streams) {
        const targets = streams.filter((s) => s?.url && !this._getDeepProbeCache(s.url));
        if (!targets.length) return streams;
        const batches = [];
        for (let i = 0; i < targets.length; i += this._DEEP_PROBE_CONCURRENCY) {
            batches.push(targets.slice(i, i + this._DEEP_PROBE_CONCURRENCY));
        }
        for (const batch of batches) {
            await Promise.allSettled(batch.map((s) => this.deepProbeStream(s.url)));
        }
        return streams.map((stream) => {
            const probe = this._getDeepProbeCache(stream.url);
            if (!probe) return stream;
            const enriched = { ...stream };
            if (probe.canonicalEventDate) enriched.canonicalEventDate = probe.canonicalEventDate;
            if (Number.isFinite(probe.eventStartUtcMs) && probe.eventStartUtcMs > 0) enriched.eventStartUtcMs = probe.eventStartUtcMs;
            if (Number.isFinite(probe.countdownSeconds) && probe.countdownSeconds >= 0) {
                enriched.countdownSeconds = probe.countdownSeconds;
            }
            if (probe.hasActiveStream) {
                enriched.hasActiveStream = true;
                enriched.isLive = true;
                enriched.isLocked = false;
            }
            if (probe.isLocked) {
                enriched.isLocked = true;
                enriched.lockReason = probe.lockReason;
            }
            if (probe.lockReason === 'early-broadcast') {
                enriched.isLive = true;
                enriched.hasActiveStream = true;
                enriched.isLocked = false;
            }
            return enriched;
        });
    }

    _applyHysteresisGuard(existingStreams, newStreams) {
        const existingMap = new Map(existingStreams.map((s) => [s.url || s.id, s]));
        return newStreams.map((stream) => {
            const key = stream.url || stream.id;
            const prev = existingMap.get(key);
            if (!prev) return stream;
            if (prev.isLive === true || prev.hasActiveStream === true) {
                return { ...stream, isLive: true, hasActiveStream: true, isLocked: false };
            }
            return stream;
        });
    }

    resolveSearchTarget(query) {
        const raw = String(query || '').trim().toLowerCase();
        if (!raw || raw === 'all') return { url: this.homeUrl, mode: 'all' };
        const categoryKey = raw.replace(/^category:/, '');
        const categoryUrl = this.categoryPages[categoryKey];
        const mainPages = [this.homeUrl, `${this.baseUrl}/index18`];
        if (categoryKey === 'fighting') return { urls: [this.categoryPages.boxing, this.categoryPages.mma, `${this.baseUrl}/index18`, ...mainPages].filter(Boolean), mode: 'category', categoryKey };
        if (categoryUrl) return { urls: [categoryUrl, ...mainPages].filter(Boolean), mode: 'category', categoryKey };
        return { url: this.homeUrl, mode: 'search', raw };
    }

    async fetchCategoryStreams(url) {
        const response = await fetch(url, { headers: this.buildHeaders(url) });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const html = await this.readTextLean(response, {
            maxBytes: 900 * 1024,
            stopWhen: (text) => /<\/html>/i.test(text)
        });
        return this.parseStreamsFromHTML(html);
    }

    async fetchAllStreams() {
        const urls = [...this.directoryUrls, ...Object.values(this.categoryPages)];
        const results = await Promise.allSettled(urls.map((url) => this.fetchCategoryStreams(url)));
        const fulfilled = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
        return this.mergeStreams(fulfilled);
    }

    async search(query) {
        try {
            const target = this.resolveSearchTarget(query);
            let streams;
            if (target.mode === 'all') {
                streams = await this.fetchAllStreams();
            } else if (target.urls) {
                const results = await Promise.allSettled(target.urls.map((url) => this.fetchCategoryStreams(url)));
                streams = this.mergeStreams(results.filter((r) => r.status === 'fulfilled').map((r) => r.value));
            } else {
                streams = await this.fetchCategoryStreams(target.url);
            }
            if (target.mode === 'category') {
                if (target.categoryKey === 'fighting') {
                    streams = streams.filter((s) => /\/(?:boxing|mma|ufc|pfl|lfc|wwe)\b|title-game\/(?:boxing|mma|ufc|pfl|lfc|wwe)|\b(?:boxing|mma|ufc|pfl|lfc|wwe|bkfc|bellator|one fight|fighting championship)\b/i.test(`${s.url || ''} ${s.title || ''} ${s.sectionTitle || ''}`));
                }
            } else if (target.mode === 'search') {
                streams = streams.filter((stream) => `${stream.title} ${stream.statusText || ''} ${stream.type} ${stream.sectionTitle || ''}`.toLowerCase().includes(target.raw));
            }
            const probeLimit = target.mode === 'all' ? 24 : 12;
            const toProbe = streams.slice(0, probeLimit);
            if (toProbe.length) {
                await this.batchDeepProbe(toProbe);
                streams = streams.map((stream) => {
                    const probe = this._getDeepProbeCache(stream.url);
                    if (!probe) return stream;
                    const enriched = { ...stream };
                    if (probe.canonicalEventDate) enriched.canonicalEventDate = probe.canonicalEventDate;
                    if (Number.isFinite(probe.eventStartUtcMs) && probe.eventStartUtcMs > 0) enriched.eventStartUtcMs = probe.eventStartUtcMs;
                    if (Number.isFinite(probe.countdownSeconds) && probe.countdownSeconds >= 0) {
                        enriched.countdownSeconds = probe.countdownSeconds;
                    }
                    if (probe.hasActiveStream) {
                        enriched.hasActiveStream = true;
                        enriched.isLive = true;
                        enriched.isLocked = false;
                    }
                    if (probe.isLocked) {
                        enriched.isLocked = true;
                        enriched.lockReason = probe.lockReason;
                    }
                    return enriched;
                });
            }
            return this.fillSiblingScheduleData(streams);
        } catch (error) {
            console.error('Error in BuffStreams search:', error);
            return [];
        }
    }

    extractTitle(html, fallbackUrl) {
        const titleMatch = html.match(/<title>(.*?)<\/title>/i);
        if (titleMatch?.[1]) return titleMatch[1].replace(/\s*-\s*Buffstreams\s*$/i, '').trim();
        try {
            const parts = new URL(fallbackUrl).pathname.split('/').filter(Boolean);
            return this.slugToTitle(parts[parts.length - 2] || fallbackUrl);
        } catch { return fallbackUrl; }
    }

    extractEmbedUrl(html, pageUrl) {
        const source = String(html || '');
        const candidates = [];
        const push = (value) => {
            const raw = String(value || '').trim();
            if (!raw || candidates.includes(raw)) return;
            candidates.push(raw);
        };
        const resolve = (value) => {
            try { return this.toAbsoluteUrl(value, pageUrl); } catch { return null; }
        };

        const iframePatterns = [
            /<iframe[^>]+id=["']cx-iframe["'][^>]+src=["']([^"']+)["']/i,
            /<iframe[^>]+data-src=["']([^"']+)["'][^>]*>/i,
            /<iframe[^>]+src=["']([^"']+)["'][^>]*>/i,
            /data-iframe=["']([^"']+)["']/i,
            /src=["']([^"']+(?:embed|iframe|player)[^"']*)["']/i
        ];

        for (const pattern of iframePatterns) {
            const match = source.match(pattern);
            if (match?.[1]) push(match[1]);
        }

        for (const match of source.matchAll(/(?:src|data-src|href)\s*=\s*["']([^"']+)["']/gi)) {
            push(match[1]);
        }

        const scriptUrlPatterns = [
            /window\.location\s*=\s*["']([^"']+)["']/i,
            /src\s*:\s*["']([^"']+)["']/i,
            /source\s*:\s*["']([^"']+)["']/i,
            /file\s*:\s*["']([^"']+)["']/i,
            /url\s*:\s*["']([^"']+)["']/i,
            /iframe\s*:\s*["']([^"']+)["']/i,
            /['"](https?:\/\/[^'"\s>]+(?:embed|playlist|m3u8|load-playlist)[^'"\s>]*)['"]/i
        ];
        for (const pattern of scriptUrlPatterns) {
            const match = source.match(pattern);
            if (match?.[1]) push(match[1]);
        }

        const base64Segments = [...source.matchAll(/(?:atob|window\.atob|Buffer\.from)\(\s*["']([^"']+)["']/gi)]
            .map((match) => match[1])
            .filter(Boolean);
        for (const encoded of base64Segments) {
            const cleaned = String(encoded)
                .replace(/\\+/g, '')
                .replace(/["'`]/g, '')
                .replace(/\s+/g, '')
                .replace(/[^A-Za-z0-9+/=]/g, '');
            if (!cleaned) continue;
            try {
                const padded = cleaned.replace(/=+$/g, '').padEnd(Math.ceil(cleaned.length / 4) * 4, '=');
                const decoded = Buffer.from(padded, 'base64').toString('utf8');
                if (/^https?:\/\//i.test(decoded)) push(decoded);
                const nested = decoded.match(/https?:\/\/[^'"\s>]+/i)?.[0];
                if (nested) push(nested);
            } catch { }
        }

        for (const candidate of candidates) {
            const resolved = resolve(candidate);
            if (resolved && /^https?:\/\//i.test(resolved)) return resolved;
        }
        return null;
    }

    extractSessionCards(html) {
        const listMatch = html.match(/<ul[^>]*class=["']under-card-events["'][^>]*>([\s\S]*?)<\/ul>/i);
        if (!listMatch) return [];
        const listHtml = listMatch[1];
        const sessions = [];
        const itemRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
        for (const itemMatch of listHtml.matchAll(itemRegex)) {
            const item = itemMatch[1];
            const status = (item.match(/<div[^>]*style=["'][^"']*font-weight:\s*500[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '').trim();
            const name = (item.match(/<div[^>]*class=["']name-under-card-name["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '').trim();
            const when = (item.match(/<div[^>]*style=["'][^"']*color:\s*#747171[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '').trim();
            if (name) {
                sessions.push({ status, name, when });
            }
        }
        return sessions;
    }

    extractScoreboard(html) {
        try {
            const headerBlock = this.firstBlockAfterLabel(html, ['event-team', 'score', 'scoreboard', 'team'], 180000);
            const scoreMatches = [...headerBlock.matchAll(/<span[^>]*class=["'][^"']*score[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)]
                .map((match) => this.textToInt(this.cleanText(match[1])))
                .filter((value) => Number.isInteger(value));
            if (scoreMatches.length >= 2) {
                return { awayScore: scoreMatches[0], homeScore: scoreMatches[1], scores: scoreMatches.map(String) };
            }

            const classDigitMatches = [...headerBlock.matchAll(/<(?:div|span|strong|b)[^>]*class=["'][^"']*(?:score|points|result|total)[^"']*["'][^>]*>\s*(-?\d{1,3})\s*<\/(?:div|span|strong|b)>/gi)]
                .map((match) => this.textToInt(match[1]))
                .filter((value) => Number.isInteger(value));
            if (classDigitMatches.length >= 2) {
                return { awayScore: classDigitMatches[0], homeScore: classDigitMatches[1], scores: classDigitMatches.map(String) };
            }
        } catch { }
        return { awayScore: null, homeScore: null, scores: [] };
    }

    normalizeSessionStatus(value) {
        const text = this.cleanText(value).toUpperCase().replace(/\s+/g, '');
        if (!text) return '';
        if (/LIVE|INPROGRESS|STARTED/.test(text)) return 'LIVE';
        if (/NOTSTARTED|UPCOMING|SCHEDULED/.test(text)) return 'NOTSTARTED';
        if (/FINISHED|ENDED|COMPLETE/.test(text)) return 'FINISHED';
        return this.cleanText(value).toUpperCase();
    }

    extractEventSessions(html) {
        const sessions = [];
        const seen = new Set();
        const block = this.firstBlockAfterLabel(html, ['live streams', 'cards', 'qualification', 'qualifying', 'race', 'practice', 'indycar', 'formula'], 180000);
        const itemBlocks = block.match(/<(?:li|tr|article|div)[^>]*>[\s\S]{0,5000}?<\/(?:li|tr|article|div)>/gi) || [];
        for (const item of itemBlocks) {
            try {
                const text = this.cleanText(item);
                const hasKeyword = /\b(qualification|qualifying|practice|sprint|warm.?up|grand prix|race|session)\b/i.test(text);
                const hasStatus = /\b(NOT\s*STARTED|NOTSTARTED|LIVE|IN\s*PROGRESS|FINISHED|ENDED|CANCELED|UPCOMING|SCHEDULED)\b/i.test(text);
                if (!hasKeyword && !hasStatus) continue;
                const nameMatch = text.match(/\b(Free Practice\s*\d*|Practice\s*\d*|Sprint Qualifying|Qualification|Qualifying|Grand Prix|Sprint(?: Race)?|Warm.?up|Race|Session\s*\d*)\b/i);
                const dateMatch = text.match(/\b\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?\b/i);
                const statusMatch = text.match(/\b(NOT\s*STARTED|NOTSTARTED|LIVE|IN\s*PROGRESS|FINISHED|ENDED|CANCELED|UPCOMING|SCHEDULED)\b/i);
                const rawName = this.cleanText(nameMatch?.[1] || '');
                if (rawName && /^live\s*streams?$/i.test(rawName)) continue;
                const name = rawName || this.cleanText(text.split(/\s{2,}| - | \| /)[0] || '');
                if (!name || name.length > 80 || /^live\s*streams?$/i.test(name)) continue;
                const status = this.normalizeSessionStatus(statusMatch?.[1] || '');
                const startsAt = dateMatch ? dateMatch[0].replace(/\s+/g, ' ').trim() : '';
                const key = `${name}|${startsAt}|${status}`;
                if (seen.has(key)) continue;
                seen.add(key);
                sessions.push({ name, startsAt, status });
            } catch { }
        }
        return sessions.slice(0, 24);
    }

    extractFightCard(html) {
        const fights = [];
        const seen = new Set();
        const invalid = /\b(?:watch|stream|live streams|click|select|reddit|official|broadcast|coverage)\b/i;
        try {
            const block = this.firstBlockAfterLabel(html, ['cards', 'main card', 'prelims', 'undercard', 'match 1'], 220000);
            const rowBlocks = [
                ...(block.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []),
                ...(block.match(/<li[^>]*>[\s\S]*?<\/li>/gi) || []),
                ...(block.match(/<div[^>]*(?:class=["'][^"']*(?:fight|match|card|row|event)[^"']*["'])[^>]*>[\s\S]{0,6000}?<\/div>/gi) || [])
            ];
            rowBlocks.forEach((row, index) => {
                try {
                    const text = this.cleanText(row);
                    if (!text || invalid.test(text) || !/\bvs\.?\b|\s@\s|\bMatch\s+\d+\b/i.test(text)) return;
                    const sequenceLabel = text.match(/\bMatch\s+\d+\b/i)?.[0] || `Match ${index + 1}`;
                    const stripped = text.replace(/\bMatch\s+\d+\b/ig, ' ').replace(/\s+/g, ' ').trim();
                    const parts = stripped.split(/\s+vs\.?\s+|\s+@\s+/i).map((part) => part.trim()).filter(Boolean);
                    if (parts.length < 2) return;

                    const cleanSide = (value) => {
                        const record = value.match(/\b\d{1,2}-\d{1,2}(?:-\d{1,2})?\b/)?.[0] || '';
                        const name = value
                            .replace(/\b\d{1,2}-\d{1,2}(?:-\d{1,2})?\b/g, '')
                            .replace(/\b(?:live|notstarted|upcoming|finished)\b/ig, '')
                            .trim();
                        return { name: name.substring(0, 100), record };
                    };

                    const left = cleanSide(parts[0]);
                    const right = cleanSide(parts.slice(1).join(' '));
                    if (left.name.length < 3 || right.name.length < 3) return;
                    const key = `${left.name}|${right.name}`;
                    if (seen.has(key)) return;
                    seen.add(key);
                    fights.push({
                        sequenceLabel,
                        fighter1: left.name,
                        fighter2: right.name,
                        record1: left.record,
                        record2: right.record
                    });
                } catch { }
            });
        } catch { }
        return fights.slice(0, 40);
    }

    extractEventDetails(html, pageUrl) {
        const leagueMatch = html.match(/<h2[^>]*class=["']title["'][^>]*>([\s\S]*?)<div>/i);
        const dateMatch = html.match(/fa-calendar[\s\S]*?<\/i>\s*([^<]+)</i);
        const statusMatch = html.match(/<div[^>]*class=["']event-status["'][^>]*>([\s\S]*?)<\/div>/i);
        const scoreboard = this.extractScoreboard(html);
        const scoreMatches = scoreboard.scores;
        const teamMatches = [...html.matchAll(/<div[^>]*class=["']event-team["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["'][^>]*alt=["']([^"']+)["'][\s\S]*?<h5>([\s\S]*?)<\/h5>[\s\S]*?<\/div>/gi)];
        const titleMatch = html.match(/<h1[^>]*class=["']title["'][^>]*>([\s\S]*?)<\/h1>/i);
        const teams = teamMatches.slice(0, 2).map((match, index) => ({
            name: this.cleanText(match[3] || match[2] || ''),
            logo: this.toAbsoluteUrl(match[1], pageUrl),
            score: scoreMatches[index] || ''
        }));
        return {
            title: this.cleanText(titleMatch?.[1] || ''),
            league: this.cleanText(leagueMatch?.[1] || ''),
            date: this.cleanText(dateMatch?.[1] || ''),
            status: this.cleanText(statusMatch?.[1] || ''),
            teams,
            scores: scoreMatches,
            awayScore: scoreboard.awayScore,
            homeScore: scoreboard.homeScore
        };
    }

    extractHlsFromEmbed(html) {
        const decodeIfUrl = (value) => {
            try {
                const decoded = Buffer.from(String(value || '').trim(), 'base64').toString('utf8').trim();
                if (/^https?:\/\//i.test(decoded)) return decoded;
            } catch { }
            return null;
        };

        const directAtobMatch = html.match(/source\s*:\s*window\.atob\(\s*['\"]([^'\"]+)['\"]\s*\)/i);
        if (directAtobMatch?.[1]) {
            const decoded = decodeIfUrl(directAtobMatch[1]);
            if (decoded) return decoded;
        }

        for (const match of html.matchAll(/window\.atob\(\s*['\"]([^'\"]+)['\"]\s*\)/gi)) {
            const decoded = decodeIfUrl(match[1]);
            if (decoded) return decoded;
        }

        const directSourceMatch = html.match(/source\s*:\s*['\"]([^'\"]+)['\"]/i);
        if (directSourceMatch?.[1] && /^https?:\/\//i.test(directSourceMatch[1])) return directSourceMatch[1];

        const playlistMatch = html.match(/https?:\/\/[^'\"\s]+(?:load-playlist|\.m3u8|\/playlist\/[^'\"\s]+)/i);
        if (playlistMatch?.[0]) return playlistMatch[0];

        for (const match of html.matchAll(/['\"](https?:\/\/[^'\"]+)['\"]/gi)) {
            if (/load-playlist|\.m3u8|\/playlist\//i.test(match[1])) return match[1];
        }

        return null;
    }

    parseM3uAttributeList(value) {
        const attributes = {};
        const source = String(value || '');
        const regex = /([A-Z0-9-]+)=(("[^"]*")|[^,]*)/gi;
        let match;
        while ((match = regex.exec(source)) !== null) {
            const key = String(match[1] || '').toUpperCase();
            let raw = String(match[2] || '').trim();
            if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
            attributes[key] = raw;
        }
        return attributes;
    }

    parseHlsVariantSources(manifestText, manifestUrl, refererHeaders) {
        const lines = String(manifestText || '').split(/\r?\n/);
        const variants = [];
        const seen = new Set();

        for (let i = 0; i < lines.length; i += 1) {
            const line = String(lines[i] || '').trim();
            if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;

            const info = line.slice('#EXT-X-STREAM-INF:'.length);
            let streamUrl = '';
            for (let j = i + 1; j < lines.length; j += 1) {
                const candidate = String(lines[j] || '').trim();
                if (!candidate) continue;
                if (candidate.startsWith('#')) continue;
                streamUrl = this.toAbsoluteUrl(candidate, manifestUrl) || '';
                break;
            }
            if (!streamUrl || seen.has(streamUrl)) continue;

            const resolution = info.match(/RESOLUTION=\s*(\d+)x(\d+)/i);
            const bandwidth = info.match(/(?:AVERAGE-BANDWIDTH|BANDWIDTH)=\s*(\d+)/i);
            const qualityLabel = resolution?.[2]
                ? `${resolution[2]}p`
                : (bandwidth?.[1] ? `${Math.round(Number(bandwidth[1]) / 1000)}k` : 'auto');

            seen.add(streamUrl);
            variants.push({
                url: streamUrl,
                quality: qualityLabel,
                isM3U8: true,
                isDirect: true,
                headers: refererHeaders
            });
        }

        return variants;
    }

    parseHlsSubtitleSources(manifestText, manifestUrl, refererHeaders) {
        const subtitles = [];
        const seen = new Set();
        const lines = String(manifestText || '').split(/\r?\n/);

        for (const rawLine of lines) {
            const line = String(rawLine || '').trim();
            if (!line.startsWith('#EXT-X-MEDIA:')) continue;
            const attrs = this.parseM3uAttributeList(line.slice('#EXT-X-MEDIA:'.length));
            const type = String(attrs.TYPE || '').toUpperCase();

            // Only handle actual subtitle files (TYPE=SUBTITLES with URI)
            // Closed captions (TYPE=CLOSED-CAPTIONS) are handled natively by HLS.js
            if (type !== 'SUBTITLES') continue;

            const trackUrl = this.toAbsoluteUrl(attrs.URI, manifestUrl);
            if (!trackUrl || seen.has(trackUrl)) continue;

            const lang = String(attrs.LANGUAGE || '').trim();
            const name = String(attrs.NAME || '').trim();
            const label = name || lang || 'Subtitles';
            const format = /\.vtt($|\?)/i.test(trackUrl) ? 'vtt' : 'm3u8';

            seen.add(trackUrl);
            subtitles.push({
                url: trackUrl,
                lang,
                label,
                format,
                headers: refererHeaders
            });
        }

        return subtitles;
    }

    async extractManifestMedia(hlsUrl, refererHeaders) {
        try {
            const response = await fetch(hlsUrl, { headers: refererHeaders });
            if (!response.ok) return { variants: [], subtitles: [] };
            const contentType = String(response.headers.get('content-type') || '').toLowerCase();
            const manifestText = await response.text();
            if (!/mpegurl|m3u8/.test(contentType) && !/^#EXTM3U/i.test(manifestText.trim())) {
                return { variants: [], subtitles: [] };
            }

            const variants = /#EXT-X-STREAM-INF:/i.test(manifestText)
                ? this.parseHlsVariantSources(manifestText, hlsUrl, refererHeaders)
                : [];
            const subtitles = this.parseHlsSubtitleSources(manifestText, hlsUrl, refererHeaders);

            return { variants, subtitles };
        } catch {
            return { variants: [], subtitles: [] };
        }
    }

    extractEventCards(html) {
        const cards = { mainCard: [], prelims: [] };

        try {
            // Split by Main Card and Prelims sections
            const mainCardStartIdx = html.toUpperCase().indexOf('MAIN CARD');
            const prelimsStartIdx = html.toUpperCase().indexOf('PRELIM');

            if (mainCardStartIdx === -1 && prelimsStartIdx === -1) {
                // Generic fallback for sports without explicit Main Card / Prelims headers.
                const listMatches = this.extractCardMatches(html);
                if (listMatches && listMatches.length > 0) {
                    cards.mainCard = listMatches;
                }

                // Limit to reasonable number
                cards.mainCard = cards.mainCard.slice(0, 12);
                return cards;
            }

            // Extract Main Card section
            let mainCardHtml = '';
            if (mainCardStartIdx !== -1) {
                const endIdx = prelimsStartIdx !== -1 ? prelimsStartIdx : html.length;
                mainCardHtml = html.substring(mainCardStartIdx, endIdx);
            }

            // Extract Prelims section
            let prelimsHtml = '';
            if (prelimsStartIdx !== -1) {
                prelimsHtml = html.substring(prelimsStartIdx);
            }

            // Parse Main Card matches
            cards.mainCard = this.extractCardMatches(mainCardHtml);

            // Parse Prelims matches
            cards.prelims = this.extractCardMatches(prelimsHtml);

        } catch (e) {
            console.warn('Error extracting event cards:', e);
        }

        return cards;
    }

    extractCardMatches(sectionHtml) {
        const matches = [];
        if (!sectionHtml) return matches;

        // List of common non-competitor terms to filter out
        const invalidTerms = [
            'streameast', 'watch', 'click', 'play', 'link', 'stream', 'source',
            'live', 'start', 'join', 'channel', 'check', 'action', 'select',
            'open', 'view', 'coverage', 'broadcast', 'reddit', 'official',
            '1stream', 'thetvapp', 'sportsurge', 'crackstreams', 'methstreams',
            'footybite', 'buffstream', 'nbastreams', 'nflstreams', 'soccer',
            'app', 'link', 'button', 'option', 'go', 'go to', 'open in',
            'reddit', 'thread', 'discussion', 'hd', 'sd', 'popup', 'ads'
        ];

        const isInvalidCompetitor = (name) => {
            const lower = name.toLowerCase();
            return invalidTerms.some(term => lower === term || lower.includes(term)) ||
                name.length < 3 || /^watch|^click|^select|^go|^open/i.test(name);
        };

        // Try list-based format first (under-card-events)
        const listItems = sectionHtml.match(/<li[^>]*>[\s\S]*?<\/li>/gi) || [];
        if (listItems.length > 0) {
            listItems.forEach(item => {
                try {
                    const imageMatches = [...item.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)];
                    const imageCandidates = imageMatches
                        .map((entry) => this.toAbsoluteUrl(entry?.[1], this.baseUrl))
                        .filter((value) => value && !value.startsWith('data:'));
                    const image1 = imageCandidates[0] || '';
                    const image2 = imageCandidates[1] || '';

                    // Extract text content from the list item
                    const textContent = this.cleanText(item.replace(/<[^>]+>/g, ' '));

                    // Generic parsing for any sport - look for two competitors/teams separated by vs patterns
                    const parts = textContent.split(/\s+vs\s+|\s+vs\.?\s+|match\s+\d+|(?:^|\s)\d+\s+vs\s+\d+|@|-\s+(?!.*\d+-\d+)/i);

                    if (parts.length >= 2) {
                        let competitor1 = parts[0].trim();
                        let competitor2 = parts.slice(1).join(' ').trim();

                        // Remove date patterns
                        competitor1 = competitor1.replace(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d+|^\d+\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i, '').trim();
                        competitor2 = competitor2.replace(/\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d+\s*$|\s+\d+\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*$/i, '').trim();

                        // Extract record/stats if present
                        const record1Match = competitor1.match(/(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?/);
                        const record2Match = competitor2.match(/(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?/);

                        // Remove records/stats from names
                        const competitor1Clean = competitor1.replace(/\s*\d+\s*-\s*\d+(?:\s*-\s*\d+)?\s*(.*)$/, '').trim();
                        const competitor2Clean = competitor2.replace(/\s*\d+\s*-\s*\d+(?:\s*-\s*\d+)?\s*(.*)$/, '').trim();

                        const record1 = record1Match ? `${record1Match[1]}-${record1Match[2]}` : '';
                        const record2 = record2Match ? `${record2Match[1]}-${record2Match[2]}` : '';

                        // Validate: both competitors must be non-empty, reasonably sized, and not invalid terms
                        if (competitor1Clean && competitor2Clean &&
                            competitor1Clean.length > 2 && competitor2Clean.length > 2 &&
                            !isInvalidCompetitor(competitor1Clean) && !isInvalidCompetitor(competitor2Clean)) {

                            matches.push({
                                sequenceLabel: `Match ${matches.length + 1}`,
                                fighter1: competitor1Clean.substring(0, 100),
                                fighter2: competitor2Clean.substring(0, 100),
                                record1,
                                record2,
                                image1,
                                image2
                            });
                        }
                    }
                } catch { }
            });

            if (matches.length > 0) return matches;
        }

        // Fallback to table-based format
        const rows = sectionHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

        rows.forEach(row => {
            const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
            if (cells.length >= 2) {
                try {
                    const cell1Img = cells[0].match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i)?.[1] || '';
                    const cellLastImg = cells[cells.length - 1].match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i)?.[1] || '';
                    const image1 = this.toAbsoluteUrl(cell1Img, this.baseUrl) || '';
                    const image2 = this.toAbsoluteUrl(cellLastImg, this.baseUrl) || '';

                    // Extract competitor names - usually in first and last cells
                    const cell1 = this.cleanText(cells[0].replace(/<[^>]+>/g, ' '));
                    const cellLast = this.cleanText(cells[cells.length - 1].replace(/<[^>]+>/g, ' '));

                    // Split by records if present
                    const competitor1Parts = cell1.trim().split(/\s*\(|\s*\d+\s*-\s*\d+/);
                    const competitor2Parts = cellLast.trim().split(/\s*\(|\s*\d+\s*-\s*\d+/);

                    const competitor1 = (competitor1Parts[0] || '').trim();
                    const competitor2 = (competitor2Parts[0] || '').trim();

                    // Extract records if present
                    const record1Match = cell1.match(/(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?/);
                    const record2Match = cellLast.match(/(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?/);

                    const record1 = record1Match ? `${record1Match[1]}-${record1Match[2]}` : '';
                    const record2 = record2Match ? `${record2Match[1]}-${record2Match[2]}` : '';

                    if (competitor1 && competitor2 && competitor1.length > 2 && competitor2.length > 2 &&
                        !isInvalidCompetitor(competitor1) && !isInvalidCompetitor(competitor2)) {

                        matches.push({
                            sequenceLabel: `Match ${matches.length + 1}`,
                            fighter1: competitor1.substring(0, 100),
                            fighter2: competitor2.substring(0, 100),
                            record1,
                            record2,
                            image1,
                            image2
                        });
                    }
                } catch { }
            }
        });

        return matches;
    }
    async fetchInfo(id) {
        try {
            const url = await this.resolveEventUrl(id);
            if (!url) throw new Error(`Invalid stream URL: ${id}`);
            const rawHtml = await this.fetchRawHtml(url, this.homeUrl, {
                maxBytes: 700 * 1024,
                stopWhen: (text) => /<\/html>/i.test(text)
            });
            const html = this.stripUnneededHtml(rawHtml);
            const embedUrl = this.extractEmbedUrl(html, url);
            const details = this.extractEventDetails(html, url);
            const sessions = this.extractSessionCards(html);
            const eventSessions = this.extractEventSessions(html);
            const fightCard = this.extractFightCard(html);
            const eventCards = this.extractEventCards(html);
            const activeSession = (() => {
                const isReal = (s) => s && s.name && !/live\s*streams?/i.test(s.name) && !/^notstarted$/i.test(s.name);
                const candidates = [...eventSessions, ...sessions].filter(isReal);
                if (!candidates.length) return null;
                const liveMatch = candidates.find((s) => /live|in progress|started/i.test(s.status));
                if (liveMatch) return liveMatch;
                const nextMatch = candidates.find((s) => !/finished|cancelled/i.test(s.status));
                if (nextMatch) return nextMatch;
                return candidates[candidates.length - 1];
            })();
            const liveState = this.extractLiveState(details.title || this.extractTitle(html, url), details.status || '', html);
            let canonicalEventDate = '';
            const dateText = html.match(/<img[^>]+>\s*<span[^>]*>(\d{4}-\d{2}-\d{2})<\/span>/i)
                || html.match(/<[^>]*class=["'][^"']*date[^"']*["'][^>]*>([^<]*\d{4}-\d{2}-\d{2}[^<]*)<\/[^>]*>/i)
                || html.match(/>\s*(?:<[^>]+>\s*)*(\d{4}-\d{2}-\d{2})\s*</i);
            if (dateText?.[1]) canonicalEventDate = dateText[1].trim();
            let eventStartUtcMs = 0;
            const epochMatchInfo = rawHtml.match(/var\s+countDownDate\s*=\s*(\d{10,13})\s*\*\s*1000/i)
                || rawHtml.match(/(?:countDownDate|countdownTarget|eventStart|startAt|startTime|eventStartUtc)["']?\s*[:=]\s*["']?(\d{10,13})\b/i)
                || rawHtml.match(/(?:countDownDate|countdownTarget|eventStart|startAt|startTime|eventStartUtc)["']?\s*[:=]\s*["']?(\d{10,13})\s*\*\s*1000/i);
            if (epochMatchInfo) {
                const rawTs = parseInt(epochMatchInfo[1], 10);
                const tsMs = rawTs < 1e12 ? rawTs * 1000 : rawTs;
                const diffMs = tsMs - Date.now();
                if (diffMs > 0 && diffMs < 7 * 24 * 60 * 60 * 1000) {
                    eventStartUtcMs = tsMs;
                }
            }
            let countdownSeconds = -1;
            let lockReason = '';
            let countdownMatchInfo = null;
            if (eventStartUtcMs > 0) {
                countdownSeconds = Math.floor((eventStartUtcMs - Date.now()) / 1000);
                lockReason = 'countdown-timer';
            } else {
                const countdownElInfo = html.match(/(?:countdown|timer|clock|time-?left|time-?remaining)[^>]*>\s*(\d{2}):(\d{2}):(\d{2})\s*</i)
                    || html.match(/data-(?:countdown|timer|seconds|time)[=:]["']?\s*(\d{2}):(\d{2}):(\d{2})/i)
                    || html.match(/["']countdown["']\s*:\s*["'](\d{2}):(\d{2}):(\d{2})["']/i);
                if (countdownElInfo) {
                    countdownMatchInfo = countdownElInfo;
                }
                if (countdownMatchInfo) {
                    countdownSeconds = (parseInt(countdownMatchInfo[1], 10) * 3600) + (parseInt(countdownMatchInfo[2], 10) * 60) + parseInt(countdownMatchInfo[3], 10);
                    lockReason = 'countdown-timer';
                }
            }
            const hasM3u8InPage = /src\s*[:=]\s*["']?[^"'\s]*\.m3u8/i.test(rawHtml)
                || /(?:file|source|manifest|streamUrl)\s*[:=]\s*["']?[^"'\s]*\.m3u8/i.test(rawHtml)
                || /https?:\/\/[^"'\s]+\.m3u8(?:\?[^"'\s]*)?/i.test(rawHtml);
            const pageTextContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
            const hasInProgressText = /\bIN\s*PROGRESS\b|\b2ND\s*QUARTER\b|\b1ST\s*QUARTER\b|\b3RD\s*QUARTER\b|\b4TH\s*QUARTER\b|\b1ST\s*HALF\b|\b2ND\s*HALF\b|\bHALFTIME\b|\bOVERTIME\b/i.test(pageTextContent);
            const hasLiveScoreInPage = /<span[^>]*class=["'][^"']*score[^"']*["'][^>]*>\s*\d+\s*<\/span>/i.test(rawHtml);
            const hasActiveStream = hasM3u8InPage || (hasInProgressText && hasLiveScoreInPage);
            if (hasActiveStream) {
                lockReason = 'early-broadcast';
            }
            const liveScoreboard = {
                isLive: liveState.isLive,
                status: liveState.periodText || details.status || '',
                exactTime: liveState.exactTime || details.date || '',
                homeTotal: details.homeScore,
                awayTotal: details.awayScore,
                matrix: {
                    home: { T: details.homeScore ?? null },
                    away: { T: details.awayScore ?? null },
                    runsByInning: []
                }
            };
            const liveStats = {
                possession: '',
                period: liveState.periodText || '',
                time: liveState.exactTime || '',
                status: details.status || ''
            };
            let boxStats = details.awayScore !== null && details.homeScore !== null ? {
                home: { score: details.homeScore },
                away: { score: details.awayScore }
            } : null;

            let liveDirectory = null;
            let liveDirectoryTeams = null;
            try {
                const sport = this.inferType(url, details.league);
                const title = this.cleanText(details.title || this.extractTitle(html, url));
                const liveRes = await fetch(`${this.backendApiBase}/sports/buffstreams/livesport?title=${encodeURIComponent(title)}&sport=${encodeURIComponent(sport)}`, {
                    headers: { 'User-Agent': this.userAgent }
                });
                if (liveRes.ok) {
                    const liveJson = await liveRes.json();
                    liveDirectory = liveJson?.liveScoreboard || null;
                    liveDirectoryTeams = liveJson?.teams || null;
                    if (liveJson?.boxStats) {
                        boxStats = liveJson.boxStats;
                    }
                    if (liveJson?.homeLogo) {
                        details.homeLogo = liveJson.homeLogo;
                    }
                    if (liveJson?.awayLogo) {
                        details.awayLogo = liveJson.awayLogo;
                    }
                    if (liveJson?.teams) {
                        details.teams = liveJson.teams;
                    }
                }
            } catch (liveError) {
                console.warn('BuffStreams live-sport enrichment failed:', liveError?.message || liveError);
            }

            return {
                id: url,
                title: details.title || this.extractTitle(html, url),
                url,
                embedUrl,
                league: details.league,
                sport: this.inferType(url, details.league),
                eventDate: details.date,
                canonicalEventDate,
                eventStartUtcMs,
                countdownSeconds,
                hasActiveStream,
                isLive: liveState.isLive || hasActiveStream,
                isLocked: lockReason === 'countdown-timer',
                lockReason,
                status: details.status,
                teams: details.teams,
                scores: details.scores,
                awayScore: details.awayScore,
                homeScore: details.homeScore,
                liveScoreboard: liveDirectory || liveScoreboard,
                liveStats,
                boxStats,
                liveDirectoryTeams,
                sessions,
                eventSessions,
                activeSession,
                fightCard,
                cards: eventCards
            };
        } catch (error) {
            console.error('Error in BuffStreams fetchInfo:', error);
            throw error;
        }
    }

    async fetchServerButtonsFromPage(pageUrl) {
        try {
            const response = await fetch(pageUrl, {
                headers: this.buildHeaders(pageUrl),
                signal: AbortSignal.timeout(15000)
            });
            if (!response.ok) return { servers: [], embedUrl: '', error: `HTTP ${response.status}` };
            const html = await response.text();

            const pageOrigin = (() => { try { return new URL(pageUrl).origin; } catch { return ''; } })();
            const $ = cheerioLoad(html);
            const servers = [];
            const seenUrls = new Set();

            const streamSection = $(
                '#live-stream-section, .streaming-section, .stream-block, ' +
                '.live-streams-wrapper, .streams-container, .video-servers, ' +
                '.server-navigation, .server-list, #server-list, #streams, ' +
                '.new-table, #streams-table, .table-row, ' +
                '[class*="server"], [class*="stream"], [id*="server"], [id*="stream"], ' +
                '.watch-live, .live-servers, .stream-links, .game-streams'
            ).first();
            const container = streamSection.length ? streamSection : $('body');

            const excludedNames = new Set(['thetvapp', 'crackstreams', 'methstreams', 'buffstream']);
            const pushServer = (name, url, engine, quality) => {
                const cleanName = String(name || '').replace(/\s+/g, ' ').trim();
                let cleanUrl = String(url || '').replace(/&amp;/g, '&').trim();
                if (!cleanName || cleanName.length > 60 || !cleanUrl) return;
                if (cleanUrl.startsWith('//')) cleanUrl = 'https:' + cleanUrl;
                if (!/^https?:\/\//i.test(cleanUrl) && pageOrigin) {
                    try { cleanUrl = new URL(cleanUrl, pageOrigin).toString(); } catch { return; }
                }
                if (!/^https?:\/\//i.test(cleanUrl)) return;
                if (seenUrls.has(cleanUrl)) return;
                seenUrls.add(cleanUrl);
                const nameLower = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (excludedNames.has(nameLower)) return;
                servers.push({ name: cleanName, url: cleanUrl, engine: engine || 'iframe', quality: quality || 'auto' });
            };

            // 1) Parse table rows in #streams / .new-table (stream server list)
            $('#streams table tbody tr, #streams .table-row, .new-table tbody tr, .new-table .table-row').each((_, el) => {
                const $el = $(el);
                const name = $el.find('.streamer-name, .mobile-name').text().trim() || $el.find('td:first').text().trim();
                if (!name) return;
                let url = '';
                const link = $el.find('a.watch-btn, a[href]').first();
                if (link.length) {
                    url = link.attr('href') || '';
                }
                if (!url) {
                    const onclick = $el.attr('onclick') || '';
                    const m = onclick.match(/window\.open\s*\(\s*['"]([^'"]+)['"]/i);
                    if (m) url = m[1];
                }
                if (!url) return;
                pushServer(name, url, 'iframe', 'auto');
            });

            // 2) General server button search (existing)
            container.find('a, button, [role="button"], .server-btn, .stream-btn, [data-server], [data-stream]').each((_, el) => {
                const $el = $(el);
                let name = $el.attr('data-name') || $el.attr('data-server') || $el.attr('title') || $el.attr('aria-label') || $el.text().trim();
                name = name.replace(/\s+/g, ' ').trim();
                if (!name || name.length > 60 || seenUrls.has($el.attr('href') || $el.attr('data-src') || $el.attr('data-url') || '')) return;
                let url = $el.attr('href') || $el.attr('data-src') || $el.attr('data-url') || $el.attr('data-iframe') || $el.attr('src') || '';
                url = String(url).replace(/&amp;/g, '&').trim();
                if (url.startsWith('//')) url = 'https:' + url;
                if (!/^https?:\/\//i.test(url) && pageOrigin) {
                    try { url = new URL(url, pageOrigin).toString(); } catch { return; }
                }
                if (!/^https?:\/\//i.test(url)) return;
                if (seenUrls.has(url)) return;
                seenUrls.add(url);

                const onclick = $el.attr('onclick') || '';
                let engine = 'hls';
                const engineHint = String(name + ' ' + onclick).toLowerCase();
                if (/iframe|embed|frame|player/i.test(engineHint)) engine = 'iframe';

                const qualityHint = $el.find('.quality, .res, [class*="quality"], [class*="res"]').first().text().trim()
                    || $el.attr('data-quality') || 'auto';
                servers.push({ name, url, engine, quality: qualityHint });
            });

            // 3) Fallback: regex extraction from raw HTML for JS-rendered content
            if (servers.length < 2) {
                const streamUrlPattern = /(?:href|window\.open)\s*\(\s*['"](https?:\/\/[^'"]+(?:stream|embed|watch|live)[^'"]*)['"]/gi;
                const namePattern = /(?:<span[^>]*class=["'][^"']*streamer-name[^"']*["'][^>]*>([\s\S]{0,80}?)<\/span>)/gi;
                const names = [];
                let m;
                while ((m = namePattern.exec(html)) !== null) {
                    const n = this.cleanText(m[1]);
                    if (n && !names.includes(n)) names.push(n);
                }
                let idx2 = 0;
                const streamUrls = [];
                while ((m = streamUrlPattern.exec(html)) !== null) {
                    const u = String(m[1]).replace(/&amp;/g, '&').trim();
                    if (u && !streamUrls.includes(u)) {
                        const name = names[idx2] || 'Server ' + (idx2 + 1);
                        pushServer(name, u, 'iframe', 'auto');
                        streamUrls.push(u);
                        idx2++;
                    }
                }
            }

            let embedUrl = '';
            $('iframe[id="cx-iframe"], iframe[src]').each((_, el) => {
                const src = $(el).attr('src') || '';
                if (src && !embedUrl) {
                    embedUrl = src.replace(/&amp;/g, '&').trim();
                    if (embedUrl.startsWith('//')) embedUrl = 'https:' + embedUrl;
                }
            });
            if (!embedUrl) {
                const m = html.match(/<iframe[^>]+id=["']cx-iframe["'][^>]+src=["']([^"']+)["']/i);
                if (m) embedUrl = m[1].replace(/&amp;/g, '&').trim();
            }
            if (!embedUrl) {
                $('frame[src]').each((_, el) => {
                    const src = $(el).attr('src') || '';
                    if (src && !embedUrl) {
                        embedUrl = src.replace(/&amp;/g, '&').trim();
                        if (embedUrl.startsWith('//')) embedUrl = 'https:' + embedUrl;
                    }
                });
            }

            return { servers, embedUrl, error: '' };
        } catch (error) {
            console.error(`[Stream.js] fetchServerButtonsFromPage failed for ${pageUrl}:`, error?.message || error);
            return { servers: [], embedUrl: '', error: error.message };
        }
    }

    async fetchSources(eventUrl) {
        const pageResult = await this.fetchServerButtonsFromPage(eventUrl);
        const allSources = [];
        const seen = new Set();

        for (const server of pageResult.servers) {
            const key = server.url;
            if (seen.has(key)) continue;
            seen.add(key);
            const isM3u8 = /\.m3u8(\?|$)/i.test(server.url) || /load-playlist|\/playlist\//i.test(server.url);
            allSources.push({
                name: server.name,
                url: server.url,
                engine: server.engine,
                quality: server.quality,
                isM3U8: isM3u8,
                isDirect: !isM3u8,
                headers: this.buildHeaders(eventUrl)
            });
        }

        if (pageResult.embedUrl && !seen.has(pageResult.embedUrl)) {
            seen.add(pageResult.embedUrl);
            const isM3u8 = /\.m3u8(\?|$)/i.test(pageResult.embedUrl) || /load-playlist|\/playlist\//i.test(pageResult.embedUrl);
            allSources.push({
                name: 'Embed',
                url: pageResult.embedUrl,
                engine: 'iframe',
                quality: 'auto',
                isM3U8: isM3u8,
                isDirect: !isM3u8,
                headers: this.buildHeaders(pageResult.embedUrl || eventUrl)
            });

            try {
                const embedResp = await fetch(pageResult.embedUrl, {
                    headers: this.buildHeaders(eventUrl),
                    signal: AbortSignal.timeout(10000)
                });
                if (embedResp.ok) {
                    const embedHtml = await embedResp.text();
                    const hlsFromEmbed = this.extractAllSourcesFromEmbed(embedHtml, pageResult.embedUrl, eventUrl);
                    for (const hlsSrc of hlsFromEmbed) {
                        if (!seen.has(hlsSrc.url)) {
                            seen.add(hlsSrc.url);
                            allSources.push({
                                name: 'HD Stream',
                                url: hlsSrc.url,
                                isM3U8: true,
                                engine: 'hls',
                                quality: hlsSrc.quality || 'auto',
                                isM3U8: true,
                                isDirect: true,
                                headers: this.buildHeaders(eventUrl)
                            });
                        }
                    }
                }
            } catch (err) {
                console.warn(`[Stream.js] Embed HLS extraction failed: ${err?.message || err}`);
            }
        }

        const embedFetchTasks = pageResult.servers
            .filter((s) => s.url && s.url !== pageResult.embedUrl)
            .slice(0, 8)
            .map(async (server, i) => {
                try {
                    const embedUrl = await this.resolveServerEmbed(server.url);
                    if (!embedUrl || seen.has(embedUrl)) return;
                    seen.add(embedUrl);
                    const resp = await fetch(embedUrl, {
                        headers: this.buildHeaders(eventUrl),
                        signal: AbortSignal.timeout(8000)
                    });
                    if (!resp.ok) return;
                    const html = await resp.text();
                    const hlsList = this.extractAllSourcesFromEmbed(html, embedUrl, server.url);
                    for (const hlsSrc of hlsList) {
                        if (!seen.has(hlsSrc.url)) {
                            seen.add(hlsSrc.url);
                            allSources.push({
                                name: server.name + ' HLS',
                                url: hlsSrc.url,
                                isM3U8: true,
                                engine: 'hls',
                                quality: hlsSrc.quality || 'auto',
                                isDirect: true,
                                headers: this.buildHeaders(eventUrl)
                            });
                        }
                    }
                } catch {
                }
            });
        await Promise.allSettled(embedFetchTasks);

        if (allSources.length > 0) {
            const filtered = allSources.filter(s => !s.isM3U8 && !/\.m3u8(\?|$)/i.test(s.url));
            console.log(`[Stream.js] Direct page extraction returned ${allSources.length} source(s), ${filtered.length} after HLS filter`);
            return {
                sources: filtered,
                subtitles: [],
                headers: this.buildHeaders(eventUrl),
                embedUrl: pageResult.embedUrl || ''
            };
        }

        console.warn(`[Stream.js] No sources found on page for ${eventUrl}, falling back to backend RPC`);
        const backendResult = await BuffStreams.fetchSourcesFromBackend(
            eventUrl,
            this.backendApiBase
        );
        if (Array.isArray(backendResult?.sources) && backendResult.sources.length > 0) {
            const enriched = backendResult.sources
                .filter(s => !s.isM3U8 && !/\.m3u8(\?|$)/i.test(s.url))
                .map((s) => ({
                    ...s,
                    name: s.name || s.server || s.label || 'Source',
                    engine: s.engine || (s.isM3U8 ? 'hls' : 'iframe')
                }));
            const embedUrl = backendResult.embedUrl || '';
            if (embedUrl && !enriched.some((s) => s.url === embedUrl)) {
                enriched.push({
                    name: 'Embed',
                    url: embedUrl,
                    engine: 'iframe',
                    quality: 'auto',
                    isM3U8: false,
                    isDirect: false,
                    headers: this.buildHeaders(embedUrl)
                });
            }
            return { ...backendResult, sources: enriched };
        }

        const embedFallback = backendResult?.embedUrl || '';
        if (!embedFallback) return { sources: allSources, subtitles: [], headers: this.buildHeaders(eventUrl), embedUrl: '' };

        try {
            let embedOrigin = '';
            try { embedOrigin = new URL(embedFallback).origin; } catch { }
            const refererHeaders = embedOrigin
                ? { Referer: embedOrigin + '/', Origin: embedOrigin }
                : {};

            const embedResponse = await fetch(embedFallback, {
                headers: { 'User-Agent': this.userAgent, ...refererHeaders },
                signal: AbortSignal.timeout(10000),
            });
            if (embedResponse.ok) {
                const embedHtml = await embedResponse.text();
                const embedSources = this.extractAllSourcesFromEmbed(embedHtml, embedFallback, eventUrl);
                if (embedSources.length > 0) {
                    const enriched = embedSources.map((s) => ({
                        ...s,
                        name: s.name || s.server || 'Stream',
                        engine: s.engine || (s.isM3U8 ? 'hls' : 'iframe')
                    }));
                    enriched.push({
                        name: 'Embed',
                        url: embedFallback,
                        engine: 'iframe',
                        quality: 'auto',
                        isM3U8: false,
                        isDirect: false,
                        headers: refererHeaders
                    });
                    return { sources: enriched, subtitles: [], headers: refererHeaders, embedUrl: embedFallback };
                }
            }
        } catch (error) {
            console.warn(`[Stream.js] Embed fallback failed:`, error?.message || error);
        }

        return { sources: allSources, subtitles: [], headers: this.buildHeaders(eventUrl), embedUrl: pageResult.embedUrl || '' };
    }

    async verifyEventSources(eventUrl) {
        try {
            const normalizedEventUrl = await this.resolveEventUrl(eventUrl);
            if (!normalizedEventUrl) throw new Error(`Invalid event URL: ${eventUrl}`);

            const headResponse = await this.supportsHead(normalizedEventUrl, this.homeUrl);
            if (headResponse && headResponse.status >= 400 && headResponse.status !== 403 && headResponse.status !== 405) {
                throw new Error(`Event page unavailable: ${headResponse.status}`);
            }

            const eventHtml = await this.fetchLeanHtml(normalizedEventUrl, this.homeUrl, {
                maxBytes: 384 * 1024,
                stopWhen: (text) => /<iframe[^>]+(?:id=["']cx-iframe["'][^>]+)?src=["'][^"']+["']/i.test(text)
            });
            const embedUrl = this.extractEmbedUrl(eventHtml, normalizedEventUrl);
            if (!embedUrl) throw new Error('No stream iframe found on the event page');

            const embedHead = await this.supportsHead(embedUrl, normalizedEventUrl);
            if (embedHead && embedHead.status >= 400 && embedHead.status !== 403 && embedHead.status !== 405) {
                throw new Error(`Embed page unavailable: ${embedHead.status}`);
            }

            const embedHtml = await this.fetchLeanHtml(embedUrl, normalizedEventUrl, {
                maxBytes: 384 * 1024,
                strip: false,
                stopWhen: (text) => /(?:window\.atob|source\s*:|\.m3u8|load-playlist|\/playlist\/)/i.test(text)
            });
            const allSources = this.extractAllSourcesFromEmbed(embedHtml, embedUrl, normalizedEventUrl);
            if (!allSources.length) throw new Error('No direct HLS URL found in embed');

            return {
                sources: allSources,
                subtitles: [],
                headers: {},
                embedUrl,
                verifiedOnly: true
            };
        } catch (error) {
            console.error('Error in BuffStreams verifyEventSources:', error);
            return { sources: [], subtitles: [], headers: {}, error: error.message, verifiedOnly: true };
        }
    }
    collectSourceCandidates(eventUrl, embedFallback) {
        const candidates = [];
        const push = (value) => {
            const raw = String(value || '').trim();
            if (!raw || candidates.includes(raw)) return;
            candidates.push(raw);
        };
        push(embedFallback);
        push(eventUrl);
        return candidates.filter((value) => /^https?:\/\//i.test(value));
    }
    extractAllSourcesFromEmbed(html, candidateUrl, pageUrl) {
        const source = String(html || '');
        const headers = this.buildHeaders(candidateUrl || pageUrl);
        const out = [];
        const seen = new Set();
        const push = (url, quality = 'auto') => {
            const clean = String(url || '').trim();
            if (!clean || seen.has(clean)) return;
            seen.add(clean);
            out.push({
                url: clean,
                quality,
                isM3U8: /\.m3u8(\?|$)/i.test(clean) || /\/m3u8-proxy\?/i.test(clean) || /\/playlist\//i.test(clean),
                isDirect: true,
                headers
            });
        };
        for (const match of source.matchAll(/https?:\/\/[^'"\s]+(?:load-playlist|\.m3u8|\/playlist\/[^'"\s]*)/gi)) {
            push(match[0], 'auto');
        }
        for (const match of source.matchAll(/['"](https?:\/\/[^'"]+)['"]/gi)) {
            if (/load-playlist|\.m3u8|\/playlist\//i.test(match[1])) push(match[1], 'auto');
        }
        for (const match of source.matchAll(/window\.atob\(\s*['"]([^'"]+)['"]\s*\)/gi)) {
            try {
                const decoded = Buffer.from(String(match[1]).trim(), 'base64').toString('utf8').trim();
                if (/^https?:\/\//i.test(decoded)) push(decoded, 'auto');
            } catch { }
        }
        return out;
    }

    async resolveServerEmbed(serverUrl) {
        try {
            const response = await fetch(serverUrl, {
                headers: { 'User-Agent': this.userAgent }
            });
            if (!response.ok) return null;
            const html = await response.text();
            const $ = cheerioLoad(html);

            const knownIds = ['wp_player', 'player', 'main-player', 'video-player', 'stream-player', 'embed-player', 'live-stream'];
            for (const id of knownIds) {
                const iframe = $(`iframe#${id}`);
                if (iframe.length) {
                    const src = iframe.attr('src');
                    if (src) return src;
                }
            }

            const knownClasses = ['embed-responsive-item', 'player-iframe', 'stream-iframe', 'video-iframe'];
            for (const cls of knownClasses) {
                const iframe = $(`iframe.${cls}`);
                if (iframe.length) {
                    const src = iframe.attr('src');
                    if (src) return src;
                }
            }

            const allIframes = $('iframe');
            for (let i = 0; i < allIframes.length; i++) {
                const src = $(allIframes[i]).attr('src') || '';
                if (/gooz\.aapmains|embed|stream|player|watch/i.test(src) && !/youtube.*chat|live.*chat|googleads|doubleclick|facebook/i.test(src)) {
                    return src;
                }
            }

            for (let i = 0; i < allIframes.length; i++) {
                const src = $(allIframes[i]).attr('src') || '';
                if (src && src.startsWith('http') && !/youtube.*chat|googleads|doubleclick/i.test(src)) {
                    return src;
                }
            }

            const embedPattern = /gooz\.aapmains\.net\/new-stream-embed\/(\d+)/i;
            const jsMatch = html.match(embedPattern);
            if (jsMatch) {
                return 'https://' + jsMatch[0];
            }

            return null;
        } catch {
            return null;
        }
    }

    // Lightweight transport bridge that forwards a watch request directly
    // to the configured Consumet backend. Returns the normalized
    // { sources, subtitles, headers, embedUrl } shape that watch.html and
    // server.js consume. This is the PRIMARY source fetch path; the instance
    // fetchSources() method falls through to local HTML extraction only when
    // this returns an empty sources array.
    //
    // NOTE: This method MUST remain inside the class body so that
    // BuffStreams.fetchSourcesFromBackend() is a valid static call.
    static decodeUrlSafeToken(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        try {
            const decodedUrl = decodeURIComponent(raw);
            if (/^https?:\/\//i.test(decodedUrl)) return decodedUrl;
            const normalized = decodedUrl.replace(/-/g, '+').replace(/_/g, '/');
            const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
            const decoded = Buffer.from(padded, 'base64').toString('utf8').trim();
            return /^https?:\/\//i.test(decoded) ? decoded : decodedUrl;
        } catch {
            return raw;
        }
    }

    static normalizeBackendPayload(data, target) {
        const sources = Array.isArray(data?.sources) ? data.sources : [];
        const upstreamReferer = data?.headers?.Referer || data?.headers?.referer || data?.referer || BuffStreams.prototype.baseUrl;
        const upstreamOrigin = (() => {
            try { return new URL(upstreamReferer).origin; } catch { return BuffStreams.prototype.baseUrl; }
        })();
        return {
            sources: sources.map((source) => ({
                ...source,
                headers: {
                    ...(source?.headers || {}),
                    ...(data?.headers || {}),
                    Referer: source?.headers?.Referer || source?.headers?.referer || upstreamReferer,
                    Origin: source?.headers?.Origin || source?.headers?.origin || upstreamOrigin,
                    'User-Agent': source?.headers?.['User-Agent'] || source?.headers?.user_agent || BuffStreams.prototype.userAgent
                }
            })),
            subtitles: Array.isArray(data?.subtitles) ? data.subtitles : [],
            headers: {
                ...(data?.headers || {}),
                Referer: upstreamReferer,
                Origin: upstreamOrigin,
                'User-Agent': BuffStreams.prototype.userAgent
            },
            embedUrl: data?.embedURL || data?.embedUrl || target
        };
    }

    static async fetchSourcesFromBackend(eventUrl, backendBase) {
        const resolvedBase = backendBase
            || (globalThis.process?.env?.CONSUMET_API_BASE || globalThis.process?.env?.SITE_API_BASE || 'http://localhost:3000').replace(/\/$/, '');
        const target = BuffStreams.decodeUrlSafeToken(eventUrl);
        if (!target) return { sources: [], subtitles: [], headers: {}, error: 'no_event_url' };
        const isRacing = /fullraces|racing|formula-1|nascar|indycar/i.test(target);
        const apiPath = isRacing
            ? `/api/racing/watch?episodeId=${encodeURIComponent(target)}`
            : `/sports/buffstreams/watch?episodeId=${encodeURIComponent(target)}`;
        const base = isRacing
            ? (globalThis.process?.env?.SITE_API_BASE || `http://localhost:${globalThis.process?.env?.PORT || 3001}`).replace(/\/$/, '')
            : String(resolvedBase || '').replace(/\/$/, '');
        try {
            const response = await fetch(`${base}${apiPath}`, { cache: 'no-store' });
            if (!response.ok) {
                return { sources: [], subtitles: [], headers: {}, error: `backend_${response.status}` };
            }
            const data = await response.json();
            return BuffStreams.normalizeBackendPayload(data, target);
        } catch (err) {
            return { sources: [], subtitles: [], headers: {}, error: err?.message || 'backend_unreachable' };
        }
    }
    static forceBuffstreamsProbe() {
        return forceBuffstreamsProbe();
    }

    static getProbeBackoff() {
        return buffstreamsProbeBackoff;
    }
}

export default BuffStreams;





