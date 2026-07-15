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
var flixhq_exports = {};
__export(flixhq_exports, {
  default: () => flixhq_default
});
module.exports = __toCommonJS(flixhq_exports);
var import_cache = __toESM(require("../../utils/cache"));
var import_main = require("../../main");
var import_flixhqProvider = require("../../providers/custom/flixhqProvider");
const isDirectMediaUrl = (value) => /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(value || ""));
const isUsableSourceUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw || /^blob:/i.test(raw))
    return false;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (host === "example.com" || host.endsWith(".example.com"))
      return false;
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0")
      return false;
    if (host.includes("placeholder") || host.includes("dummy"))
      return false;
    return true;
  } catch {
    return false;
  }
};
const sortAndLimitSources = (rawSources) => {
  const usable = rawSources.filter((item) => isUsableSourceUrl(String(item?.url || "")));
  const deduped = usable.filter(
    (item, idx, arr) => arr.findIndex((v) => String(v?.url || "") === String(item?.url || "")) === idx
  );
  const hasMasterForBase = new Set(
    deduped.map((source) => String(source?.url || "")).filter((url) => /\/master\.m3u8(?:\?|$)/i.test(url)).map((url) => url.replace(/\/master\.m3u8(?:\?.*)?$/i, ""))
  );
  const collapsed = deduped.filter((source) => {
    const url = String(source?.url || "");
    const base = url.replace(/\/index-[^/]+\.m3u8(?:\?.*)?$/i, "");
    return !hasMasterForBase.has(base) || /\/master\.m3u8(?:\?|$)/i.test(url);
  });
  const direct = collapsed.filter((s) => isDirectMediaUrl(String(s?.url || ""))).sort((a, b) => {
    const score = (source) => {
      const url = String(source?.url || "");
      const serverLabel = String(source?.server || source?.quality || "").toLowerCase();
      return (/\.m3u8(?:\?|$)/i.test(url) || source?.isM3U8 ? 80 : 0) + (/\/master\.m3u8(?:\?|$)/i.test(url) ? 25 : 0) + (/\/index\.m3u8(?:\?|$)/i.test(url) ? 15 : 0) + (/\.mp4(?:\?|$)/i.test(url) ? 20 : 0) + (/hydrogen/.test(serverLabel) ? 35 : 0) + (/lithium/.test(serverLabel) ? 30 : 0) + (/helium/.test(serverLabel) ? 15 : 0) - (/oxygen/.test(serverLabel) ? 40 : 0);
    };
    return score(b) - score(a);
  });
  const nonDirect = collapsed.filter((s) => !isDirectMediaUrl(String(s?.url || "")));
  return [...direct.slice(0, 8), ...nonDirect.slice(0, 2)];
};
const routes = async (fastify, options) => {
  fastify.get("/", (_, rp) => {
    rp.status(200).send({
      intro: `Welcome to the custom FlixHQ provider`,
      routes: [
        "/:query",
        "/search",
        "/info",
        "/watch",
        "/home",
        "/popular-movies",
        "/popular-tv",
        "/top-movies",
        "/top-tv",
        "/upcoming",
        "/servers"
      ],
      documentation: "https://docs.consumet.org/#tag/flixhq"
    });
  });
  fastify.get("/home", async (request, reply) => {
    try {
      let res = import_main.redis ? await import_cache.default.fetch(
        import_main.redis,
        `flixhq:home`,
        async () => await import_flixhqProvider.FlixHQProvider.fetchHome(),
        import_main.REDIS_TTL
      ) : await import_flixhqProvider.FlixHQProvider.fetchHome();
      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({ error: error.message });
    }
  });
  fastify.get("/:query", async (request, reply) => {
    const query = decodeURIComponent(request.params.query);
    const page = request.query.page || 1;
    try {
      let res = import_main.redis ? await import_cache.default.fetch(
        import_main.redis,
        `flixhq:search:${query}:${page}`,
        async () => await import_flixhqProvider.FlixHQProvider.search(query, page),
        import_main.REDIS_TTL
      ) : await import_flixhqProvider.FlixHQProvider.search(query, page);
      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({ error: error.message });
    }
  });
  fastify.post("/search", async (request, reply) => {
    const { query } = request.body;
    const page = 1;
    if (!query) {
      return reply.status(400).send({ error: "Query is required" });
    }
    try {
      let res = import_main.redis ? await import_cache.default.fetch(
        import_main.redis,
        `flixhq:search:${query}:${page}`,
        async () => await import_flixhqProvider.FlixHQProvider.search(query, page),
        import_main.REDIS_TTL
      ) : await import_flixhqProvider.FlixHQProvider.search(query, page);
      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({ error: error.message });
    }
  });
  fastify.get("/popular-movies", async (request, reply) => {
    const page = request.query.page || 1;
    try {
      let res = import_main.redis ? await import_cache.default.fetch(
        import_main.redis,
        `flixhq:popular-movies:${page}`,
        async () => await import_flixhqProvider.FlixHQProvider.fetchPopularMovies(page),
        import_main.REDIS_TTL
      ) : await import_flixhqProvider.FlixHQProvider.fetchPopularMovies(page);
      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({ error: error.message });
    }
  });
  fastify.get("/popular-tv", async (request, reply) => {
    const page = request.query.page || 1;
    try {
      let res = import_main.redis ? await import_cache.default.fetch(
        import_main.redis,
        `flixhq:popular-tv:${page}`,
        async () => await import_flixhqProvider.FlixHQProvider.fetchPopularTv(page),
        import_main.REDIS_TTL
      ) : await import_flixhqProvider.FlixHQProvider.fetchPopularTv(page);
      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({ error: error.message });
    }
  });
  fastify.get("/top-movies", async (request, reply) => {
    const page = request.query.page || 1;
    try {
      let res = import_main.redis ? await import_cache.default.fetch(
        import_main.redis,
        `flixhq:top-movies:${page}`,
        async () => await import_flixhqProvider.FlixHQProvider.fetchTopMovies(page),
        import_main.REDIS_TTL
      ) : await import_flixhqProvider.FlixHQProvider.fetchTopMovies(page);
      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({ error: error.message });
    }
  });
  fastify.get("/top-tv", async (request, reply) => {
    const page = request.query.page || 1;
    try {
      let res = import_main.redis ? await import_cache.default.fetch(
        import_main.redis,
        `flixhq:top-tv:${page}`,
        async () => await import_flixhqProvider.FlixHQProvider.fetchTopTv(page),
        import_main.REDIS_TTL
      ) : await import_flixhqProvider.FlixHQProvider.fetchTopTv(page);
      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({ error: error.message });
    }
  });
  fastify.get("/upcoming", async (request, reply) => {
    const page = request.query.page || 1;
    try {
      let res = import_main.redis ? await import_cache.default.fetch(
        import_main.redis,
        `flixhq:upcoming:${page}`,
        async () => await import_flixhqProvider.FlixHQProvider.fetchUpcoming(page),
        import_main.REDIS_TTL
      ) : await import_flixhqProvider.FlixHQProvider.fetchUpcoming(page);
      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({ error: error.message });
    }
  });
  fastify.get("/info", async (request, reply) => {
    const id = request.query.id;
    if (typeof id === "undefined") {
      return reply.status(400).send({ message: "id is required" });
    }
    try {
      let res = import_main.redis ? await import_cache.default.fetch(
        import_main.redis,
        `flixhq:info:${id}`,
        async () => await import_flixhqProvider.FlixHQProvider.fetchMediaInfo(id),
        import_main.REDIS_TTL
      ) : await import_flixhqProvider.FlixHQProvider.fetchMediaInfo(id);
      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({ error: error.message });
    }
  });
  fastify.get("/servers", async (request, reply) => {
    const episodeId = request.query.episodeId;
    if (typeof episodeId === "undefined") {
      return reply.status(400).send({ message: "episodeId is required" });
    }
    try {
      let res = import_main.redis ? await import_cache.default.fetch(
        import_main.redis,
        `flixhq:servers:${episodeId}`,
        async () => await import_flixhqProvider.FlixHQProvider.fetchServers(episodeId),
        import_main.REDIS_TTL
      ) : await import_flixhqProvider.FlixHQProvider.fetchServers(episodeId);
      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({ error: error.message });
    }
  });
  fastify.get("/watch", async (request, reply) => {
    const episodeId = request.query.episodeId;
    const server = request.query.server || "vidking";
    const serverName = String(server || "").trim().toLowerCase();
    const hasExplicitServer = typeof request.query.server !== "undefined" && serverName !== "auto";
    const strictServer = String(
      request.query.strictServer || ""
    ).toLowerCase() === "true" || hasExplicitServer;
    const allowEmbedFallback = String(
      request.query.allowEmbedFallback || ""
    ).toLowerCase() === "true";
    const extractionTimeoutMs = Number(
      request.query.extractionTimeoutMs
    );
    const requestedExtractionTimeoutMs = Number.isFinite(extractionTimeoutMs) && extractionTimeoutMs > 0 ? extractionTimeoutMs : void 0;
    if (typeof episodeId === "undefined") {
      return reply.status(400).send({ message: "episodeId is required" });
    }
    try {
      const hostHeader = String(request.headers.host || "").trim();
      const protocol = request.protocol;
      console.log("[FlixHQ Watch] Request host:", hostHeader, "protocol:", protocol);
      const watchCacheKey = `flixhq:watch:v24:${episodeId}:${server}:${strictServer ? "strict" : "fallback"}:${allowEmbedFallback ? "embed-ok" : "direct"}:${requestedExtractionTimeoutMs || "default"}`;
      let res = null;
      if (import_main.redis) {
        try {
          res = await import_cache.default.get(import_main.redis, watchCacheKey);
        } catch {
          res = null;
        }
      }
      if (!res) {
        res = await import_flixhqProvider.FlixHQProvider.fetchSources(episodeId, server, strictServer, {
          allowEmbedFallback,
          extractionTimeoutMs: requestedExtractionTimeoutMs
        });
        if (import_main.redis && Array.isArray(res?.sources) && res.sources.length > 0 && !res?.error) {
          import_main.redis.setex(watchCacheKey, import_main.REDIS_TTL, JSON.stringify(res)).catch(() => {
          });
        }
      }
      if (res && res.sources) {
        res.sources = sortAndLimitSources(res.sources).map((source) => ({
          ...source,
          url: String(source?.url || "").trim(),
          requiresProxy: false
        }));
      }
      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({ error: error.message });
    }
  });
};
var flixhq_default = routes;
