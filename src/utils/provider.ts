import { StreamingServers } from '@consumet/extensions/dist/models';
import { MegaCloud, RapidCloud, VidCloud, VideoStr } from '@consumet/extensions/dist/extractors';
import { getProxyCandidatesSync } from './outboundProxy';

type ProviderWithClient = {
  name?: string;
  client?: {
    get?: (url: string, options?: unknown) => Promise<{ data?: any }>;
    defaults?: {
      timeout?: number;
      headers?: {
        common?: Record<string, string>;
      };
    };
  };
  proxyConfig?: unknown;
  adapter?: unknown;
  baseUrl?: string;
  fetchEpisodeSources?: (...args: any[]) => Promise<any>;
  fetchEpisodeServers?: (...args: any[]) => Promise<any[]>;
  __sourceRescueWrapped?: boolean;
  __flixhqServersWrapped?: boolean;
};

const parseProxyEnv = (): string | string[] | undefined => {
  const list = getProxyCandidatesSync();
  if (!list.length) return undefined;
  return list.length === 1 ? list[0] : list;
};

const applyBrowserHeaders = (provider: ProviderWithClient) => {
  const headers = provider.client?.defaults?.headers?.common;
  if (!headers) return;

  headers['User-Agent'] =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  headers['Accept'] =
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8';
  headers['Accept-Language'] = 'en-US,en;q=0.9';
  headers['Accept-Encoding'] = 'gzip, deflate, br';
  headers['Connection'] = 'keep-alive';
  headers['Upgrade-Insecure-Requests'] = '1';
  headers['Sec-Fetch-Dest'] = 'document';
  headers['Sec-Fetch-Mode'] = 'navigate';
  headers['Sec-Fetch-Site'] = 'none';
};

const applyProxyConfig = (provider: ProviderWithClient) => {
  const proxy = parseProxyEnv();
  if (!proxy) return;
  provider.proxyConfig = { url: proxy };
};

const applyTimeoutConfig = (provider: ProviderWithClient) => {
  const defaults = provider.client?.defaults;
  if (!defaults) return;

  const isProduction = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
  const envTimeout = Number(process.env.PROVIDER_FETCH_TIMEOUT_MS || '');
  const timeoutMs = Number.isFinite(envTimeout) && envTimeout > 0
    ? envTimeout
    : (isProduction ? 12000 : 10000);

  defaults.timeout = timeoutMs;
};

const isFlixhqProvider = (provider: ProviderWithClient): boolean =>
  String(provider.name || '').toLowerCase() === 'flixhq';

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '');

const applyFlixhqBaseUrl = (provider: ProviderWithClient) => {
  if (!isFlixhqProvider(provider)) return;
  const desiredBase = normalizeBaseUrl(
    String(process.env.FLIXHQ_BASE_URL || 'https://flixhq-tv.lol').trim(),
  );
  if (!desiredBase) return;
  provider.baseUrl = desiredBase;
};

const parseAttr = (tag: string, attr: string): string | undefined => {
  const match = tag.match(new RegExp(`${attr}=["']([^"']+)["']`, 'i'));
  return match?.[1]?.trim();
};

const parseFlixhqServerList = (html: string) => {
  const rows: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();
  const linkMatches = html.match(/<a\b[^>]*>/gi) || [];

  for (const linkTag of linkMatches) {
    const dataId = parseAttr(linkTag, 'data-id');
    if (!dataId || seen.has(dataId)) continue;
    const title = parseAttr(linkTag, 'title') || '';
    const normalizedName = title
      .replace(/^server\s*/i, '')
      .trim()
      .toLowerCase();
    rows.push({ id: dataId, name: normalizedName || 'unknown' });
    seen.add(dataId);
  }

  return rows;
};

const buildFlixhqWatchUrl = (
  baseUrl: string,
  mediaId: string | undefined,
  serverId: string,
): string => {
  const base = normalizeBaseUrl(baseUrl);
  const rawMediaId = String(mediaId || '').trim();
  if (!rawMediaId) return `${base}/watch.${serverId}`;
  return `${base}/${rawMediaId}.${serverId}`;
};

const wrapFlixhqServerFetcher = (provider: ProviderWithClient) => {
  if (provider.__flixhqServersWrapped || typeof provider.fetchEpisodeServers !== 'function') return;
  if (!isFlixhqProvider(provider) || !provider.client?.get || !provider.baseUrl) return;

  const original = provider.fetchEpisodeServers.bind(provider);

  provider.fetchEpisodeServers = async (...args: any[]) => {
    try {
      return await original(...args);
    } catch (error) {
      const episodeId = String(args?.[0] || '').trim();
      const mediaId = typeof args?.[1] === 'string' ? args[1].trim() : undefined;
      if (!episodeId) throw error;

      const fallbackUrl = `${provider.baseUrl}/ajax/episode/servers/${encodeURIComponent(episodeId)}`;
      const response = await provider.client!.get!(fallbackUrl);
      const html = String(response?.data || '');
      const parsed = parseFlixhqServerList(html).map((entry) => ({
        name: entry.name,
        id: entry.id,
        url: buildFlixhqWatchUrl(String(provider.baseUrl), mediaId, entry.id),
      }));

      if (!parsed.length) throw error;
      return parsed;
    }
  };

  provider.__flixhqServersWrapped = true;
};

const toServerName = (value?: unknown): string => String(value || '').toLowerCase().trim();

const parsePossibleServer = (value: unknown): StreamingServers | undefined => {
  const raw = toServerName(value);
  if (!raw) return undefined;
  const known = Object.values(StreamingServers).find((s) => s === raw);
  return known as StreamingServers | undefined;
};

