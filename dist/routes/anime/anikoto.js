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
const routes = async (fastify, _options) => {
  const createProvider = () => new import_extensions.ANIME.AniKoto();
  const provider = createProvider();
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
      let result;
      try {
        result = await createProvider().fetchEpisodeSources(episodeId, server);
      } catch (firstError) {
        request.log.warn({ err: firstError, episodeId }, "AniKoto watch retry with fresh provider");
        result = await createProvider().fetchEpisodeSources(episodeId, server);
      }
      const sources = Array.isArray(result?.sources) ? result.sources : Array.isArray(result?.sub?.sources) ? result.sub.sources : null;
      if (sources) {
        const megaplay = sources.filter((source) => /megap\.mikora\.top/i.test(String(source?.url || "")));
        if (megaplay.length) {
          if (Array.isArray(result?.sources))
            result.sources = megaplay;
          else
            result.sub.sources = megaplay;
        }
      }
      return reply.send(result);
    } catch (error) {
      return reply.status(502).send({ message: error?.message || "AniKoto source extraction failed" });
    }
  });
};
var anikoto_default = routes;
