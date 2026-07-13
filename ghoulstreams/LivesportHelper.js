(function() {
const BASE = 'https://www.livesport.com/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const SPORT_BY_ID = { '1': 'soccer', '3': 'basketball', '4': 'hockey', '5': 'cfl', '6': 'baseball', '12': 'american-football' };
const SOCCER_RE = /\b(soccer|premier league|la liga|serie a|bundesliga|uefa|fifa)\b/i;
const SUPPORTED_RE = /\b(baseball|mlb|basketball|nba|hockey|nhl|american football|nfl|cfl)\b/i;
const LIVE_RE = /\b(in progress|live|inning|quarter|period|halftime|half time|ht|break|intermission|delay|1st half|2nd half|overtime|ot)\b/i;

function cleanText(value) {
    return String(value || '').replace(/[\s\r\n]+/g, ' ').trim();
}

function num(value) {
    const parsed = Number(String(value || '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNum(value) {
    const raw = String(value ?? '').trim();
    if (!raw || /^(x|-|null)$/i.test(raw)) return null;
    const parsed = Number(raw.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
}

function ordinal(value) {
    if (value % 100 >= 11 && value % 100 <= 13) return 'TH';
    return value % 10 === 1 ? 'ST' : value % 10 === 2 ? 'ND' : value % 10 === 3 ? 'RD' : 'TH';
}

function stripHeavyHtml(html) {
    return String(html || '')
        .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
        .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
        .replace(/<footer\b[\s\S]*?<\/footer>/gi, '')
        .replace(/data:image\/[^"']{500,}/gi, '')
        .replace(/<script\b(?![^>]*(?:__INITIAL_STATE__|__NEXT_DATA__|environment))[\s\S]*?<\/script>/gi, '');
}

function absolute(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        return new URL(raw, BASE).toString();
    } catch {
        return '';
    }
}

function inferSport(rowId, rowText, containerText) {
    const id = rowId.match(/^g_(\d+)_/i)?.[1] || '';
    if (id === '1') return 'soccer';
    if (SPORT_BY_ID[id]) return SPORT_BY_ID[id];
    const text = `${containerText} ${rowText}`.toLowerCase();
    if (SOCCER_RE.test(text) && !/american football|nfl/.test(text)) return 'soccer';
    if (/baseball|mlb/.test(text)) return 'baseball';
    if (/basketball|nba/.test(text)) return 'basketball';
    if (/hockey|nhl/.test(text)) return 'hockey';
    if (/american football|nfl/.test(text)) return 'american-football';
    return SUPPORTED_RE.test(text) ? 'other' : null;
}

function normalizeName(value) {
    return cleanText(value)
        .replace(/\b(in progress|live|halftime|half time|\d+(?:st|nd|rd|th)?\s+(?:inning|quarter|period))\b/gi, '')
        .replace(/\b\d+\b/g, '')
        .replace(/[¢•|]/g, ' ')
        .trim();
}

function statusFromText(text) {
    return cleanText(
        (text.match(
            /\b(?:IN PROGRESS|LIVE|HALFTIME|HALF TIME|HT|BREAK|INTERMISSION|DELAYED|POSTPONED|CANCELLED|\d+(?:ST|ND|RD|TH)\s+(?:INNING|QUARTER|PERIOD)|\d+['’]|OT|OVERTIME)\b/i,
        ) || [])[0] || ''
    );
}

function assetFromEl(el) {
    if (!el) return '';
    const candidates = [
        el.getAttribute('src'),
        el.getAttribute('data-src'),
        el.getAttribute('data-original'),
        el.getAttribute('data-lazy'),
        (el.getAttribute('srcset') || '').split(/\s+/)[0],
        (el.getAttribute('data-srcset') || '').split(/\s+/)[0],
    ];
    for (const value of candidates) {
        const resolved = absolute(value);
        if (resolved) return resolved;
    }
    return '';
}

function parseDirectoryRow(el) {
    try {
        const rowId = el.getAttribute('id') || '';
        const rowText = cleanText(el.textContent || '');
        const parentEl = el.closest('.sportName, .event, .leagues--static, [class*="sport"], [class*="league"]');
        const parentText = cleanText(parentEl ? parentEl.textContent || '' : '').slice(0, 700);
        const sport = inferSport(rowId, rowText, parentText);
        if (!sport) return null;

        const fallbackNodes = el.querySelectorAll('.event__participant, [class*="participant"], [class*="teamName"]');
        const fallbackNames = Array.from(fallbackNodes, (item) => normalizeName(item.textContent || '')).filter(Boolean);

        const homeEl = el.querySelector('.event__participant--home, [class*="participant--home"], [class*="homeParticipant"], [data-testid*="home"]');
        const homeTeam = normalizeName(homeEl ? homeEl.textContent || '' : '') || fallbackNames[0] || '';

        const awayEl = el.querySelector('.event__participant--away, [class*="participant--away"], [class*="awayParticipant"], [data-testid*="away"]');
        const awayTeam = normalizeName(awayEl ? awayEl.textContent || '' : '') || fallbackNames[1] || '';

        if (!homeTeam || !awayTeam) return null;

        const scoreNodes = el.querySelectorAll('.event__score, [class*="score"], [data-testid*="score"]');
        const scores = Array.from(scoreNodes)
            .map((score) => cleanText(score.textContent || ''))
            .filter((score) => /^-?\d+$/.test(score));

        const matchId =
            rowId.replace(/^g_\d+_/i, '') ||
            el.getAttribute('data-id') ||
            el.getAttribute('data-event-id') ||
            '';

        const status =
            statusFromText(rowText) ||
            cleanText((el.querySelector('.event__stage, [class*="stage"], [class*="status"]') || {}).textContent || '');

        const linkEl = el.querySelector('a[href]');
        const href = linkEl ? linkEl.getAttribute('href') || '' : '';
        const url = absolute(href) || (matchId ? `${BASE}match/${matchId}/#/match-summary` : '');

        return {
            matchId,
            sport,
            title: `${homeTeam} vs ${awayTeam}`,
            homeTeam,
            awayTeam,
            status,
            homeTotal: num(scores[0] || '0'),
            awayTotal: num(scores[1] || '0'),
            url,
            rowText,
        };
    } catch {
        return null;
    }
}

function discoverMatches(html) {
    const cleaned = stripHeavyHtml(html);
    const doc = new DOMParser().parseFromString(cleaned, 'text/html');
    const rows = doc.querySelectorAll('div[id^="g_"], .event__match, .event__match--live, [data-event-id], [class*="event__match"]');
    const map = new Map();
    rows.forEach((row) => {
        const parsed = parseDirectoryRow(row);
        if (!parsed) return;
        if (!LIVE_RE.test(`${parsed.status} ${parsed.rowText}`) && parsed.homeTotal === 0 && parsed.awayTotal === 0) return;
        const key = parsed.matchId || `${parsed.sport}:${parsed.homeTeam}:${parsed.awayTeam}`.toLowerCase();
        if (!map.has(key)) map.set(key, parsed);
    });
    return [...map.values()];
}

function carrySoccerClock(matchId, status, isLive, soccerClockAnchors) {
    if (!isLive) {
        if (matchId) soccerClockAnchors.delete(matchId);
        return status;
    }
    const key = matchId || '';
    if (!key) return status;
    const timeMatch = String(status || '').match(/^(\d{1,3}):(\d{2})$/);
    if (timeMatch) {
        soccerClockAnchors.set(key, {
            minute: Number(timeMatch[1]),
            observedAt: Date.now() - Number(timeMatch[2]) * 1000,
        });
        return status;
    }
    const minuteMatch = String(status || '').match(/^(\d{1,3})'$/);
    if (!minuteMatch) return status;
    const minute = Number(minuteMatch[1]);
    const now = Date.now();
    const existing = soccerClockAnchors.get(key);
    if (!existing || existing.minute !== minute || now - existing.observedAt > 90000) {
        soccerClockAnchors.set(key, { minute, observedAt: now });
        return `${String(minute).padStart(2, '0')}:00`;
    }
    const elapsedSeconds = Math.max(0, Math.floor((now - existing.observedAt) / 1000));
    const totalSeconds = minute * 60 + Math.min(59, elapsedSeconds);
    const displayMinute = Math.floor(totalSeconds / 60);
    const displaySecond = totalSeconds % 60;
    return `${String(displayMinute).padStart(2, '0')}:${String(displaySecond).padStart(2, '0')}`;
}

function fromSeed(seed, soccerClockAnchors) {
    const matrix = seed.matrix || { home: {}, away: {}, runsByInning: [] };
    const statusRow = `${seed.status} ${seed.rowText}`;
    let isLive = false;
    if (!/\b(finished|completed|ended|full\s*time|ft\b|final)\b/i.test(statusRow)) {
        isLive =
            LIVE_RE.test(statusRow) ||
            /^\d+'$/.test(seed.status) ||
            /^Q[1-4]$/i.test(seed.status) ||
            (seed.sport === 'soccer'
                ? /^\d+:\d+$/.test(seed.status)
                : /^\d+:\d+$/.test(seed.status));
    }
    const status =
        seed.sport === 'soccer'
            ? carrySoccerClock(seed.matchId, seed.status || 'Scheduled', isLive, soccerClockAnchors)
            : seed.status || 'Scheduled';
    const liveScoreboard = {
        homeTotal: seed.homeTotal,
        awayTotal: seed.awayTotal,
        status,
        isLive,
        matrix,
    };
    return {
        matchId: seed.matchId,
        sport: seed.sport,
        status: liveScoreboard.status,
        teams: { home: seed.homeTeam, away: seed.awayTeam },
        homeTeam: seed.homeTeam,
        awayTeam: seed.awayTeam,
        homeLogo: seed.homeLogo || '',
        awayLogo: seed.awayLogo || '',
        url: seed.url,
        title: seed.title,
        startTime: seed.startTime,
        homeTotal: seed.homeTotal,
        awayTotal: seed.awayTotal,
        homeScore: seed.homeTotal,
        awayScore: seed.awayTotal,
        liveScoreboard,
        rowText: seed.rowText,
    };
}

function makeCacheKeys(homeTeam, awayTeam) {
    const keys = new Set();
    for (const name of [homeTeam, awayTeam]) {
        if (!name) continue;
        const norm = cleanText(name).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        if (norm.length > 2) keys.add(norm);
        for (const part of norm.split(/\s+/)) {
            if (part.length > 2) keys.add(part);
        }
    }
    return [...keys];
}

const SCRAPE_URLS = [
    { sport: 'all', url: BASE },
    { sport: 'baseball', url: `${BASE}baseball/` },
    { sport: 'basketball', url: `${BASE}basketball/` },
    { sport: 'hockey', url: `${BASE}hockey/` },
    { sport: 'american-football', url: `${BASE}american-football/` },
];

async function fetchHtml(url) {
    const response = await fetch(url, {
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': BASE,
        },
    });
    if (!response.ok) throw new Error(`HTML fetch failed: ${response.status} for ${url}`);
    return response.text();
}

class LivesportHelper {
    static cache = { matches: [], cachedAt: 0 };
    static cacheMap = new Map();
    static soccerClockAnchors = new Map();

    static async getAllLiveStats(forceRefresh = false) {
        const now = Date.now();
        const hasLive = this.cache.matches.some(m =>
            m.liveScoreboard?.isLive ||
            /inning|quarter|period|progress|live|ht|halftime|break|intermission/i.test(m.status) ||
            /^\d+:\d+$/.test(m.status)
        );
        const ttl = hasLive ? 20000 : 60000;
        if (!forceRefresh && now - this.cache.cachedAt < ttl && this.cache.matches.length > 0) {
            return this.cache.matches;
        }

        const seedMap = new Map();

        for (const entry of SCRAPE_URLS) {
            try {
                const html = await fetchHtml(entry.url);
                const discovered = discoverMatches(html);
                for (const seed of discovered) {
                    const key = seed.matchId || `${seed.sport}:${seed.homeTeam}:${seed.awayTeam}`.toLowerCase();
                    if (!seedMap.has(key)) seedMap.set(key, seed);
                }
            } catch {}
        }

        const oldMatchesMap = new Map();
        for (const m of this.cache.matches) {
            if (m && m.matchId) oldMatchesMap.set(m.matchId, m);
        }

        const matches = [];
        for (const seed of seedMap.values()) {
            let matchObj = fromSeed(seed, this.soccerClockAnchors);
            const oldMatch = oldMatchesMap.get(seed.matchId);
            if (oldMatch) {
                matchObj.homeLogo = seed.homeLogo || oldMatch.homeLogo || '';
                matchObj.awayLogo = seed.awayLogo || oldMatch.awayLogo || '';
                if (oldMatch.liveScoreboard) {
                    if (
                        oldMatch.liveScoreboard.isLive &&
                        matchObj.liveScoreboard.isLive &&
                        /^\d+:\d+$/.test(matchObj.liveScoreboard.status)
                    ) {
                        matchObj.liveScoreboard.status = oldMatch.liveScoreboard.status;
                        matchObj.status = oldMatch.liveScoreboard.status;
                    }
                }
            }
            matches.push(matchObj);
            const cacheKeys = makeCacheKeys(seed.homeTeam, seed.awayTeam);
            for (const k of cacheKeys) {
                if (!this.cacheMap.has(k)) this.cacheMap.set(k, []);
                this.cacheMap.get(k).push(matchObj);
            }
        }

        this.cache = { matches, cachedAt: Date.now() };
        return matches;
    }

    static async getDirectory() {
        const matches = await this.getAllLiveStats();
        return { matches };
    }
}

(typeof window !== 'undefined' ? window : globalThis).LivesportHelper = LivesportHelper;
})();
