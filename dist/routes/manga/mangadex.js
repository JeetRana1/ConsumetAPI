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
var mangadex_exports = {};
__export(mangadex_exports, {
  default: () => mangadex_default
});
module.exports = __toCommonJS(mangadex_exports);
var import_extensions = require("@consumet/extensions");
var import_provider = require("../../utils/provider");
var import_cache = __toESM(require("../../utils/cache"));
var import_main = require("../../main");
const routes = async (fastify, options) => {
  const mangadex = (0, import_provider.configureProvider)(new import_extensions.MANGA.MangaDex());
  const fetchChapterPagesWithFallback = async (chapterId) => {
    return await mangadex.fetchChapterPages(chapterId);
  };
  fastify.get("/", (_, rp) => {
    rp.status(200).send({
      intro: `Welcome to the mangadex provider: check out the provider's website @ ${mangadex.toString.baseUrl}`,
      routes: ["/:query", "/info/:id", "/read/:chapterId"],
      documentation: "https://docs.consumet.org/#tag/mangadex"
    });
  });
  fastify.get("/:query", async (request, reply) => {
    const { query } = request.params;
    const { page } = request.query;
    try {
      const res = import_main.redis ? await import_cache.default.fetch(
        import_main.redis,
        `mangadex:search:${query}:${page ?? 1}`,
        () => mangadex.search(query, page),
        import_main.REDIS_TTL
      ) : await mangadex.search(query, page);
      reply.status(200).send(res);
    } catch (err) {
      reply.status(500).send({
        message: "Something went wrong. Please try again later."
      });
    }
  });
  fastify.get("/info/:id", async (request, reply) => {
    const id = decodeURIComponent(request.params.id);
    try {
      const res = import_main.redis ? await import_cache.default.fetch(
        import_main.redis,
        `mangadex:info:${id}`,
        () => mangadex.fetchMangaInfo(id),
        import_main.REDIS_TTL
      ) : await mangadex.fetchMangaInfo(id);
      reply.status(200).send(res);
    } catch (err) {
      reply.status(500).send({
        message: "Something went wrong. Please try again later."
      });
    }
  });
  fastify.get(
    "/read/:chapterId",
    async (request, reply) => {
      const { chapterId } = request.params;
      try {
        const res = import_main.redis ? await import_cache.default.fetch(
          import_main.redis,
          `mangadex:read:${chapterId}`,
          () => fetchChapterPagesWithFallback(chapterId),
          import_main.REDIS_TTL
        ) : await fetchChapterPagesWithFallback(chapterId);
        reply.status(200).send(res);
      } catch (err) {
        console.log("Error reading chapter:", chapterId, err);
        reply.status(500).send({
          message: "Something went wrong. Please try again later."
        });
      }
    }
  );
};
var mangadex_default = routes;
