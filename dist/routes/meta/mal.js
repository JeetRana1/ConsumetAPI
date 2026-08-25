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
var mal_exports = {};
__export(mal_exports, {
  default: () => mal_default
});
module.exports = __toCommonJS(mal_exports);
var import_extensions = require("@consumet/extensions");
var import_provider = require("../../utils/provider");
const routes = async (fastify, options) => {
  fastify.get("/", (_, rp) => {
    rp.status(200).send({
      intro: "Welcome to the mal provider: check out the provider's website @ https://mal.co/",
      routes: ["/:query", "/info/:id", "/watch/:episodeId"],
      documentation: "https://docs.consumet.org/#tag/mal"
    });
  });
  fastify.get("/:query", async (request, reply) => {
    try {
      const query = request.params.query;
      const page = request.query.page;
      const mal = generateMalMeta();
      const res = await mal.search(query, page);
      reply.status(200).send(res);
    } catch (err) {
      reply.status(200).send({ results: [], message: err.message });
    }
  });
  fastify.get("/info/:id", async (request, reply) => {
    const id = request.params.id;
    const provider = request.query.provider;
    let fetchFiller = request.query.fetchFiller;
    let isDub = request.query.dub;
    const possibleProvider = provider ? import_extensions.PROVIDERS_LIST.ANIME.find((p) => p.name.toLowerCase() === provider.toLowerCase()) : void 0;
    const mal = generateMalMeta(possibleProvider);
    isDub = isDub === "true" || isDub === "1";
    fetchFiller = fetchFiller === "true" || fetchFiller === "1";
    try {
      const res = await mal.fetchAnimeInfo(id, isDub, fetchFiller);
      reply.status(200).send(res);
    } catch (err) {
      reply.status(500).send({ message: err.message });
    }
  });
  fastify.get(
    "/watch/:episodeId",
    async (request, reply) => {
      const episodeId = request.params.episodeId;
      const provider = request.query.provider;
      const possibleProvider = provider ? import_extensions.PROVIDERS_LIST.ANIME.find(
        (p) => p.name.toLowerCase() === provider.toLowerCase()
      ) : void 0;
      const mal = generateMalMeta(possibleProvider);
      try {
        const res = await mal.fetchEpisodeSources(episodeId);
        reply.status(200).send(res);
      } catch (err) {
        reply.status(404).send({ message: err.message || err });
      }
    }
  );
};
const generateMalMeta = (provider) => {
  return (0, import_provider.configureProvider)(new import_extensions.META.Myanimelist(provider));
};
var mal_default = routes;
