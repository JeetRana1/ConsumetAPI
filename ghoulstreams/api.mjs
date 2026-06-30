import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { load as cheerioLoad } from 'cheerio';
import BuffStreams from './Stream.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const provider = new BuffStreams();
const streamAvailability = new Map();
const HAS_LOCAL_FRONTEND = fs.existsSync(path.join(__dirname, 'index.html'));

const ONE_YEAR_SECONDS = 31536000;
const STATIC_ASSET_PATTERN = /\.(?:css|js|mjs|json|webmanifest|svg|png|jpg|jpeg|webp|gif|ico|woff2?|ttf|otf|txt)$/i;
const NO_STORE_HEADERS = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
};

app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        res.set(NO_STORE_HEADERS);
    }
    next();
});

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Range');
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    next();
});

if (HAS_LOCAL_FRONTEND) {
    app.use(express.static(__dirname, {
        etag: true,
        lastModified: true,
        setHeaders: (res, filePath) => {
            if (STATIC_ASSET_PATTERN.test(filePath)) {
                res.setHeader('Cache-Control', `public, max-age=${ONE_YEAR_SECONDS}, immutable`);
                return;
            }
            if (/\.(?:html|md)$/i.test(filePath)) {
                res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
            }
        }
    }));
}
app.use(express.json());

app.get('/', (_req, res) => {
    if (!HAS_LOCAL_FRONTEND) {
        return res.json({ success: true, service: 'ghoulstreams-api', status: 'ok' });
    }
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    res.sendFile(path.join(__dirname, 'index.html'));
});

if (HAS_LOCAL_FRONTEND) {
    app.get('/index.html', (_req, res) => {
        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
        res.sendFile(path.join(__dirname, 'index.html'));
    });

    app.get('/watch.html', (_req, res) => {
        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
        res.sendFile(path.join(__dirname, 'watch.html'));
    });

    app.get('/watch/:slug', (_req, res) => {
        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
        res.sendFile(path.join(__dirname, 'watch.html'));
    });

    app.get('/manifest.json', (_req, res) => {
        res.set({
            'Cache-Control': `public, max-age=${ONE_YEAR_SECONDS}, immutable`,
            'Content-Type': 'application/manifest+json'
        });
        res.sendFile(path.join(__dirname, 'manifest.json'));
    });

    app.get('/Logo.svg', (_req, res) => {
        res.set({
            'Cache-Control': `public, max-age=${ONE_YEAR_SECONDS}, immutable`,
            'Content-Type': 'image/svg+xml'
        });
        res.sendFile(path.join(__dirname, 'Logo.svg'));
    });

    app.get('/GhoulStream-Logo.svg', (_req, res) => {
        res.set({
            'Cache-Control': `public, max-age=${ONE_YEAR_SECONDS}, immutable`,
            'Content-Type': 'image/svg+xml'
        });
        res.sendFile(path.join(__dirname, 'GhoulStream-Logo.svg'));
    });

    app.get('/sw.js', (_req, res) => {
        res.set({
            'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
            'Content-Type': 'application/javascript'
        });
        res.sendFile(path.join(__dirname, 'sw.js'));
    });

    const SPA_PATHS = ['/', '/all', '/football', '/nfl', '/mma', '/boxing', '/formula-1', '/nba', '/wnba', '/mlb'];
    app.get(SPA_PATHS, (_req, res) => {
        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
        res.sendFile(path.join(__dirname, 'index.html'));
    });

    const RECAPS_PATHS = ['/recaps', '/formula-1/recaps'];
    app.get(RECAPS_PATHS, (_req, res) => {
        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
        res.sendFile(path.join(__dirname, 'recaps.html'));
    });

    app.get('/:category/recaps/test-player/*', (_req, res) => {
        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
        res.sendFile(path.join(__dirname, 'test-player.html'));
    });
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const AVAILABILITY_TTL_MS = 1000 * 60 * 45;

const isAbsoluteHttpUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());

const pruneAvailability = () => {
    const now = Date.now();
    for (const [id, value] of streamAvailability.entries()) {
        if (!value?.updatedAt || now - value.updatedAt > AVAILABILITY_TTL_MS) {
            streamAvailability.delete(id);
        }
    }
};

const setStreamAvailability = (id, isLive, reason = '') => {
    const key = String(id || '').trim();
    if (!key) return;
    streamAvailability.set(key, { isLive: Boolean(isLive), reason: String(reason || ''), updatedAt: Date.now() });
};

