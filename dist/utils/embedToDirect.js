"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.promoteEmbedSourcesToDirect = void 0;
const models_1 = require("@consumet/extensions/dist/models");
const extractors_1 = require("@consumet/extensions/dist/extractors");
const axios_1 = __importDefault(require("axios"));
const isDirectMediaUrl = (value) => /\.(m3u8|mp4|mpd)(\?|$)/i.test(value);
const isEmbedLikeUrl = (value) => {
    const lower = String(value || '').toLowerCase();
    if (!lower.startsWith('http'))
        return false;
    if (isDirectMediaUrl(lower))
        return false;
    return (lower.includes('/embed') ||
        /\/e\//.test(lower) ||
        lower.includes('/v3/e-') ||
        lower.includes('stream') ||
        lower.includes('player') ||
        lower.includes('mixdrop') ||
        lower.includes('mp4upload') ||
        lower.includes('streamtape') ||
        lower.includes('vizcloud') ||
        lower.includes('vidcloud') ||
        lower.includes('upcloud') ||
        lower.includes('megacloud'));
};
const hasDirectSources = (payload) => {
    if (!payload || !Array.isArray(payload.sources))
        return false;
    return payload.sources.some((src) => {
        const url = String(src?.url || '');
        return !!url && isDirectMediaUrl(url);
    });
};
const getServerOrder = (preferred) => {
    const list = [
        preferred,
        models_1.StreamingServers.VidCloud,
        models_1.StreamingServers.MegaCloud,
        models_1.StreamingServers.UpCloud,
        models_1.StreamingServers.VidStreaming,
    ].filter(Boolean);
    return list.filter((item, idx) => list.indexOf(item) === idx);
};
const hasUsableSources = (payload) => {
    if (Array.isArray(payload)) {
        return payload.some((src) => typeof src?.url === 'string' && src.url.length > 0);
    }
    if (!payload || typeof payload !== 'object')
        return false;
    const record = payload;
    if (!Array.isArray(record.sources))
        return false;
    return record.sources.some((src) => typeof src?.url === 'string' && src.url.length > 0);
};
const normalizeExtractorResult = (result, embedUrl) => {
    if (!result)
        return undefined;
    if (Array.isArray(result)) {
        return {
            headers: { Referer: embedUrl },
            sources: result,
            embedURL: embedUrl,
        };
    }
    if (typeof result === 'object') {
        const record = result;
        if (Array.isArray(record.sources)) {
            return {
                headers: { Referer: embedUrl },
                ...record,
            };
        }
    }
    return undefined;
};
const tryExtractor = async (provider, embedUrl, requestedServer) => {
    const serverOrder = getServerOrder(requestedServer);
    const url = new URL(embedUrl);
    const host = String(url.hostname || '').toLowerCase();
    for (const server of serverOrder) {
        const isVideoStr = host.includes('videostr.');
        const isMixDrop = host.includes('mixdrop');
        const isMp4Upload = host.includes('mp4upload');
        const isStreamTape = host.includes('streamtape');
        const isVizCloud = host.includes('vizcloud');
        const extractors = isMixDrop
            ? [extractors_1.MixDrop, extractors_1.Mp4Upload, extractors_1.StreamTape, extractors_1.VidCloud, extractors_1.MegaCloud, extractors_1.RapidCloud]
            : isMp4Upload
                ? [extractors_1.Mp4Upload, extractors_1.MixDrop, extractors_1.StreamTape, extractors_1.VidCloud, extractors_1.MegaCloud, extractors_1.RapidCloud]
                : isStreamTape
                    ? [extractors_1.StreamTape, extractors_1.MixDrop, extractors_1.Mp4Upload, extractors_1.VidCloud, extractors_1.MegaCloud, extractors_1.RapidCloud]
                    : isVizCloud
                        ? [extractors_1.VidCloud, extractors_1.MegaCloud, extractors_1.RapidCloud, extractors_1.VideoStr]
                        : isVideoStr
                            ? [extractors_1.VideoStr, extractors_1.MegaCloud, extractors_1.VidCloud, extractors_1.RapidCloud]
                            : server === models_1.StreamingServers.MegaCloud
                                ? [extractors_1.MegaCloud, extractors_1.VidCloud, extractors_1.RapidCloud, extractors_1.VideoStr]
                                : server === models_1.StreamingServers.VizCloud
                                    ? [extractors_1.VidCloud, extractors_1.MegaCloud, extractors_1.RapidCloud, extractors_1.VideoStr]
                                    : server === models_1.StreamingServers.MixDrop
                                        ? [extractors_1.MixDrop, extractors_1.Mp4Upload, extractors_1.StreamTape, extractors_1.VidCloud, extractors_1.MegaCloud, extractors_1.RapidCloud]
                                        : server === models_1.StreamingServers.Mp4Upload
                                            ? [extractors_1.Mp4Upload, extractors_1.MixDrop, extractors_1.StreamTape, extractors_1.VidCloud, extractors_1.MegaCloud, extractors_1.RapidCloud]
                                            : server === models_1.StreamingServers.StreamTape
                                                ? [
                                                    extractors_1.StreamTape,
                                                    extractors_1.MixDrop,
                                                    extractors_1.Mp4Upload,
                                                    extractors_1.VidCloud,
                                                    extractors_1.MegaCloud,
                                                    extractors_1.RapidCloud,
                                                ]
                                                : [
                                                    extractors_1.VidCloud,
                                                    extractors_1.RapidCloud,
                                                    extractors_1.MegaCloud,
                                                    extractors_1.VideoStr,
                                                    extractors_1.MixDrop,
                                                    extractors_1.Mp4Upload,
                                                    extractors_1.StreamTape,
                                                ];
        for (const Extractor of extractors) {
            try {
                const raw = await new Extractor(provider.proxyConfig, provider.adapter).extract(url);
                const extracted = normalizeExtractorResult(raw, embedUrl);
                if (hasUsableSources(extracted)) {
                    return extracted;
                }
            }
            catch {
                continue;
            }
        }
    }
    return undefined;
};
const extractDirectUrlsFromHtml = (html) => {
    const candidates = new Set();
    const patterns = [
        /["']file["']\s*:\s*["']([^"']+\.(?:m3u8|mp4|mpd)[^"']*)["']/gi,
        /["']src["']\s*:\s*["']([^"']+\.(?:m3u8|mp4|mpd)[^"']*)["']/gi,
        /(https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|mpd)[^\s"'<>]*)/gi,
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(html)) !== null) {
            const url = String(match[1] || match[0] || '').trim();
            if (/^https?:\/\//i.test(url))
                candidates.add(url);
        }
    }
    return [...candidates];
};
const extractFirstIframe = (html) => {
    const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    const src = String(iframeMatch?.[1] || '').trim();
    return src || undefined;
};
const fetchHtml = async (provider, url, referer) => {
    try {
        if (provider.client?.get) {
            const res = await provider.client.get(url, {
                headers: { Referer: referer },
            });
            const html = String(res?.data || '');
            if (html)
                return html;
        }
    }
    catch {
        // continue to axios fallback
    }
    try {
        const res = await axios_1.default.get(url, { headers: { Referer: referer } });
        const html = String(res?.data || '');
        if (html)
            return html;
    }
    catch {
        // ignore
    }
    return undefined;
};
const tryHtmlScrapeDirect = async (provider, embedUrl, upstreamReferer) => {
    const visited = new Set();
    let current = embedUrl;
    const referer = String(upstreamReferer || '').trim() || embedUrl;
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
                        quality: 'auto',
                        isM3U8: direct.includes('.m3u8'),
                        isEmbed: false,
                    },
                ],
                embedURL: embedUrl,
            };
        }
        const nextIframe = extractFirstIframe(html);
        if (!nextIframe)
            break;
        try {
            current = new URL(nextIframe, current).toString();
        }
        catch {
            break;
        }
    }
    return undefined;
};
const promoteEmbedSourcesToDirect = async (provider, payload, preferredServer) => {
    if (!payload || typeof payload !== 'object')
        return payload;
    if (hasDirectSources(payload))
        return payload;
    const candidates = new Set();
    if (Array.isArray(payload.sources)) {
        for (const source of payload.sources) {
            const url = String(source?.url || '').trim();
            if (url && isEmbedLikeUrl(url))
                candidates.add(url);
        }
    }
    const embedURL = String(payload.embedURL || '').trim();
    if (embedURL && isEmbedLikeUrl(embedURL))
        candidates.add(embedURL);
    const upstreamReferer = String(payload.headers?.Referer || payload.headers?.referer || '').trim();
    for (const candidate of candidates) {
        let extracted = await tryExtractor(provider, candidate, preferredServer);
        if (!extracted || !hasDirectSources(extracted)) {
            extracted = await tryHtmlScrapeDirect(provider, candidate, upstreamReferer);
        }
        if (!extracted || !hasDirectSources(extracted)) {
            try {
                const { extractDirectSourcesWithPlaywright } = await Promise.resolve().then(() => __importStar(require('./browserRuntimeExtractor')));
                const pwSources = await extractDirectSourcesWithPlaywright(candidate, upstreamReferer, 15000);
                if (pwSources && pwSources.length > 0) {
                    extracted = {
                        headers: { Referer: candidate },
                        sources: pwSources,
                        embedURL: candidate,
                    };
                }
            }
            catch (e) {
                // ignore
            }
        }
        if (extracted && hasDirectSources(extracted)) {
            return {
                ...payload,
                ...extracted,
                subtitles: Array.isArray(payload.subtitles)
                    ? payload.subtitles
                    : extracted?.subtitles,
                embedURL: payload.embedURL || candidate,
            };
        }
    }
    return payload;
};
exports.promoteEmbedSourcesToDirect = promoteEmbedSourcesToDirect;
