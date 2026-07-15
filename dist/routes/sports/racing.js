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
var racing_exports = {};
__export(racing_exports, {
  default: () => racing_default
});
module.exports = __toCommonJS(racing_exports);
var import_racing = require("../../providers/sports/racing");
var import_main = require("../../main");
var import_cache = __toESM(require("../../utils/cache"));
const routes = async (fastify, options) => {
  const racing = new import_racing.Racing();
  fastify.get("/", (_, rp) => {
    rp.status(200).send({
      intro: "Welcome to the Racing sports provider",
      routes: ["/:query", "/info", "/watch"]
    });
  });
  fastify.get("/:query", async (request, reply) => {
    const query = decodeURIComponent(request.params.query);
    const forceRefresh = String(
      request.query.forceRefresh || ""
    ).toLowerCase() === "true";
    try {
      const cacheKey = `sports:racing:search:${query}:${forceRefresh ? "force" : "cache"}`;
      let res = import_main.redis && !forceRefresh ? await import_cache.default.fetch(
        import_main.redis,
        cacheKey,
        async () => await racing.search(query),
        import_main.REDIS_TTL
      ) : await racing.fetchCatalogLatest({ query, forceRefresh });
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
      reply.header(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate"
      );
      reply.header("Pragma", "no-cache");
      reply.header("Expires", "0");
      const res = await racing.fetchMediaInfo(id);
      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({ error: error.message });
    }
  });
  fastify.get("/watch", async (request, reply) => {
    const episodeId = request.query.episodeId;
    if (typeof episodeId === "undefined") {
      return reply.status(400).send({ message: "episodeId is required" });
    }
    try {
      let res = import_main.redis ? await import_cache.default.fetch(
        import_main.redis,
        `sports:racing:watch:${episodeId}`,
        async () => await racing.fetchEpisodeSources(episodeId),
        import_main.REDIS_TTL
      ) : await racing.fetchEpisodeSources(episodeId);
      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({ error: error.message });
    }
  });
};
var racing_default = routes;
