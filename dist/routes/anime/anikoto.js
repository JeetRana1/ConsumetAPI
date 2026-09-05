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
var anikoto_exports = {};
__export(anikoto_exports, {
  default: () => anikoto_default
});
module.exports = __toCommonJS(anikoto_exports);
var import_extensions = require("@consumet/extensions");
var import_anikotoProvider = require("../../providers/custom/anikotoProvider");
const routes = async (fastify, _options) => {
  const createProvider = () => new import_extensions.ANIME.AniKoto();
  const provider = createProvider();
  const sourceCache = /* @__PURE__ */ new Map();
  const SOURCE_CACHE_TTL_MS = 5 * 60 * 1e3;
  fastify.get("/", async (_request, reply) => reply.send({ provider: "anikoto", baseUrl: provider.toString.baseUrl }));
  fastify.get("/:query", async (request, reply) => {
    try {
      return reply.send(await provider.search(String(request.params.query), Number(request.query?.page) || 1));
    } catch (error) {
      return reply.status(502).send({ message: error?.message || "AniKoto search failed" });
    }
  });
  fastify.get("/info", async (request, reply) => {
    try {
      return reply.send(await provider.fetchAnimeInfo(String(request.query?.id || "")));
    } catch (error) {
      return reply.status(502).send({ message: error?.message || "AniKoto info failed" });
    }
  });
  fastify.get("/watch/:episodeId", async (request, reply) => {
    try {
      const episodeId = String(request.params.episodeId);
      const server = request.query?.server;
      const cacheKey = `${episodeId}|${server || ""}`;
      const cached = sourceCache.get(cacheKey);
      if (cached && cached.expires > Date.now())
        return reply.send(cached.value);
      let result = null;
      try {
        result = await (0, import_anikotoProvider.fetchCurrentAniKotoSources)(episodeId, server);
      } catch (error) {
        request.log.warn({ err: error, episodeId }, "Current AniKoto extraction failed; using extension provider");
      }
      if (result) {
        sourceCache.set(cacheKey, { expires: Date.now() + SOURCE_CACHE_TTL_MS, value: result });
        return reply.send(result);
      }
      try {
        result = await createProvider().fetchEpisodeSources(episodeId, server);
      } catch (firstError) {
        request.log.warn({ err: firstError, episodeId }, "AniKoto watch retry with fresh provider");
        result = await createProvider().fetchEpisodeSources(episodeId, server);
      }
      if (result) {
        sourceCache.set(cacheKey, { expires: Date.now() + SOURCE_CACHE_TTL_MS, value: result });
      }
      return reply.send(result);
    } catch (error) {
      return reply.status(502).send({ message: error?.message || "AniKoto source extraction failed" });
    }
  });
};
var anikoto_default = routes;