const hasUsableSources = (payload: unknown): boolean => {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.sources)) return false;
  return record.sources.some((source) => {
    if (!source || typeof source !== 'object') return false;
    const entry = source as { url?: string };
    return typeof entry.url === 'string' && entry.url.trim().length > 0;
  });
};

const getServerCandidates = (preferred?: StreamingServers): StreamingServers[] => {
  const list = [
    preferred,
    StreamingServers.VidStreaming,
    StreamingServers.VidCloud,
    StreamingServers.UpCloud,
    StreamingServers.MegaCloud,
  ].filter(Boolean) as StreamingServers[];

  return list.filter((item, index) => list.indexOf(item) === index);
};

const findServerByName = (servers: any[], target: StreamingServers): any | undefined => {
  const targetName = toServerName(target);
  return servers.find((server) => {
    const name = toServerName(server?.name);
    return name === targetName || name.includes(targetName) || targetName.includes(name);
  });
};

const resolveEpisodeLink = async (
  provider: ProviderWithClient,
  episodeId: string,
  mediaId: string | undefined,
  selectedServer: any,
): Promise<string | undefined> => {
  if (episodeId.startsWith('http://') || episodeId.startsWith('https://')) {
    return episodeId;
  }

  if (typeof selectedServer?.url === 'string' && /^https?:\/\//i.test(selectedServer.url)) {
    return selectedServer.url;
  }

  const serverIdFromField =
    (typeof selectedServer?.id === 'string' && selectedServer.id) ||
    (typeof selectedServer?.url === 'string' && selectedServer.url.includes('.')
      ? selectedServer.url.split('.').pop()
      : undefined);

  if (!serverIdFromField || !provider.client?.get || !provider.baseUrl) {
    return undefined;
  }

  const candidateEndpoints = [
    `${provider.baseUrl}/ajax/episode/sources/${serverIdFromField}`,
    `${provider.baseUrl}/ajax/movie/episode/server/sources/${serverIdFromField}`,
  ];

  for (const endpoint of candidateEndpoints) {
    try {
      const res = await provider.client.get(endpoint);
      const link =
        res?.data?.link ||
        res?.data?.data?.link ||
        res?.data?.url ||
        res?.data?.data?.url;

      if (typeof link === 'string' && /^https?:\/\//i.test(link)) {
        return link;
      }
    } catch {
      continue;
    }
  }

  return undefined;
};

const extractWithFallback = async (
  provider: ProviderWithClient,
  streamUrl: string,
  requestedServer: StreamingServers,
) => {
  const url = new URL(streamUrl);
  const host = String(url.hostname || '').toLowerCase();
  const isVideoStr = host.includes('videostr.');

  const primary =
    isVideoStr
      ? [VideoStr, MegaCloud, VidCloud, RapidCloud]
      : requestedServer === StreamingServers.MegaCloud
        ? [MegaCloud, VidCloud, RapidCloud, VideoStr]
        : [VidCloud, RapidCloud, MegaCloud, VideoStr];

  for (const Extractor of primary) {
    try {
      const extracted = await new Extractor(provider.proxyConfig as any, provider.adapter as any).extract(url);
      if (hasUsableSources(extracted)) {
        return {
          headers: { Referer: url.href },
          ...extracted,
        };
      }
    } catch {
      continue;
    }
  }

  return undefined;
};

const rescueMovieSources = async (provider: ProviderWithClient, args: any[]) => {
  const episodeId = String(args?.[0] || '');
  if (!episodeId) return undefined;

  let mediaId: string | undefined;
  let preferredServer: StreamingServers | undefined;

  if (args.length >= 3) {
    mediaId = typeof args[1] === 'string' ? args[1] : undefined;
    preferredServer = parsePossibleServer(args[2]);
  } else if (args.length === 2) {
    const parsed = parsePossibleServer(args[1]);
    if (parsed) {
      preferredServer = parsed;
    } else if (typeof args[1] === 'string') {
      mediaId = args[1];
    }
  }

  const candidates = getServerCandidates(preferredServer);

  let servers: any[] = [];
  try {
    if (provider.fetchEpisodeServers) {
      servers = mediaId
        ? await provider.fetchEpisodeServers(episodeId, mediaId)
        : await provider.fetchEpisodeServers(episodeId);
    }
  } catch {
    servers = [];
  }

  for (const server of candidates) {
    const selectedServer = servers.length > 0 ? (findServerByName(servers, server) ?? servers[0]) : undefined;
    const link = await resolveEpisodeLink(provider, episodeId, mediaId, selectedServer);
    if (!link) continue;

    const extracted = await extractWithFallback(provider, link, server);
    if (extracted && hasUsableSources(extracted)) {
      return extracted;
    }
  }

  return undefined;
};

const wrapMovieSourceFetcher = (provider: ProviderWithClient) => {
  if (provider.__sourceRescueWrapped || typeof provider.fetchEpisodeSources !== 'function') return;

  const original = provider.fetchEpisodeSources.bind(provider);

  provider.fetchEpisodeSources = async (...args: any[]) => {
    try {
      return await original(...args);
    } catch (error) {
      const rescued = await rescueMovieSources(provider, args);
      if (rescued) return rescued;
      throw error;
    }
  };

  provider.__sourceRescueWrapped = true;
};

export const configureProvider = <T>(provider: T): T => {
  const target = provider as unknown as ProviderWithClient;
  applyFlixhqBaseUrl(target);
  applyBrowserHeaders(target);
  applyProxyConfig(target);
  applyTimeoutConfig(target);
  wrapFlixhqServerFetcher(target);
  wrapMovieSourceFetcher(target);
  return provider;
};
