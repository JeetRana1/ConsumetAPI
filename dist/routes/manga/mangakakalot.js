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
var mangakakalot_exports = {};
__export(mangakakalot_exports, {
  default: () => mangakakalot_default
});
module.exports = __toCommonJS(mangakakalot_exports);
var import_extensions = require("@consumet/extensions");
var import_provider = require("../../utils/provider");
var import_cache = __toESM(require("../../utils/cache"));
var import_main = require("../../main");
const routes = async (fastify, options) => {
  const mangakakalot = (0, import_provider.configureProvider)(new import_extensions.MANGA.MangaKakalot());
  const mangapill = (0, import_provider.configureProvider)(new import_extensions.MANGA.MangaPill());
  const mangahere = (0, import_provider.configureProvider)(new import_extensions.MANGA.MangaHere());
  const fromCache = async (key, fn) => {
    return import_main.redis ? await import_cache.default.fetch(import_main.redis, key, fn, import_main.REDIS_TTL) : await fn();
  };
  const tryMany = async (fns) => {
    let lastErr = null;
    for (const fn of fns) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("All provider fallbacks failed");
  };
  fastify.get("/", (_, rp) => {
    rp.status(200).send({
      intro: `Welcome to the Mangakakalot provider (with fallbacks): check out the provider's website @ ${mangakakalot.toString.baseUrl}`,
      routes: {
        "/:query": {
          description: "Search for manga by title",
          example: "/manga/mangakakalot/naruto?page=1"
        },
        "/info": {
          description: "Get manga details by id",
          example: "/manga/mangakakalot/info?id=naruto"
        },
        "/read": {
          description: "Get chapter pages/images by chapterId",
          example: "/manga/mangakakalot/read?chapterId=naruto/chapter-700-5"
        },
        "/latestmanga": {
          description: "Get latest updates",
          example: "/manga/mangakakalot/latestmanga?page=1"
        },
        "/suggestions": {
          description: "Get autocomplete suggestions while typing",
          example: "/manga/mangakakalot/suggestions?query=one piece"
        },
        "/bygenre": {
          description: "Get manga filtered by genre",
          example: "/manga/mangakakalot/bygenre?genre=action&page=1"
        }
      },
      documentation: "https://docs.consumet.org/#tag/mangakakalot"
    });
  });
  fastify.get("/info", async (request, reply) => {
    const id = request.query.id;
    if (!id) {
      return reply.status(400).send({
        message: "id is required"
      });
    }
    try {
      const res = await tryMany([
        () => fromCache(`mangakakalot:info:${id}`, () => mangakakalot.fetchMangaInfo(id)),
        () => fromCache(
          `mangakakalot:fallback:mangapill:info:${id}`,
          () => mangapill.fetchMangaInfo(id)
        ),
        () => fromCache(
          `mangakakalot:fallback:mangahere:info:${id}`,
          () => mangahere.fetchMangaInfo(id)
        )
      ]);
      reply.status(200).send(res);
    } catch {
      reply.status(500).send({
        message: "Failed to fetch manga info from all fallback providers."
      });
    }
  });
  fastify.get("/read", async (request, reply) => {
    const chapterId = request.query.chapterId;
    if (!chapterId) {
      return reply.status(400).send({
        message: "chapterId is required"
      });
    }
    try {
      const res = await tryMany([
        () => fromCache(
          `mangakakalot:read:${chapterId}`,
          () => mangakakalot.fetchChapterPages(chapterId)
        ),
        () => fromCache(
          `mangakakalot:fallback:mangapill:read:${chapterId}`,
          () => mangapill.fetchChapterPages(chapterId)
        ),
        () => fromCache(
          `mangakakalot:fallback:mangahere:read:${chapterId}`,
          () => mangahere.fetchChapterPages(chapterId)
        )
      ]);
      reply.status(200).send(res);
    } catch {
      reply.status(500).send({
        message: "Failed to fetch chapter pages from all fallback providers."
      });
    }
  });
  fastify.get("/latestmanga", async (request, reply) => {
    const page = request.query.page || 1;
    const mh = mangahere;
    const mp = mangapill;
    try {
      const res = await tryMany([
        () => fromCache(
          `mangakakalot:latestmanga:${page}`,
          () => mangakakalot.fetchLatestUpdates(page)
        ),
        () => fromCache(`mangakakalot:fallback:mangahere:latestmanga:${page}`, async () => {
          if (typeof mh.fetchLatestUpdates === "function")
            return await mh.fetchLatestUpdates(page);
          return await mangahere.search("one piece", page);
        }),
        () => fromCache(`mangakakalot:fallback:mangapill:latestmanga:${page}`, async () => {
          if (typeof mp.fetchLatestUpdates === "function")
            return await mp.fetchLatestUpdates(page);
          return await mangapill.search("one piece");
        })
      ]);
      reply.status(200).send(res);
    } catch {
      reply.status(500).send({
        message: "Failed to fetch latest manga updates from all fallback providers."
      });
    }
  });
  fastify.get("/bygenre", async (request, reply) => {
    const genre = request.query.genre;
    const page = request.query.page || 1;
    if (!genre) {
      return reply.status(400).send({ message: "genre is required" });
    }
    try {
      const res = await tryMany([
        () => fromCache(
          `mangakakalot:bygenre:${genre}:${page}`,
          () => mangakakalot.fetchByGenre(genre, page)
        ),
        () => fromCache(
          `mangakakalot:fallback:mangahere:bygenre:${genre}:${page}`,
          () => mangahere.search(genre, page)
        ),
        () => fromCache(
          `mangakakalot:fallback:mangapill:bygenre:${genre}:${page}`,
          () => mangapill.search(genre)
        )
      ]);
      reply.status(200).send(res);
    } catch {
      reply.status(500).send({
        message: "Failed to fetch by genre from all fallback providers."
      });
    }
  });
  fastify.get("/suggestions", async (request, reply) => {
    const query = request.query.query;
    const mp = mangapill;
    if (!query) {
      return reply.status(400).send({ message: "query is required" });
    }
    try {
      const res = await tryMany([
        () => fromCache(
          `mangakakalot:suggestions:${query}`,
          () => mangakakalot.fetchSuggestions(query)
        ),
        () => fromCache(`mangakakalot:fallback:mangapill:suggestions:${query}`, async () => {
          if (typeof mp.fetchSuggestions === "function")
            return await mp.fetchSuggestions(query);
          return await mangapill.search(query);
        }),
        () => fromCache(
          `mangakakalot:fallback:mangahere:suggestions:${query}`,
          () => mangahere.search(query, 1)
        )
      ]);
      reply.status(200).send(res);
    } catch {
      reply.status(500).send({
        message: "Failed to fetch suggestions from all fallback providers."
      });
    }
  });
  fastify.get("/:query", async (request, reply) => {
    const { query } = request.params;
    const page = request.query.page || 1;
    const ensureSearchShape = (payload) => {
      if (!payload)
        return null;
      if (Array.isArray(payload))
        return { currentPage: String(page), hasNextPage: false, results: payload };
      if (Array.isArray(payload?.results))
        return payload;
      if (Array.isArray(payload?.data?.results)) {
        return { ...payload, results: payload.data.results };
      }
      if (Array.isArray(payload?.data)) {
        return { currentPage: String(page), hasNextPage: false, results: payload.data };
      }
      return null;
    };
    const safe = async (fn) => {
      try {
        return ensureSearchShape(await fn());
      } catch {
        return null;
      }
    };
    try {
      const fromPill = await safe(() => mangapill.search(query));
      if (fromPill)
        return reply.status(200).send(fromPill);
      const fromHere = await safe(() => mangahere.search(query, page));
      if (fromHere)
        return reply.status(200).send(fromHere);
      const fromKakalot = await safe(() => mangakakalot.search(query, page));
      if (fromKakalot)
        return reply.status(200).send(fromKakalot);
      return reply.status(200).send({
        currentPage: String(page),
        hasNextPage: false,
        results: []
      });
    } catch {
      return reply.status(200).send({
        currentPage: String(page),
        hasNextPage: false,
        results: []
      });
    }
  });
};
var mangakakalot_default = routes;
