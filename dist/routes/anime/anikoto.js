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
  const provider = new import_extensions.ANIME.AniKoto();
  fastify.get("/", async (_request, reply) => {
    reply.send({
      intro: `Welcome to the anikoto provider: check out ${provider.toString.baseUrl}`,
      routes: ["/:query", "/info", "/watch/:episodeId"]
    });
  });
  fastify.get("/:query", async (request, reply) => {
    try {
      reply.send(await provider.search(String(request.params.query), Number(request.query?.page) || 1));
    } catch (error) {
      reply.status(500).send({ message: error?.message || "AniKoto search failed" });
    }
  });
  fastify.get("/info", async (request, reply) => {
    try {
      reply.send(await provider.fetchAnimeInfo(String(request.query?.id || "")));
    } catch (error) {
      reply.status(500).send({ message: error?.message || "AniKoto info failed" });
    }
  });
  fastify.get("/watch/:episodeId", async (request, reply) => {
    try {
      reply.send(await provider.fetchEpisodeSources(String(request.params.episodeId)));
    } catch (error) {
      reply.status(500).send({ message: error?.message || "AniKoto source extraction failed" });
    }
  });
};
var anikoto_default = routes;
