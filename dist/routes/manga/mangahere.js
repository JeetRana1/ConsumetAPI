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
var mangahere_exports = {};
__export(mangahere_exports, {
  default: () => mangahere_default
});
module.exports = __toCommonJS(mangahere_exports);
var import_extensions = require("@consumet/extensions");
var import_provider = require("../../utils/provider");
var import_cache = __toESM(require("../../utils/cache"));
var import_main = require("../../main");
const routes = async (fastify, options) => {
  const mangahere = (0, import_provider.configureProvider)(new import_extensions.MANGA.MangaHere());
  fastify.get("/", (_, rp) => {
    rp.status(200).send({
      intro: `Welcome to the MangaHere provider: check out the provider's website @ ${mangahere.toString.baseUrl}`,
      routes: ["/:query", "/info", "/read"],
      documentation: "https://docs.consumet.org/#tag/mangahere"
    });
  });
  fastify.get("/:query", async (request, reply) => {
    const { query } = request.params;
    const { page } = request.query;
    try {
      const res = import_main.redis ? await import_cache.default.fetch(
        import_main.redis,
        `mangahere:search:${query}:${page ?? 1}`,
        () => mangahere.search(query, page),
        import_main.REDIS_TTL
      ) : await mangahere.search(query, page);
      reply.status(200).send(res);
    } catch (err) {
      reply.status(500).send({
        message: "Something went wrong. Please try again later."
      });
    }
  });
  fastify.get("/info", async (request, reply) => {
    const id = request.query.id;
    if (!id)
      return reply.status(400).send({ message: "id is required" });
    try {
      const res = import_main.redis ? await import_cache.default.fetch(
        import_main.redis,
        `mangahere:info:${id}`,
        () => mangahere.fetchMangaInfo(id),
        import_main.REDIS_TTL
      ) : await mangahere.fetchMangaInfo(id);
      reply.status(200).send(res);
    } catch (err) {
      reply.status(500).send({
        message: "Something went wrong. Please try again later."
      });
    }
  });
  fastify.get("/read", async (request, reply) => {
    const chapterId = request.query.chapterId;
    if (!chapterId)
      return reply.status(400).send({ message: "chapterId is required" });
    try {
      const res = import_main.redis ? await import_cache.default.fetch(
        import_main.redis,
        `mangahere:read:${chapterId}`,
        () => mangahere.fetchChapterPages(chapterId),
        import_main.REDIS_TTL
      ) : await mangahere.fetchChapterPages(chapterId);
      reply.status(200).send(res);
    } catch (err) {
      reply.status(500).send({
        message: "Something went wrong. Please try again later."
      });
    }
  });
};
var mangahere_default = routes;
