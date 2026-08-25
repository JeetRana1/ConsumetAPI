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
var embedToDirect_exports = {};
__export(embedToDirect_exports, {
  promoteEmbedSourcesToDirect: () => promoteEmbedSourcesToDirect
});
module.exports = __toCommonJS(embedToDirect_exports);
var import_models = require("@consumet/extensions/dist/models");
var import_extractors = require("@consumet/extensions/dist/extractors");
var import_axios = __toESM(require("axios"));
const isDirectMediaUrl = (value) => /\.(m3u8|mp4|mpd)(\?|$)/i.test(value);
const isEmbedLikeUrl = (value) => {
  const lower = String(value || "").toLowerCase();
  if (!lower.startsWith("http"))
    return false;
  if (isDirectMediaUrl(lower))
    return false;
  return lower.includes("/embed") || /\/e\//.test(lower) || lower.includes("/v3/e-") || lower.includes("stream") || lower.includes("player") || lower.includes("mixdrop") || lower.includes("mp4upload") || lower.includes("streamtape") || lower.includes("vizcloud") || lower.includes("vidcloud") || lower.includes("upcloud") || lower.includes("megacloud");
};
const hasDirectSources = (payload) => {
  if (!payload || !Array.isArray(payload.sources))
    return false;
  return payload.sources.some((src) => {
    const url = String(src?.url || "");
    return !!url && isDirectMediaUrl(url);
  });
};
const getServerOrder = (preferred) => {
  const list = [
    preferred,
    import_models.StreamingServers.VidCloud,
    import_models.StreamingServers.MegaCloud,
    import_models.StreamingServers.UpCloud,
    import_models.StreamingServers.VidStreaming
  ].filter(Boolean);
  return list.filter((item, idx) => list.indexOf(item) === idx);
};
const hasUsableSources = (payload) => {
  if (Array.isArray(payload)) {
    return payload.some(
      (src) => typeof src?.url === "string" && src.url.length > 0
    );
  }
  if (!payload || typeof payload !== "object")
    return false;
  const record = payload;
  if (!Array.isArray(record.sources))
    return false;
  return record.sources.some((src) => typeof src?.url === "string" && src.url.length > 0);
};
const normalizeExtractorResult = (result, embedUrl) => {
  if (!result)
    return void 0;
  if (Array.isArray(result)) {
    return {
      headers: { Referer: embedUrl },
      sources: result,
      embedURL: embedUrl
    };
  }
  if (typeof result === "object") {
    const record = result;
    if (Array.isArray(record.sources)) {
      return {
        headers: { Referer: embedUrl },
        ...record
      };
    }
  }
  return void 0;
};
const tryExtractor = async (provider, embedUrl, requestedServer) => {
  const serverOrder = getServerOrder(requestedServer);
  const url = new URL(embedUrl);
  const host = String(url.hostname || "").toLowerCase();
  for (const server of serverOrder) {
    const isVideoStr = host.includes("videostr.");
    const isMixDrop = host.includes("mixdrop");
    const isMp4Upload = host.includes("mp4upload");
    const isStreamTape = host.includes("streamtape");
    const isVizCloud = host.includes("vizcloud");
    const extractors = isMixDrop ? [import_extractors.MixDrop, import_extractors.StreamTape, import_extractors.VidCloud, import_extractors.MegaCloud] : isMp4Upload ? [import_extractors.MixDrop, import_extractors.StreamTape, import_extractors.VidCloud, import_extractors.MegaCloud] : isStreamTape ? [import_extractors.StreamTape, import_extractors.MixDrop, import_extractors.VidCloud, import_extractors.MegaCloud] : isVizCloud ? [import_extractors.VidCloud, import_extractors.MegaCloud, import_extractors.VideoStr] : isVideoStr ? [import_extractors.VideoStr, import_extractors.MegaCloud, import_extractors.VidCloud] : server === import_models.StreamingServers.MegaCloud ? [import_extractors.MegaCloud, import_extractors.VidCloud, import_extractors.VideoStr] : server === import_models.StreamingServers.VizCloud ? [import_extractors.VidCloud, import_extractors.MegaCloud, import_extractors.VideoStr] : server === import_models.StreamingServers.MixDrop ? [import_extractors.MixDrop, import_extractors.StreamTape, import_extractors.VidCloud, import_extractors.MegaCloud] : server === import_models.StreamingServers.StreamTape ? [
      import_extractors.StreamTape,
      import_extractors.MixDrop,
      import_extractors.VidCloud,
      import_extractors.MegaCloud
    ] : [
      import_extractors.VidCloud,
      import_extractors.MegaCloud,
      import_extractors.VideoStr,
      import_extractors.MixDrop,
      import_extractors.StreamTape
    ];
    for (const Extractor of extractors) {
      try {
        const raw = await new Extractor(
          provider.proxyConfig,
          provider.adapter
        ).extract(url);
        const extracted = normalizeExtractorResult(raw, embedUrl);
        if (hasUsableSources(extracted)) {
          return extracted;
        }
      } catch {
        continue;
      }
    }
  }
  return void 0;
};
const extractDirectUrlsFromHtml = (html) => {
  const candidates = /* @__PURE__ */ new Set();
  const patterns = [
    /["']file["']\s*:\s*["']([^"']+\.(?:m3u8|mp4|mpd)[^"']*)["']/gi,
    /["']src["']\s*:\s*["']([^"']+\.(?:m3u8|mp4|mpd)[^"']*)["']/gi,
    /(https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|mpd)[^\s"'<>]*)/gi
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const url = String(match[1] || match[0] || "").trim();
      if (/^https?:\/\//i.test(url))
        candidates.add(url);
    }
  }
  return [...candidates];
};
const extractFirstIframe = (html) => {
  const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  const src = String(iframeMatch?.[1] || "").trim();
  return src || void 0;
};
const fetchHtml = async (provider, url, referer) => {
  try {
    if (provider.client?.get) {
      const res = await provider.client.get(url, {
        headers: { Referer: referer }
      });
      const html = String(res?.data || "");
      if (html)
        return html;
    }
  } catch {
  }
  try {
    const res = await import_axios.default.get(url, { headers: { Referer: referer } });
    const html = String(res?.data || "");
    if (html)
      return html;
  } catch {
  }
  return void 0;
};
const tryHtmlScrapeDirect = async (provider, embedUrl, upstreamReferer) => {
  const visited = /* @__PURE__ */ new Set();
  let current = embedUrl;
  const referer = String(upstreamReferer || "").trim() || embedUrl;
  for (let depth = 0; depth < 2; depth += 1) {
    if (visited.has(current))
      break;
    visited.add(current);
    const html = await fetchHtml(provider, current, referer);
    if (!html)
      break;
    const directUrls = extractDirectUrlsFromHtml(html);
    const direct = directUrls.find((u) => isDirectMediaUrl(u));
    if (direct) {
      return {
        headers: { Referer: current },
        sources: [
          {
            url: direct,
            quality: "auto",
            isM3U8: direct.includes(".m3u8"),
            isEmbed: false
          }
        ],
        embedURL: embedUrl
      };
    }
    const nextIframe = extractFirstIframe(html);
    if (!nextIframe)
      break;
    try {
      current = new URL(nextIframe, current).toString();
    } catch {
      break;
    }
  }
  return void 0;
};
const promoteEmbedSourcesToDirect = async (provider, payload, preferredServer) => {
  if (!payload || typeof payload !== "object")
    return payload;
  if (hasDirectSources(payload))
    return payload;
  const candidates = /* @__PURE__ */ new Set();
  if (Array.isArray(payload.sources)) {
    for (const source of payload.sources) {
      const url = String(source?.url || "").trim();
      if (url && isEmbedLikeUrl(url))
        candidates.add(url);
    }
  }
  const embedURL = String(payload.embedURL || "").trim();
  if (embedURL && isEmbedLikeUrl(embedURL))
    candidates.add(embedURL);
  const upstreamReferer = String(
    payload.headers?.Referer || payload.headers?.referer || ""
  ).trim();
  for (const candidate of candidates) {
    let extracted = await tryExtractor(provider, candidate, preferredServer);
    if (!extracted || !hasDirectSources(extracted)) {
      extracted = await tryHtmlScrapeDirect(provider, candidate, upstreamReferer);
    }
    if (!extracted || !hasDirectSources(extracted)) {
      try {
        const { extractDirectSourcesWithPlaywright } = await import("./browserRuntimeExtractor");
        const pwSources = await extractDirectSourcesWithPlaywright(
          candidate,
          upstreamReferer,
          15e3
        );
        if (pwSources && pwSources.length > 0) {
          extracted = {
            headers: { Referer: candidate },
            sources: pwSources,
            embedURL: candidate
          };
        }
      } catch (e) {
      }
    }
    if (extracted && hasDirectSources(extracted)) {
      return {
        ...payload,
        ...extracted,
        subtitles: Array.isArray(payload.subtitles) ? payload.subtitles : extracted?.subtitles,
        embedURL: payload.embedURL || candidate
      };
    }
  }
  return payload;
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  promoteEmbedSourcesToDirect
});
