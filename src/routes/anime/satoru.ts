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
import Anilist from '@consumet/extensions/dist/providers/meta/anilist';
import { promisify } from 'util';
import { getProxyCandidates, toAxiosProxyOptions } from '../../utils/outboundProxy';

const execFileAsync = promisify(execFile);
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const PROD_DIRECT_RACE_TIMEOUT_MS =
    Number(process.env.SATORU_PROD_DIRECT_RACE_TIMEOUT_MS || '') || 9000;

class SatoruProvider extends AnimeParser {
    name = 'Satoru';
    baseUrl = 'https://satoru.one';
    logo = 'https://satoru.one/satoru-full-logo.png';
    classPath = 'ANIME.Satoru';
    private readonly requestTimeoutMs =
      Number(process.env.SATORU_FETCH_TIMEOUT_MS || '') ||
      (process.env.NODE_ENV === 'production' ? 5000 : 4000);
    private readonly proxyRequestTimeoutMs =
      Number(process.env.SATORU_PROXY_TIMEOUT_MS || '') ||
      (process.env.NODE_ENV === 'production' ? 2000 : 2000);
    private readonly maxProxyAttempts =
      Number(process.env.SATORU_PROXY_MAX_ATTEMPTS || '') ||
      (process.env.NODE_ENV === 'production' ? 2 : 2);
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
                    ...(i === 0 ? { proxy: false } : {}),
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

        // Add AniList IDs in parallel
        const anilistPromises = results.map(async (result) => {
            try {
                const anilistId = redis ? await cache.fetch(
                    redis,
                    `anilist:title:${result.title}`,
                    async () => {
                        const anilist = new Anilist();
                        const searchRes = await anilist.search(String(result.title), 1, 1);
                        return searchRes.results[0]?.id || null;
                    },
                    REDIS_TTL
                ) : null;
                if (anilistId) (result as any).anilistId = anilistId;
            } catch (e) {
                console.error('Failed to get AniList ID for', result.title, (e as Error).message);
            }
        });
        await Promise.all(anilistPromises);

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
        (animeInfo as any).related = [];

