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
var buffstreams_exports = {};
__export(buffstreams_exports, {
  default: () => buffstreams_default
});
module.exports = __toCommonJS(buffstreams_exports);
var import_buffstreams = require("../../providers/sports/buffstreams");
const routes = async (fastify, options) => {
  const buffstreams = new import_buffstreams.BuffStreams();
  fastify.get("/", (_, rp) => {
    rp.status(200).send({
      intro: "Welcome to the BuffStreams sports provider",
      routes: ["/:query", "/info", "/watch"]
    });
  });
  fastify.get("/:query", async (request, reply) => {
    const query = decodeURIComponent(request.params.query);
    const date = request.query.date;
    try {
      let res = await buffstreams.search(query, { date });
      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({ error: error.message });
    }
  });
  fastify.get("/info", async (request, reply) => {
    const id = request.query.id;
    if (typeof id === "undefined") {
      return reply.status(400).send({ message: "id is required" });
    }
    try {
      reply.header(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate"
      );
      reply.header("Pragma", "no-cache");
      reply.header("Expires", "0");
      const res = await buffstreams.fetchMediaInfo(id);
      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({ error: error.message });
    }
  });
  fastify.get("/watch", async (request, reply) => {
    const episodeId = request.query.episodeId;
    if (typeof episodeId === "undefined") {
      return reply.status(400).send({ message: "episodeId is required" });
    }
    try {
      let res = await buffstreams.fetchEpisodeSources(episodeId);
      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({ error: error.message });
    }
  });
  fastify.get("/livesport", async (request, reply) => {
    const title = request.query.title;
    const sport = request.query.sport || "soccer";
    if (typeof title === "undefined") {
      return reply.status(400).send({ message: "title is required" });
    }
    try {
      const { LiveSportHelper } = await import("../../providers/sports/livesport-helper");
      const axios = (await import("axios")).default;
      const client = axios.create();
      const res = await LiveSportHelper.getLiveStats(client, title, sport);
      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({ error: error.message });
    }
  });
  fastify.get("/directory", async (request, reply) => {
    try {
      const { LiveSportHelper } = await import("../../providers/sports/livesport-helper");
      const axios = (await import("axios")).default;
      const client = axios.create();
      const res = await LiveSportHelper.getGlobalDirectory(client);
      reply.status(200).send(res);
    } catch (error) {
      reply.status(500).send({ error: error.message });
    }
  });
};
var buffstreams_default = routes;
