import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { load as cheerioLoad } from 'cheerio';
import BuffStreams from './Stream.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const provider = new BuffStreams();
const streamAvailability = new Map();
const sourcesCache = new Map();
const eventInfoCache = new Map();
const matchDetailsCache = new Map();
const endpointInflight = new Map();
const directoryCache = { data: null, ts: 0 };
const DIRECTORY_CACHE_TTL = 6_000;
const searchCache = { data: null, ts: 0, key: '' };
const SEARCH_CACHE_TTL = 12_000;
const EVENT_INFO_CACHE_TTL = 8_000;
const MATCH_DETAILS_CACHE_TTL = 8_000;
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Range, Referer, Origin');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    next();
});

app.set('trust proxy', true);

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
const EMBED_DEBUG = String(process.env.GHOULSTREAMS_EMBED_DEBUG || '').toLowerCase() === 'true';
const AVAILABILITY_TTL_MS = 1000 * 60 * 45;

const isAbsoluteHttpUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());

const getTimedCacheValue = (cache, key, ttlMs) => {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts <= ttlMs) return entry.value;
    cache.delete(key);
    return null;
};

const setTimedCacheValue = (cache, key, value) => {
    cache.set(key, { value, ts: Date.now() });
    return value;
};

const withInflight = async (key, factory) => {
    const existing = endpointInflight.get(key);
    if (existing) return existing;
    const promise = Promise.resolve().then(factory);
    endpointInflight.set(key, promise);
    const clear = () => {
        if (endpointInflight.get(key) === promise) endpointInflight.delete(key);
    };
    promise.then(clear, clear);
    return promise;
};

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
const mediaRefererCache = new Map();
const mediaInflight = new Map();
const MEDIA_CACHE_MAX = 400;
const MEDIA_CACHE_TTL_SEGMENT = 3600_000;
const MEDIA_CACHE_TTL_PLAYLIST = 30_000;
const MEDIA_CACHE_TTL_LIVE_PLAYLIST = 3_000;
const MEDIA_CACHE_STALE_LIMIT = 300_000;
const MEDIA_CACHE_MAX_SIZE = 5_000_000;
const isSegment = (url) => /\.ts(?:[?#]|$)/i.test(url) || /\.txt\?.*X-Amz-/i.test(url);

const getFromCache = (key, allowStale = false) => {
  const entry = mediaCache.get(key);
  if (!entry) return null;
  if (Date.now() <= entry.expires) return entry.data;
  if (allowStale && Date.now() - entry.created <= MEDIA_CACHE_STALE_LIMIT) return entry.data;
  mediaCache.delete(key);
  return null;
};

const setCache = (key, data, isSeg) => {
  if (mediaCache.size >= MEDIA_CACHE_MAX) {
    const oldest = mediaCache.entries().next().value;
    if (oldest) mediaCache.delete(oldest[0]);
  }
  mediaCache.set(key, { data, expires: Date.now() + (isSeg ? MEDIA_CACHE_TTL_SEGMENT : MEDIA_CACHE_TTL_PLAYLIST), created: Date.now() });
};

const getInflight = (key) => mediaInflight.get(key) || null;
const setInflight = (key, promise) => {
  mediaInflight.set(key, promise);
  const clear = () => {
    if (mediaInflight.get(key) === promise) mediaInflight.delete(key);
  };
  promise.then(clear).catch(clear);
  return promise;
};

const getMediaRefererKeys = (targetUrl) => {
  const raw = String(targetUrl || '').trim();
  if (!raw) return [];
  const keys = new Set([raw]);
  try {
    const parsed = new URL(raw);
    const pathname = String(parsed.pathname || '');
    const dir = pathname.replace(/\/[^/]*$/, '/') || '/';
    keys.add(`${parsed.origin}${dir}`);
  } catch { }
  return [...keys];
};

const getRememberedReferer = (targetUrl) => {
  for (const key of getMediaRefererKeys(targetUrl)) {
    const value = mediaRefererCache.get(key);
    if (value) return value;
  }
  return '';
};

const rememberReferer = (targetUrl, referer) => {
  const safeReferer = String(referer || '').trim();
  if (!safeReferer) return;
  for (const key of getMediaRefererKeys(targetUrl)) {
    mediaRefererCache.set(key, safeReferer);
  }
};

const prefetchMediaUrl = (targetUrl, referer) => {
  const normalizedTargetUrl = String(targetUrl || '').trim();
  if (!isAbsoluteHttpUrl(normalizedTargetUrl)) return;
  if (!isSegment(normalizedTargetUrl)) return;
  const inflightKey = normalizedTargetUrl + ':media';
  if (getFromCache(normalizedTargetUrl) || getInflight(inflightKey)) return;

  const job = (async () => {
    try {
      const headers = stripConditionalHeaders({
        'User-Agent': USER_AGENT,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(referer ? { 'Referer': referer, 'Origin': (() => { try { return new URL(referer).origin; } catch { return ''; } })() } : {})
      });
      const resp = await fetchWithRetry(normalizedTargetUrl, { headers }, 1);
      if (!resp || (!resp.ok && resp.status !== 206)) return null;
      const arr = Buffer.from(await resp.arrayBuffer());
      const ct = resp.headers.get('content-type') || 'application/octet-stream';
      if (arr.length > 0 && arr.length < MEDIA_CACHE_MAX_SIZE) {
        setCache(normalizedTargetUrl, { body: arr, type: ct }, true);
        if (referer) rememberReferer(normalizedTargetUrl, referer);
      }
      return true;
    } catch {
      return null;
    }
  })();

  setInflight(inflightKey, job);
};

const prefetchPlaylistSegments = (playlistText, playlistUrl, referer) => {
  const lines = String(playlistText || '').split(/\r?\n/);
  let count = 0;
  for (const line of lines) {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    try {
      const absolute = new URL(trimmed, playlistUrl).toString();
      if (!isSegment(absolute)) continue;
      prefetchMediaUrl(absolute, referer || playlistUrl);
      count += 1;
      if (count >= 10) break;
    } catch { }
  }
};

const wait = (ms) => new Promise(r => setTimeout(r, ms));

const hostTimers = new Map();
const HOST_MIN_INTERVAL = 2000;
const host429Count = new Map();

const rateLimitHost = async (url) => {
  const host = new URL(url).hostname;
  const hasBeen429 = (host429Count.get(host) || 0) > 0;
  if (!hasBeen429) return;
  const last = hostTimers.get(host) || 0;
  const now = Date.now();
  const elapsed = now - last;
  if (elapsed < HOST_MIN_INTERVAL) {
    const waitTime = HOST_MIN_INTERVAL - elapsed;
    await wait(waitTime);
  }
  hostTimers.set(host, Date.now());
};

const fetchWithRetry = async (url, options, maxRetries = 3) => {
  const isSeg = /\.ts(?:[?#]|$)/i.test(url) || /\.txt\?.*X-Amz-/i.test(url);
  const timeoutMs = isSeg ? 30000 : 20000;
  for (let i = 0; i <= maxRetries; i++) {
    await rateLimitHost(url);
    let resp;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        resp = await fetch(url, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      console.warn(`fetch failed on ${url.split('?')[0].slice(-40)}: ${err.cause?.code || err.message}, retry ${i+1}/${maxRetries}`);
      if (i < maxRetries) {
        await wait(2000);
        continue;
      }
      const fallbackResp = new Response(null, { status: 503, statusText: 'Upstream unreachable' });
      return fallbackResp;
    }
    if (resp.status !== 429) return resp;
    const host = new URL(url).hostname;
    host429Count.set(host, (host429Count.get(host) || 0) + 1);
    if (i < maxRetries) {
      const delay = (i + 1) * 2000;
      console.warn(`429 on ${url.split('?')[0].slice(-40)}, retry ${i+1}/${maxRetries} in ${delay}ms`);
      await wait(delay);
    }
  }
  const fallbackResp = new Response(null, { status: 503, statusText: 'Upstream rate limited - retry later' });
  return fallbackResp;
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

const stripConditionalHeaders = (headers = {}) => {
    const out = {};
    for (const [key, value] of Object.entries(headers || {})) {
        const lower = String(key || '').toLowerCase();
        if (lower === 'if-none-match' || lower === 'if-modified-since' || lower === 'if-match' || lower === 'if-unmodified-since') {
            continue;
        }
        if (value !== undefined && value !== null && value !== '') {
            out[key] = value;
        }
    }
    return out;
};

const proxyNoStoreHeaders = () => ({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no'
});

const proxiedMediaUrl = (targetUrl, referer, rootReferer, baseUrl) => {
    const params = new URLSearchParams({ url: targetUrl });
    if (referer) params.set('referer', referer);
    if (rootReferer) params.set('root_referer', rootReferer);
    const path = `/api/media-proxy?${params.toString()}`;
    if (baseUrl) {
        const base = String(baseUrl).replace(/\/+$/, '');
        return `${base}${path}`;
    }
    return path;
};

const selectLowestBandwidthVariant = (playlistText) => {
    const lines = String(playlistText || '').split(/\r?\n/);
    const variants = [];
    for (let i = 0; i < lines.length; i += 1) {
        const infoLine = String(lines[i] || '');
        const trimmedInfo = infoLine.trim();
        if (!trimmedInfo.startsWith('#EXT-X-STREAM-INF:')) continue;
        let nextIndex = i + 1;
        while (nextIndex < lines.length) {
            const candidate = String(lines[nextIndex] || '').trim();
            if (!candidate) {
                nextIndex += 1;
                continue;
            }
            if (candidate.startsWith('#')) break;
            const bandwidthMatch = trimmedInfo.match(/(?:^|,)BANDWIDTH=(\d+)/i);
            variants.push({
                bandwidth: bandwidthMatch ? Number(bandwidthMatch[1]) : Number.MAX_SAFE_INTEGER,
                infoLine: infoLine,
                uriLine: lines[nextIndex]
            });
            break;
        }
    }
    if (!variants.length) return null;
    variants.sort((a, b) => a.bandwidth - b.bandwidth);
    return variants[0];
};

const rewritePlaylist = (text, playlistUrl, rootReferer, baseUrl) => {
    const selectedVariant = selectLowestBandwidthVariant(text);
    if (selectedVariant) {
        const preservedLines = String(text || '')
            .split(/\r?\n/)
            .filter((line) => {
                const trimmed = String(line || '').trim();
                return trimmed === '#EXTM3U'
                    || trimmed.startsWith('#EXT-X-VERSION')
                    || trimmed.startsWith('#EXT-X-INDEPENDENT-SEGMENTS')
                    || trimmed.startsWith('#EXT-X-MEDIA')
                    || trimmed.startsWith('#EXT-X-SESSION-');
            });
        const absolute = new URL(String(selectedVariant.uriLine || '').trim(), playlistUrl).toString();
        return [
            ...preservedLines,
            selectedVariant.infoLine,
            proxiedMediaUrl(absolute, playlistUrl, rootReferer || playlistUrl, baseUrl)
        ].join('\n');
    }
    const lines = String(text || '').split(/\r?\n/);
    return lines
        .map((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return line;
            const absolute = new URL(trimmed, playlistUrl).toString();
            return proxiedMediaUrl(absolute, playlistUrl, rootReferer || playlistUrl, baseUrl);
        })
        .join('\n');
};

const buildMediaHeaders = (referer, rangeHeader) => stripConditionalHeaders({
    'User-Agent': USER_AGENT,
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    ...(referer ? { 'Referer': referer, 'Origin': new URL(referer).origin } : {}),
    ...(rangeHeader ? { 'Range': rangeHeader } : {})
});

const fetchWithRefererFallbacks = async (targetUrl, referer, rootReferer, rangeHeader, isSeg = false) => {
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
        if (isSeg && response.status === 404) {
            await wait(200);
            const retryResponse = await fetchWithRetry(targetUrl, { headers: buildMediaHeaders(candidate, rangeHeader) });
            if (retryResponse.ok || retryResponse.status === 206) {
                return { response: retryResponse, usedReferer: candidate };
            }
            lastResponse = retryResponse;
            if (retryResponse.status !== 403 && retryResponse.status !== 404) break;
        }
        lastResponse = response;
        if (response.status !== 403 && response.status !== 404) break;
    }

    // Try without any referer as last resort
    if (lastResponse && (lastResponse.status === 403 || lastResponse.status === 404 || lastResponse.status >= 500)) {
        const noRefResponse = await fetchWithRetry(targetUrl, { headers: buildMediaHeaders('', rangeHeader) });
        if (noRefResponse.ok || noRefResponse.status === 206) {
            return { response: noRefResponse, usedReferer: '' };
        }
    }

    return { response: lastResponse, usedReferer: candidates[0] || targetUrl };
};

app.post('/api/search', async (req, res) => {
    try {
        const { query } = req.body;
        const q = String(query || '').trim();
        if (searchCache.data && searchCache.key === q && Date.now() - searchCache.ts < SEARCH_CACHE_TTL) {
            return res.json(searchCache.data);
        }
        let results = await provider.search(q);
        for (const result of results) {
            if (result?.isLive === true) {
                const cached = streamAvailability.get(result.id);
                if (cached?.isLive === false) {
                    clearStreamAvailability(result.id);
                }
            }
        }
        const resultData = { success: true, data: results };
        searchCache.data = resultData;
        searchCache.key = q;
        searchCache.ts = Date.now();
        res.json(resultData);
    } catch (error) {
        console.error('Error in /api/search:', error);
        if (searchCache.data && searchCache.key === (String(req.body?.query || '').trim())) {
            return res.json(searchCache.data);
        }
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/matchDetails', async (req, res) => {
    try {
        const { title, sport, lockId } = req.body || {};
        if (!title) return res.json({ success: false, error: 'title required' });
        const cacheKey = `${String(title).trim().toLowerCase()}|${String(sport || 'sports').trim().toLowerCase()}`;
        const cached = getTimedCacheValue(matchDetailsCache, cacheKey, MATCH_DETAILS_CACHE_TTL);
        if (cached !== null) {
            return res.json({ success: true, data: cached });
        }
        const backendBase = (process.env.CONSUMET_API_BASE || process.env.SITE_API_BASE || 'http://localhost:3000').replace(/\/$/, '');
        const liveUrl = `${backendBase}/sports/buffstreams/livesport?title=${encodeURIComponent(title)}&sport=${encodeURIComponent(sport || 'sports')}`;
        const data = await withInflight(`match:${cacheKey}`, async () => {
            const response = await fetch(liveUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(8000),
            });
            if (!response.ok) {
                return null;
            }
            const payload = await response.json();
            return payload?.data || payload || null;
        });
        res.json({ success: true, data: setTimedCacheValue(matchDetailsCache, cacheKey, data) });
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
        const { default: LivesportHelper } = await import('./LivesportHelper.mjs');
        const dir = await LivesportHelper.getDirectory();
        const result = { success: true, data: { matches: dir?.matches || [] } };
        directoryCache.data = result;
        directoryCache.ts = Date.now();
        res.json(result);
    } catch (error) {
        console.error('Directory error:', error?.message || error);
        if (directoryCache.data) return res.json(directoryCache.data);
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

app.post('/api/boxing-card', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url || !url.startsWith('http')) return res.json({ success: false, error: 'Invalid URL' });
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return res.json({ success: false, error: `HTTP ${response.status}` });
        const html = await response.text();
        const $ = cheerioLoad(html);
        const seen = new Set();
        const fights = [];
        $('ul.under-card-events li').each((_, el) => {
            const date = $(el).children('div').first().text().trim();
            const imgs = $(el).find('img[src*="scdnmain"]');
            const imgSrcs = [];
            imgs.each((_, img) => { const s = $(img).attr('src') || ''; if (s) imgSrcs.push(s); });
            const nameDivs = $(el).find('div[style*="min-width:130px"]');
            const names = [];
            nameDivs.each((_, nd) => {
                const n = $(nd).find('div[style*="font-weight:bold"]').first().text().trim();
                if (n) names.push(n);
            });
            const recordDivs = $(el).find('div[style*="min-width:130px"] div[style*="color:#9c9c9c"]');
            const records = [];
            recordDivs.each((_, rd) => { const t = $(rd).text().trim(); if (t) records.push(t); });
            let matchNumber = '';
            const mnDiv = $(el).find('.match-number');
            if (mnDiv.length) matchNumber = mnDiv.text().trim();
            const key = `${names[0] || ''}|${names[1] || ''}`;
            if (!key || key === '|' || seen.has(key)) return;
            seen.add(key);
            if (names.length >= 2) {
                fights.push({
                    home: names[0] || '',
                    away: names[1] || '',
                    homeRecord: records[0] || '',
                    awayRecord: records[1] || '',
                    homeImage: imgSrcs[0] || '',
                    awayImage: imgSrcs[1] || '',
                    matchNumber: matchNumber || '',
                    date: date || '',
                });
            }
        });
        await Promise.all(fights.flatMap(fight =>
            ['homeImage', 'awayImage'].map(async side => {
                const url = fight[side];
                if (!url) return;
                try {
                    const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
                    if (!head.ok) fight[side] = '';
                } catch { fight[side] = ''; }
            })
        ));
        res.json({ success: true, data: { fights, title: $('h1').first().text().trim() || $('title').text().trim() } });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
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
        const cacheKey = String(id || '').trim();
        if (!cacheKey) return res.json({ success: false, error: 'id required' });
        const cached = getTimedCacheValue(eventInfoCache, cacheKey, EVENT_INFO_CACHE_TTL);
        if (cached) {
            return res.json({ success: true, data: cached });
        }
        const info = await withInflight(`info:${cacheKey}`, async () => {
            console.log('Fetching info for:', cacheKey);
            let freshInfo = await provider.fetchInfo(cacheKey);
            if (!freshInfo && BuffStreams.forceBuffstreamsProbe) {
                await BuffStreams.forceBuffstreamsProbe();
                freshInfo = await provider.fetchInfo(cacheKey);
            }
            return freshInfo || null;
        });
        if (info) {
            setTimedCacheValue(eventInfoCache, cacheKey, info);
        }
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
        const cacheKey = target;
        const cacheTtlMs = 180000;
        if (!isBackground && cacheKey) {
            const cached = sourcesCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < cacheTtlMs) {
                console.log('Cache hit for sources:', cacheKey);
                return res.json({ success: true, data: cached.data });
            }
        }
        let sources;
        for (let attempt = 0; attempt < 2; attempt++) {
            console.log(`Fetching sources for: ${target} (attempt ${attempt + 1})`);
            const timeoutMs = attempt === 0 ? 20000 : 30000;
            try {
                const result = await Promise.race([
                    isBackground
                        ? provider.verifyEventSources(target)
                        : provider.fetchSources(target),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Fetch sources timed out')), timeoutMs))
                ]);
                sources = result || { sources: [], error: 'empty_result' };
                if (sources.sources.length > 0) break;
            } catch (fetchErr) {
                if (attempt === 0 && BuffStreams.forceBuffstreamsProbe) {
                    await BuffStreams.forceBuffstreamsProbe();
                    continue;
                }
                throw fetchErr;
            }
            if (attempt === 0 && BuffStreams.forceBuffstreamsProbe) {
                await BuffStreams.forceBuffstreamsProbe();
            }
        }
        console.log('Got sources:', sources.sources.length);
        if (sources.sources.length > 0) {
            setStreamAvailability(target, true, 'source_available');
        } else if (!isBackground) {
            setStreamAvailability(target, false, sources.error || 'no_sources');
        }
        if (!isBackground && cacheKey) {
            sourcesCache.set(cacheKey, { data: sources, timestamp: Date.now() });
        }
        res.json({ success: true, data: sources });
    } catch (error) {
        console.error('Error in /api/fetchSources:', error);
        const timedOut = error.message === 'Fetch sources timed out';
        if (!req.body?.background) {
            setStreamAvailability(req.body?.eventUrl || req.body?.embedUrl, false, error.message);
        }
        if (timedOut) {
            res.json({ success: false, error: 'Source fetch timed out' });
        } else {
            res.json({ success: false, error: error.message });
        }
    }
});

app.post('/api/resolve-server-embed', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.json({ success: false, error: 'no_url' });
        }
        const embedUrl = await provider.resolveServerEmbed(url);
        res.json({ success: true, embedUrl: embedUrl || '' });
    } catch (error) {
        console.error('Error in /api/resolve-server-embed:', error);
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

app.get('/api/iframe-proxy', async (req, res) => {
    try {
        const targetUrl = String(req.query.url || '').trim();
        const referer = String(req.query.referer || '').trim();
        if (!targetUrl) return res.status(400).send('Missing url param');

        const upstreamHeaders = stripConditionalHeaders({
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            ...(referer ? { 'Referer': referer, 'Origin': (() => { try { return new URL(referer).origin; } catch { return ''; } })() } : {})
        });

        const resp = await fetch(targetUrl, {
            headers: upstreamHeaders,
            signal: AbortSignal.timeout(15000)
        });

        let html = await resp.text();
        const base = (() => { try { return new URL(targetUrl).origin; } catch { return ''; } })();
        if (base) {
            html = html.replace(/(<(?:img|script|link|source|video|audio|iframe)\b[^>]*?)(src=|href=)(["'])(?!https?:\/\/|\/\/|data:|#|javascript:)/gi, '$1$2$3' + base + '/');
        }

        const proxyBase = `${req.protocol}://${req.get('host')}`;
        const escTargetUrl = encodeURIComponent(targetUrl);
        const debugOverlay = !EMBED_DEBUG ? '' : `<script>
(function(){
  function emit(msg){
    try { window.parent && window.parent.postMessage('[gs-embed] ' + msg, '*'); } catch {}
  }
  emit('boot');
  const watch = () => {
    emit('ready:' + document.readyState);
    try {
      const videos = Array.from(document.querySelectorAll('video'));
      emit('videos:' + videos.length);
      videos.forEach((video, idx) => {
        if (video.__gsDebugBound) return;
        video.__gsDebugBound = true;
        const label = 'video' + idx;
        ['loadstart','loadedmetadata','playing','pause','waiting','stalled','canplay','canplaythrough','seeking','seeked','ended','error','timeupdate','progress'].forEach((ev) => {
          video.addEventListener(ev, () => {
            let extra = '';
            try {
              extra = ' ct=' + (Number.isFinite(video.currentTime) ? video.currentTime.toFixed(1) : 'na') + ' rs=' + video.readyState + ' ns=' + video.networkState + ' paused=' + video.paused;
            } catch {}
            emit(label + ':' + ev + extra);
          }, { passive: true });
        });
      });
    } catch (e) {
      emit('bind-error:' + (e && e.message ? e.message : String(e)));
    }
    try {
      const oldFetch = window.fetch;
      window.fetch = function(input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (/playlist|m3u8|load-playlist|chatgpt\\.hereisman\\.net/i.test(url)) emit('fetch:' + url);
        return oldFetch.apply(this, arguments);
      };
    } catch {}
    try {
      const oldOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url) {
        try { if (/playlist|m3u8|load-playlist|chatgpt\\.hereisman\\.net/i.test(String(url || ''))) emit('xhr:' + String(url)); } catch {}
        return oldOpen.apply(this, arguments);
      };
    } catch {}
    try {
      const oldError = console.error;
      console.error = function() {
        try { emit('console.error:' + Array.from(arguments).join(' ')); } catch {}
        return oldError.apply(this, arguments);
      };
    } catch {}
    setInterval(() => emit('heartbeat:' + Date.now()), 5000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true });
  else watch();
})();
</script>`;
        const xhrOverride = `<script>
var PROXY_BASE='${proxyBase}';
function _shouldProxy(u){
var url=typeof u==='string'?u:'';
if(!url) return false;
return /^https?:\\/\\//i.test(url) && (/\\/playlist\\//i.test(url) || /chatgpt\\.hereisman\\.net/i.test(url));
}
var ro=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(m,u){
var url=typeof u==='string'?u:'';
if(_shouldProxy(url)&&url.indexOf(PROXY_BASE)<0){u=PROXY_BASE+'/api/media-proxy?url='+encodeURIComponent(url)+'&referer=${escTargetUrl}&root_referer=${escTargetUrl}'}
return ro.apply(this,arguments)
};
var rf=window.fetch;
window.fetch=function(u,o){
var url=typeof u==='string'?u:'';
if(_shouldProxy(url)&&url.indexOf(PROXY_BASE)<0){u=PROXY_BASE+'/api/media-proxy?url='+encodeURIComponent(url)+'&referer=${escTargetUrl}&root_referer=${escTargetUrl}'}
return rf.call(this,u,o)
};
</script>`;
        const hlsPatch = `<script>
(function(){
  var d=document.createDocumentFragment();
  var s=document.createElement('script');
  s.textContent='if(typeof Hls!==\\"undefined\\"&&Hls.DefaultConfig){Hls.DefaultConfig.liveSyncDuration=45;Hls.DefaultConfig.liveMaxLatencyDuration=90;Hls.DefaultConfig.maxBufferLength=30;Hls.DefaultConfig.maxMaxBufferLength=45;Hls.DefaultConfig.maxBufferSize=72*1000*1000;Hls.DefaultConfig.backBufferLength=30;Hls.DefaultConfig.liveBackBufferLength=18;Hls.DefaultConfig.maxLiveSyncPlaybackRate=1.05;Hls.DefaultConfig.startLevel=0;Hls.DefaultConfig.abrEwmaDefaultEstimate=220000;Hls.DefaultConfig.capLevelToPlayerSize=true;Hls.DefaultConfig.testBandwidth=false;Hls.DefaultConfig.fragLoadingRetryDelay=1200;Hls.DefaultConfig.levelLoadingRetryDelay=1500}';
  d.appendChild(s);
  document.head.appendChild(d);
})();
</script>`;
        html = html.replace('</head>', debugOverlay + xhrOverride + hlsPatch + '</head>');
        res.set({
            'Content-Type': 'text/html; charset=utf-8',
            'X-Frame-Options': 'ALLOWALL',
            'Content-Security-Policy': "frame-ancestors * 'self'; script-src * 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob: *; style-src * 'unsafe-inline'",
            'Access-Control-Allow-Origin': '*',
            ...proxyNoStoreHeaders()
        });
        res.send(html);
    } catch (error) {
        console.error('Error in /api/iframe-proxy:', error);
        res.status(502).send('Proxy error: ' + error.message);
    }
});

app.all('/api/proxy', async (req, res) => {
    if (req.method === 'OPTIONS') {
        return res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': '*' }).end();
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return res.status(405).send('Method not allowed');
    }
    const targetUrl = String(req.query.url || '').trim();
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
        return res.status(400).send('Missing or invalid url param');
    }
    try {
        const referer = String(req.query.referer || targetUrl).trim();
        const resp = await fetch(targetUrl, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': referer,
                'Origin': (() => { try { return new URL(referer).origin; } catch { return ''; } })(),
                ...(req.headers.range ? { 'Range': req.headers.range } : {})
            },
            signal: AbortSignal.timeout(30000)
        });
        res.status(resp.status);
        resp.headers.forEach((v, k) => {
            const lower = k.toLowerCase();
            if (!/^(transfer-encoding|connection|keep-alive)$/i.test(lower)) {
                res.set(k, v);
            }
        });
        res.set('Access-Control-Allow-Origin', '*');
        if (resp.body) {
            const reader = resp.body.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(value);
                }
            } catch (streamError) {
                console.error('Stream error in /api/proxy:', streamError);
            } finally {
                reader.releaseLock();
            }
        }
        res.end();
    } catch (error) {
        console.error('Error in /api/proxy:', error);
        if (!res.headersSent) {
            res.status(502).send('Proxy error: ' + error.message);
        } else {
            res.end();
        }
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
        } catch { }

        const strippedRange = req.headers.range;
        const upstreamBaseHeaders = {
            'User-Agent': USER_AGENT,
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            ...(strippedRange ? { 'Range': strippedRange } : {})
        };
        const cleanHeaders = stripConditionalHeaders(upstreamBaseHeaders);

        const isSeg = isSegment(normalizedTargetUrl);
        const isPlaylist = /mpegurl|m3u8|load-playlist|\/playlist\/|\/video\/?(?:\?|#|$)/i.test(normalizedTargetUrl) || /playlist/i.test(String(req.headers['content-type'] || ''));
        const host = req.get('host') || '';
        const scheme = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) ? 'http' : 'https';
        const proxyBaseUrl = process.env.API_PUBLIC_URL || `${req.secure || req.protocol === 'https' ? 'https' : scheme}://${host}`;

        const fetchUpstream = async () => {
            const candidates = [];
            const pushUnique = (v) => { if (v && /^https?:\/\//i.test(v) && !candidates.includes(v)) candidates.push(v); };
            const rememberedReferer = getRememberedReferer(normalizedTargetUrl);
            pushUnique(rememberedReferer);
            if (isSeg) {
                candidates.push('');
                try { const o = new URL(normalizedTargetUrl).origin; if (o) pushUnique(o + '/'); } catch { }
                pushUnique(referer);
                pushUnique(rootReferer);
            } else {
                pushUnique(referer);
                pushUnique(rootReferer);
                pushUnique(normalizedTargetUrl);
                try { const o = new URL(normalizedTargetUrl).origin; if (o) pushUnique(o + '/'); } catch { }
                candidates.push('');
            }

            const quickFetch = async (url, opts) => {
                try {
                    const ctrl = new AbortController();
                    const to = setTimeout(() => ctrl.abort(), isSeg ? 5000 : 12000);
                    const r = await fetch(url, { ...opts, signal: ctrl.signal });
                    clearTimeout(to);
                    return r;
                } catch { return new Response(null, { status: 503 }); }
            };

            let lastResponse = null;
            for (const ref of candidates) {
                const headers = ref
                    ? { ...cleanHeaders, 'Referer': ref, 'Origin': (() => { try { return new URL(ref).origin; } catch { return ''; } })() }
                    : { ...cleanHeaders };
                const resp = await quickFetch(normalizedTargetUrl, { headers });
                if (resp.ok || resp.status === 206) {
                    rememberReferer(normalizedTargetUrl, ref);
                    return { response: resp, usedReferer: ref };
                }
                lastResponse = resp;
            }
            return { response: lastResponse, usedReferer: '' };
        };

        const cacheKey = normalizedTargetUrl;
        if (EMBED_DEBUG && (isPlaylist || isSeg)) {
            console.log('[media-proxy]', isPlaylist ? 'playlist' : 'segment', normalizedTargetUrl, 'referer=', referer || '-', 'root=', rootReferer || '-');
        }
        if (isPlaylist) {
            const cached = getFromCache(cacheKey + ':rewritten');
            if (cached) {
                res.status(200);
                res.removeHeader('ETag');
                res.removeHeader('Last-Modified');
                res.removeHeader('Cache-Control');
                res.set({
                    'Content-Type': 'application/vnd.apple.mpegurl',
                    'Cache-Control': 'no-cache, no-store, must-revalidate, proxy-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0',
                    'Surrogate-Control': 'no-store',
                    'Access-Control-Allow-Origin': '*'
                });
                return res.send(cached);
            }
            const inflight = getInflight(cacheKey + ':rewritten');
            if (inflight) {
                const rewritten = await inflight.catch(() => null);
                if (rewritten) {
                    res.status(200);
                    res.removeHeader('ETag');
                    res.removeHeader('Last-Modified');
                    res.removeHeader('Cache-Control');
                    res.set({
                        'Content-Type': 'application/vnd.apple.mpegurl',
                        'Cache-Control': 'no-cache, no-store, must-revalidate, proxy-revalidate',
                        'Pragma': 'no-cache',
                        'Expires': '0',
                        'Surrogate-Control': 'no-store',
                        'Access-Control-Allow-Origin': '*'
                    });
                    return res.send(rewritten);
                }
            }
        } else if (!strippedRange) {
            const cached = getFromCache(cacheKey);
            if (cached) {
                res.status(200);
                res.removeHeader('ETag');
                res.removeHeader('Last-Modified');
                res.removeHeader('Pragma');
                res.removeHeader('Expires');
                res.removeHeader('Surrogate-Control');
                res.set({ 'Content-Type': cached.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400, immutable', 'Access-Control-Allow-Origin': '*' });
                return res.send(Buffer.from(cached.body));
            }
        }

        const inflightKey = isPlaylist
            ? cacheKey + ':upstream'
            : cacheKey + ':media' + (strippedRange ? `:range:${strippedRange}` : '');
        const fetchPromise = (async () => {
            const { response, usedReferer } = await fetchUpstream();
            return { response, usedReferer };
        })();
        const { response, usedReferer } = await setInflight(inflightKey, fetchPromise);

        if (!response || (!response.ok && response.status !== 206)) {
            if (isPlaylist) {
                const stalePlaylist = getFromCache(cacheKey + ':rewritten', true);
                if (stalePlaylist) {
                    res.status(200);
                    res.removeHeader('ETag');
                    res.removeHeader('Last-Modified');
                    res.removeHeader('Cache-Control');
                    res.set({
                        'Content-Type': 'application/vnd.apple.mpegurl',
                        'Cache-Control': 'no-cache, no-store, must-revalidate, proxy-revalidate',
                        'Pragma': 'no-cache',
                        'Expires': '0',
                        'Surrogate-Control': 'no-store',
                        'Access-Control-Allow-Origin': '*'
                    });
                    return res.send(stalePlaylist);
                }
            }
            if (!isPlaylist && !strippedRange) {
                const staleMedia = getFromCache(cacheKey, true);
                if (staleMedia) {
                    res.status(200);
                    res.removeHeader('ETag');
                    res.removeHeader('Last-Modified');
                    res.removeHeader('Cache-Control');
                    res.set({ 'Content-Type': staleMedia.type, ...proxyNoStoreHeaders() });
                    return res.send(Buffer.from(staleMedia.body));
                }
            }
            return res.status(response?.status || 502).send(`Upstream media error: ${response?.status || 502}`);
        }

        if (isPlaylist) {
            const rewritePromise = (async () => {
                const body = await response.text();
                prefetchPlaylistSegments(body, normalizedTargetUrl, rootReferer || usedReferer || referer || normalizedTargetUrl);
                const rewritten = rewritePlaylist(body, normalizedTargetUrl, rootReferer || usedReferer || referer || normalizedTargetUrl, proxyBaseUrl);
                mediaCache.set(cacheKey + ':rewritten', { data: rewritten, expires: Date.now() + MEDIA_CACHE_TTL_LIVE_PLAYLIST, created: Date.now() });
                return rewritten;
            })();
            const rewritten = await setInflight(cacheKey + ':rewritten', rewritePromise);
            res.status(response.status);
            res.removeHeader('ETag');
            res.removeHeader('Last-Modified');
            res.removeHeader('Cache-Control');
            res.set({
                'Content-Type': 'application/vnd.apple.mpegurl',
                'Cache-Control': 'no-cache, no-store, must-revalidate, proxy-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
                'Surrogate-Control': 'no-store',
                'Access-Control-Allow-Origin': '*'
            });
            return res.send(rewritten);
        }

        res.status(response.status);
        const responseHeaders = {
            ...passthroughHeaders(response.headers),
            ...(response.headers.get('content-length') ? { 'Content-Length': response.headers.get('content-length') } : {}),
            ...(response.headers.get('accept-ranges') ? { 'Accept-Ranges': response.headers.get('accept-ranges') } : {}),
        };
        const cacheSeconds = isSeg ? 86400 : 0;
        res.set({
            ...responseHeaders,
            'Cache-Control': isSeg ? `public, max-age=${cacheSeconds}, immutable` : 'no-cache, no-store, must-revalidate',
            'Access-Control-Allow-Origin': '*'
        });
        res.removeHeader('ETag');
        res.removeHeader('Last-Modified');
        res.removeHeader('Pragma');
        res.removeHeader('Expires');
        res.removeHeader('Surrogate-Control');

        try {
            if (response.body) {
                const nodeStream = Readable.fromWeb(response.body);
                nodeStream.pipe(res);
                if (!strippedRange) {
                    const ct = response.headers.get('content-type') || 'application/octet-stream';
                    let accSize = 0;
                    const accChunks = [];
                    nodeStream.on('data', c => {
                        accSize += c.length;
                        if (accSize < MEDIA_CACHE_MAX_SIZE) accChunks.push(c);
                    });
                    nodeStream.on('end', () => {
                        if (accChunks.length > 0 && accSize > 0) {
                            setCache(cacheKey, { body: Buffer.concat(accChunks), type: ct }, isSeg);
                        }
                    });
                }
                nodeStream.on('error', () => { res.end(); });
            } else {
                res.end();
            }
        } catch {
            if (!res.headersSent) res.status(502).send('Stream failed');
        }
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
        fetch(`http://localhost:${port}/api/livesport-directory`).catch(() => {});
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



