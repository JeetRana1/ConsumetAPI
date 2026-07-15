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
var mangapill_exports = {};
__export(mangapill_exports, {
  default: () => mangapill_default
});
module.exports = __toCommonJS(mangapill_exports);
var import_extensions = require("@consumet/extensions");
var import_provider = require("../../utils/provider");
var import_cache = __toESM(require("../../utils/cache"));
var import_main = require("../../main");
const routes = async (fastify, options) => {
  const mangapill = (0, import_provider.configureProvider)(new import_extensions.MANGA.MangaPill());
  fastify.get("/", (_, rp) => {
    rp.status(200).send({
      intro: `Welcome to the Mangapill provider: check out the provider's website @ ${mangapill.toString.baseUrl}`,
      routes: ["/:query", "/info", "/read"],
      documentation: "https://docs.consumet.org/#tag/mangapill"
    });
  });
  fastify.get("/:query", async (request, reply) => {
    const { query } = request.params;
    try {
      const res = import_main.redis ? await import_cache.default.fetch(
        import_main.redis,
        `mangapill:search:${query}`,
        () => mangapill.search(query),
        import_main.REDIS_TTL
      ) : await mangapill.search(query);
      reply.status(200).send(res);
    } catch {
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
        `mangapill:info:${id}`,
        () => mangapill.fetchMangaInfo(id),
        import_main.REDIS_TTL
      ) : await mangapill.fetchMangaInfo(id);
      reply.status(200).send(res);
    } catch {
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
        `mangapill:read:${chapterId}`,
        () => mangapill.fetchChapterPages(chapterId),
        import_main.REDIS_TTL
      ) : await mangapill.fetchChapterPages(chapterId);
      reply.status(200).send(res);
    } catch {
      reply.status(500).send({
        message: "Something went wrong. Please try again later."
      });
    }
  });
};
var mangapill_default = routes;
