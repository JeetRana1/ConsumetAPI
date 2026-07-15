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
var manga_exports = {};
__export(manga_exports, {
  default: () => manga_default
});
module.exports = __toCommonJS(manga_exports);
var import_mangapill = __toESM(require("./mangapill"));
var import_mangadex = __toESM(require("./mangadex"));
var import_mangakakalot = __toESM(require("./mangakakalot"));
var import_mangahere = __toESM(require("./mangahere"));
const routes = async (fastify, options) => {
  const supportedProviders = ["mangadex", "mangahere", "mangapill", "mangakakalot"];
  await fastify.register(import_mangadex.default, { prefix: "/mangadex" });
  await fastify.register(import_mangahere.default, { prefix: "/mangahere" });
  await fastify.register(import_mangapill.default, { prefix: "/mangapill" });
  await fastify.register(import_mangakakalot.default, { prefix: "/mangakakalot" });
  fastify.get("/", async (request, reply) => {
    reply.status(200).send(
      "Welcome to Consumet Manga our available providers are: " + supportedProviders.join(", ")
    );
  });
  fastify.get("/:mangaProvider", async (request, reply) => {
    const mangaProvider = decodeURIComponent(
      request.params.mangaProvider
    );
    try {
      if (supportedProviders.includes(mangaProvider)) {
        reply.redirect(`/manga/${mangaProvider}`);
      } else {
        reply.status(404).send({ message: "Page not found, please check the provider list." });
      }
    } catch (err) {
      reply.status(500).send("Something went wrong. Please try again later.");
    }
  });
};
var manga_default = routes;
