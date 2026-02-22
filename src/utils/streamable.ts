import { StreamingServers } from '@consumet/extensions/dist/models';

const STREAMABLE_URL_REGEX =
  /(\.m3u8|\.mpd|\.mp4)(\?|$)|manifest|playlist|googlevideo|akamaized|cloudfront|cdn|vidstreaming|megacloud/i;

const normalizeUrl = (url?: string): string | undefined => {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return trimmed;
};

const normalizeDownload = (download: unknown): unknown => {
  if (typeof download === 'string') return normalizeUrl(download) ?? download;

  if (Array.isArray(download)) {
    for (const item of download) {
      if (item && typeof item === 'object' && 'url' in item) {
        const url = normalizeUrl((item as { url?: string }).url);
        if (url) (item as { url?: string }).url = url;
      }
    }
  }

  return download;
};

export const normalizeStreamLinks = <T>(payload: T): T => {
  if (!payload || typeof payload !== 'object') return payload;

  if (Array.isArray(payload)) {
    for (const item of payload) normalizeStreamLinks(item);
    return payload;
  }

  const record = payload as Record<string, unknown>;

  if (Array.isArray(record.sources)) {
    for (const source of record.sources) {
      if (!source || typeof source !== 'object') continue;
      const src = source as { url?: string };
      const url = normalizeUrl(src.url);
      if (url) src.url = url;
    }
  }

  if (Array.isArray(record.subtitles)) {
    for (const subtitle of record.subtitles) {
      if (!subtitle || typeof subtitle !== 'object') continue;
      const sub = subtitle as { url?: string };
      const url = normalizeUrl(sub.url);
      if (url) sub.url = url;
    }
  }

  if ('download' in record) {
    record.download = normalizeDownload(record.download);
  }

  if ('embedURL' in record && typeof record.embedURL === 'string') {
    record.embedURL = normalizeUrl(record.embedURL) ?? record.embedURL;
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') normalizeStreamLinks(value);
  }

  return payload;
};

const hasUsableStreamSources = (payload: unknown): boolean => {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.sources)) return false;

  return record.sources.some((source) => {
    if (!source || typeof source !== 'object') return false;
    const video = source as { url?: string; isM3U8?: boolean; isDASH?: boolean };
    const url = normalizeUrl(video.url);
    if (!url) return false;
    return Boolean(video.isM3U8 || video.isDASH || STREAMABLE_URL_REGEX.test(url));
  });
};

const DEFAULT_SERVER_FALLBACKS: StreamingServers[] = [
  StreamingServers.VidStreaming,
  StreamingServers.VidCloud,
  StreamingServers.UpCloud,
  StreamingServers.MegaCloud,
];

const IS_PRODUCTION =
  process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const DEFAULT_ATTEMPT_TIMEOUT_MS = IS_PRODUCTION ? 9000 : 15000;

export const MOVIE_SERVER_FALLBACKS: StreamingServers[] = [
  StreamingServers.VidStreaming,
  StreamingServers.VidCloud,
  StreamingServers.UpCloud,
  StreamingServers.MegaCloud,
];

export type ServerFallbackOptions = {
  attemptTimeoutMs?: number;
  requireDirectPlayable?: boolean;
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Provider attempt timed out after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
};

const scoreSourceUrl = (source: unknown): number => {
  if (!source || typeof source !== 'object') return -1000;
  const entry = source as { url?: string; isEmbed?: boolean; isM3U8?: boolean; isDASH?: boolean };
  const url = String(normalizeUrl(entry.url) || '').toLowerCase();
  if (!url) return -1000;

  let score = 0;
  const isEmbed = Boolean(entry.isEmbed);
  const isM3U8 = Boolean(entry.isM3U8) || url.includes('.m3u8');
  const isDASH = Boolean(entry.isDASH) || url.includes('.mpd');
  const isMp4 = url.includes('.mp4');

  if (isEmbed) score -= 100;
  if (url.includes('kaa.lt/intro.mp4') || url.endsWith('/intro.mp4')) score -= 250;
  if (url.includes('/trailer') || url.includes('/preview')) score -= 180;
  if (isMp4) score += 90;
  if (isM3U8) score += 70;
  if (isDASH) score += 60;

  if (url.includes('googlevideo') || url.includes('akamaized') || url.includes('cloudfront')) score += 20;
  if (url.includes('megacloud') || url.includes('/embed')) score -= 25;

  return score;
};

export const hasDirectPlayableSource = (payload: unknown): boolean => {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.sources)) return false;
  return record.sources.some((source) => scoreSourceUrl(source) >= 60);
};

const sortSourcesByPlayability = <T>(payload: T): T => {
  if (!payload || typeof payload !== 'object') return payload;
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.sources)) return payload;
  record.sources.sort((a, b) => scoreSourceUrl(b) - scoreSourceUrl(a));
  return payload;
};

export const fetchWithServerFallback = async <T>(
  fetcher: (server?: StreamingServers) => Promise<T>,
  preferredServer?: StreamingServers,
  fallbackServers: StreamingServers[] = DEFAULT_SERVER_FALLBACKS,
  options: ServerFallbackOptions = {},
): Promise<T> => {
  const attemptTimeoutMs = Number(options.attemptTimeoutMs || DEFAULT_ATTEMPT_TIMEOUT_MS);
  const requireDirectPlayable = Boolean(options.requireDirectPlayable);
  const candidates: (StreamingServers | undefined)[] = [
    preferredServer,
    ...fallbackServers,
  ].filter((server, index, list) => list.indexOf(server) === index);

  let lastError: unknown = undefined;
  let firstResponse: T | undefined = undefined;
  let firstWithSources: T | undefined = undefined;
  let bestDirectResponse: T | undefined = undefined;

  for (const server of candidates) {
    try {
      const response = sortSourcesByPlayability(
        normalizeStreamLinks(await withTimeout(fetcher(server), attemptTimeoutMs)),
      );
      if (typeof firstResponse === 'undefined') firstResponse = response;
      if (hasUsableStreamSources(response) && typeof firstWithSources === 'undefined') {
        firstWithSources = response;
      }
      if (hasDirectPlayableSource(response)) {
        bestDirectResponse = response;
        break;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (typeof bestDirectResponse !== 'undefined') return bestDirectResponse;
  if (requireDirectPlayable) {
    throw lastError ?? new Error('No direct playable stream found (embed-only sources were skipped).');
  }
  if (typeof firstWithSources !== 'undefined') return firstWithSources;
  if (typeof firstResponse !== 'undefined') return firstResponse;
  throw lastError ?? new Error('Failed to fetch stream sources.');
};
