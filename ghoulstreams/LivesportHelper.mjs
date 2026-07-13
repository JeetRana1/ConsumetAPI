const BASE = 'https://www.livesport.com/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const SPORT_BY_ID = { '1': 'soccer', '3': 'basketball', '4': 'hockey', '5': 'cfl', '6': 'baseball', '12': 'american-football', '16': 'boxing' };
const SOCCER_RE = /\b(soccer|premier league|la liga|serie a|bundesliga|uefa|fifa)\b/i;
const SUPPORTED_RE = /\b(baseball|mlb|basketball|nba|hockey|nhl|american football|nfl|cfl)\b/i;
const LIVE_RE = /\b(in progress|live|inning|quarter|period|halftime|half time|ht|break|intermission|delay|1st half|2nd half|overtime|ot)\b/i;
const FEED_SIGN = 'SW9D1eZo';

let dynamicFsign = FEED_SIGN;

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

function feedAsset(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    return `https://static.flashscore.com/res/image/data/${raw}`;
}

function feedFields(record) {
    const fields = {};
    if (!record) return fields;
    const parts = String(record).split(/[¬\u00ac~]/);
    for (const part of parts) {
        if (!part) continue;
        const index = part.search(/[÷\u00f7]/);
        if (index > 0) {
            const key = part.slice(0, index).trim();
            const value = part.slice(index + 1).trim();
            if (key) fields[key] = value;
        } else {
            const clean = part.replace(/÷/g, '÷').replace(/¬/g, '¬');
            const idx = clean.indexOf('÷');
            if (idx > 0) {
                const key = clean.slice(0, idx).trim();
                const value = clean.slice(idx + 1).trim();
                if (key) fields[key] = value;
            }
        }
    }
    return fields;
}

function feedStatus(fields, sport) {
    const stage = fields.AB || '';
    const note = cleanText(fields.AM || fields.AC || fields.AD || fields.AX || '');
    const isFootball = sport === 'cfl' || sport === 'american-football' || sport === 'nfl';
    if (note && /delay|postpon|cancel|intermission|halftime|half\s*time|break|ht/i.test(note)) {
        if (/ht|halftime|half\s*time/i.test(note)) return isFootball ? 'Halftime' : 'HT';
        return note;
    }
    const homeKeys = ['BA', 'BC', 'BE', 'BG', 'BI', 'BK', 'BM', 'BO', 'BQ', 'BS', 'BU'];
    const awayKeys = ['BB', 'BD', 'BF', 'BH', 'BJ', 'BL', 'BN', 'BP', 'BR', 'BT', 'BV'];
    let maxPeriod = 0;
    for (let i = 0; i < homeKeys.length; i++) {
        if (fields[homeKeys[i]] !== undefined || fields[awayKeys[i]] !== undefined) maxPeriod = i + 1;
    }
    if (maxPeriod > 0) {
        if (stage === '3') return 'Finished';
        if (sport === 'baseball') return `${maxPeriod}${ordinal(maxPeriod)} INNING`;
        if (sport === 'basketball') return maxPeriod > 4 ? 'OVERTIME' : `${maxPeriod}${ordinal(maxPeriod)} QUARTER`;
        if (sport === 'hockey') return maxPeriod > 3 ? 'OVERTIME' : `${maxPeriod}${ordinal(maxPeriod)} PERIOD`;
        if (isFootball) {
            if (maxPeriod === 2 && /ht|halftime|break|intermission|half.?time/i.test(note)) return 'Halftime';
            if (maxPeriod > 4) return 'Overtime';
            return `${maxPeriod}${ordinal(maxPeriod)} QUARTER`;
        }
    }
    if (stage === '3') return 'Finished';
    const period = num(fields.AC || '0');
    if (sport === 'baseball' && period > 0) return `${period}${ordinal(period)} INNING`;
    if (sport === 'basketball' && period > 0) return `${period}${ordinal(period)} QUARTER`;
    if (sport === 'hockey' && period > 0) return `${period}${ordinal(period)} PERIOD`;
    if (isFootball) {
        if (/^\d{2}$/.test(note)) {
            const stageChar = note[0];
            if (stageChar === '3') return 'Finished';
            const q = parseInt(note[1], 10);
            if (q >= 1 && q <= 4) return `${q}${ordinal(q)} QUARTER`;
            if (q === 5) return 'Halftime';
            return 'Overtime';
        }
        if (note.toLowerCase() === 'ht') return 'Halftime';
        if (note.toLowerCase() === 'ot') return 'Overtime';
        if (period > 0 && period <= 4) return `${period}${ordinal(period)} QUARTER`;
        if (period === 5) return 'Halftime';
        if (period > 5) return 'Overtime';
    }
    if (sport === 'soccer' && stage === '2') {
        const ao = num(fields.AO || '0');
        let ax = String(fields.AX || '1').trim();
        if (fields.AC === '13' || fields.BC !== undefined || fields.BD !== undefined) ax = '2';
        if (ao > 0) {
            const diffSeconds = Math.floor(Date.now() / 1000) - ao;
            if (diffSeconds > 0) {
                const diffMinutes = Math.floor(diffSeconds / 60);
                if (ax === '2' && diffMinutes > 75) return 'Finished';
                if (ax === '1' && diffMinutes > 60) return 'Halftime';
                const m = ax === '2' ? 45 + diffMinutes : diffMinutes;
                const s = diffSeconds % 60;
                return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
            }
        }
    }
    if (sport === 'soccer' && period > 0) return `${period}'`;
    if (stage === '2') return 'In Progress';
    if (stage === '1') return 'Upcoming';
    return note || 'Scheduled';
}