const clearStreamAvailability = (id) => {
    const key = String(id || '').trim();
    if (!key) return;
    streamAvailability.delete(key);
};

const getAvailabilitySnapshot = () => {
    pruneAvailability();
    const snapshot = {};
    for (const [id, value] of streamAvailability.entries()) {
        snapshot[id] = value;
    }
    return snapshot;
};

const mediaCache = new Map();
const MEDIA_CACHE_MAX = 150;
const MEDIA_CACHE_TTL_SEGMENT = 3600_000;
const MEDIA_CACHE_TTL_PLAYLIST = 2_000;
const MEDIA_CACHE_MAX_SIZE = 5_000_000;
const isSegment = (url) => /\.ts(?:[?#]|$)/i.test(url);

const getFromCache = (key) => {
  const entry = mediaCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { mediaCache.delete(key); return null; }
  return entry.data;
};

const setCache = (key, data, isSeg) => {
  if (mediaCache.size >= MEDIA_CACHE_MAX) {
    const oldest = mediaCache.entries().next().value;
    if (oldest) mediaCache.delete(oldest[0]);
  }
  mediaCache.set(key, { data, expires: Date.now() + (isSeg ? MEDIA_CACHE_TTL_SEGMENT : MEDIA_CACHE_TTL_PLAYLIST) });
};

const wait = (ms) => new Promise(r => setTimeout(r, ms));

const hostTimers = new Map();
const HOST_MIN_INTERVAL = 200;

const rateLimitHost = async (url) => {
  const host = new URL(url).hostname;
  const last = hostTimers.get(host) || 0;
  const now = Date.now();
  const elapsed = now - last;
  if (elapsed < HOST_MIN_INTERVAL) {
    await wait(HOST_MIN_INTERVAL - elapsed);
  }
  hostTimers.set(host, Date.now());
};

const fetchWithRetry = async (url, options, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    await rateLimitHost(url);
    const resp = await fetch(url, options);
    if (resp.status !== 429) return resp;
    const delay = (i + 1) * 1500;
    console.warn(`429 on ${url.split('?')[0].slice(-40)}, retry ${i+1}/${maxRetries} in ${delay}ms`);
    await wait(delay);
  }
  return fetch(url, options);
};

const passthroughHeaders = (headers = {}) => {
    const out = {};
    const contentType = headers['content-type'] || headers.get?.('content-type');
    const contentLength = headers['content-length'] || headers.get?.('content-length');
    const acceptRanges = headers['accept-ranges'] || headers.get?.('accept-ranges');
    const contentRange = headers['content-range'] || headers.get?.('content-range');
    const cacheControl = headers['cache-control'] || headers.get?.('cache-control');

    if (contentType) out['Content-Type'] = contentType;
    if (contentLength) out['Content-Length'] = contentLength;
    if (acceptRanges) out['Accept-Ranges'] = acceptRanges;
    if (contentRange) out['Content-Range'] = contentRange;
    if (cacheControl) out['Cache-Control'] = cacheControl;
    out['Access-Control-Allow-Origin'] = '*';
    return out;
};

const proxiedMediaUrl = (targetUrl, referer, rootReferer) => {
    const params = new URLSearchParams({ url: targetUrl });
    if (referer) params.set('referer', referer);
    if (rootReferer) params.set('root_referer', rootReferer);
    return `/api/media-proxy?${params.toString()}`;
};

const rewritePlaylist = (text, playlistUrl, rootReferer) => {
    const lines = String(text || '').split(/\r?\n/);
    return lines
        .map((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return line;
            const absolute = new URL(trimmed, playlistUrl).toString();
            return proxiedMediaUrl(absolute, playlistUrl, rootReferer || playlistUrl);
        })
        .join('\n');
};

const buildMediaHeaders = (referer, rangeHeader) => ({
    'User-Agent': USER_AGENT,
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Referer': referer,
    'Origin': new URL(referer).origin,
    ...(rangeHeader ? { 'Range': rangeHeader } : {})
});

const fetchWithRefererFallbacks = async (targetUrl, referer, rootReferer, rangeHeader) => {
    const candidates = [];
    const pushUnique = (value) => {
        if (!value || !isAbsoluteHttpUrl(value) || candidates.includes(value)) return;
        candidates.push(value);
    };

    pushUnique(referer);
    pushUnique(rootReferer);
    pushUnique(targetUrl);

    try {
        const targetOrigin = new URL(targetUrl).origin;
        if (targetOrigin && targetOrigin !== 'null') pushUnique(targetOrigin + '/');
    } catch { }

    let lastResponse = null;
    for (const candidate of candidates) {
        const response = await fetchWithRetry(targetUrl, { headers: buildMediaHeaders(candidate, rangeHeader) });
        if (response.ok || response.status === 206) {
            return { response, usedReferer: candidate };
        }
        lastResponse = response;
        if (response.status !== 403 && response.status !== 404) break;
    }

    return { response: lastResponse, usedReferer: candidates[0] || targetUrl };
};

app.post('/api/search', async (req, res) => {
    try {
        const { query } = req.body;
        const results = await provider.search(query || '');
        for (const result of results) {
            if (result?.isLive === true) {
                const cached = streamAvailability.get(result.id);
                if (cached?.isLive === false) {
                    clearStreamAvailability(result.id);
                }
            }
        }
        res.json({ success: true, data: results });
    } catch (error) {
        console.error('Error in /api/search:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/matchDetails', async (req, res) => {
    try {
        const { title, sport, lockId } = req.body || {};
        if (!title) return res.json({ success: false, error: 'title required' });
        const backendBase = (process.env.CONSUMET_API_BASE || process.env.SITE_API_BASE || 'http://localhost:3000').replace(/\/$/, '');
        const liveUrl = `${backendBase}/sports/buffstreams/livesport?title=${encodeURIComponent(title)}&sport=${encodeURIComponent(sport || 'sports')}`;
        const response = await fetch(liveUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
            return res.json({ success: true, data: null });
        }
        const data = await response.json();
        res.json({ success: true, data: data?.data || data || null });
    } catch (error) {
        console.error('Error in /api/matchDetails:', error?.message || error);
        res.json({ success: true, data: null });
    }
});

const RACING_BASE = 'https://fullraces.com';
const RACING_CATEGORIES = {
    'formula-1': '/formula1-replays', 'f1': '/formula1-replays', 'formula1': '/formula1-replays', 'formula': '/formula1-replays',
    'formula-2': '/f2-full-races', 'f2': '/f2-full-races', 'formula2': '/f2-full-races',
    'formula-3': '/f3-full-races', 'f3': '/f3-full-races', 'formula3': '/f3-full-races',
    'formula-e': '/formula-e', 'fe': '/formula-e', 'formulae': '/formula-e',
    'nascar': '/nascar', 'indycar': '/indycar', 'motogp': '/motogp',
    'wec': '/wec', 'wrc': '/wrc', 'rally': '/wrc', 'wsbk': '/wsbk',
    'f1-academy': '/f1-academy', 'f1academy': '/f1-academy',
};
const racingCatalogCache = new Map();
const RACING_CACHE_TTL = 60 * 1000;

function racingNormalizeQuery(q) {
    const s = String(q || '').toLowerCase().trim();
    return (s === 'all' || s === 'racing' || s === 'f1') ? '' : s;
}
function racingCategoryPath(q) {
    const wanted = racingNormalizeQuery(q);
    if (wanted && RACING_CATEGORIES[wanted]) return RACING_CATEGORIES[wanted];
    if (wanted) return '/' + wanted.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return '/';
}
function racingPageUrl(catPath, page) {
    const clean = RACING_BASE + (catPath === '/' ? '/' : catPath);
    if (page <= 1) return clean;
    return clean + (catPath.includes('?') ? '&' : '?') + 'page' + page;
}
function racingPreclean(html) {
    return String(html || '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<script\b[^>]*>(?:[\s\S]*?)(?:analytics|tracking|gtag|googletag|fbq|adsbygoogle|dataLayer)(?:[\s\S]*?)<\/script>/gi, '')
        .replace(/<script\b[^>]*src=["'][^"']*(?:analytics|tracking|gtag|googletag|doubleclick|adservice|adsbygoogle)[^"']*["'][^>]*><\/script>/gi, '');
}
function racingSanitizeUrl(v) {
    return String(v || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\\&/g, '&').replace(/\\/g, '').trim();
}
function racingNormalizeUrl(v) {
    const raw = String(v || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('//')) return 'https:' + raw;
    return RACING_BASE + (raw.startsWith('/') ? '' : '/') + raw;
}
function racingNormalizeUrlPath(v) {
    const raw = String(v || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw) || raw.startsWith('//')) return racingNormalizeUrl(raw);
    return raw.startsWith('/') ? raw : '/' + raw;
}
function racingExtractDate(root, $) {
    const candidates = [
        $(root).find('time').first().text(),
        $(root).find('.date, .post-date, .entry-date, .meta-date, .published').first().text(),
        $(root).text(),
    ];
    for (const c of candidates) {
        const n = String(c || '').trim().replace(/\s+/g, ' ');
        if (n && /\b\d{4}\b/.test(n)) return n;
    }
    return '';
}
function racingParsePage(html, query) {
    const $ = cheerioLoad(html);
    const wanted = racingNormalizeQuery(query);
    const items = [];
    $('article, .short_item, .post-item, .card, [data-provider-card], .post, .grid-item, .elementor-post, .wp-block-post').each((_, el) => {
        const root = $(el);
        const dateText = racingExtractDate(root, $);
        const yearMatch = String(dateText).match(/\b(19|20)\d{2}\b/);
        const year = yearMatch ? Number(yearMatch[0]) : null;

        let title = root.find('h3, h2, h1, h4, .entry-title, .post-title, a[title]').first().text() || root.find('a').first().text() || '';
        title = title.trim().replace(/\s+/g, ' ');
        if (!title) return;

        let id = root.find('a').first().attr('href') || '';
        id = racingNormalizeUrlPath(id);
        if (!id) return;

        const image = racingNormalizeUrl(root.find('img').first().attr('src') || root.find('img').first().attr('data-src') || '');
        const category = (root.find('.short_cat, .category, .tag, .term, .series, .label, [data-category]').first().text() || '').trim().replace(/\s+/g, ' ');
        const duration = (root.find('.duration, .runtime, .time, time').first().text() || '').trim().replace(/\s+/g, ' ');

        if (wanted && !`${title} ${category}`.toLowerCase().includes(wanted)) return;

        items.push({ id, title, image, thumbnail: image, category: category || 'Racing', duration, publishedAt: dateText, year: year ?? undefined });
    });
    return items;
}
function racingNextPage(html, currentUrl) {
    const $ = cheerioLoad(html);
    const candidates = [];
    $('a[rel="next"], .nav-links a, .pagination a, a.page-numbers').each((_, el) => {
        const href = $(el).attr('href');
        if (href) candidates.push(racingSanitizeUrl(href));
    });
    for (const href of candidates) {
        const n = racingNormalizeUrl(href);
        if (!n || n === currentUrl) continue;
        if (/[?&]page\d+\b/i.test(n) || /[?&]page=\d+\b/i.test(n) || /\/page\/\d+/i.test(n)) return n;
    }
    return '';
}

app.get('/api/racing/catalog', async (req, res) => {
    try {
        const category = String(req.query.category || 'racing').trim() || 'racing';
        const cacheKey = 'racing:' + category;
        const cached = racingCatalogCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < RACING_CACHE_TTL) {
            return res.json({ success: true, data: cached.data });
        }

        const backendBase = (process.env.CONSUMET_API_BASE || process.env.SITE_API_BASE || 'http://localhost:3000').replace(/\/$/, '');
        const response = await fetch(`${backendBase}/sports/racing/${encodeURIComponent(category)}`, {
            headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
            signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
            return res.json({ success: true, data: [] });
        }

        const payload = await response.json();
        const items = Array.isArray(payload) ? payload : (Array.isArray(payload?.data) ? payload.data : []);
        racingCatalogCache.set(cacheKey, { data: items, ts: Date.now() });
        res.json({ success: true, data: items });
    } catch (error) {
        console.error('Error in /api/racing/catalog:', error?.message || error);
        res.json({ success: true, data: [] });
    }
});

function racingExtractStreamUrl(html, embedUrl) {
    const decoded = String(html || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\\u0026/g, '&');
    const patterns = [
        /hlsManifestUrl["']\s*:\s*["'](https?:\/\/[^"']+?\.m3u8[^"']*)["']/i,
        /hlsManifestUrl=([^&"'\s]+?\.m3u8[^&"'\s]*)/i,
        /(?:file|src|source|manifest|streamUrl|hls|m3u8|mp4)\s*[:=]\s*["'](https?:\/\/[^"']+)["']/i,
        /(https?:\/\/[^"'\`\s>]+?\.m3u8(?:\?[^"'\`\s>]*)?)/i,
        /(https?:\/\/[^"'\`\s>]+?\.mp4(?:\?[^"'\`\s>]*)?)/i,
        /\/\/[^"'\`\s>]+?\.m3u8(?:\?[^"'\`\s>]*)?/i,
    ];
    for (const pattern of patterns) {
        const match = decoded.match(pattern);
        if (match?.[1]) {
            let url = match[1].trim();
            if (url.startsWith('//')) url = 'https:' + url;
            if (/^https?:\/\//i.test(url) && /\.m3u8|\.mp4/i.test(url)) return url;
        }
    }
    return '';
}

function racingExtractIframeUrl(html) {
    const decoded = String(html || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    const $ = cheerioLoad(decoded);
    const candidates = [];
    $('iframe[src], frame[src]').each((_, el) => {
        const src = $(el).attr('src');
        if (src) candidates.push(src);
    });
    const regexMatches = decoded.match(/<(?:iframe|frame)\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi) || [];
    for (const m of regexMatches) {
        const href = m.match(/src=["']([^"']+)["']/i)?.[1];
        if (href) candidates.push(href);
    }
    const priority = [/ok\.?ru/i, /vk\.com/i, /vkvideo/i, /player/i, /embed/i, /iframe/i, /video/i, /stream/i];
    for (const raw of candidates) {
        let url = raw.replace(/&amp;/g, '&').trim();
        if (url.startsWith('//')) url = 'https:' + url;
        if (/^https?:\/\//i.test(url) && !/javascript:|data:|blob:/i.test(url) && !/\.m3u8|\.mp4/i.test(url)) {
            if (priority.some(p => p.test(url))) return url;
        }
    }
    for (const raw of candidates) {
        let url = raw.replace(/&amp;/g, '&').trim();
        if (url.startsWith('//')) url = 'https:' + url;
        if (/^https?:\/\//i.test(url) && !/javascript:|data:|blob:/i.test(url) && !/\.m3u8|\.mp4/i.test(url)) return url;
    }
    return '';
}

app.get('/api/racing/watch', async (req, res) => {
    try {
        const episodeId = String(req.query.episodeId || req.query.url || '').trim();
        if (!episodeId) return res.json({ success: false, error: 'episodeId required', data: { sources: [] } });

        const backendBase = (process.env.CONSUMET_API_BASE || process.env.SITE_API_BASE || 'http://localhost:3000').replace(/\/$/, '');
        const response = await fetch(`${backendBase}/sports/racing/watch?episodeId=${encodeURIComponent(episodeId)}`, {
            headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
            signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
            return res.json({ success: true, data: { sources: [] } });
        }

        const payload = await response.json();
        const data = payload?.data || payload || { sources: [] };
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error in /api/racing/watch:', error?.message || error);
        res.json({ success: true, data: { sources: [] } });
    }
});

app.get('/api/livesport-directory', async (_req, res) => {
    try {
        const backendBase = (process.env.CONSUMET_API_BASE || process.env.SITE_API_BASE || 'http://localhost:3000').replace(/\/$/, '');
        const response = await fetch(`${backendBase}/sports/buffstreams/directory`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
            return res.json({ success: true, data: { matches: [] } });
        }
        const data = await response.json();
        res.json({ success: true, data: data?.data || data || { matches: [] } });
    } catch (error) {
        console.error('Error in /api/livesport-directory:', error?.message || error);
        res.json({ success: true, data: { matches: [] } });
    }
});

app.get('/api/image-proxy', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url || !url.startsWith('http')) return res.status(400).send('Invalid URL');
        const referer = req.query.referer || 'https://www.flashscore.com/';
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': referer,
                'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
            },
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) return res.status(response.status).send('Upstream error');
        const contentType = response.headers.get('content-type') || 'image/png';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));
    } catch (error) {
        res.status(502).send('Proxy error');
    }
});

app.get('/api/stream-statuses', (_req, res) => {
    res.json({ success: true, data: getAvailabilitySnapshot() });
});

app.post('/api/report-stream-status', (req, res) => {
    try {
        const { id, isLive, reason } = req.body || {};
        setStreamAvailability(id, Boolean(isLive), reason || 'reported');
        res.json({ success: true });
    } catch (error) {
        console.error('Error in /api/report-stream-status:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/fetchInfo', async (req, res) => {
    try {
        const { id } = req.body;
        console.log('Fetching info for:', id);
        const info = await provider.fetchInfo(id);
        res.json({ success: true, data: info });
    } catch (error) {
        console.error('Error in /api/fetchInfo:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/fetchSources', async (req, res) => {
    try {
        const { eventUrl, embedUrl, background } = req.body;
        const target = eventUrl || embedUrl;
        const isBackground = Boolean(background);
        console.log('Fetching sources for:', target);
        const sources = isBackground
            ? await provider.verifyEventSources(target)
            : await provider.fetchSources(target);
        console.log('Got sources:', sources.sources.length);
        if (sources.sources.length > 0) {
            setStreamAvailability(target, true, 'source_available');
        } else if (!isBackground) {
            setStreamAvailability(target, false, sources.error || 'no_sources');
        }
        res.json({ success: true, data: sources });
    } catch (error) {
        console.error('Error in /api/fetchSources:', error);
        if (!req.body?.background) {
            setStreamAvailability(req.body?.eventUrl || req.body?.embedUrl, false, error.message);
        }
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/proxy', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.json({ success: false, error: 'URL required' });
        }

        const response = await fetch(url, {
            headers: {
                'User-Agent': USER_AGENT
            }
        });

        const html = await response.text();
        res.json({ success: true, data: html });
    } catch (error) {
        console.error('Error in /api/proxy:', error);
        res.json({ success: false, error: error.message });
    }
});

app.get('/api/media-proxy', async (req, res) => {
    try {
        const rawQuery = { ...req.query };
        const targetUrl = String(rawQuery.url || rawQuery.URL || '').trim();
        const referer = String(rawQuery.referer || rawQuery.Referer || '').trim();
        const rootReferer = String(rawQuery.root_referer || rawQuery.rootReferer || '').trim();

        if (!isAbsoluteHttpUrl(targetUrl)) {
            return res.status(400).send('Invalid target URL');
        }

        let normalizedTargetUrl = targetUrl;
        try {
            const parsed = new URL(targetUrl);
            normalizedTargetUrl = parsed.toString();
        } catch { /* keep original if URL parse fails */ }

        const cacheKey = normalizedTargetUrl;
        const isSeg = isSegment(normalizedTargetUrl);
        const cached = getFromCache(cacheKey);
        if (cached) {
            res.status(200);
            res.set({ 'Content-Type': cached.type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' });
            return res.send(cached.body);
        }

        const { response, usedReferer } = await fetchWithRefererFallbacks(normalizedTargetUrl, referer, rootReferer, req.headers.range);

        if (!response || (!response.ok && response.status !== 206)) {
            return res.status(response?.status || 502).send(`Upstream media error: ${response?.status || 502}`);
        }

        const isPlaylist = /mpegurl|m3u8|load-playlist|\/playlist\/|\/video\/?(?:\?|#|$)/i.test(normalizedTargetUrl) || /playlist/i.test(String(req.headers['content-type'] || ''));

        if (isPlaylist) {
            const body = await response.text();
            const rewritten = rewritePlaylist(body, normalizedTargetUrl, rootReferer || usedReferer || referer || normalizedTargetUrl);
            res.status(response.status);
            res.set({ ...passthroughHeaders(response.headers), 'Content-Type': 'application/vnd.apple.mpegurl' });
            return res.send(rewritten);
        }

        const rawBody = await response.arrayBuffer();
        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        if (isSeg && rawBody.byteLength < MEDIA_CACHE_MAX_SIZE) setCache(cacheKey, { body: rawBody, type: contentType }, true);

        res.status(response.status);
        res.set({ ...passthroughHeaders(response.headers), 'Access-Control-Allow-Origin': '*' });
        res.send(Buffer.from(rawBody));
    } catch (error) {
        console.error('Error in /api/media-proxy:', error);
        res.status(500).send(error.message);
    }
});

const DEFAULT_PORT = Number(process.env.PORT) || 3001;

if (HAS_LOCAL_FRONTEND) {
    app.get('*', (_req, res) => {
        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
        res.sendFile(path.join(__dirname, 'index.html'));
    });
}

function startServer(port, retries = 10) {
    const server = app.listen(port, () => {
        console.log(`BuffStreams Test Server running on http://localhost:${port}`);
        console.log('Check browser console (F12) for debug logs when playing streams');
    });

    server.on('error', (error) => {
        if (error && error.code === 'EADDRINUSE' && retries > 0) {
            const nextPort = port + 1;
            console.warn(`Port ${port} is in use, retrying on ${nextPort}...`);
            startServer(nextPort, retries - 1);
            return;
        }
        throw error;
    });
}

if (!process.env.VERCEL) {
    startServer(DEFAULT_PORT);
}

export default app;



