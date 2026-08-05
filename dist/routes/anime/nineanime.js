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
var nineanime_exports = {};
__export(nineanime_exports, {
  default: () => nineanime_default
});
module.exports = __toCommonJS(nineanime_exports);
const BASE_URL = "https://9animez.org";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
const routes = async (fastify, _options) => {
  fastify.get("/watch/:animeId/:episode", async (request, reply) => {
    const params = request.params;
    const episodeId = `${params.animeId}/${params.episode}`.trim();
    if (!episodeId)
      return reply.status(400).send({ message: "episodeId is required" });
    let chromium;
    try {
      ({ chromium } = await import("playwright"));
    } catch {
      return reply.status(503).send({ message: "Playwright is unavailable" });
    }
    const url = `${BASE_URL}/watch/${episodeId}`;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ userAgent: UA });
      let sourcePayload = null;
      page.on("response", async (response) => {
        if (!/\/stream\/getSourcesNew\b/i.test(response.url()))
          return;
        try {
          sourcePayload = await response.json();
        } catch {
        }
      });
      await page.goto(url, { waitUntil: "networkidle", timeout: 3e4 });
      const server = page.locator("button.srv-btn").first();
      if (await server.count())
        await server.click({ force: true });
      await page.waitForTimeout(5e3);
      const source = String(sourcePayload?.sources?.file || "").trim();
      if (!source)
        return reply.status(404).send({ message: "9Anime stream unavailable" });
      return reply.send({
        headers: { Referer: "https://vidtube.site/", Origin: "https://vidtube.site" },
        sources: [{ url: source, isM3U8: /\.m3u8(?:\?|$)/i.test(source), isEmbed: false, quality: "Auto", provider: "nineanime" }],
        subtitles: Array.isArray(sourcePayload?.tracks) ? sourcePayload.tracks.map((track) => ({ url: track.file, lang: track.label, provider: "nineanime" })) : []
      });
    } catch (error) {
      return reply.status(500).send({ message: error?.message || "9Anime extraction failed" });
    } finally {
      await browser.close();
    }
  });
};
var nineanime_default = routes;
