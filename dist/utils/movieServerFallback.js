"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var movieServerFallback_exports = {};
__export(movieServerFallback_exports, {
  getMovieEmbedFallbackSource: () => getMovieEmbedFallbackSource
});
module.exports = __toCommonJS(movieServerFallback_exports);
const toName = (value) => String(value || "").toLowerCase().trim();
const parseServerId = (server) => {
  if (typeof server?.id === "string" && server.id.trim())
    return server.id.trim();
  if (typeof server?.url !== "string")
    return void 0;
  const token = server.url.split(".").pop();
  return token && /^[a-zA-Z0-9_-]+$/.test(token) ? token : void 0;
};
const resolveServerStreamUrl = async (provider, server) => {
  if (typeof server?.url === "string" && server.url.startsWith("http")) {
    const id = parseServerId(server);
    if (!id || !provider.client?.get || !provider.baseUrl)
      return server.url;
    const endpoints = [
      `${provider.baseUrl}/ajax/episode/sources/${id}`,
      `${provider.baseUrl}/ajax/movie/episode/server/sources/${id}`
    ];
    for (const endpoint of endpoints) {
      try {
        const res = await provider.client.get(endpoint);
        const link = res?.data?.link || res?.data?.data?.link || res?.data?.url || res?.data?.data?.url;
        if (typeof link === "string" && /^https?:\/\//i.test(link)) {
          return link;
        }
      } catch {
        continue;
      }
    }
    return server.url;
  }
  return void 0;
};
const getMovieEmbedFallbackSource = async (provider, episodeId, mediaId, preferredServer) => {
  if (!provider.fetchEpisodeServers || !episodeId)
    return void 0;
  const servers = mediaId ? await provider.fetchEpisodeServers(episodeId, mediaId) : await provider.fetchEpisodeServers(episodeId);
  if (!Array.isArray(servers) || servers.length === 0)
    return void 0;
  const preferredName = toName(preferredServer);
  const selected = preferredName ? servers.find((server) => toName(server?.name).includes(preferredName)) || servers[0] : servers[0];
  const streamUrl = await resolveServerStreamUrl(provider, selected);
  if (!streamUrl)
    return void 0;
  const referer = typeof selected?.url === "string" && selected.url.startsWith("http") ? selected.url : streamUrl;
  return {
    headers: { Referer: referer },
    sources: [
      {
        url: streamUrl,
        quality: "auto",
        isM3U8: streamUrl.includes(".m3u8"),
        isEmbed: true
      }
    ],
    embedURL: streamUrl,
    server: selected?.name
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getMovieEmbedFallbackSource
});
