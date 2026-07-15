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
var getComics_exports = {};
__export(getComics_exports, {
  default: () => getComics_default
});
module.exports = __toCommonJS(getComics_exports);
var import_extensions = require("@consumet/extensions");
var import_cache = __toESM(require("../../utils/cache"));
var import_main = require("../../main");
const routes = async (fastify, options) => {
  const getComics = new import_extensions.COMICS.GetComics();
  fastify.get("/", (_, rp) => {
    rp.status(200).send({
      intro: `Welcome to the getComics provider: check out the provider's website @ ${getComics.toString.baseUrl}`,
      routes: ["/:query"],
      documentation: "https://docs.consumet.org/#tag/getComics"
    });
  });
  fastify.get("/:query", async (request, reply) => {
    const { comicTitle } = request.query;
    const page = request.query.page || 1;
    if (!comicTitle || comicTitle.length < 4)
      return reply.status(400).send({
        message: "length of comicTitle must be > 4 characters",
        error: "short_length"
      });
    try {
      let res = import_main.redis ? await import_cache.default.fetch(
        import_main.redis,
        `getcomics:search:${comicTitle}:${page}`,
        async () => await getComics.search(comicTitle, page),
        import_main.REDIS_TTL
      ) : await getComics.search(comicTitle, page);
      return reply.status(200).send(res);
    } catch (err) {
      return reply.status(500).send({
        message: "Something went wrong. Contact developer for help."
      });
    }
  });
};
var getComics_default = routes;