function feedMatrix(fields, sport) {
    const matrix = { home: {}, away: {}, runsByInning: [] };
    const homeKeys = ['BA', 'BC', 'BE', 'BG', 'BI', 'BK', 'BM', 'BO', 'BQ', 'BS', 'BU'];
    const awayKeys = ['BB', 'BD', 'BF', 'BH', 'BJ', 'BL', 'BN', 'BP', 'BR', 'BT', 'BV'];
    try {
        let homeSum = 0, awaySum = 0, hasInnings = false;
        const isBaseball = sport === 'baseball';
        for (let i = 0; i < homeKeys.length; i++) {
            const val1 = nullableNum(fields[homeKeys[i]]);
            const val2 = nullableNum(fields[awayKeys[i]]);
            if (val1 === null && val2 === null) continue;
            hasInnings = true;
            const isFootball = sport === 'cfl' || sport === 'american-football' || sport === 'nfl';
            const label = isFootball ? `Q${i + 1}` : String(i + 1);
            matrix.home[label] = val1 ?? 0;
            matrix.away[label] = val2 ?? 0;
            matrix.runsByInning.push({ inning: label, home: val1, away: val2 });
            homeSum += val1 ?? 0;
            awaySum += val2 ?? 0;
        }
        matrix.home.T = fields.AG !== undefined ? num(fields.AG) : hasInnings ? homeSum : 0;
        matrix.away.T = fields.AH !== undefined ? num(fields.AH) : hasInnings ? awaySum : 0;
        if (isBaseball) {
            if (fields.WF) matrix.home.H = num(fields.WF);
            if (fields.WG) matrix.away.H = num(fields.WG);
            if (fields.WH) matrix.home.E = num(fields.WH);
            if (fields.WI) matrix.away.E = num(fields.WI);
        }
    } catch {}
    return matrix;
}

function parseFeed(text, sport) {
    const matches = [];
    let league = sport;
    const records = String(text || '').split(/Â¬~|~|¬~/);
    for (const record of records) {
        try {
            const fields = feedFields(record);
            if (fields.ZA) league = cleanText(fields.ZA).replace(/^\d+\\|/, '') || league;
            if (!fields.AA) continue;
            const homeTeam = cleanText(fields.AE || fields.CX || '');
            const awayTeam = cleanText(fields.AF || '');
            if (!homeTeam || !awayTeam) continue;
            const status = feedStatus(fields, sport);
            const homeTotal = num(fields.AG || '0');
            const awayTotal = num(fields.AH || '0');
            const matrix = feedMatrix(fields, sport);
            const startTime = num(fields.AD || fields.ADE || fields.AJ || '0');
            matches.push({
                matchId: fields.AA,
                sport,
                title: `${homeTeam} vs ${awayTeam}`,
                homeTeam,
                awayTeam,
                status,
                homeTotal,
                awayTotal,
                url: `${BASE}match/${fields.AA}/#/match-summary`,
                rowText: `${league} ${awayTeam} ${homeTeam} ${status}`,
                startTime: startTime || undefined,
                homeLogo: feedAsset(fields.OA),
                awayLogo: feedAsset(fields.OB),
                matrix,
                stage: fields.AB || '',
            });
        } catch {}
    }
    return matches;
}