        const relatedMap = new Map<string, { id: string; title: string; url: string }>();
        const normalizeFamilyTitle = (value: string) =>
            String(value || '')
                .toLowerCase()
                .replace(/\bseason\s*\d+\b/g, ' ')
                .replace(/\bs\d+\b/g, ' ')
                .replace(/\bpart\s*\d+\b/g, ' ')
                .replace(/\bmovie\b/g, ' ')
                .replace(/\barc\b/g, ' ')
                .replace(/[^a-z0-9]+/g, ' ')
                .trim();
        const currentTitleFamily = normalizeFamilyTitle(String(animeInfo.title || ''));
        const currentTitleTokens = currentTitleFamily.split(' ').filter(Boolean);
        $('a').each((_, el) => {
            const anchor = $(el);
            const href = String(anchor.attr('href') || '').trim();
            const title = anchor.text().trim();
            if (!href || !title) return;
            if (!/\/watch\//i.test(href)) return;

            const absoluteUrl = href.startsWith('http') ? href : `${this.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
            const slugPart = absoluteUrl.split('/watch/')[1]?.split('?')[0]?.replace(/\/$/, '') || '';
            if (!slugPart) return;

            // Restrict to the site's explicit "other seasons" section by keeping only
            // close title variants of the current anime family.
            const candidateTitleFamily = normalizeFamilyTitle(title);
            const candidateTitleTokens = candidateTitleFamily.split(' ').filter(Boolean);
            const sharedPrefix =
                currentTitleTokens.length >= 2 &&
                candidateTitleTokens.length >= 2 &&
                currentTitleTokens[0] === candidateTitleTokens[0] &&
                currentTitleTokens[1] === candidateTitleTokens[1];
            const sharedTokenCount = candidateTitleTokens.filter((token) => currentTitleTokens.includes(token)).length;
            const titleFamilyMatch =
                currentTitleFamily.includes(candidateTitleFamily) ||
                candidateTitleFamily.includes(currentTitleFamily) ||
                sharedPrefix ||
                sharedTokenCount >= Math.min(3, Math.max(1, currentTitleTokens.length - 1));
            if (!titleFamilyMatch) return;

            relatedMap.set(slugPart, {
                id: slugPart,
                title,
                url: absoluteUrl,
            });
        });
        (animeInfo as any).related = [...relatedMap.values()];

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

        // Add AniList ID
        try {
            const anilistId = redis ? await cache.fetch(
                redis,
                `anilist:title:${animeInfo.title}`,
                async () => {
                    const anilist = new Anilist();
                    const searchRes = await anilist.search(String(animeInfo.title), 1, 1);
                    return searchRes.results[0]?.id || null;
                },
                REDIS_TTL
            ) : null;
            if (anilistId) (animeInfo as any).anilistId = anilistId;
        } catch (e) {
            console.error('Failed to get AniList ID for', animeInfo.title, (e as Error).message);
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

        // Try all servers IN PARALLEL - first one with a link wins (no waiting for slow servers)
        const tryServer = async (candidate: string): Promise<{ data: any; resolvedServerId: string }> => {
            const dataStr = await this.fetch(`${this.baseUrl}/ajax/episode/sources?id=${candidate}`, {
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': this.baseUrl,
            });
            const parsed = JSON.parse(dataStr);
            const link = String(parsed?.link || '').trim();
            if (!link) throw new Error(`Server ${candidate} returned no link`);
            return { data: parsed, resolvedServerId: candidate };
        };

        let data: any = null;
        let resolvedServerId: string | undefined;
        try {
            const winner = await Promise.any(candidateServerIds.map(tryServer));
            data = winner.data;
            resolvedServerId = winner.resolvedServerId;
        } catch {
            throw new Error("Couldn't find server. Try another server");
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

    const getSatoruSlug = (episodeId: string) => String(episodeId || '').split('$episode$')[0];
    const normalizeEpisodeIdForWatch = (id: string) => {
        const raw = String(id || '').trim();
        if (!raw) return raw;
        if (raw.includes('$episode$')) {
            return (raw.split('$episode$').pop() || raw).trim();
        }
        return raw;
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
    const sanitizeDirectNoDash = (payload: any): ISource | null => {
        if (!payload || typeof payload !== 'object') return null;
        const direct = (Array.isArray(payload?.sources) ? payload.sources : []).filter((src: any) => {
            const url = String(src?.url || '').trim().toLowerCase();
            if (!url) return false;
            if (Boolean(src?.isEmbed)) return false;
            if (url.includes('.mpd')) return false;
            return url.includes('.m3u8') || url.includes('.mp4') || Boolean(src?.isM3U8);
        });
        if (!direct.length) return null;
        return {
            ...payload,
            sources: direct,
        } as ISource;
    };
    const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) =>
                setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs),
            ),
        ]);
    };
    const firstSuccessful = async <T>(tasks: Array<Promise<T>>): Promise<T> => {
        return await new Promise<T>((resolve, reject) => {
            let pending = tasks.length;
            let lastError: unknown = new Error('All strategies failed');
            for (const task of tasks) {
                task
                    .then((value) => resolve(value))
                    .catch((err) => {
                        lastError = err;
                        pending -= 1;
                        if (pending <= 0) reject(lastError);
                    });
            }
        });
    };
    const slugToTitle = (slug: string) =>
        String(slug || '')
            .replace(/-\d+$/, '')
            .replace(/-/g, ' ')
            .trim();
    const normalizeTitle = (value: string) =>
        String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    const titleWords = (value: string) => normalizeTitle(value).split(' ').filter(Boolean);
    const uniqueStrings = (values: any[]) =>
        [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
    const detectSeasonNumber = (...values: any[]): number | null => {
        for (const rawValue of values) {
            const value = normalizeTitle(String(rawValue || ''));
            if (!value) continue;

            const patterns = [
                /\bseason\s+(\d{1,2})\b/i,
                /\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i,
                /\bpart\s+(\d{1,2})\b/i,
                /\bcour\s+(\d{1,2})\b/i,
            ];
            for (const pattern of patterns) {
                const match = value.match(pattern);
                if (match) return Number(match[1]);
            }

            if (/\bfinal season\b/i.test(value)) return 99;

            const romanSuffix = value.match(/\b(?:season|part|cour)\s+(i|ii|iii|iv|v|vi)\b/i);
            if (romanSuffix) {
                const roman = romanSuffix[1].toUpperCase();
                const romanMap: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };
                return romanMap[roman] ?? null;
            }

            const compactSeason = value.match(/\bs(\d{1,2})\b/i);
            if (compactSeason) return Number(compactSeason[1]);
        }
        return null;
    };
    const detectSeasonPart = (...values: any[]): number | null => {
        for (const rawValue of values) {
            const value = normalizeTitle(String(rawValue || ''));
            if (!value) continue;

            const numericMatch =
                value.match(/\bpart\s+(\d{1,2})\b/i) ||
                value.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+part\b/i);
            if (numericMatch) return Number(numericMatch[1]);

            const compactMatch = value.match(/\bs\d{1,2}\s*\(?part\s*(\d{1,2})\)?/i);
            if (compactMatch) return Number(compactMatch[1]);
        }
        return null;
    };
    const collectTitleVariants = (payload: any, fallback?: string): string[] => {
        const variants = uniqueStrings([
            payload?.title,
            payload?.name,
            payload?.japaneseTitle,
            ...(Array.isArray(payload?.synonyms) ? payload.synonyms : []),
            ...(Array.isArray(payload?.otherName) ? payload.otherName : []),
            ...(Array.isArray(payload?.otherNames) ? payload.otherNames : []),
            fallback,
        ]);
        return variants;
    };
    const countSharedWords = (left: string, right: string) => {
        const leftWords = titleWords(left);
        const rightSet = new Set(titleWords(right));
        return leftWords.filter((word) => rightSet.has(word)).length;
    };
    const scoreSatoruCandidate = (
        candidateInfo: any,
        candidateSearchRow: any,
        hiInfo: any,
        hiSlug: string,
        hiEpisodeCount: number,
    ) => {
        const searchTitle = String(candidateSearchRow?.title || candidateSearchRow?.name || candidateInfo?.title || '');
        const candidateVariants = collectTitleVariants(candidateInfo, searchTitle);
        const hiVariants = collectTitleVariants(hiInfo, slugToTitle(hiSlug));
        const hiSeason = detectSeasonNumber(hiSlug, ...hiVariants);
        const candidateSeason = detectSeasonNumber(candidateInfo?.id, ...candidateVariants);

        let score = 0;
        for (const hiTitle of hiVariants) {
            for (const candidateTitle of candidateVariants) {
                const normalizedHiTitle = normalizeTitle(hiTitle);
                const normalizedCandidateTitle = normalizeTitle(candidateTitle);
                if (!normalizedHiTitle || !normalizedCandidateTitle) continue;
                if (normalizedHiTitle === normalizedCandidateTitle) score += 120;
                else if (
                    normalizedHiTitle.includes(normalizedCandidateTitle) ||
                    normalizedCandidateTitle.includes(normalizedHiTitle)
                ) {
                    score += 70;
                }
                score += countSharedWords(hiTitle, candidateTitle) * 8;
            }
        }

        if (hiSeason !== null && candidateSeason !== null) {
            if (hiSeason === candidateSeason) score += 90;
            else score -= Math.min(120, Math.abs(hiSeason - candidateSeason) * 60);
        } else if (hiSeason === null && candidateSeason === 1) {
            score += 10;
        }

        const candidateEpisodeCount = Array.isArray(candidateInfo?.episodes) ? candidateInfo.episodes.length : 0;
        if (hiEpisodeCount > 0 && candidateEpisodeCount > 0) {
            const diff = Math.abs(candidateEpisodeCount - hiEpisodeCount);
            score += Math.max(0, 50 - diff * 2);
        }

        const normalizedHiSlug = normalizeTitle(hiSlug.replace(/-/g, ' '));
        const normalizedCandidateId = normalizeTitle(String(candidateInfo?.id || '').split(':')[0].replace(/-/g, ' '));
        if (normalizedHiSlug && normalizedCandidateId) {
            if (normalizedHiSlug === normalizedCandidateId) score += 140;
            else if (normalizedCandidateId.includes(normalizedHiSlug) || normalizedHiSlug.includes(normalizedCandidateId)) score += 50;
        }

        return score;
    };
    const scoreRelatedSeasonEntry = (entry: any, hiInfo: any, hiSlug: string, hiEpisodeCount: number) => {
        const hiVariants = collectTitleVariants(hiInfo, slugToTitle(hiSlug));
        const entryTitle = String(entry?.title || entry?.id || '');
        const hiSeason = detectSeasonNumber(hiSlug, ...hiVariants);
        const hiPart = detectSeasonPart(hiSlug, ...hiVariants);
        const entrySeason = detectSeasonNumber(entry?.id, entryTitle);
        const entryPart = detectSeasonPart(entry?.id, entryTitle);

        let score = 0;
        for (const hiTitle of hiVariants) {
            const normalizedHi = normalizeTitle(hiTitle);
            const normalizedEntry = normalizeTitle(entryTitle);
            if (!normalizedHi || !normalizedEntry) continue;
            if (normalizedHi === normalizedEntry) score += 120;
            else if (normalizedHi.includes(normalizedEntry) || normalizedEntry.includes(normalizedHi)) score += 70;
            score += countSharedWords(hiTitle, entryTitle) * 8;
        }

        if (hiSeason !== null && entrySeason !== null) {
            if (hiSeason === entrySeason) score += 220;
            else score -= Math.min(220, Math.abs(hiSeason - entrySeason) * 90);
        }
        if (hiPart !== null && entryPart !== null) {
            if (hiPart === entryPart) score += 140;
            else score -= Math.min(180, Math.abs(hiPart - entryPart) * 90);
        }

        if (hiEpisodeCount > 0 && Number.isFinite(Number(entry?.episodeCount || 0))) {
            const diff = Math.abs(Number(entry?.episodeCount || 0) - hiEpisodeCount);
            score += Math.max(0, 40 - diff * 2);
        }

        return score;
    };
    const normalizeLooseTitle = (value: string) =>
        String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    const normalizeSeasonLabel = (value: string) =>
        normalizeLooseTitle(String(value || '').replace(/\bseason\s*\d+\b/gi, ' '));
    const getSeasonAliases = (title: string, season: number): string[] => {
        const normalizedTitle = normalizeLooseTitle(title);
        if (normalizedTitle.includes('demon slayer') || normalizedTitle.includes('kimetsu no yaiba')) {
            if (season === 2) return ['entertainment district arc', 'mugen train arc'];
            if (season === 3) return ['swordsmith village arc'];
            if (season === 4) return ['hashira training arc'];
        }
        return [];
    };
    const getKnownSatoruIdsForTitleSeason = (title: string, season: number): string[] => {
        const normalizedTitle = normalizeLooseTitle(title);
        if (normalizedTitle.includes('demon slayer') || normalizedTitle.includes('kimetsu no yaiba')) {
            if (season === 1) return ['demon-slayer-kimetsu-no-yaiba'];
            if (season === 2) {
                return [
                    'demon-slayer-s2part-1-kimetsu-no-yaiba-entertainment-district-arc',
                    'demon-slayer-s2part-2-kimetsu-no-yaiba-mugen-train-arc',
                    'demon-slayer-s2part-2-kimetsu-no-yaiba-entertainment-district-arc',
                    'demon-slayer-s2part-1-kimetsu-no-yaiba-mugen-train-arc',
                ];
            }
            if (season === 3) {
                return [
                    'demon-slayer-s3-kimetsu-no-yaiba-swordsmith-village-arc',
                    'demon-slayer-s3-kimetsu-no-yaiba',
                ];
            }
            if (season === 4) {
                return [
                    'demon-slayer-s4-kimetsu-no-yaiba-hashira-training-arc',
                    'demon-slayer-s4-kimetsu-no-yaiba',
                ];
            }
        }
        return [];
    };
    const getSeasonSubEntryOrder = (title: string, season: number, info: any): number => {
        const haystack = normalizeLooseTitle(
            [
                info?.title,
                info?.japaneseTitle,
                ...(Array.isArray(info?.synonyms) ? info.synonyms : []),
            ].join(' '),
        );
        const normalizedTitle = normalizeLooseTitle(title);
        if (normalizedTitle.includes('demon slayer') || normalizedTitle.includes('kimetsu no yaiba')) {
            if (season === 2) {
                if (haystack.includes('mugen train')) return 0;
                if (haystack.includes('entertainment district')) return 1;
            }
        }
        const part = detectSeasonPart(info?.id, info?.title, info?.japaneseTitle);
        if (part !== null) return part - 1;
        return 999;
    };
    const scoreResolvedSatoruEntry = (
        info: any,
        {
            title,
            season,
            seasonLabel,
            preferredYear,
        }: { title: string; season: number; seasonLabel: string; preferredYear?: number },
    ) => {
        const variants = collectTitleVariants(info, title);
        const targetTitle = normalizeLooseTitle(title);
        const targetSeasonLabel = normalizeSeasonLabel(seasonLabel);
        const aliases = getSeasonAliases(title, season);
        const candidateTitle = normalizeLooseTitle(String(info?.title || info?.name || ''));
        const candidateSeason = detectSeasonNumber(info?.id, ...variants);
        const candidatePart = detectSeasonPart(info?.id, ...variants);
        const targetPart = detectSeasonPart(seasonLabel, title);
        let score = 0;

        if (candidateTitle === targetTitle) score += 240;
        else if (candidateTitle.includes(targetTitle) || targetTitle.includes(candidateTitle)) score += 140;
        score += countSharedWords(candidateTitle, targetTitle) * 18;

        if (season > 1) {
            if (candidateSeason === season) score += 320;
            else if (candidateSeason !== null) score -= Math.abs(candidateSeason - season) * 180;
            else score -= 80;
        } else if (candidateSeason === 1 || candidateSeason === null) {
            score += 40;
        }

        if (targetPart !== null && candidatePart !== null) {
            if (candidatePart === targetPart) score += 220;
            else score -= Math.abs(candidatePart - targetPart) * 180;
        }

        if (targetSeasonLabel) {
            const candidateJoined = normalizeSeasonLabel(
                [
                    info?.title,
                    info?.japaneseTitle,
                    ...(Array.isArray(info?.synonyms) ? info.synonyms : []),
                ].join(' '),
            );
            if (candidateJoined.includes(targetSeasonLabel)) score += 260;
            score += countSharedWords(candidateJoined, targetSeasonLabel) * 28;
        }
        for (const alias of aliases) {
            if (candidateTitle.includes(alias) || variants.some((variant) => normalizeLooseTitle(variant).includes(alias))) {
                score += 260;
            }
        }

        const yearValue = Number(String(info?.season || '').match(/\b(19|20)\d{2}\b/)?.[0] || 0);
        if (preferredYear && yearValue) {
            if (preferredYear === yearValue) score += 40;
            else if (Math.abs(preferredYear - yearValue) === 1) score += 15;
        }

        return score;
    };
    const candidateMatchesRequestedSeason = (
        info: any,
        {
            title,
            season,
            seasonLabel,
        }: { title: string; season: number; seasonLabel: string },
    ) => {
        if (season <= 1) return true;
        const variants = collectTitleVariants(info, info?.title);
        const candidateSeason = detectSeasonNumber(info?.id, ...variants);
        const aliases = getSeasonAliases(title, season);
        const candidateHaystack = normalizeLooseTitle(
            [info?.id, ...variants, info?.japaneseTitle].filter(Boolean).join(' '),
        );
        const normalizedSeasonLabel = normalizeSeasonLabel(seasonLabel);

        if (candidateSeason === season) return true;
        if (normalizedSeasonLabel && candidateHaystack.includes(normalizedSeasonLabel)) return true;
        if (aliases.some((alias) => candidateHaystack.includes(alias))) return true;
        return false;
    };
    const resolveSatoruByMetadata = async ({
        title,
        season,
        episode,
        seasonLabel,
        preferredYear,
    }: {
        title: string;
        season: number;
        episode: number;
        seasonLabel?: string;
        preferredYear?: number;
    }) => {
        const searchTerms = uniqueStrings([
            `${title} ${seasonLabel || ''}`.trim(),
            season > 1 ? `${title} season ${season}` : '',
            season > 1 ? `${title} s${season}` : '',
            title,
        ]).slice(0, 6);

        const knownCandidateIds = getKnownSatoruIdsForTitleSeason(title, season);
        const candidateIds = new Set<string>(knownCandidateIds);
        const knownSettled = await Promise.allSettled(
            knownCandidateIds.map(async (candidateId) => await satoru.fetchAnimeInfo(candidateId)),
        );
        const knownInfos = knownSettled
            .filter((entry): entry is PromiseFulfilledResult<any> => entry.status === 'fulfilled')
            .map((entry) => entry.value)
            .filter((info) => Array.isArray(info?.episodes) && info.episodes.length);

        if (knownInfos.length) {
            const strictKnown = knownInfos.filter((info) =>
                candidateMatchesRequestedSeason(info, { title, season, seasonLabel: seasonLabel || '' }),
            );
            const knownPool = strictKnown.length ? strictKnown : knownInfos;
            const knownOrderMap = new Map<string, number>(
                knownCandidateIds.map((id, index) => [String(id), index]),
            );
            const orderedKnown = knownPool
                .map((info) => ({
                    info,
                    index: knownOrderMap.get(String(info?.id || '').split(':')[0]) ?? 999,
                    len: Array.isArray(info?.episodes) ? info.episodes.length : 0,
                }))
                .sort((left, right) => left.index - right.index);

            let remainingKnownEpisode = episode;
            for (const candidate of orderedKnown) {
                if (candidate.len <= 0) continue;
                if (remainingKnownEpisode <= candidate.len) {
                    const knownEpisodes = Array.isArray(candidate.info?.episodes) ? candidate.info.episodes : [];
                    const exactKnownEpisode =
                        knownEpisodes.find((ep: any) => toEpisodeNum(ep) === remainingKnownEpisode) ||
                        knownEpisodes[Math.max(0, Math.min(knownEpisodes.length - 1, remainingKnownEpisode - 1))];
                    if (exactKnownEpisode?.id) {
                        return {
                            anime: {
                                id: candidate.info.id,
                                title: candidate.info.title,
                            },
                            episode: {
                                id: String(exactKnownEpisode.id),
                                number: toEpisodeNum(exactKnownEpisode),
                                title: String(exactKnownEpisode?.title || ''),
                            },
                        };
                    }
                }
                remainingKnownEpisode -= candidate.len;
            }
        }

        const searchSettled = await Promise.allSettled(searchTerms.map((term) => satoru.search(term, 1)));
        for (const settled of searchSettled) {
            if (settled.status !== 'fulfilled') continue;
            const rows = Array.isArray(settled.value?.results) ? settled.value.results : [];
            for (const row of rows.slice(0, 10)) {
                if (row?.id) candidateIds.add(String(row.id));
            }
        }
        if (!candidateIds.size) throw new Error('No Satoru candidates found');

        const fetched = await Promise.allSettled(
            [...candidateIds].map(async (candidateId) => await satoru.fetchAnimeInfo(candidateId)),
        );
        const baseInfos = fetched
            .filter((entry): entry is PromiseFulfilledResult<any> => entry.status === 'fulfilled')
            .map((entry) => entry.value)
            .filter((info) => Array.isArray(info?.episodes) && info.episodes.length);
        if (!baseInfos.length) throw new Error('No Satoru info candidates found');

        const allInfos = new Map<string, any>();
        for (const info of baseInfos) {
            if (info?.id) allInfos.set(String(info.id), info);
            const relatedRows = Array.isArray(info?.related) ? info.related : [];
            const relatedSettled = await Promise.allSettled(
                relatedRows.slice(0, 8).map(async (row: any) => await satoru.fetchAnimeInfo(String(row.id))),
            );
            for (const related of relatedSettled) {
                if (related.status !== 'fulfilled') continue;
                const relatedInfo = related.value;
                if (relatedInfo?.id && Array.isArray(relatedInfo?.episodes) && relatedInfo.episodes.length) {
                    allInfos.set(String(relatedInfo.id), relatedInfo);
                }
            }
        }

        const strictCandidates = [...allInfos.values()].filter((info) =>
            candidateMatchesRequestedSeason(info, {
                title,
                season,
                seasonLabel: seasonLabel || '',
            }),
        );
        const candidatesToRank = strictCandidates.length ? strictCandidates : [...allInfos.values()];

        const ranked = candidatesToRank
            .map((info) => ({
                info,
                score: scoreResolvedSatoruEntry(info, { title, season, seasonLabel: seasonLabel || '', preferredYear }),
            }))
            .sort((left, right) => right.score - left.score);
        let picked = ranked[0]?.info;
        if (!picked) throw new Error('Failed to resolve exact Satoru season');

        const sameSeasonCandidates = ranked
            .map((row) => row.info)
            .filter((info) => detectSeasonNumber(info?.id, info?.title, info?.japaneseTitle) === season);
        const normalizedRequestedSeasonLabel = normalizeSeasonLabel(seasonLabel || '');
        if (normalizedRequestedSeasonLabel && sameSeasonCandidates.length > 1) {
            const explicitArcMatch = sameSeasonCandidates.find((info) => {
                const haystack = normalizeSeasonLabel(
                    [info?.id, info?.title, info?.japaneseTitle, ...(Array.isArray(info?.synonyms) ? info.synonyms : [])]
                        .filter(Boolean)
                        .join(' '),
                );
                if (normalizedRequestedSeasonLabel.includes('mugen train')) {
                    return haystack.includes('mugen train');
                }
                if (normalizedRequestedSeasonLabel.includes('entertainment district')) {
                    return haystack.includes('entertainment district');
                }
                if (normalizedRequestedSeasonLabel.includes('swordsmith village')) {
                    return haystack.includes('swordsmith village');
                }
                if (normalizedRequestedSeasonLabel.includes('hashira training')) {
                    return haystack.includes('hashira training');
                }
                return false;
            });
            if (explicitArcMatch) {
                picked = explicitArcMatch;
            }

            const explicitLabelMatch = sameSeasonCandidates
                .map((info) => ({
                    info,
                    score: scoreResolvedSatoruEntry(info, {
                        title,
                        season,
                        seasonLabel: seasonLabel || '',
                        preferredYear,
                    }),
                }))
                .sort((left, right) => right.score - left.score)[0]?.info;
            if (explicitLabelMatch) {
                picked = explicitLabelMatch;
            }
        }
        if (sameSeasonCandidates.length > 1) {
            const orderedParts = sameSeasonCandidates
                .map((info) => ({
                    info,
                    order: getSeasonSubEntryOrder(title, season, info),
                    len: Array.isArray(info?.episodes) ? info.episodes.length : 0,
                }))
                .sort((left, right) => left.order - right.order || left.len - right.len);

            const pickedLabelHaystack = normalizeSeasonLabel(
                [picked?.id, picked?.title, picked?.japaneseTitle].filter(Boolean).join(' '),
            );
            const hasExplicitPickedLabel =
                normalizedRequestedSeasonLabel &&
                pickedLabelHaystack.includes(normalizedRequestedSeasonLabel);

            if (!hasExplicitPickedLabel) {
                let remainingEpisode = episode;
                for (const part of orderedParts) {
                    if (part.len <= 0) continue;
                    if (remainingEpisode <= part.len) {
                        picked = part.info;
                        episode = remainingEpisode;
                        break;
                    }
                    remainingEpisode -= part.len;
                }
            }
        }

        const episodes = Array.isArray(picked?.episodes) ? picked.episodes : [];
        const targetEpisode =
            episodes.find((ep: any) => toEpisodeNum(ep) === episode) ||
            episodes[Math.max(0, Math.min(episodes.length - 1, episode - 1))];
        if (!targetEpisode?.id) throw new Error('Failed to resolve Satoru episode');

        return {
            anime: {
                id: picked.id,
                title: picked.title,
            },
            episode: {
                id: String(targetEpisode.id),
                number: toEpisodeNum(targetEpisode),
                title: String(targetEpisode?.title || ''),
            },
        };
    };
    const resolveSatoruSeriesByTitle = async ({
        title,
        preferredYear,
    }: {
        title: string;
        preferredYear?: number;
    }) => {
        const knownIds = getKnownSatoruIdsForTitleSeason(title, 1);
        const searchTerms = uniqueStrings([title, ...getSeasonAliases(title, 2), ...getSeasonAliases(title, 3), ...getSeasonAliases(title, 4)]);
        const candidateIds = new Set<string>(knownIds);

        const searchSettled = await Promise.allSettled(searchTerms.slice(0, 6).map((term) => satoru.search(term, 1)));
        for (const settled of searchSettled) {
            if (settled.status !== 'fulfilled') continue;
            const rows = Array.isArray(settled.value?.results) ? settled.value.results : [];
            for (const row of rows.slice(0, 10)) {
                if (row?.id) candidateIds.add(String(row.id));
            }
        }

        if (!candidateIds.size) throw new Error('No Satoru series candidates found');

        const fetched = await Promise.allSettled(
            [...candidateIds].map(async (candidateId) => await satoru.fetchAnimeInfo(candidateId)),
        );
        const baseInfos = fetched
            .filter((entry): entry is PromiseFulfilledResult<any> => entry.status === 'fulfilled')
            .map((entry) => entry.value)
            .filter((info) => Array.isArray(info?.episodes) && info.episodes.length);
        if (!baseInfos.length) throw new Error('No Satoru series infos found');

        const titleNorm = normalizeLooseTitle(title);
        const familyRoot = (value: string) => normalizeLooseTitle(value).split(' ').slice(0, 4).join(' ');
        const selectedBase = baseInfos
            .map((info) => ({
                info,
                score: scoreResolvedSatoruEntry(info, {
                    title,
                    season: 1,
                    seasonLabel: '',
                    preferredYear,
                }),
            }))
            .sort((left, right) => right.score - left.score)[0]?.info;
        if (!selectedBase) throw new Error('Failed to choose Satoru series base');

        const allInfos = new Map<string, any>();
        allInfos.set(String(selectedBase.id), selectedBase);
        const relatedRows = Array.isArray(selectedBase?.related) ? selectedBase.related : [];
        const relatedSettled = await Promise.allSettled(
            relatedRows.map(async (row: any) => await satoru.fetchAnimeInfo(String(row.id))),
        );
        for (const related of relatedSettled) {
            if (related.status !== 'fulfilled') continue;
            const info = related.value;
            if (!Array.isArray(info?.episodes) || !info.episodes.length) continue;
            allInfos.set(String(info.id), info);
        }

        const ordered = [...allInfos.values()]
            .filter((info) => {
                const joined = normalizeLooseTitle([info?.title, info?.japaneseTitle, ...(Array.isArray(info?.synonyms) ? info.synonyms : [])].join(' '));
                return joined.includes(titleNorm.split(' ').slice(0, 2).join(' ')) || familyRoot(joined) === familyRoot(titleNorm);
            })
            .map((info) => ({
                id: String(info.id),
                title: String(info.title || ''),
                season: detectSeasonNumber(info?.id, info?.title, info?.japaneseTitle) || 1,
                part: detectSeasonPart(info?.id, info?.title, info?.japaneseTitle) || 0,
                episodeCount: Array.isArray(info?.episodes) ? info.episodes.length : 0,
                episodes: (Array.isArray(info?.episodes) ? info.episodes : []).map((ep: any, idx: number) => ({
                    id: String(ep?.id || ''),
                    number: idx + 1,
                    title: String(ep?.title || `Episode ${idx + 1}`),
                })),
            }))
            .sort((left, right) => left.season - right.season || left.part - right.part);

        return {
            title: selectedBase.title,
            entries: ordered,
        };
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
            reply
                .status(500)
                .send({ message: (err as Error).message });
        }
    });

    fastify.get('/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as {
            title?: string;
            season?: number | string;
            episode?: number | string;
            seasonTitle?: string;
            year?: number | string;
        };
        const title = String(query?.title || '').trim();
        const season = Number(query?.season || 1);
        const episode = Number(query?.episode || 1);
        const seasonTitle = String(query?.seasonTitle || '').trim();
        const year = Number(query?.year || 0);

        if (!title) return reply.status(400).send({ message: 'title is required' });
        if (!Number.isFinite(season) || season <= 0) return reply.status(400).send({ message: 'season is invalid' });
        if (!Number.isFinite(episode) || episode <= 0) return reply.status(400).send({ message: 'episode is invalid' });

        try {
            const cacheKey = `satoru:resolve:${title}:${season}:${episode}:${seasonTitle}:${year}`;
            const resolved = redis
                ? await cache.fetch(
                    redis as Redis,
                    cacheKey,
                    async () =>
                        await resolveSatoruByMetadata({
                            title,
                            season,
                            episode,
                            seasonLabel: seasonTitle,
                            preferredYear: Number.isFinite(year) && year > 1900 ? year : undefined,
                        }),
                    REDIS_TTL,
                )
                : await resolveSatoruByMetadata({
                    title,
                    season,
                    episode,
                    seasonLabel: seasonTitle,
                    preferredYear: Number.isFinite(year) && year > 1900 ? year : undefined,
                });
            return reply.status(200).send(resolved);
        } catch (err) {
            return reply.status(500).send({ message: (err as Error).message });
        }
    });
    fastify.get('/series', async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as { title?: string; year?: number | string };
        const title = String(query?.title || '').trim();
        const year = Number(query?.year || 0);
        if (!title) return reply.status(400).send({ message: 'title is required' });
        try {
            const cacheKey = `satoru:series:${title}:${year}`;
            const payload = redis
                ? await cache.fetch(
                    redis as Redis,
                    cacheKey,
                    async () =>
                        await resolveSatoruSeriesByTitle({
                            title,
                            preferredYear: Number.isFinite(year) && year > 1900 ? year : undefined,
                        }),
                    REDIS_TTL,
                )
                : await resolveSatoruSeriesByTitle({
                    title,
                    preferredYear: Number.isFinite(year) && year > 1900 ? year : undefined,
                });
            return reply.status(200).send(payload);
        } catch (err) {
            return reply.status(500).send({ message: (err as Error).message });
        }
    });

    fastify.get(
        '/watch/:episodeId',
        async (request: FastifyRequest, reply: FastifyReply) => {
            const episodeId = (request.params as { episodeId: string }).episodeId;
            const serverId = (request.query as { serverId?: string }).serverId;
            const normalizedEpisodeId = normalizeEpisodeIdForWatch(episodeId);

            try {
                let res = redis
                    ? await cache.fetch(
                        redis as Redis,
                        `satoru:watch:${normalizedEpisodeId}:${serverId}`,
                        async () => await satoru.fetchEpisodeSources(normalizedEpisodeId, serverId),
                        REDIS_TTL,
                    )
                    : await satoru.fetchEpisodeSources(normalizedEpisodeId, serverId);

                if (IS_PRODUCTION) {
                    const direct = sanitizeDirectNoDash(res);
                    if (direct) return reply.status(200).send(direct);
                    throw new Error('Satoru returned no direct playable source');
                }

                reply.status(200).send(res);
            } catch (err) {
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
