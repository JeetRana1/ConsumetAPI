import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { proxyGet } from '../../utils/outboundProxy';
import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { Redis } from 'ioredis';

const JUSTANIME_BASE = 'https://core.justanime.to/api';
const JUSTANIME_YUKI_BASE = 'https://yuki.justanime.to';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const COMMON_HEADERS = { 'User-Agent': UA, Referer: 'https://justanime.to/', Origin: 'https://justanime.to' };

const fetchJustAnime = async (path: string) =>
  proxyGet(`${JUSTANIME_BASE}${path}`, { headers: COMMON_HEADERS });

const toYukiProxyUrl = (url: string) => {
    const value = String(url || '').trim();
    if (!value) return value;
    if (/m3u8-proxy/i.test(value)) return value;
    if (/\.m3u8(\?|$)/i.test(value)) {
        return `${JUSTANIME_YUKI_BASE}/m3u8-proxy?url=${encodeURIComponent(value)}`;
    }
    return value;
};

const normalizeSourceEntry = (entry: any, quality: string, isSub: boolean) => {
    const file = String(entry?.file || entry?.url || '').trim();
    if (!file) return null;
    const proxied = toYukiProxyUrl(file);
    return {
        url: proxied,
        backupUrl: proxied === file ? undefined : file,
        quality,
        isM3U8: /\.m3u8(\?|$)/i.test(file) || /m3u8-proxy/i.test(proxied),
        isSub
    };
};

const isDeadJustAnimeBackendError = (err: any) =>
    /(backend|core)\.justanime\.to/i.test(String(err?.message || '')) ||
    /getaddrinfo\s+enotfound/i.test(String(err?.message || '')) ||
    /eai_again/i.test(String(err?.message || ''));

const isCloudflareChallengeBody = (value: any) => {
    const body = String(value || '');
    return /just a moment/i.test(body) || /__cf_chl/i.test(body) || /challenge-platform/i.test(body);
};

const tryParseJson = (value: string) => {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const extractJsonFromBrowserText = (value: string) => {
    const text = String(value || '').trim();
    if (!text) return null;
    const direct = tryParseJson(text);
    if (direct !== null) return direct;

    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    const startCandidates = [firstBrace, firstBracket].filter((n) => n >= 0);
    if (!startCandidates.length) return null;
    const start = Math.min(...startCandidates);
    const sliced = text.slice(start).trim();
    return tryParseJson(sliced);
};

const normalizeText = (value: string) =>
    String(value || '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const slugToSearchQuery = (value: string) =>
    String(value || '')
        .replace(/\$episode\$\d+$/i, '')
        .replace(/[-_]\d+$/g, '')
        .replace(/[-_]+/g, ' ')
        .trim();

const fetchJustAnimeViaConnectedBrowser = async (targetUrl: string) => {
    let chromium: any;
    try {
        ({ chromium } = await import('playwright'));
    } catch {
        return null;
    }

    let browser: any;
    try {
        browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
        const context = browser.contexts?.()[0];
        if (!context) return null;

        const page =
            context.pages().find((p: any) => /justanime\.to/i.test(String(p.url?.() || ''))) ||
            await context.newPage();

        const response = await page.goto(targetUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
        }).catch(() => null);

        const bodyText = await page.locator('body').innerText().catch(async () => {
            const html = await page.content().catch(() => '');
            return String(html || '');
        });

        const parsed = extractJsonFromBrowserText(String(bodyText || ''));
        if (parsed !== null) {
            return { data: parsed, status: Number(response?.status?.() || 200) };
        }
        return null;
    } catch {
        return null;
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch {
                // ignore
            }
        }
    }
};

