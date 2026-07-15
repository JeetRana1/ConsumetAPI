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
var streamable_exports = {};
__export(streamable_exports, {
  MOVIE_SERVER_FALLBACKS: () => MOVIE_SERVER_FALLBACKS,
  fetchWithServerFallback: () => fetchWithServerFallback,
  hasDirectPlayableSource: () => hasDirectPlayableSource,
  normalizeStreamLinks: () => normalizeStreamLinks
});
module.exports = __toCommonJS(streamable_exports);
var import_models = require("@consumet/extensions/dist/models");
const STREAMABLE_URL_REGEX = /(\.m3u8|\.mpd|\.mp4)(\?|$)|manifest|playlist|googlevideo|akamaized|cloudfront|cdn|vidstreaming|megacloud/i;
const normalizeUrl = (url) => {
  if (!url)
    return void 0;
  let trimmed = url.trim();
  if (!trimmed)
    return void 0;
  if (trimmed.startsWith("//"))
    return `https:${trimmed}`;
  for (let i = 0; i < 4; i += 1) {
    try {
      const parsed = new URL(trimmed);
      if (!/\/utils\/proxy$/i.test(parsed.pathname))
        break;
      const innerUrl = parsed.searchParams.get("url");
      if (!innerUrl)
        break;
      trimmed = innerUrl.trim();
      if (trimmed.startsWith("//"))
        trimmed = `https:${trimmed}`;
    } catch {
      break;
    }
  }
  return trimmed;
};
const normalizeDownload = (download) => {
  if (typeof download === "string")
    return normalizeUrl(download) ?? download;
  if (Array.isArray(download)) {
    for (const item of download) {
      if (item && typeof item === "object" && "url" in item) {
        const url = normalizeUrl(item.url);
        if (url)
          item.url = url;
      }
    }
  }
  return download;
};
const normalizeStreamLinks = (payload) => {
  if (!payload || typeof payload !== "object")
    return payload;
  if (Array.isArray(payload)) {
    for (const item of payload)
      normalizeStreamLinks(item);
    return payload;
  }
  const record = payload;
  if (Array.isArray(record.sources)) {
    for (const source of record.sources) {
      if (!source || typeof source !== "object")
        continue;
      const src = source;
      const url = normalizeUrl(src.url);
      if (url)
        src.url = url;
    }
  }
  if (Array.isArray(record.subtitles)) {
    for (const subtitle of record.subtitles) {
      if (!subtitle || typeof subtitle !== "object")
        continue;
      const sub = subtitle;
      const url = normalizeUrl(sub.url);
      if (url)
        sub.url = url;
    }
  }
  if ("download" in record) {
    record.download = normalizeDownload(record.download);
  }
  if ("embedURL" in record && typeof record.embedURL === "string") {
    record.embedURL = normalizeUrl(record.embedURL) ?? record.embedURL;
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === "object")
      normalizeStreamLinks(value);
  }
  return payload;
};
const hasUsableStreamSources = (payload) => {
  if (!payload || typeof payload !== "object")
    return false;
  const record = payload;
  if (!Array.isArray(record.sources))
    return false;
  return record.sources.some((source) => {
    if (!source || typeof source !== "object")
      return false;
    const video = source;
    const url = normalizeUrl(video.url);
    if (!url)
      return false;
    return Boolean(video.isM3U8 || video.isDASH || STREAMABLE_URL_REGEX.test(url));
  });
};
const DEFAULT_SERVER_FALLBACKS = [
  import_models.StreamingServers.VidStreaming,
  import_models.StreamingServers.VidCloud,
  import_models.StreamingServers.UpCloud,
  import_models.StreamingServers.MegaCloud,
  import_models.StreamingServers.VideoStr,
  import_models.StreamingServers.VizCloud,
  import_models.StreamingServers.MixDrop,
  import_models.StreamingServers.Mp4Upload,
  import_models.StreamingServers.StreamTape
];
const IS_PRODUCTION = process.env.NODE_ENV === "production" || !!process.env.VERCEL;
const envAttemptTimeout = Number(process.env.STREAMABLE_ATTEMPT_TIMEOUT_MS || "");
const DEFAULT_ATTEMPT_TIMEOUT_MS = Number.isFinite(envAttemptTimeout) && envAttemptTimeout > 0 ? envAttemptTimeout : IS_PRODUCTION ? 4500 : 7e3;
const MOVIE_SERVER_FALLBACKS = [
  import_models.StreamingServers.VidStreaming,
  import_models.StreamingServers.VidCloud,
  import_models.StreamingServers.UpCloud,
  import_models.StreamingServers.MegaCloud,
  import_models.StreamingServers.VideoStr,
  import_models.StreamingServers.VizCloud,
  import_models.StreamingServers.MixDrop,
  import_models.StreamingServers.Mp4Upload,
  import_models.StreamingServers.StreamTape
];
const withTimeout = async (promise, timeoutMs) => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    return promise;
  return await Promise.race([
    promise,
    new Promise(
      (_, reject) => setTimeout(
        () => reject(new Error(`Provider attempt timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    )
  ]);
};
const scoreSourceUrl = (source) => {
  if (!source || typeof source !== "object")
    return -1e3;
  const entry = source;
  const url = String(normalizeUrl(entry.url) || "").toLowerCase();
  if (!url)
    return -1e3;
  let score = 0;
  const isEmbed = Boolean(entry.isEmbed);
  const isM3U8 = Boolean(entry.isM3U8) || url.includes(".m3u8");
  const isDASH = Boolean(entry.isDASH) || url.includes(".mpd");
  const isMp4 = url.includes(".mp4");
  if (isEmbed)
    score -= 100;
  if (url.includes("kaa.lt/intro.mp4") || url.endsWith("/intro.mp4"))
    score -= 250;
  if (url.includes("/trailer") || url.includes("/preview"))
    score -= 180;
  if (isMp4)
    score += 90;
  if (isM3U8)
    score += 70;
  if (isDASH)
    score += 60;
  if (url.includes("googlevideo") || url.includes("akamaized") || url.includes("cloudfront"))
    score += 20;
  if (url.includes("megacloud") || url.includes("/embed"))
    score -= 25;
  return score;
};
const hasDirectPlayableSource = (payload) => {
  if (!payload || typeof payload !== "object")
    return false;
  const record = payload;
  if (!Array.isArray(record.sources))
    return false;
  return record.sources.some((source) => scoreSourceUrl(source) >= 60);
};
const sortSourcesByPlayability = (payload) => {
  if (!payload || typeof payload !== "object")
    return payload;
  const record = payload;
  if (!Array.isArray(record.sources))
    return payload;
  record.sources.sort((a, b) => scoreSourceUrl(b) - scoreSourceUrl(a));
  return payload;
};
const fetchWithServerFallback = async (fetcher, preferredServer, fallbackServers = DEFAULT_SERVER_FALLBACKS, options = {}) => {
  const attemptTimeoutMs = Number(options.attemptTimeoutMs || DEFAULT_ATTEMPT_TIMEOUT_MS);
  const requireDirectPlayable = Boolean(options.requireDirectPlayable);
  const candidates = [
    preferredServer,
    ...fallbackServers
  ].filter((server, index, list) => list.indexOf(server) === index);
  let lastError = void 0;
  let firstResponse = void 0;
  let firstWithSources = void 0;
  let bestDirectResponse = void 0;
  for (const server of candidates) {
    try {
      const response = sortSourcesByPlayability(
        normalizeStreamLinks(await withTimeout(fetcher(server), attemptTimeoutMs))
      );
      if (typeof firstResponse === "undefined")
        firstResponse = response;
      if (hasUsableStreamSources(response) && typeof firstWithSources === "undefined") {
        firstWithSources = response;
        if (!requireDirectPlayable)
          return response;
      }
      if (hasDirectPlayableSource(response)) {
        bestDirectResponse = response;
        break;
      }
    } catch (err) {
      lastError = err;
    }
  }
  if (typeof bestDirectResponse !== "undefined")
    return bestDirectResponse;
  if (requireDirectPlayable) {
    throw lastError ?? new Error("No direct playable stream found (embed-only sources were skipped).");
  }
  if (typeof firstWithSources !== "undefined")
    return firstWithSources;
  if (typeof firstResponse !== "undefined")
    return firstResponse;
  throw lastError ?? new Error("Failed to fetch stream sources.");
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MOVIE_SERVER_FALLBACKS,
  fetchWithServerFallback,
  hasDirectPlayableSource,
  normalizeStreamLinks
});
