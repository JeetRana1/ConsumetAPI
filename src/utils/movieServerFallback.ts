import { StreamingServers } from '@consumet/extensions/dist/models';

type GenericProvider = {
  baseUrl?: string;
  client?: {
    get?: (url: string, options?: unknown) => Promise<{ data?: any }>;
  };
  fetchEpisodeServers?: (...args: any[]) => Promise<any[]>;
};

const toName = (value: unknown): string => String(value || '').toLowerCase().trim();

const parseServerId = (server: any): string | undefined => {
  if (typeof server?.id === 'string' && server.id.trim()) return server.id.trim();
  if (typeof server?.url !== 'string') return undefined;
  const token = server.url.split('.').pop();
  return token && /^[a-zA-Z0-9_-]+$/.test(token) ? token : undefined;
};

const resolveServerStreamUrl = async (
  provider: GenericProvider,
  server: any,
): Promise<string | undefined> => {
  if (typeof server?.url === 'string' && server.url.startsWith('http')) {
    const id = parseServerId(server);
    if (!id || !provider.client?.get || !provider.baseUrl) return server.url;

    const endpoints = [
      `${provider.baseUrl}/ajax/episode/sources/${id}`,
      `${provider.baseUrl}/ajax/movie/episode/server/sources/${id}`,
    ];

    for (const endpoint of endpoints) {
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

    return server.url;
  }

  return undefined;
};

export const getMovieEmbedFallbackSource = async (
  provider: GenericProvider,
  episodeId: string,
  mediaId?: string,
  preferredServer?: StreamingServers,
) => {
  if (!provider.fetchEpisodeServers || !episodeId) return undefined;

  const servers = mediaId
    ? await provider.fetchEpisodeServers(episodeId, mediaId)
    : await provider.fetchEpisodeServers(episodeId);

  if (!Array.isArray(servers) || servers.length === 0) return undefined;

  const preferredName = toName(preferredServer);
  const selected = preferredName
    ? servers.find((server) => toName(server?.name).includes(preferredName)) || servers[0]
    : servers[0];

  const streamUrl = await resolveServerStreamUrl(provider, selected);
  if (!streamUrl) return undefined;

  return {
    headers: { Referer: streamUrl },
    sources: [
      {
        url: streamUrl,
        quality: 'auto',
        isM3U8: streamUrl.includes('.m3u8'),
        isEmbed: true,
      },
    ],
    embedURL: streamUrl,
    server: selected?.name,
  };
};