async function refreshFsign() {
    try {
        const response = await fetch(`${BASE}x/feed/f_1_0_2_en_1`, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/plain,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': BASE,
                'x-fsign': FEED_SIGN,
            },
        });
        if (!response.ok) return;
        const text = await response.text();
        const match = text.match(/Fsign=([A-Za-z0-9]+)/);
        if (match) dynamicFsign = match[1];
    } catch {}
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
        soccerClockAnchors.set(key, { minute: Number(timeMatch[1]), observedAt: Date.now() - Number(timeMatch[2]) * 1000 });
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
    return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function fromSeed(seed, soccerClockAnchors) {
    const matrix = seed.matrix || { home: {}, away: {}, runsByInning: [] };
    const statusRow = `${seed.status} ${seed.rowText}`;
    let isLive = false;
    if (!/\b(finished|completed|ended|full\s*time|ft\b|final)\b/i.test(statusRow)) {
        isLive = LIVE_RE.test(statusRow) || /^\d+'$/.test(seed.status) || /^Q[1-4]$/i.test(seed.status) || /^\d+:\d+$/.test(seed.status);
    }
    const status = seed.sport === 'soccer' ? carrySoccerClock(seed.matchId, seed.status || 'Scheduled', isLive, soccerClockAnchors) : seed.status || 'Scheduled';
    return {
        matchId: seed.matchId,
        sport: seed.sport,
        status,
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
        liveScoreboard: { homeTotal: seed.homeTotal, awayTotal: seed.awayTotal, status, isLive, matrix },
        rowText: seed.rowText,
    };
}

function makeCacheKeys(homeTeam, awayTeam) {
    const keys = new Set();
    for (const name of [homeTeam, awayTeam]) {
        if (!name) continue;
        const norm = cleanText(name).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        if (norm.length > 2) keys.add(norm);
        for (const part of norm.split(/\s+/)) { if (part.length > 2) keys.add(part); }
    }
    return [...keys];
}

class LivesportHelper {
    static cache = { matches: [], cachedAt: 0 };
    static cacheMap = new Map();
    static soccerClockAnchors = new Map();

    static async refreshFsign() {
        await refreshFsign();
    }

    static async getAllLiveStats(forceRefresh = false) {
        const now = Date.now();
        const hasLive = this.cache.matches.some(m =>
            m.liveScoreboard?.isLive ||
            /inning|quarter|period|progress|live|ht|halftime|break|intermission/i.test(m.status) ||
            /^\d+:\d+$/.test(m.status)
        );
        const ttl = hasLive ? 4000 : 60000;
        if (!forceRefresh && now - this.cache.cachedAt < ttl && this.cache.matches.length > 0) {
            return this.cache.matches;
        }

        try { await refreshFsign(); } catch {}

        const seedMap = new Map();
        const sportFeeds = [
            { sport: 'soccer', url: `${BASE}x/feed/f_1_0_2_en_1`, referer: BASE },
            { sport: 'baseball', url: `${BASE}x/feed/f_6_0_2_en_1`, referer: `${BASE}baseball/` },
            { sport: 'basketball', url: `${BASE}x/feed/f_3_0_2_en_1`, referer: `${BASE}basketball/` },
            { sport: 'hockey', url: `${BASE}x/feed/f_4_0_2_en_1`, referer: `${BASE}hockey/` },
            { sport: 'cfl', url: `${BASE}x/feed/f_5_0_2_en_1`, referer: `${BASE}football/canada/cfl/` },
            { sport: 'american-football', url: `${BASE}x/feed/f_12_0_2_en_1`, referer: `${BASE}american-football/` },
            { sport: 'boxing', url: `${BASE}x/feed/f_16_0_2_en_1`, referer: `${BASE}boxing/` },
        ];

        for (const feed of sportFeeds) {
            try {
                const response = await fetch(feed.url, {
                    headers: {
                        'User-Agent': USER_AGENT,
                        'Accept': 'text/plain,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Referer': feed.referer,
                        'x-fsign': dynamicFsign,
                    },
                });
                if (!response.ok) continue;
                const text = await response.text();
                const feedMatches = parseFeed(text, feed.sport);
                for (const seed of feedMatches) {
                    const key = seed.matchId || `${seed.sport}:${seed.homeTeam}:${seed.awayTeam}`.toLowerCase();
                    if (!seedMap.has(key)) seedMap.set(key, seed);
                }
            } catch {}
        }

        if (!seedMap.size) return [];

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
                if (oldMatch.liveScoreboard && oldMatch.liveScoreboard.isLive && matchObj.liveScoreboard.isLive && /^\d+:\d+$/.test(matchObj.liveScoreboard.status)) {
                    matchObj.liveScoreboard.status = oldMatch.liveScoreboard.status;
                    matchObj.status = oldMatch.liveScoreboard.status;
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

export default LivesportHelper;
