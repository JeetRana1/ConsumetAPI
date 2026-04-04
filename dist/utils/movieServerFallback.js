"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMovieEmbedFallbackSource = void 0;
const toName = (value) => String(value || '').toLowerCase().trim();
const parseServerId = (server) => {
    if (typeof server?.id === 'string' && server.id.trim())
        return server.id.trim();
    if (typeof server?.url !== 'string')
        return undefined;
    const token = server.url.split('.').pop();
    return token && /^[a-zA-Z0-9_-]+$/.test(token) ? token : undefined;
};
const resolveServerStreamUrl = async (provider, server) => {
    if (typeof server?.url === 'string' && server.url.startsWith('http')) {
        const id = parseServerId(server);
        if (!id || !provider.client?.get || !provider.baseUrl)
            return server.url;
        const endpoints = [
            `${provider.baseUrl}/ajax/episode/sources/${id}`,
            `${provider.baseUrl}/ajax/movie/episode/server/sources/${id}`,
        ];
        for (const endpoint of endpoints) {
            try {
                const res = await provider.client.get(endpoint);
                const link = res?.data?.link ||
                    res?.data?.data?.link ||
                    res?.data?.url ||
                    res?.data?.data?.url;
                if (typeof link === 'string' && /^https?:\/\//i.test(link)) {
                    return link;
                }
            }
            catch {
                continue;
            }
        }
        return server.url;
    }
    return undefined;
};
const getMovieEmbedFallbackSource = async (provider, episodeId, mediaId, preferredServer) => {
    if (!provider.fetchEpisodeServers || !episodeId)
        return undefined;
    const servers = mediaId
        ? await provider.fetchEpisodeServers(episodeId, mediaId)
        : await provider.fetchEpisodeServers(episodeId);
    if (!Array.isArray(servers) || servers.length === 0)
        return undefined;
    const preferredName = toName(preferredServer);
    const selected = preferredName
        ? servers.find((server) => toName(server?.name).includes(preferredName)) || servers[0]
        : servers[0];
    const streamUrl = await resolveServerStreamUrl(provider, selected);
    if (!streamUrl)
        return undefined;
    const referer = typeof selected?.url === 'string' && selected.url.startsWith('http')
        ? selected.url
        : streamUrl;
    return {
        headers: { Referer: referer },
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
exports.getMovieEmbedFallbackSource = getMovieEmbedFallbackSource;
