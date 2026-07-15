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
var comics_exports = {};
__export(comics_exports, {
  default: () => comics_default
});
module.exports = __toCommonJS(comics_exports);
var import_getComics = __toESM(require("./getComics"));
const routes = async (fastify, options) => {
  await fastify.register(import_getComics.default, { prefix: "/getcomics" });
  fastify.get("/", async (request, reply) => {
    reply.status(200).send("Welcome to Consumet Comics \u{1F9B8}\u200D\u2642\uFE0F");
  });
  fastify.get("/s", async (request, reply) => {
    const { comicTitle, page } = request.query;
    reply.status(300).redirect(`getcomics/s?comicTitle=${comicTitle}&page=${page}`);
  });
};
var comics_default = routes;
