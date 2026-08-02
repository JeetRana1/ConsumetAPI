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
var hdstream4u_exports = {};
__export(hdstream4u_exports, {
  default: () => hdstream4u_default
});
module.exports = __toCommonJS(hdstream4u_exports);
var import_hdstream4uProvider = require("../../providers/custom/hdstream4uProvider");
const sourceCache = /* @__PURE__ */ new Map();
const SOURCE_CACHE_TTL_MS = 5 * 60 * 1e3;
const routes = async (fastify, options) => {
  fastify.get("/", (_, rp) => {
    rp.status(200).send({
      intro: "HDStream4u / HDHub4u provider",
      routes: ["/search", "/info", "/watch"]
    });
  });
  fastify.get("/search", async (request, reply) => {
    const { query, page } = request.query;
    if (!query)
      return reply.status(400).send({ error: "query is required" });
    const res = await import_hdstream4uProvider.HdStream4uProvider.search(query, page || 1);
    reply.status(200).send(res);
  });
  fastify.get("/info", async (request, reply) => {
    const { id, type } = request.query;
    if (!id)
      return reply.status(400).send({ error: "id is required" });
    const res = await import_hdstream4uProvider.HdStream4uProvider.fetchMediaInfo(id, type || "movie");
    reply.status(200).send(res);
  });
  fastify.get("/watch", async (request, reply) => {
    const { episodeId, server, mediaId } = request.query;
    if (!episodeId)
      return reply.status(400).send({ error: "episodeId is required" });
    const cacheKey = `${episodeId}|${server || ""}|${mediaId || ""}`;
    const cached = sourceCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return reply.status(200).send(cached.value);
    }
    let res = await import_hdstream4uProvider.HdStream4uProvider.fetchSources(episodeId, server, false, { mediaId });
    if (!res?.sources?.length) {
      res = await import_hdstream4uProvider.HdStream4uProvider.fetchSources(episodeId, server, false, { mediaId });
    }
    const hasShortLivedHls = res?.sources?.some(
      (source) => Boolean(source?.isM3U8 || source?.isM3u8 || /\.m3u8(?:[?#]|$)/i.test(String(source?.url || "")))
    );
    if (res?.sources?.length && !hasShortLivedHls) {
      sourceCache.set(cacheKey, { expires: Date.now() + SOURCE_CACHE_TTL_MS, value: res });
    }
    reply.status(200).send(res);
  });
};
var hdstream4u_default = routes;
