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
var unifiedPlayback_exports = {};
__export(unifiedPlayback_exports, {
  buildUnifiedPlaybackProfile: () => buildUnifiedPlaybackProfile,
  withUnifiedPlayback: () => withUnifiedPlayback
});
module.exports = __toCommonJS(unifiedPlayback_exports);
const normalizeUrl = (value) => {
  const trimmed = String(value || "").trim();
  if (!trimmed)
    return "";
  if (trimmed.startsWith("//"))
    return `https:${trimmed}`;
  return trimmed;
};
const toNumericQualityScore = (quality) => {
  const text = String(quality || "").toLowerCase();
  const match = text.match(/(\d{3,4})p/);
  if (match)
    return Number(match[1]) || 0;
  if (text.includes("4k"))
    return 2160;
  if (text.includes("2k"))
    return 1440;
  if (text.includes("uhd"))
    return 2160;
  if (text.includes("fhd"))
    return 1080;
  if (text.includes("hd"))
    return 720;
  if (text.includes("sd"))
    return 480;
  if (text.includes("auto"))
    return 9999;
  return 0;
};
const detectSourceType = (source, url) => {
  const lower = url.toLowerCase();
  const embed = Boolean(source?.isEmbed);
  const isM3u8 = Boolean(source?.isM3U8) || /\.m3u8(\?|$)/i.test(lower) || /\/m3u8-proxy\?/i.test(lower);
  const isDash = Boolean(source?.isDASH) || /\.mpd(\?|$)/i.test(lower);
  const isMp4 = /\.mp4(\?|$)/i.test(lower);
  if (isM3u8)
    return "hls";
  if (isDash)
    return "dash";
  if (isMp4)
    return "mp4";
  if (embed || /\/embed\b|iframe|player|watch/i.test(lower))
    return "embed";
  return "unknown";
};
const detectMimeType = (type) => {
  if (type === "hls")
    return "application/vnd.apple.mpegurl";
  if (type === "dash")
    return "application/dash+xml";
  if (type === "mp4")
    return "video/mp4";
  return "text/html";
};
const typeRank = (type) => {
  if (type === "hls")
    return 5;
  if (type === "dash")
    return 4;
  if (type === "mp4")
    return 3;
  if (type === "unknown")
    return 2;
  return 1;
};
const buildUnifiedSource = (source, headers) => {
  const url = normalizeUrl(String(source?.url || ""));
  if (!url)
    return null;
  const type = detectSourceType(source, url);
  const quality = String(source?.quality || (type === "hls" ? "auto" : "unknown"));
  return {
    url,
    type,
    quality,
    mimeType: detectMimeType(type),
    isAdaptive: type === "hls" || type === "dash",
    isEmbed: type === "embed",
    requiresProxy: /\/m3u8-proxy\?/i.test(url),
    headers
  };
};
const buildUnifiedPlaybackProfile = (sources, headers) => {
  const input = Array.isArray(sources) ? sources : [];
  const dedupe = /* @__PURE__ */ new Set();
  const normalized = [];
  for (const source of input) {
    const entry = buildUnifiedSource(source, headers);
    if (!entry)
      continue;
    const key = entry.url.toLowerCase();
    if (dedupe.has(key))
      continue;
    dedupe.add(key);
    normalized.push(entry);
  }
  normalized.sort((a, b) => {
    const rankDelta = typeRank(b.type) - typeRank(a.type);
    if (rankDelta !== 0)
      return rankDelta;
    return toNumericQualityScore(b.quality) - toNumericQualityScore(a.quality);
  });
  const primary = normalized[0] || null;
  const preferredType = primary ? primary.type : null;
  return {
    primary,
    preferredType,
    supports: {
      hls: normalized.some((entry) => entry.type === "hls"),
      dash: normalized.some((entry) => entry.type === "dash"),
      mp4: normalized.some((entry) => entry.type === "mp4"),
      embed: normalized.some((entry) => entry.type === "embed")
    },
    alternatives: normalized
  };
};
const withUnifiedPlayback = (payload) => {
  const headers = payload?.headers;
  return {
    ...payload,
    playback: buildUnifiedPlaybackProfile(payload?.sources, headers)
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildUnifiedPlaybackProfile,
  withUnifiedPlayback
});
