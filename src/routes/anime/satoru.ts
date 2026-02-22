import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { AnimeParser, ISearch, IAnimeResult, IAnimeInfo, IEpisodeServer, ISource, MediaFormat, MediaStatus } from '@consumet/extensions/dist/models';
import { ANIME } from '@consumet/extensions';
import { StreamingServers, SubOrSub } from '@consumet/extensions/dist/models';
import { load } from 'cheerio';
import Redis from 'ioredis/built';
import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { configureProvider } from '../../utils/provider';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getProxyCandidates, toAxiosProxyOptions } from '../../utils/outboundProxy';

const execFileAsync = promisify(execFile);

class SatoruProvider extends AnimeParser {
    name = 'Satoru';
    baseUrl = 'https://satoru.one';
    logo = 'https://satoru.one/satoru-full-logo.png';
    classPath = 'ANIME.Satoru';
    private readonly requestTimeoutMs =
      Number(process.env.SATORU_FETCH_TIMEOUT_MS || '') ||
      (process.env.NODE_ENV === 'production' ? 7000 : 10000);
    private readonly proxyRequestTimeoutMs =
      Number(process.env.SATORU_PROXY_TIMEOUT_MS || '') ||
      (process.env.NODE_ENV === 'production' ? 3500 : 5000);
    private readonly maxProxyAttempts =
      Number(process.env.SATORU_PROXY_MAX_ATTEMPTS || '') ||
      (process.env.NODE_ENV === 'production' ? 2 : 3);
    private readonly preferWindowsCurl =
      process.platform === 'win32' && !['1', 'true', 'yes'].includes(String(process.env.SATORU_DISABLE_CURL || '').toLowerCase());
    private readonly satoruCookieHeader = (() => {
        const rawCookie = String(process.env.SATORU_COOKIE || '').trim();
        const cfClearance = String(process.env.SATORU_CF_CLEARANCE || '').trim();
        const parts: string[] = [];
        if (rawCookie) parts.push(rawCookie);
        if (cfClearance) parts.push(`cf_clearance=${cfClearance}`);
        return parts.join('; ');
    })();

    private async fetch(url: string, headers: any = {}): Promise<string> {
        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
        const mergedHeaders: Record<string, string> = {
            'User-Agent': userAgent,
            ...(this.satoruCookieHeader ? { Cookie: this.satoruCookieHeader } : {}),
            ...(headers || {}),
        };

        if (this.preferWindowsCurl) {
            try {
                const curlArgs: string[] = ['-sS', '-L', '--compressed', '-A', userAgent];
                for (const [key, value] of Object.entries(mergedHeaders)) {
                    if (String(key).toLowerCase() === 'user-agent') continue;
                    curlArgs.push('-H', `${key}: ${String(value)}`);
                }
                curlArgs.push(url);
                const { stdout } = await execFileAsync('curl.exe', curlArgs, {
                    maxBuffer: 1024 * 1024 * 50,
                    timeout: this.requestTimeoutMs,
                });
                if (String(stdout || '').trim()) {
                    return stdout;
                }
            } catch {
                // Fall through to axios client.
            }
        }

        const proxyCandidates = await getProxyCandidates();
        const chain = [
            undefined,
            ...proxyCandidates.slice(0, Math.max(0, this.maxProxyAttempts)),
        ];
        let lastErr: unknown;

        for (let i = 0; i < chain.length; i += 1) {
            const proxyUrl = chain[i];
            try {
                const proxyOptions = toAxiosProxyOptions(proxyUrl);
                const { data } = await this.client.get<string>(url, {
                    headers: mergedHeaders,
                    // Direct attempt gets slightly longer timeout; proxy attempts are short.
                    timeout: i === 0 ? this.requestTimeoutMs : this.proxyRequestTimeoutMs,
                    responseType: 'text',
                    ...(proxyOptions as any),
                });
                if (typeof data === 'string') return data;
                return String(data || '');
            } catch (err) {
                lastErr = err;
                continue;
            }
        }

        throw lastErr instanceof Error ? lastErr : new Error('Satoru fetch failed');
    }

