import { StreamingServers } from '@consumet/extensions/dist/models';
import { MegaCloud, RapidCloud, VidCloud, VideoStr } from '@consumet/extensions/dist/extractors';
import axios from 'axios';

type SourceEntry = {
  url?: string;
  quality?: string;
  isM3U8?: boolean;
  isEmbed?: boolean;
};

type SourcePayload = {
  headers?: Record<string, string>;
  sources?: SourceEntry[];
  subtitles?: any[];
  embedURL?: string;
  [key: string]: any;
};

type ProviderLike = {
  proxyConfig?: unknown;
  adapter?: unknown;
  client?: {
    get?: (url: string, options?: unknown) => Promise<{ data?: any }>;
  };
};

const isDirectMediaUrl = (value: string): boolean => /\.(m3u8|mp4|mpd)(\?|$)/i.test(value);

const isEmbedLikeUrl = (value: string): boolean => {
  const lower = String(value || '').toLowerCase();
  if (!lower.startsWith('http')) return false;
  if (isDirectMediaUrl(lower)) return false;
  return (
    lower.includes('/embed') ||
    lower.includes('/v3/e-') ||
    lower.includes('stream') ||
    lower.includes('player')
  );
};

const hasDirectSources = (payload: SourcePayload | undefined): boolean => {
  if (!payload || !Array.isArray(payload.sources)) return false;
  return payload.sources.some((src) => {
    const url = String(src?.url || '');
    return !!url && isDirectMediaUrl(url);
  });
};

const getServerOrder = (preferred?: StreamingServers): StreamingServers[] => {
  const list = [
    preferred,
    StreamingServers.VidCloud,
    StreamingServers.MegaCloud,
    StreamingServers.UpCloud,
    StreamingServers.VidStreaming,
  ].filter(Boolean) as StreamingServers[];
  return list.filter((item, idx) => list.indexOf(item) === idx);
};

const hasUsableSources = (payload: unknown): boolean => {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as SourcePayload;
  if (!Array.isArray(record.sources)) return false;
  return record.sources.some((src) => typeof src?.url === 'string' && src.url.length > 0);
};

const tryExtractor = async (
  provider: ProviderLike,
  embedUrl: string,
  requestedServer?: StreamingServers,
): Promise<SourcePayload | undefined> => {
  const serverOrder = getServerOrder(requestedServer);
  const url = new URL(embedUrl);

  for (const server of serverOrder) {
    const isVideoStr = String(url.hostname || '').toLowerCase().includes('videostr.');
    const extractors =
      isVideoStr
        ? [VideoStr, MegaCloud, VidCloud, RapidCloud]
        : server === StreamingServers.MegaCloud
          ? [MegaCloud, VidCloud, RapidCloud, VideoStr]
          : [VidCloud, RapidCloud, MegaCloud, VideoStr];

    for (const Extractor of extractors) {
      try {
        const extracted = await new Extractor(
          provider.proxyConfig as any,
          provider.adapter as any,
        ).extract(url);

        if (hasUsableSources(extracted)) {
          return {
            headers: { Referer: embedUrl },
            ...(extracted as object),
          } as SourcePayload;
        }
      } catch {
        continue;
      }
    }
  }

  return undefined;
};

const extractDirectUrlsFromHtml = (html: string): string[] => {
  const candidates = new Set<string>();
  const patterns = [
    /["']file["']\s*:\s*["']([^"']+\.(?:m3u8|mp4|mpd)[^"']*)["']/gi,
    /["']src["']\s*:\s*["']([^"']+\.(?:m3u8|mp4|mpd)[^"']*)["']/gi,
    /(https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|mpd)[^\s"'<>]*)/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const url = String(match[1] || match[0] || '').trim();
      if (/^https?:\/\//i.test(url)) candidates.add(url);
    }
  }

  return [...candidates];
};

const extractFirstIframe = (html: string): string | undefined => {
  const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  const src = String(iframeMatch?.[1] || '').trim();
  return /^https?:\/\//i.test(src) ? src : undefined;
};

const fetchHtml = async (
  provider: ProviderLike,
  url: string,
  referer: string,
): Promise<string | undefined> => {
  try {
    if (provider.client?.get) {
      const res = await provider.client.get(url, { headers: { Referer: referer } } as any);
      const html = String((res as any)?.data || '');
      if (html) return html;
    }
  } catch {
    // continue to axios fallback
  }

  try {
    const res = await axios.get(url, { headers: { Referer: referer } });
    const html = String(res?.data || '');
    if (html) return html;
  } catch {
    // ignore
  }

  return undefined;
};

const tryHtmlScrapeDirect = async (
  provider: ProviderLike,
  embedUrl: string,
  upstreamReferer?: string,
): Promise<SourcePayload | undefined> => {
  const visited = new Set<string>();
  let current = embedUrl;
  const referer = String(upstreamReferer || '').trim() || embedUrl;

  for (let depth = 0; depth < 2; depth += 1) {
    if (visited.has(current)) break;
    visited.add(current);

    const html = await fetchHtml(provider, current, referer);
    if (!html) break;

    const directUrls = extractDirectUrlsFromHtml(html);
    const direct = directUrls.find((u) => isDirectMediaUrl(u));
    if (direct) {
      return {
        headers: { Referer: current },
        sources: [
          {
            url: direct,
            quality: 'auto',
            isM3U8: direct.includes('.m3u8'),
            isEmbed: false,
          },
        ],
        embedURL: embedUrl,
      };
    }

    const nextIframe = extractFirstIframe(html);
    if (!nextIframe) break;
    current = nextIframe;
  }

  return undefined;
};

export const promoteEmbedSourcesToDirect = async (
  provider: ProviderLike,
  payload: SourcePayload,
  preferredServer?: StreamingServers,
): Promise<SourcePayload> => {
  if (!payload || typeof payload !== 'object') return payload;
  if (hasDirectSources(payload)) return payload;

  const candidates = new Set<string>();
  if (Array.isArray(payload.sources)) {
    for (const source of payload.sources) {
      const url = String(source?.url || '').trim();
      if (url && isEmbedLikeUrl(url)) candidates.add(url);
    }
  }

  const embedURL = String(payload.embedURL || '').trim();
  if (embedURL && isEmbedLikeUrl(embedURL)) candidates.add(embedURL);
  const upstreamReferer = String(payload.headers?.Referer || payload.headers?.referer || '').trim();

  for (const candidate of candidates) {
    const extracted =
      (await tryExtractor(provider, candidate, preferredServer)) ||
      (await tryHtmlScrapeDirect(provider, candidate, upstreamReferer));

    if (extracted && hasDirectSources(extracted)) {
      return {
        ...payload,
        ...extracted,
        subtitles: Array.isArray(payload.subtitles) ? payload.subtitles : extracted.subtitles,
        embedURL: payload.embedURL || candidate,
      };
    }
  }

  return payload;
};