const fetchJustAnimeViaBrowser = async (path: string) => {
    let chromium: any;
    try {
        ({ chromium } = await import('playwright'));
    } catch {
        throw new Error('Playwright is not available for JustAnime browser fallback');
    }

    const targetUrl = `${JUSTANIME_BASE}${path}`;
    const connectedRes = await fetchJustAnimeViaConnectedBrowser(targetUrl);
    if (connectedRes?.data) {
        return connectedRes;
    }

    let browser: any;
    try {
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage'],
        });
        const context = await browser.newContext({
            userAgent: UA,
            extraHTTPHeaders: COMMON_HEADERS,
        });
        const page = await context.newPage();
        let lastText = '';
        let lastStatus = 0;
        let lastContentType = '';

        for (let attempt = 0; attempt < 3; attempt += 1) {
            const response = await page.goto(targetUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000,
            }).catch(() => null);

            lastStatus = Number(response?.status?.() || 0);
            lastContentType = String(response?.headers?.()['content-type'] || '');

            await page.waitForTimeout(3500 + (attempt * 1500));

            const bodyText = await page.locator('body').innerText().catch(async () => {
                const html = await page.content().catch(() => '');
                return String(html || '');
            });
            lastText = String(bodyText || '').trim();

            const parsed = extractJsonFromBrowserText(lastText);
            if (parsed !== null) {
                return { data: parsed };
            }

            if (!isCloudflareChallengeBody(lastText) && lastStatus >= 200 && lastStatus < 400) {
                const evalText = await page.evaluate(async () => {
                    const res = await fetch(window.location.href, {
                        method: 'GET',
                        credentials: 'include',
                        headers: { 'X-Requested-With': 'XMLHttpRequest' },
                    });
                    return await res.text();
                }).catch(() => '');
                const parsedEval = extractJsonFromBrowserText(String(evalText || ''));
                if (parsedEval !== null) {
                    return { data: parsedEval };
                }
                lastText = String(evalText || lastText || '');
            }
        }

        if (lastStatus >= 400) {
            throw new Error(`JustAnime browser fetch http ${lastStatus}`);
        }
        if (isCloudflareChallengeBody(lastText)) {
            throw new Error('JustAnime browser fetch hit Cloudflare challenge');
        }

        throw new Error(
            `JustAnime browser fetch returned non-JSON payload (${lastContentType || 'unknown content-type'})`
        );
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch {
                // ignore
            }
        }
    }
};

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
    const searchJustAnime = async (query: string) => {
        const encoded = encodeURIComponent(query);
        const candidates = [
            `/search/suggestions?query=${encoded}`,
            `/search?query=${encoded}`,
            `/anime/search?query=${encoded}`,
        ];

        let lastErr: any = null;
        for (const path of candidates) {
            try {
                const res = await fetchJustAnime(path);
                const body = res?.data;
                if (isCloudflareChallengeBody(body)) {
                    const browserRes = await fetchJustAnimeViaBrowser(path);
                    if (browserRes?.data) return browserRes;
                    continue;
                }
                if (body !== undefined && body !== null && body !== '') {
                    return res;
                }
            } catch (err: any) {
                lastErr = err;
                try {
                    const browserRes = await fetchJustAnimeViaBrowser(path);
                    if (browserRes?.data) return browserRes;
                } catch (browserErr: any) {
                    lastErr = browserErr || err;
                }
            }
        }
        if (lastErr) {
            console.error('JustAnime search fallback failed:', lastErr.message);
        }
        return { data: [] };
    };

    const resolveJustAnimeId = async (value: string) => {
        const raw = String(value || '').trim();
        if (/^\d+$/.test(raw)) return raw;

        const searchQuery = slugToSearchQuery(raw);
        if (!searchQuery) return raw;

        const res = await searchJustAnime(searchQuery);
        const items = Array.isArray(res?.data?.data)
            ? res.data.data
            : Array.isArray(res?.data)
                ? res.data
                : [];

        const target = normalizeText(searchQuery);
        let best: any = null;
        let bestScore = -1;

        for (const item of items) {
            const english = normalizeText(item?.title?.english || '');
            const romaji = normalizeText(item?.title?.romaji || '');
            const id = item?.id;
            if (!id) continue;

            let score = 0;
            if (english === target || romaji === target) score += 1000;
            if (english.includes(target) || target.includes(english)) score += 400;
            if (romaji.includes(target) || target.includes(romaji)) score += 350;

            const targetTerms = new Set(target.split(' ').filter(Boolean));
            for (const term of targetTerms) {
                if (english.includes(term)) score += 20;
                if (romaji.includes(term)) score += 20;
            }

            if (score > bestScore) {
                bestScore = score;
                best = item;
            }
        }

        return String(best?.id || raw);
    };

    fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
        const id = (request.query as { id: string }).id;
        if (typeof id === 'undefined')
            return reply.status(400).send({ message: 'id is required' });
        try {
            const fetchInfo = async () => {
                try {
                    const resolvedId = await resolveJustAnimeId(id);
                    const [infoRes, epRes] = await Promise.all([
                        (async () => {
                            const res = await fetchJustAnime(`/anime/${resolvedId}`);
                            return isCloudflareChallengeBody(res?.data)
                                ? await fetchJustAnimeViaBrowser(`/anime/${resolvedId}`)
                                : res;
                        })(),
                        (async () => {
                            const res = await fetchJustAnime(`/anime/${resolvedId}/episodes?page=1`);
                            return isCloudflareChallengeBody(res?.data)
                                ? await fetchJustAnimeViaBrowser(`/anime/${resolvedId}/episodes?page=1`)
                                : res;
                        })()
                    ]);

                    const infoPayload = (infoRes?.data?.data ?? infoRes?.data ?? {}) as any;
                    const rawEpisodes = epRes?.data?.data?.episodes ?? epRes?.data?.episodes ?? epRes?.data ?? [];
                    const episodes = (Array.isArray(rawEpisodes) ? rawEpisodes : []).map((ep: any) => ({
                        id: `${resolvedId}$episode$${ep.number}`,
                        number: ep.number,
                        title: ep.title,
                        isFiller: ep.isFiller
                    }));

                    return {
                        ...(typeof infoPayload === 'object' && infoPayload ? infoPayload : {}),
                        id: resolvedId,
                        episodes
                    };
                } catch (err: any) {
                    throw err;
                }
            };

            const res = redis
                ? await cache.fetch(
                    redis as Redis,
                    `justanime:info:${id}`,
                    fetchInfo,
                    REDIS_TTL
                )
                : await fetchInfo();

            reply.status(200).send(res);
        } catch (err: any) {
            console.error('JustAnime info error:', err.message);
            reply.status(500).send({ message: 'Error fetching info from JustAnime', error: err.message });
        }
    });

    fastify.get('/watch/:episodeId', async (request: FastifyRequest, reply: FastifyReply) => {
        const episodeId = (request.params as { episodeId: string }).episodeId;
        // Format: anilistId$episode$number
        const parts = episodeId.split('$episode$');
        const id = parts[0];
        const ep = parts[1] || '1';

        try {
            const fetchWatch = async () => {
                try {
                    const resolvedId = await resolveJustAnimeId(id);
                    const watchPath = `/watch/${resolvedId}/episode/${ep}/hianime`;
                    const initialRes = await fetchJustAnime(watchPath);
                    const res = isCloudflareChallengeBody(initialRes?.data)
                        ? await fetchJustAnimeViaBrowser(watchPath)
                        : initialRes;

                    const data = (res?.data?.data ?? res?.data ?? {}) as any;
                    if (Array.isArray(data?.sources) && data.sources.length > 0) {
                        const sources = data.sources
                            .map((s: any) => normalizeSourceEntry(s, s?.quality || 'Default', Boolean(s?.isSub)))
                            .filter(Boolean);
                        return {
                            headers: { Referer: 'https://justanime.to/', Origin: 'https://justanime.to' },
                            sources,
                            subtitles: data.subtitles || [],
                            intro: data.intro,
                            outro: data.outro
                        };
                    }
                    const sub = data.sub?.sources || { sources: [], tracks: [] };
                    const dub = data.dub?.sources || { sources: [], tracks: [] };

                    const sources = [
                        ...(sub.sources || []).map((s: any) => normalizeSourceEntry(s, 'Subbed', true)),
                        ...(dub.sources || []).map((s: any) => normalizeSourceEntry(s, 'Dubbed', false))
                    ].filter(Boolean);

                    const subtitles = [
                        ...(sub.tracks || []).map((t: any) => ({ ...t, url: t.file })),
                        ...(dub.tracks || []).map((t: any) => ({ ...t, url: t.file }))
                    ];

                    return {
                        headers: { Referer: 'https://justanime.to/', Origin: 'https://justanime.to' },
                        sources,
                        subtitles,
                        intro: data.sub?.intro || data.dub?.intro,
                        outro: data.sub?.outro || data.dub?.outro
                    };
                } catch (err: any) {
                    throw err;
                }
            };

            const res = redis
                ? await cache.fetch(
                    redis as Redis,
                    `justanime:watch:${episodeId}`,
                    fetchWatch,
                    REDIS_TTL
                )
                : await fetchWatch();

            reply.status(200).send(res);
        } catch (err: any) {
            console.error('JustAnime watch error:', err.message);
            reply.status(500).send({ message: 'Error fetching sources from JustAnime', error: err.message });
        }
    });

    fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
        const query = (request.params as { query: string }).query;
        try {
            const res = await searchJustAnime(query);
            const payload = res?.data?.data ?? res?.data ?? [];
            reply.status(200).send(payload);
        } catch (err: any) {
            console.error('JustAnime search error:', err.message);
            reply.status(200).send([]);
        }
    });
};

export default routes;