    private normalizeEpisodeId(episodeId: string): string {
        const raw = String(episodeId || '').trim();
        if (!raw) return raw;
        if (raw.includes('$episode$')) {
            const tail = raw.split('$episode$').pop() || raw;
            return tail.trim();
        }
        return raw;
    }

    async search(query: string, page: number = 1): Promise<ISearch<IAnimeResult>> {
        const data = await this.fetch(`${this.baseUrl}/filter?keyword=${encodeURIComponent(query)}&page=${page}`, {
            'Referer': this.baseUrl,
        });
        const $ = load(data);
        const results: IAnimeResult[] = [];

        $('.flw-item').each((i, el) => {
            const card = $(el);
            const title = card.find('.film-name a').text().trim();
            const href = card.find('.film-name a').attr('href') || '';
            const slug = href.split('/').pop() || '';
            // movieId is the numeric data-id on the poster anchor
            const movieId = card.find('.film-poster-ahref').attr('data-id') || '';
            // id format: "slug:movieId" to carry both pieces of info
            const id = movieId ? `${slug}:${movieId}` : slug;
            const image = card.find('img').attr('data-src') || card.find('img').attr('src');

            const typeStr = card.find('.fdi-item').first().text().trim().toUpperCase();
            let type: MediaFormat | undefined;
            if (typeStr === 'TV') type = MediaFormat.TV;
            else if (typeStr === 'MOVIE') type = MediaFormat.MOVIE;
            else if (typeStr === 'OVA') type = MediaFormat.OVA;
            else if (typeStr === 'ONA') type = MediaFormat.ONA;
            else if (typeStr === 'SPECIAL') type = MediaFormat.SPECIAL;

            results.push({
                id,
                title,
                image,
                url: `${this.baseUrl}/watch/${slug}`,
                type,
            });
        });

        return {
            currentPage: page,
            hasNextPage: $('.pagination .active').next().length > 0,
            results,
        };
    }

