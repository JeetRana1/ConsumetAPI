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
var animekai_exports = {};
__export(animekai_exports, {
  default: () => animekai_default
});
module.exports = __toCommonJS(animekai_exports);
var cheerio = __toESM(require("cheerio"));
var import_outboundProxy = require("../../utils/outboundProxy");
const BASE_URL = "https://animekai.be";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
const directJson = async (url) => {
  const response = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12e3) });
  if (!response.ok)
    throw new Error(`AnimeKai upstream HTTP ${response.status}`);
  return response.json();
};
const searchAnimeKai = async (query) => directJson(`${BASE_URL}/api/search/suggest?q=${encodeURIComponent(query)}`);
const routes = async (fastify, _options) => {
  fastify.get("/search/:query", async (request, reply) => {
    const query = String(request.params.query || "");
    const response = await searchAnimeKai(query);
    const results = [];
    for (const item of Array.isArray(response) ? response : response?.results || []) {
      const id = String(item?.slug || item?.id || "").trim();
      if (id)
        results.push({ id, title: item.title, url: `${BASE_URL}/watch/${id}`, image: item.poster_url, type: item.type || "TV", anilistId: item.anilistId, malId: item.malId });
    }
    reply.send({ currentPage: 1, hasNextPage: false, totalPages: 1, results });
  });
  fastify.get("/info", async (request, reply) => {
    let id = String(request.query.id || "").split("$")[0];
    let response;
    try {
      response = await (0, import_outboundProxy.proxyGet)(`${BASE_URL}/watch/${id}`, { headers: { "User-Agent": UA } });
      if (Number(response?.status || 200) >= 400)
        throw new Error(`AnimeKai info HTTP ${response.status}`);
    } catch {
      const searchTerms = [id.replace(/-/g, " "), id.replace(/[^a-z0-9]/gi, "")];
      let match = null;
      for (const term of [...new Set(searchTerms)]) {
        const results = await searchAnimeKai(term);
        const candidates = Array.isArray(results) ? results : results?.results || [];
        const ordered = candidates.sort((a, b) => Number(String(b?.type || "").toLowerCase() === "tv") - Number(String(a?.type || "").toLowerCase() === "tv"));
        for (const candidate of ordered) {
          const candidateId = String(candidate?.slug || candidate?.id || "").trim();
          if (!candidateId)
            continue;
          try {
            const candidateResponse = await (0, import_outboundProxy.proxyGet)(`${BASE_URL}/watch/${candidateId}`, { headers: { "User-Agent": UA } });
            if (candidateResponse?.data) {
              match = candidate;
              response = candidateResponse;
              break;
            }
          } catch {
          }
        }
        match = match || candidates.find(
          (item) => String(item?.slug || "").toLowerCase() === id.toLowerCase() || String(item?.slug || "").toLowerCase().startsWith(id.toLowerCase())
        ) || candidates[0];
        if (match)
          break;
      }
      id = String(match?.slug || match?.id || "").trim();
      if (!id)
        return reply.status(404).send({ message: "AnimeKai title not found" });
      if (!response)
        response = await (0, import_outboundProxy.proxyGet)(`${BASE_URL}/watch/${id}`, { headers: { "User-Agent": UA } });
    }
    const $ = cheerio.load(String(response.data || ""));
    const malId = $('a[href*="myanimelist.net/anime/"]').attr("href")?.match(/anime\/(\d+)/)?.[1] || null;
    const episodes = [];
    $(".eplist a[num]").each((_, el) => {
      const number = Number($(el).attr("num"));
      if (!number)
        return;
      const token = $(el).attr("token") || "";
      episodes.push({ id: `${id}$ep=${number}$token=${token}`, number, title: $(el).find("span").text().trim() || `Episode ${number}`, isSubbed: true, isDubbed: true });
    });
    reply.send({ id, title: $(".entity-scroll > .title").text().trim() || id, image: $("div.poster img").attr("src"), malId, episodes, seasons: [{ season: 1, episodes }] });
  });
  fastify.get("/watch/:episodeId", async (request, reply) => {
    const episodeId = String(request.params.episodeId || "");
    const nativeMatch = episodeId.match(/^(.*?)\$ep=(\d+)/i);
    const sharedMatch = episodeId.match(/^(.+)-(\d+)x(\d+)$/i);
    const slug = nativeMatch?.[1] || sharedMatch?.[1] || episodeId;
    const episode = Number(nativeMatch?.[2] || sharedMatch?.[3] || 1);
    const dub = String(request.query.dub || "").toLowerCase() === "true";
    let resolvedSlug = slug;
    let pageResponse = await fetch(`${BASE_URL}/watch/${resolvedSlug}/ep-${episode}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12e3) });
    if (!pageResponse.ok) {
      const searchTerm = slug.replace(/-\d+x\d+$/i, "").replace(/-\$ep=.*$/i, "").replace(/-(?:the-)?movie$/i, "");
      let results = await searchAnimeKai(searchTerm);
      if (!(Array.isArray(results) ? results : results?.results || []).length) {
        results = await searchAnimeKai(slug.split("-").slice(0, 2).join(" "));
      }
      const resultRows = Array.isArray(results) ? results : results?.results || [];
      const match = resultRows.find((item) => /movie/i.test(String(item?.type || ""))) || resultRows[0];
      resolvedSlug = String(match?.slug || match?.id || "").trim();
      if (!resolvedSlug)
        throw new Error(`AnimeKai title not found: ${slug}`);
      pageResponse = await fetch(`${BASE_URL}/watch/${resolvedSlug}/ep-${episode}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12e3) });
    }
    if (!pageResponse.ok) {
      pageResponse = await fetch(`${BASE_URL}/watch/${resolvedSlug}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12e3) });
    }
    if (!pageResponse.ok)
      throw new Error(`AnimeKai episode HTTP ${pageResponse.status}`);
    const $ = cheerio.load(await pageResponse.text());
    let malId = $('a[href*="myanimelist.net/anime/"]').attr("href")?.match(/anime\/(\d+)/)?.[1] || "";
    if (!malId) {
      try {
        const jikan = await directJson(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(resolvedSlug.replace(/-/g, " "))}&limit=1`);
        malId = String(jikan?.data?.[0]?.mal_id || "");
      } catch {
      }
    }
    if (!malId)
      return reply.status(404).send({ message: "AnimeKai MAL mapping unavailable" });
    const malCandidates = [malId];
    let outputDub = dub;
    let data;
    for (const candidate of malCandidates) {
      try {
        data = await directJson(`https://api.flikhub.net/megaplay?mal=${candidate}&ep=${episode}&type=${dub ? "dub" : "sub"}`);
        if (data?.m3u8)
          break;
      } catch {
      }
    }
    if (!data?.m3u8 && !dub) {
      for (const candidate of malCandidates) {
        try {
          data = await directJson(`https://api.flikhub.net/megaplay?mal=${candidate}&ep=${episode}&type=dub`);
          if (data?.m3u8) {
            outputDub = true;
            break;
          }
        } catch {
        }
      }
    }
    if (!data?.m3u8)
      throw new Error(`AnimeKai source unavailable for MAL ${malCandidates.join(",")}`);
    const sources = data?.m3u8 ? [{ url: data.m3u8, isM3U8: true, isEmbed: false, quality: `AnimeKai ${outputDub ? "Dub" : "Sub"}`, referer: "https://megaplay.buzz/" }] : [];
    reply.send({ headers: { Referer: "https://megaplay.buzz/" }, sources, subtitles: (data?.tracks || []).map((track) => ({ url: track.file, lang: track.label, provider: "animekai" })) });
  });
  fastify.get("/servers/:episodeId", async (request, reply) => {
    const episodeId = String(request.params.episodeId || "");
    if (!episodeId)
      return reply.status(400).send({ message: "episodeId is required" });
    const dub = ["true", "1"].includes(String(request.query.dub || "").toLowerCase());
    try {
      const response = await (0, import_outboundProxy.proxyGet)(
        `${BASE_URL}/ajax/episode/servers/${encodeURIComponent(episodeId)}`,
        { headers: { "User-Agent": UA, Referer: `${BASE_URL}/` } }
      );
      const payload = response.data || {};
      return reply.send({
        servers: Array.isArray(payload?.servers) ? payload.servers : Array.isArray(payload) ? payload : [],
        intro: payload?.intro || null,
        outro: payload?.outro || null,
        dub
      });
    } catch (error) {
      return reply.status(502).send({ message: error?.message || "AnimeKai server metadata unavailable" });
    }
  });
  fastify.get("/catalog/:query", async (request, reply) => {
    const query = String(request.params.query || "");
    let search = await searchAnimeKai(query);
    let searchItems = Array.isArray(search) ? search : search?.results || [];
    if (!searchItems.length) {
      search = await searchAnimeKai(query.replace(/[^a-z0-9]/gi, ""));
      searchItems = Array.isArray(search) ? search : search?.results || [];
    }
    const candidates = searchItems.filter((item) => !/movie|special/i.test(String(item?.type || ""))).slice(0, 10);
    candidates.sort((a, b) => {
      const year = (item) => Number(item?.year || item?.releaseYear || 0);
      const part = (item) => {
        const text = String(item?.title || item?.slug || "").toLowerCase();
        const match = text.match(/(?:season|part)\s*(\d+)/i);
        return match ? Number(match[1]) : 0;
      };
      const yearDiff = year(a) - year(b);
      if (yearDiff !== 0)
        return yearDiff;
      return part(a) - part(b);
    });
    const seasons = [];
    for (const candidate of candidates) {
      const id = String(candidate?.slug || "").trim();
      if (!id)
        continue;
      try {
        const response = await (0, import_outboundProxy.proxyGet)(`${BASE_URL}/watch/${id}`, { headers: { "User-Agent": UA } });
        const $ = cheerio.load(String(response.data || ""));
        const episodes = [];
        $(".eplist a[num]").each((_, el) => {
          const number = Number($(el).attr("num"));
          if (number)
            episodes.push({ id: `${id}$ep=${number}$token=${$(el).attr("token") || ""}`, number, title: $(el).find("span").text().trim() || `Episode ${number}` });
        });
        const isSideStory = /\b(?:log|ova|ona|special|movie|film|fan\s+letter|heroines|episode\s+of)\b/i.test(
          String(candidate.title || id)
        );
        if (episodes.length >= 8 && !isSideStory) {
          const title = String(candidate.title || id).trim();
          for (let start = 0; start < episodes.length; start += 50) {
            const chunk = episodes.slice(start, start + 50);
            const first = chunk[0]?.number || start + 1;
            const last = chunk[chunk.length - 1]?.number || start + chunk.length;
            seasons.push({
              seasonNo: seasons.length + 1,
              name: `${title} \xB7 ${first}-${last}`,
              providerAnimeId: id,
              provider: "animekai",
              providerTitle: title,
              episodes: chunk
            });
          }
        }
      } catch {
      }
    }
    return reply.send({ seasons });
  });
  fastify.get("/:query", async (request, reply) => {
    const query = String(request.params.query || "");
    let response;
    try {
      response = { data: await searchAnimeKai(query) };
    } catch {
      const slug = query.toLowerCase().replace(/\b(19|20)\d{2}\b/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      return reply.send([{ id: slug, title: query.replace(/\s+(19|20)\d{2}\b/, "").trim(), url: `${BASE_URL}/watch/${slug}`, type: "TV" }]);
    }
    const results = (Array.isArray(response.data) ? response.data : response.data?.results || []).map((item) => {
      const id = String(item?.slug || item?.id || "").trim();
      return { id, title: item?.title, url: `${BASE_URL}/watch/${id}`, type: item?.type || "TV", image: item?.poster_url };
    }).filter((item) => item.id);
    reply.send(results);
  });
};
var animekai_default = routes;
