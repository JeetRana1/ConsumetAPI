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
var ann_exports = {};
__export(ann_exports, {
  default: () => ann_default
});
module.exports = __toCommonJS(ann_exports);
var import_extensions = require("@consumet/extensions");
const routes = async (fastify, options) => {
  const ann = new import_extensions.NEWS.ANN();
  fastify.get("/", (_, rp) => {
    rp.status(200).send({
      intro: "Welcome to the Anime News Network provider: check out the provider's website @ https://www.animenewsnetwork.com/",
      routes: ["/recent-feeds", "/info"],
      documentation: "https://docs.consumet.org/#tag/animenewsnetwork"
    });
  });
  fastify.get("/recent-feeds", async (req, reply) => {
    let { topic } = req.query;
    try {
      const feeds = await ann.fetchNewsFeeds(topic);
      reply.status(200).send(feeds);
    } catch (e) {
      reply.status(500).send({
        message: e.message
      });
    }
  });
  fastify.get("/info", async (req, reply) => {
    const { id } = req.query;
    if (typeof id === "undefined")
      return reply.status(400).send({
        message: "id is required"
      });
    try {
      const info = await ann.fetchNewsInfo(id);
      reply.status(200).send(info);
    } catch (error) {
      reply.status(500).send({
        message: error.message
      });
    }
  });
};
var ann_default = routes;
