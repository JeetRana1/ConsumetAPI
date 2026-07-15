"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var provider_exports = {};
__export(provider_exports, {
  configureProvider: () => configureProvider
});
module.exports = __toCommonJS(provider_exports);
var import_models = require("@consumet/extensions/dist/models");
var import_extractors = require("@consumet/extensions/dist/extractors");
var import_outboundProxy = require("./outboundProxy");
var import_https = __toESM(require("https"));
const globalHttpsAgent = new import_https.default.Agent({ family: 4, keepAlive: true });
const parseProxyEnv = () => {
  const list = (0, import_outboundProxy.getProxyCandidatesSync)();
  if (!list.length)
    return void 0;
  return list.length === 1 ? list[0] : list;
};
const applyBrowserHeaders = (provider) => {
  const headers = provider.client?.defaults?.headers?.common;
  if (!headers)
    return;
  headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8";
  headers["Accept-Language"] = "en-US,en;q=0.9";
  headers["Accept-Encoding"] = "gzip, deflate, br";
  headers["Connection"] = "keep-alive";
  headers["Upgrade-Insecure-Requests"] = "1";
  headers["Sec-Fetch-Dest"] = "document";
  headers["Sec-Fetch-Mode"] = "navigate";
  headers["Sec-Fetch-Site"] = "none";
};
const applyProxyConfig = (provider) => {
  const proxy = parseProxyEnv();
  if (!proxy)
    return;
  provider.proxyConfig = { url: proxy };
};
const applyTimeoutConfig = (provider) => {
  const defaults = provider.client?.defaults;
  if (!defaults)
    return;
  const isProduction = process.env.NODE_ENV === "production" || !!process.env.VERCEL;
  const envTimeout = Number(process.env.PROVIDER_FETCH_TIMEOUT_MS || "");
  const timeoutMs = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : isProduction ? 12e3 : 1e4;
  defaults.timeout = timeoutMs;
};
const applyAgentConfig = (provider) => {
  const client = provider.client;
  if (!client)
    return;
  if (client.defaults) {
    client.defaults.httpsAgent = globalHttpsAgent;
  }
};
const isFlixhqProvider = (provider) => String(provider.name || "").toLowerCase() === "flixhq";
const normalizeBaseUrl = (value) => value.replace(/\/+$/, "");
const applyFlixhqBaseUrl = (provider) => {
  if (!isFlixhqProvider(provider))
    return;
  const desiredBase = normalizeBaseUrl(
    String(process.env.FLIXHQ_BASE_URL || "https://flixhq.one").trim()
  );
  if (!desiredBase)
    return;
  provider.baseUrl = desiredBase;
};
const parseAttr = (tag, attr) => {
  const match = tag.match(new RegExp(`${attr}=["']([^"']+)["']`, "i"));
  return match?.[1]?.trim();
};
const parseFlixhqServerList = (html) => {
  const rows = [];
  const seen = /* @__PURE__ */ new Set();
  const linkMatches = html.match(/<a\b[^>]*>/gi) || [];
  for (const linkTag of linkMatches) {
    const dataId = parseAttr(linkTag, "data-id");
    if (!dataId || seen.has(dataId))
      continue;
    const title = parseAttr(linkTag, "title") || "";
    const normalizedName = title.replace(/^server\s*/i, "").trim().toLowerCase();
    rows.push({ id: dataId, name: normalizedName || "unknown" });
    seen.add(dataId);
  }
  return rows;
};
const buildFlixhqWatchUrl = (baseUrl, mediaId, serverId) => {
  const base = normalizeBaseUrl(baseUrl);
  const rawMediaId = String(mediaId || "").trim();
  if (!rawMediaId)
    return `${base}/watch.${serverId}`;
  return `${base}/${rawMediaId}.${serverId}`;
};
const wrapFlixhqServerFetcher = (provider) => {
  if (provider.__flixhqServersWrapped || typeof provider.fetchEpisodeServers !== "function")
    return;
  if (!isFlixhqProvider(provider) || !provider.client?.get || !provider.baseUrl)
    return;
  const original = provider.fetchEpisodeServers.bind(provider);
  const hasUsableServerList = (value) => Array.isArray(value) && value.some((entry) => {
    if (!entry || typeof entry !== "object")
      return false;
    const server = entry;
    return Boolean(String(server.id || server.url || server.name || "").trim());
  });
  provider.fetchEpisodeServers = async (...args) => {
    try {
      const existing = await original(...args);
      if (hasUsableServerList(existing)) {
        return existing;
      }
      const episodeId = String(args?.[0] || "").trim();
      const mediaId = typeof args?.[1] === "string" ? args[1].trim() : void 0;
      if (!episodeId)
        return existing;
      const fallbackUrl = `${provider.baseUrl}/ajax/episode/servers/${encodeURIComponent(episodeId)}`;
      const response = await provider.client.get(fallbackUrl);
      const html = String(response?.data || "");
      const parsed = parseFlixhqServerList(html).map((entry) => ({
        name: entry.name,
        id: entry.id,
        url: buildFlixhqWatchUrl(String(provider.baseUrl), mediaId, entry.id)
      }));
      if (parsed.length)
        return parsed;
      return existing;
    } catch (error) {
      const episodeId = String(args?.[0] || "").trim();
      const mediaId = typeof args?.[1] === "string" ? args[1].trim() : void 0;
      if (!episodeId)
        throw error;
      const fallbackUrl = `${provider.baseUrl}/ajax/episode/servers/${encodeURIComponent(episodeId)}`;
      const response = await provider.client.get(fallbackUrl);
      const html = String(response?.data || "");
      const parsed = parseFlixhqServerList(html).map((entry) => ({
        name: entry.name,
        id: entry.id,
        url: buildFlixhqWatchUrl(String(provider.baseUrl), mediaId, entry.id)
      }));
      if (!parsed.length)
        throw error;
      return parsed;
    }
  };
  provider.__flixhqServersWrapped = true;
};
const toServerName = (value) => String(value || "").toLowerCase().trim();
const parsePossibleServer = (value) => {
  const raw = toServerName(value);
  if (!raw)
    return void 0;
  const known = Object.values(import_models.StreamingServers).find((s) => s === raw);
  return known;
};
const hasUsableSources = (payload) => {
  if (!payload || typeof payload !== "object")
    return false;
  const record = payload;
  if (!Array.isArray(record.sources))
    return false;
  return record.sources.some((source) => {
    if (!source || typeof source !== "object")
      return false;
    const entry = source;
    return typeof entry.url === "string" && entry.url.trim().length > 0;
  });
};
const getServerCandidates = (preferred) => {
  const list = [
    preferred,
    import_models.StreamingServers.VidStreaming,
    import_models.StreamingServers.VidCloud,
    import_models.StreamingServers.UpCloud,
    import_models.StreamingServers.MegaCloud
  ].filter(Boolean);
  return list.filter((item, index) => list.indexOf(item) === index);
};
const findServerByName = (servers, target) => {
  const targetName = toServerName(target);
  return servers.find((server) => {
    const name = toServerName(server?.name);
    return name === targetName || name.includes(targetName) || targetName.includes(name);
  });
};
const resolveEpisodeLink = async (provider, episodeId, mediaId, selectedServer) => {
  if (episodeId.startsWith("http://") || episodeId.startsWith("https://")) {
    return episodeId;
  }
  if (typeof selectedServer?.url === "string" && /^https?:\/\//i.test(selectedServer.url)) {
    return selectedServer.url;
  }
  const serverIdFromField = typeof selectedServer?.id === "string" && selectedServer.id || (typeof selectedServer?.url === "string" && selectedServer.url.includes(".") ? selectedServer.url.split(".").pop() : void 0);
  if (!serverIdFromField || !provider.client?.get || !provider.baseUrl) {
    return void 0;
  }
  const candidateEndpoints = [
    `${provider.baseUrl}/ajax/episode/sources/${serverIdFromField}`,
    `${provider.baseUrl}/ajax/movie/episode/server/sources/${serverIdFromField}`
  ];
  for (const endpoint of candidateEndpoints) {
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
  return void 0;
};
const extractWithFallback = async (provider, streamUrl, requestedServer) => {
  const url = new URL(streamUrl);
  const host = String(url.hostname || "").toLowerCase();
  const isVideoStr = host.includes("videostr.");
  const primary = isVideoStr ? [import_extractors.VideoStr, import_extractors.MegaCloud, import_extractors.VidCloud, import_extractors.RapidCloud] : requestedServer === import_models.StreamingServers.MegaCloud ? [import_extractors.MegaCloud, import_extractors.VidCloud, import_extractors.RapidCloud, import_extractors.VideoStr] : [import_extractors.VidCloud, import_extractors.RapidCloud, import_extractors.MegaCloud, import_extractors.VideoStr];
  for (const Extractor of primary) {
    try {
      const extracted = await new Extractor(
        provider.proxyConfig,
        provider.adapter
      ).extract(url);
      if (hasUsableSources(extracted)) {
        return {
          headers: { Referer: url.href },
          ...extracted
        };
      }
    } catch {
      continue;
    }
  }
  return void 0;
};
const rescueMovieSources = async (provider, args) => {
  const episodeId = String(args?.[0] || "");
  if (!episodeId)
    return void 0;
  let mediaId;
  let preferredServer;
  if (args.length >= 3) {
    mediaId = typeof args[1] === "string" ? args[1] : void 0;
    preferredServer = parsePossibleServer(args[2]);
  } else if (args.length === 2) {
    const parsed = parsePossibleServer(args[1]);
    if (parsed) {
      preferredServer = parsed;
    } else if (typeof args[1] === "string") {
      mediaId = args[1];
    }
  }
  const candidates = getServerCandidates(preferredServer);
  let servers = [];
  try {
    if (provider.fetchEpisodeServers) {
      servers = mediaId ? await provider.fetchEpisodeServers(episodeId, mediaId) : await provider.fetchEpisodeServers(episodeId);
    }
  } catch {
    servers = [];
  }
  for (const server of candidates) {
    const selectedServer = servers.length > 0 ? findServerByName(servers, server) ?? servers[0] : void 0;
    const link = await resolveEpisodeLink(provider, episodeId, mediaId, selectedServer);
    if (!link)
      continue;
    const extracted = await extractWithFallback(provider, link, server);
    if (extracted && hasUsableSources(extracted)) {
      return extracted;
    }
  }
  return void 0;
};
const wrapMovieSourceFetcher = (provider) => {
  if (provider.__sourceRescueWrapped || typeof provider.fetchEpisodeSources !== "function")
    return;
  const original = provider.fetchEpisodeSources.bind(provider);
  provider.fetchEpisodeSources = async (...args) => {
    try {
      const existing = await original(...args);
      if (hasUsableSources(existing)) {
        return existing;
      }
      const rescued = await rescueMovieSources(provider, args);
      if (rescued)
        return rescued;
      return existing;
    } catch (error) {
      const rescued = await rescueMovieSources(provider, args);
      if (rescued)
        return rescued;
      throw error;
    }
  };
  provider.__sourceRescueWrapped = true;
};
const configureProvider = (provider) => {
  const target = provider;
  applyFlixhqBaseUrl(target);
  applyBrowserHeaders(target);
  applyProxyConfig(target);
  applyTimeoutConfig(target);
  applyAgentConfig(target);
  wrapFlixhqServerFetcher(target);
  wrapMovieSourceFetcher(target);
  return provider;
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  configureProvider
});