    async fetchAnimeInfo(id: string): Promise<IAnimeInfo> {
        // id can be "slug:movieId" or just a slug
        const parts = id.split(':');
        const slug = parts[0];
        let movieId = parts[1] || '';

        const data = await this.fetch(`${this.baseUrl}/watch/${slug}`, {
            'Referer': this.baseUrl,
        });
        const $ = load(data);

        // Extract movieId from the inline script: const movieId = 3;
        if (!movieId) {
            const movieIdMatch = data.match(/const movieId = (\d+);/);
            movieId = movieIdMatch ? movieIdMatch[1] : '';
        }

        const animeInfo: IAnimeInfo = {
            id,
            title: $('h2.film-name a.dynamic-name, .anisc-detail h2.film-name a').first().text().trim(),
            image: $('.anisc-poster .film-poster-img').attr('src'),
            description: $('.film-description p.text').text().trim(),
            episodes: [],
        };

        $('.anisc-info .item-title').each((i, el) => {
            const item = $(el);
            const label = item.find('.item-head').text().toLowerCase();
            const value = item.find('.name').text().trim();
            if (label.includes('japanese')) animeInfo.japaneseTitle = value;
            if (label.includes('status')) {
                if (value.includes('Finished')) animeInfo.status = MediaStatus.COMPLETED;
                else if (value.includes('Currently')) animeInfo.status = MediaStatus.ONGOING;
            }
            if (label.includes('premiered')) animeInfo.season = value;
            if (label.includes('duration')) animeInfo.duration = parseInt(value);
        });

        animeInfo.genres = $('.item-list a').map((i, el) => $(el).text().trim()).get();

        if (movieId) {
            // Correct endpoint: /ajax/episode/list/{movieId} (path param, not query)
            const episodeDataStr = await this.fetch(`${this.baseUrl}/ajax/episode/list/${movieId}`, {
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${this.baseUrl}/watch/${slug}`,
            });
            try {
                const episodeData = JSON.parse(episodeDataStr);
                const $eps = load(episodeData.html || '');

                $eps('.ep-item').each((i, el) => {
                    const ep = $eps(el);
                    const epHref = ep.attr('href') || '';
                    const epUrl = epHref.startsWith('http') ? epHref : `${this.baseUrl}${epHref}`;
                    animeInfo.episodes?.push({
                        id: ep.attr('data-id') || '',
                        number: parseFloat(ep.attr('data-number') || '0'),
                        title: ep.find('.ep-name').text().trim() || `Episode ${ep.attr('data-number')}`,
                        url: epUrl,
                    });
                });
            } catch {
                // episode list parse failed, continue with empty list
            }
        }

        return animeInfo;
    }

    async fetchEpisodeServers(episodeId: string): Promise<IEpisodeServer[]> {
        const normalizedEpisodeId = this.normalizeEpisodeId(episodeId);
        const dataStr = await this.fetch(`${this.baseUrl}/ajax/episode/servers?episodeId=${normalizedEpisodeId}`, {
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': this.baseUrl,
        });
        const data = JSON.parse(dataStr);
        const $ = load(data.html);
        const servers: IEpisodeServer[] = [];

        $('.server-item').each((i, el) => {
            const item = $(el);
            const langText = item.closest('.d-flex').find('span').first().text().trim();
            servers.push({
                name: `${item.find('a').text().trim()} (${langText})`,
                url: item.attr('data-id') || '',
            });
        });

        return servers;
    }

    async fetchEpisodeSources(episodeId: string, serverId?: string): Promise<ISource> {
        const normalizedEpisodeId = this.normalizeEpisodeId(episodeId);
        const candidateServerIds: string[] = [];
        if (serverId) candidateServerIds.push(serverId);
        try {
            const servers = await this.fetchEpisodeServers(normalizedEpisodeId);
            for (const srv of servers) {
                const id = String(srv?.url || '').trim();
                if (id && !candidateServerIds.includes(id)) candidateServerIds.push(id);
            }
        } catch {
            // If server list endpoint fails, we'll still try any provided serverId.
        }
        if (!candidateServerIds.length) throw new Error('No servers found');

        let data: any = null;
        let resolvedServerId: string | undefined;
        for (const candidate of candidateServerIds) {
            try {
                const dataStr = await this.fetch(`${this.baseUrl}/ajax/episode/sources?id=${candidate}`, {
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': this.baseUrl,
                });
                const parsed = JSON.parse(dataStr);
                const link = String(parsed?.link || '').trim();
                if (link) {
                    data = parsed;
                    resolvedServerId = candidate;
                    break;
                }
                const message = String(parsed?.message || '').toLowerCase();
                if (message.includes("couldn't find server") || message.includes('server')) {
                    continue;
                }
            } catch {
                continue;
            }
        }

        if (!data?.link) {
            throw new Error("Couldn't find server. Try another server");
        }

        let sources = [
            {
                url: data.link,
                isM3U8: String(data.link).includes('.m3u8'),
            }
        ];
        let embedURL = data.type === 'iframe' ? data.link : undefined;

        if (embedURL) {
            try {
                // Follow the embed link to see if we can scrape a direct video file from the HTML
                const embedHtml = await this.fetch(embedURL, { 'Referer': this.baseUrl });

                // Try to find m3u8 or mp4
                const m3u8Match = embedHtml.match(/(https?:\/\/[^\s"'<>]+?\.m3u8[^\s"'<>]*)/i);
                if (m3u8Match) {
                    sources = [{ url: m3u8Match[1], isM3U8: true }];
                } else {
                    const mp4Match = embedHtml.match(/(https?:\/\/[^\s"'<>]+?\.mp4[^\s"'<>]*)/i);
                    if (mp4Match) {
                        sources = [{ url: mp4Match[1], isM3U8: false }];
                    }
                }
            } catch (e) {
                // Ignore extraction failures and fallback down to embedURL
            }
        }

        const result: any = {
            headers: { Referer: this.baseUrl },
            sources: sources,
            embedURL: embedURL,
            serverId: resolvedServerId,
        };
        // Pass through upstream skip timing metadata when available.
        if (data?.intro) result.intro = data.intro;
        if (data?.outro) result.outro = data.outro;
        if (data?.skip) result.skip = data.skip;
        if (data?.skips) result.skips = data.skips;
        if (data?.timestamps) result.timestamps = data.timestamps;
        return result as ISource;
    }
}

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
    const satoru = configureProvider(new SatoruProvider());
    const hianimeFallback = configureProvider(new ANIME.Hianime());
    const localEpisodeMapCache = new Map<string, { id: string; ts: number }>();
    const EPISODE_MAP_TTL_MS = 60 * 60 * 1000;

    const isSatoruBlockedError = (err: any) => {
        const message = String(err?.message || err || '').toLowerCase();
        return (
          message.includes('status code 403') ||
          message.includes('forbidden') ||
          message.includes('timed out') ||
          message.includes('timeout') ||
          message.includes('etimedout') ||
          message.includes('aborted')
        );
    };

    const normalizeAnimeIdForFallback = (id: string) => String(id || '').split(':')[0];
    const isHiAnimeEpisodeId = (id: string) => String(id || '').includes('$episode$');
    const getSatoruSlug = (episodeId: string) => String(episodeId || '').split('$episode$')[0];
    const normalizeEpisodeIdForWatch = (id: string) => {
        const raw = String(id || '').trim();
        if (!raw) return raw;
        if (raw.includes('$episode$')) {
            return (raw.split('$episode$').pop() || raw).trim();
        }
        return raw;
    };
    const fetchHiAnimeFallbackSources = async (episodeId: string) => {
        const serversToTry = [
            StreamingServers.VidCloud,
            StreamingServers.VidStreaming,
            StreamingServers.MegaCloud,
        ];
        let lastErr: unknown;
        for (const server of serversToTry) {
            try {
                const res = await hianimeFallback.fetchEpisodeSources(
                    episodeId,
                    server,
                    SubOrSub.BOTH,
                );
                if (Array.isArray((res as any)?.sources) && (res as any).sources.length) return res;
            } catch (err) {
                lastErr = err;
                continue;
            }
        }
        throw lastErr ?? new Error('HiAnime fallback failed');
    };
    const fetchHiAnimeRouteFallbackSources = async (episodeId: string) => {
        const encodedEpisodeId = encodeURIComponent(episodeId);
        const attempts = [
            // Keep this list short to avoid long-endpoint stalls.
            { url: `/anime/hianime/watch/${encodedEpisodeId}`, forceIsDub: undefined as undefined | boolean },
            { url: `/anime/hianime/watch/${encodedEpisodeId}?server=vidcloud`, forceIsDub: undefined as undefined | boolean },
            { url: `/anime/hianime/watch/${encodedEpisodeId}?server=vidstreaming`, forceIsDub: undefined as undefined | boolean },
        ];

        const runAttempt = async (attempt: { url: string; forceIsDub?: boolean }) => {
                const res = await fastify.inject({ method: 'GET', url: attempt.url });
                if (res.statusCode >= 400) {
                    let bodyMessage = '';
                    try {
                        const body = JSON.parse(res.body || '{}');
                        bodyMessage = String(body?.message || '');
                    } catch {
                        // ignore parse errors
                    }
                    throw new Error(bodyMessage || `HiAnime route failed (${res.statusCode})`);
                }

                const payload: any = JSON.parse(res.body || '{}');
                const cleanedSources = (Array.isArray(payload?.sources) ? payload.sources : [])
                    .filter((src: any) => {
                        const rawUrl = String(src?.url || '');
                        return !!rawUrl && !rawUrl.includes('.replace(');
                    })
                    .map((src: any) => ({
                        ...src,
                        url: String(src.url),
                        isDub: typeof attempt.forceIsDub === 'boolean' ? attempt.forceIsDub : src?.isDub,
                    }));

                if (!cleanedSources.length) {
                    throw new Error('HiAnime route returned no usable sources');
                }
                return {
                    sources: cleanedSources,
                    subtitles: Array.isArray(payload?.subtitles) ? payload.subtitles : [],
                    headers: payload?.headers,
                    intro: payload?.intro,
                    outro: payload?.outro,
                } as ISource;
        };

        return await new Promise<ISource>((resolve, reject) => {
            let settled = false;
            let remaining = attempts.length;
            let lastErr: unknown = new Error('HiAnime route fallback failed');

            for (const attempt of attempts) {
                runAttempt(attempt)
                    .then((result) => {
                        if (settled) return;
                        settled = true;
                        resolve(result);
                    })
                    .catch((err) => {
                        lastErr = err;
                        remaining -= 1;
                        if (!settled && remaining <= 0) {
                            settled = true;
                            reject(lastErr);
                        }
                    });
            }
        });
    };

    const pickByTitle = (results: any[], title: string) => {
        const norm = (v: string) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const q = norm(title);
        if (!q) return results[0];
        let best = results[0];
        let bestScore = -1;
        for (const item of results) {
            const t = norm(item?.title || item?.name || '');
            if (!t) continue;
            let score = 0;
            if (t === q) score += 100;
            else if (t.includes(q) || q.includes(t)) score += 70;
            const qw = q.split(' ').filter(Boolean);
            const tw = t.split(' ').filter(Boolean);
            score += qw.filter((w) => tw.includes(w)).length * 10;
            if (score > bestScore) {
                bestScore = score;
                best = item;
            }
        }
        return best;
    };

    const toEpisodeNum = (ep: any): number => {
        const n = Number(ep?.number ?? ep?.episode ?? ep?.episodeNumber ?? ep?.episodeNum ?? 0);
        return Number.isFinite(n) ? n : 0;
    };
    const slugToTitle = (slug: string) =>
        String(slug || '')
            .replace(/-\d+$/, '')
            .replace(/-/g, ' ')
            .trim();

    const resolveSatoruEpisodeIdFromHiAnimeId = async (hiEpisodeId: string): Promise<string | null> => {
        if (!isHiAnimeEpisodeId(hiEpisodeId)) return null;
        const cached = localEpisodeMapCache.get(hiEpisodeId);
        if (cached && Date.now() - cached.ts < EPISODE_MAP_TTL_MS) {
            return cached.id;
        }
        const hiSlug = getSatoruSlug(hiEpisodeId);
        if (!hiSlug) return null;

        let episodeNum = 0;
        let titleGuess = slugToTitle(hiSlug);
        try {
            const hInfo: any = await hianimeFallback.fetchAnimeInfo(hiSlug);
            titleGuess = String(hInfo?.title || titleGuess).trim() || titleGuess;
            const hEpisodes = Array.isArray(hInfo?.episodes) ? hInfo.episodes : [];
            const hCurrent = hEpisodes.find((ep: any) => String(ep?.id || '') === String(hiEpisodeId));
            episodeNum = toEpisodeNum(hCurrent);
        } catch {
            // continue with guessed title
        }

        if (!episodeNum) {
            const slugEp = hiSlug.match(/-episode-(\d+)$/i);
            if (slugEp) episodeNum = Number(slugEp[1] || 0);
        }
        if (!episodeNum) return null;

        let sInfo: any = null;
        const directCandidates = [hiSlug, hiSlug.replace(/-\d+$/, '')].filter(Boolean);
        for (const candidate of directCandidates) {
            try {
                const info = await satoru.fetchAnimeInfo(candidate);
                if (Array.isArray(info?.episodes) && info.episodes.length) {
                    sInfo = info;
                    break;
                }
            } catch {
                // try next candidate
            }
        }

        if (!sInfo) {
            try {
                const sSearch = await satoru.search(titleGuess, 1);
                const results = Array.isArray(sSearch?.results) ? sSearch.results : [];
                if (results.length) {
                    const picked = pickByTitle(results, titleGuess);
                    if (picked?.id) {
                        sInfo = await satoru.fetchAnimeInfo(picked.id);
                    }
                }
            } catch {
                // no-op
            }
        }

        const sEpisodes = Array.isArray(sInfo?.episodes) ? sInfo.episodes : [];
        if (!sEpisodes.length) return null;

        const exact = sEpisodes.find((ep: any) => toEpisodeNum(ep) === episodeNum);
        if (exact?.id) {
            const mappedId = String(exact.id);
            localEpisodeMapCache.set(hiEpisodeId, { id: mappedId, ts: Date.now() });
            return mappedId;
        }

        const idx = Math.max(0, Math.min(sEpisodes.length - 1, episodeNum - 1));
        const byIndex = sEpisodes[idx];
        if (byIndex?.id) {
            const mappedId = String(byIndex.id);
            localEpisodeMapCache.set(hiEpisodeId, { id: mappedId, ts: Date.now() });
            return mappedId;
        }

        return null;
    };

    const fallbackViaKickAssByOrdinal = async (satoruEpisodeId: string) => {
        const slug = getSatoruSlug(satoruEpisodeId);
        if (!slug) return null;
        const normalizedEpisodeId = normalizeEpisodeIdForWatch(satoruEpisodeId);

        const sInfo: any = await satoru.fetchAnimeInfo(slug);
        const sEpisodes = Array.isArray(sInfo?.episodes) ? sInfo.episodes : [];
        const current = sEpisodes.find((ep: any) => {
            const id = String(ep?.id || '').trim();
            return (
                id === String(satoruEpisodeId) ||
                id === normalizedEpisodeId ||
                (normalizedEpisodeId && id.includes(normalizedEpisodeId))
            );
        });
        const episodeNum = toEpisodeNum(current);
        if (!episodeNum) return null;

        const title = String(sInfo?.title || slug).trim();
        const searchRes = await fastify.inject({
            method: 'GET',
            url: `/anime/kickassanime/${encodeURIComponent(title)}`,
        });
        const search = (() => {
            try {
                return JSON.parse(searchRes.body || '{}');
            } catch {
                return {};
            }
        })();
        const results = Array.isArray(search?.results) ? search.results : [];
        if (!results.length) return null;
        const picked = pickByTitle(results, title);
        if (!picked?.id) return null;

        const infoRes = await fastify.inject({
            method: 'GET',
            url: `/anime/kickassanime/info?id=${encodeURIComponent(picked.id)}`,
        });
        const kInfo: any = (() => {
            try {
                return JSON.parse(infoRes.body || '{}');
            } catch {
                return {};
            }
        })();
        const kEpisodes = Array.isArray(kInfo?.episodes) ? kInfo.episodes : [];
        if (!kEpisodes.length) return null;
        const kEpisode =
            kEpisodes.find((ep: any) => toEpisodeNum(ep) === episodeNum) ||
            kEpisodes[Math.max(0, Math.min(kEpisodes.length - 1, episodeNum - 1))];
        if (!kEpisode?.id) return null;

        const watchRes = await fastify.inject({
            method: 'GET',
            url: `/anime/kickassanime/watch/${encodeURIComponent(kEpisode.id)}`,
        });
        const watch: any = (() => {
            try {
                return JSON.parse(watchRes.body || '{}');
            } catch {
                return {};
            }
        })();
        if (!watch || !Array.isArray((watch as any).sources) || !(watch as any).sources.length) return null;
        return watch;
    };

    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro:
                "Welcome to the Satoru provider: check out the provider's website @ https://satoru.one/",
            routes: ['/:query', '/info/:id', '/watch/:episodeId', '/servers/:episodeId'],
        });
    });

    fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
        const query = (request.params as { query: string }).query;
        const page = (request.query as { page?: number }).page || 1;

        try {
            let res = redis
                ? await cache.fetch(
                    redis as Redis,
                    `satoru:search:${query}:${page}`,
                    async () => await satoru.search(query, page),
                    REDIS_TTL,
                )
                : await satoru.search(query, page);

            reply.status(200).send(res);
        } catch (err) {
            if (isSatoruBlockedError(err)) {
                try {
                    const fallback = await hianimeFallback.search(query, page);
                    return reply.status(200).send(fallback);
                } catch (fallbackErr) {
                    return reply.status(500).send({
                        message: (fallbackErr as Error).message,
                    });
                }
            }
            reply.status(500).send({
                message: (err as Error).message,
            });
        }
    });

    fastify.get('/info/:id', async (request: FastifyRequest, reply: FastifyReply) => {
        const id = (request.params as { id: string }).id;

        try {
            let res = redis
                ? await cache.fetch(
                    redis as Redis,
                    `satoru:info:${id}`,
                    async () => await satoru.fetchAnimeInfo(id),
                    REDIS_TTL,
                )
                : await satoru.fetchAnimeInfo(id);

            reply.status(200).send(res);
        } catch (err) {
            if (isSatoruBlockedError(err)) {
                try {
                    const fallback = await hianimeFallback.fetchAnimeInfo(normalizeAnimeIdForFallback(id));
                    return reply.status(200).send(fallback);
                } catch (fallbackErr) {
                    return reply.status(500).send({ message: (fallbackErr as Error).message });
                }
            }
            reply
                .status(500)
                .send({ message: (err as Error).message });
        }
    });

    fastify.get(
        '/watch/:episodeId',
        async (request: FastifyRequest, reply: FastifyReply) => {
            const episodeId = (request.params as { episodeId: string }).episodeId;
            const serverId = (request.query as { serverId?: string }).serverId;
            const normalizedEpisodeId = normalizeEpisodeIdForWatch(episodeId);
            const isHiAnimeStyle = isHiAnimeEpisodeId(episodeId);
            let resolvedSatoruEpisodeId = normalizedEpisodeId;

            if (isHiAnimeStyle) {
                try {
                    const mapKey = `satoru:episode-map:${episodeId}`;
                    const mapped = redis
                        ? await cache.fetch(
                            redis as Redis,
                            mapKey,
                            async () => (await resolveSatoruEpisodeIdFromHiAnimeId(episodeId)) || '',
                            REDIS_TTL,
                        )
                        : (await resolveSatoruEpisodeIdFromHiAnimeId(episodeId)) || '';
                    if (mapped) resolvedSatoruEpisodeId = mapped;
                } catch {
                    // mapping failed; keep normalized fallback id
                }
            }

            try {
                let res = redis
                    ? await cache.fetch(
                        redis as Redis,
                        `satoru:watch:${resolvedSatoruEpisodeId}:${serverId}`,
                        async () => await satoru.fetchEpisodeSources(resolvedSatoruEpisodeId, serverId),
                        REDIS_TTL,
                    )
                    : await satoru.fetchEpisodeSources(resolvedSatoruEpisodeId, serverId);

                reply.status(200).send(res);
            } catch (err) {
                if (
                    isSatoruBlockedError(err) ||
                    String((err as Error)?.message || '').toLowerCase().includes('no servers found') ||
                    isHiAnimeStyle
                ) {
                    if (isHiAnimeStyle) {
                        try {
                            const fallback = await fetchHiAnimeRouteFallbackSources(episodeId);
                            return reply.status(200).send(fallback);
                        } catch (fallbackErr) {
                            try {
                                const fallback = await fetchHiAnimeFallbackSources(episodeId);
                                return reply.status(200).send(fallback);
                            } catch (fallbackErr2) {
                                return reply.status(500).send({ message: (fallbackErr2 as Error).message || (fallbackErr as Error).message });
                            }
                        }
                    }
                    try {
                        const kick = await fallbackViaKickAssByOrdinal(episodeId);
                        if (kick) return reply.status(200).send(kick);
                    } catch {
                        // ignore and continue
                    }
                }
                reply
                    .status(500)
                    .send({ message: (err as Error).message });
            }
        },
    );

    fastify.get(
        '/servers/:episodeId',
        async (request: FastifyRequest, reply: FastifyReply) => {
            const episodeId = (request.params as { episodeId: string }).episodeId;

            try {
                let res = redis
                    ? await cache.fetch(
                        redis as Redis,
                        `satoru:servers:${episodeId}`,
                        async () => await satoru.fetchEpisodeServers(episodeId),
                        REDIS_TTL,
                    )
                    : await satoru.fetchEpisodeServers(episodeId);

                reply.status(200).send(res);
            } catch (err) {
                if (isSatoruBlockedError(err)) {
                    return reply.status(200).send([
                        { name: 'VidCloud (fallback)', url: 'vidcloud' },
                        { name: 'VidStreaming (fallback)', url: 'vidstreaming' },
                    ]);
                }
                reply
                    .status(500)
                    .send({ message: (err as Error).message });
            }
        },
    );
};

export default routes;
