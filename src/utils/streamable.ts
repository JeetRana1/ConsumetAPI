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
  StreamingServers.MegaCloud,
  StreamingServers.VidCloud,
  StreamingServers.UpCloud,
  StreamingServers.VidStreaming,
];

export const MOVIE_SERVER_FALLBACKS: StreamingServers[] = [
  StreamingServers.VidCloud,
  StreamingServers.UpCloud,
  StreamingServers.MegaCloud,
];

export const fetchWithServerFallback = async <T>(
  fetcher: (server?: StreamingServers) => Promise<T>,
  preferredServer?: StreamingServers,
  fallbackServers: StreamingServers[] = DEFAULT_SERVER_FALLBACKS,
): Promise<T> => {
  const candidates: (StreamingServers | undefined)[] = [
    preferredServer,
    ...fallbackServers,
  ].filter((server, index, list) => list.indexOf(server) === index);

  let lastError: unknown = undefined;
  let firstResponse: T | undefined = undefined;

  for (const server of candidates) {
    try {
      const response = normalizeStreamLinks(await fetcher(server));
      if (typeof firstResponse === 'undefined') firstResponse = response;
      if (hasUsableStreamSources(response)) return response;
    } catch (err) {
      lastError = err;
    }
  }

  if (typeof firstResponse !== 'undefined') return firstResponse;
  throw lastError ?? new Error('Failed to fetch stream sources.');
};
