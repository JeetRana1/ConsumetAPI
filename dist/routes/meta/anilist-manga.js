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
var anilist_manga_exports = {};
__export(anilist_manga_exports, {
  default: () => anilist_manga_default
});
module.exports = __toCommonJS(anilist_manga_exports);
var import_extensions = require("@consumet/extensions");
var import_provider = require("../../utils/provider");
const routes = async (fastify, options) => {
  fastify.get("/", (_, rp) => {
    const anilist = generateAnilistMangaMeta();
    rp.status(200).send({
      intro: `Welcome to the anilist manga provider: check out the provider's website @ ${anilist.provider.toString().baseUrl || "https://anilist.co/"}`,
      routes: ["/:query", "/info/:id", "/read"],
      documentation: "https://docs.consumet.org/#tag/anilist"
    });
  });
  fastify.get("/:query", async (request, reply) => {
    try {
      const query = request.params.query;
      const anilist = generateAnilistMangaMeta();
      const res = await anilist.search(query);
      reply.status(200).send(res);
    } catch (err) {
      reply.status(200).send({ results: [], message: err.message });
    }
  });
  fastify.get("/info/:id", async (request, reply) => {
    const id = request.params.id;
    const provider = request.query.provider;
    const possibleProvider = provider ? import_extensions.PROVIDERS_LIST.MANGA.find((p) => p.name.toLowerCase() === provider.toLowerCase()) : void 0;
    const anilist = generateAnilistMangaMeta(possibleProvider);
    if (typeof id === "undefined")
      return reply.status(400).send({ message: "id is required" });
    try {
      const res = await anilist.fetchMangaInfo(id);
      reply.status(200).send(res);
    } catch (err) {
      reply.status(500).send({ message: err.message || "Something went wrong." });
    }
  });
  fastify.get("/read", async (request, reply) => {
    const chapterId = request.query.chapterId;
    const provider = request.query.provider;
    const possibleProvider = provider ? import_extensions.PROVIDERS_LIST.MANGA.find((p) => p.name.toLowerCase() === provider.toLowerCase()) : void 0;
    const anilist = generateAnilistMangaMeta(possibleProvider);
    if (typeof chapterId === "undefined")
      return reply.status(400).send({ message: "chapterId is required" });
    try {
      const res = await anilist.fetchChapterPages(chapterId);
      reply.status(200).send(res);
    } catch (err) {
      reply.status(500).send({ message: err.message || "Something went wrong." });
    }
  });
  fastify.get("/chapters/:id", async (request, reply) => {
    const id = request.params.id;
    const provider = request.query.provider;
    const possibleProvider = provider ? import_extensions.PROVIDERS_LIST.MANGA.find((p) => p.name.toLowerCase() === provider.toLowerCase()) : void 0;
    const anilist = generateAnilistMangaMeta(possibleProvider);
    if (typeof id === "undefined")
      return reply.status(400).send({ message: "id is required" });
    try {
      const res = await anilist.fetchChaptersList(id);
      reply.status(200).send(res);
    } catch (err) {
      reply.status(500).send({ message: err.message || "Something went wrong." });
    }
  });
};
const generateAnilistMangaMeta = (provider) => {
  return (0, import_provider.configureProvider)(new import_extensions.META.Anilist.Manga(provider));
};
var anilist_manga_default = routes;
