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
var main_exports = {};
__export(main_exports, {
  REDIS_TTL: () => REDIS_TTL,
  default: () => handler,
  redis: () => redis,
  tmdbApi: () => tmdbApi
});
module.exports = __toCommonJS(main_exports);
var import_fastify = __toESM(require("fastify"));
var import_cors = __toESM(require("@fastify/cors"));
var import_axios = __toESM(require("axios"));
var import_http = __toESM(require("http"));
var import_https = __toESM(require("https"));
var import_outboundProxy = require("./utils/outboundProxy");
var import_books = __toESM(require("./routes/books"));
var import_anime = __toESM(require("./routes/anime"));
var import_manga = __toESM(require("./routes/manga"));
var import_comics = __toESM(require("./routes/comics"));
var import_light_novels = __toESM(require("./routes/light-novels"));
var import_movies = __toESM(require("./routes/movies"));
var import_meta = __toESM(require("./routes/meta"));
var import_news = __toESM(require("./routes/news"));
var import_sports = __toESM(require("./routes/sports"));
var import_ghoulstreams = __toESM(require("./routes/ghoulstreams"));
var import_chalk = __toESM(require("chalk"));
var import_utils = __toESM(require("./utils"));
var import_streamable = require("./utils/streamable");
var import_watchTogether = require("./utils/watchTogether");
require("dotenv").config();
import_axios.default.defaults.httpsAgent = new import_https.default.Agent({ family: 4, keepAlive: true });
import_axios.default.defaults.headers.common["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
import_axios.default.defaults.headers.common["Accept"] = "application/json, text/plain, */*";
const hlsHttpAgent = new import_http.default.Agent({ keepAlive: true, maxSockets: 128, maxFreeSockets: 64 });
const hlsHttpsAgent = new import_https.default.Agent({ keepAlive: true, maxSockets: 128, maxFreeSockets: 64, family: 4 });
const redis = null;
const REDIS_TTL = 3600;
const fastify = (0, import_fastify.default)({
  maxParamLength: 1e3,
  logger: true
});
const tmdbApi = process.env.TMDB_KEY && process.env.TMDB_KEY;
(async () => {
  const PORT = Number(process.env.PORT) || 3e3;
  await fastify.register(import_cors.default, {
    origin: true,
    // Transparently reflect the request origin
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
  });
  fastify.addHook("preSerialization", async (_request, _reply, payload) => {
    return (0, import_streamable.normalizeStreamLinks)(payload);
  });
  if (process.env.NODE_ENV === "DEMO") {
    console.log(import_chalk.default.yellowBright("DEMO MODE ENABLED"));
    const map = /* @__PURE__ */ new Map();
    const sessionDuration = 1e3 * 60 * 60 * 5;
    fastify.addHook("onRequest", async (request, reply) => {
      const ip = request.ip;
      const session = map.get(ip);
      if (session) {
        const { expiresIn } = session;
        const currentTime = /* @__PURE__ */ new Date();
        const sessionTime = new Date(expiresIn);
        if (currentTime.getTime() > sessionTime.getTime()) {
          console.log("session expired");
          map.delete(ip);
          return reply.redirect("/apidemo");
        }
        console.log("session found. expires in", expiresIn);
        if (request.url === "/apidemo")
          return reply.redirect("/");
        return;
      }
      if (request.url === "/apidemo")
        return;
      console.log("session not found");
      reply.redirect("/apidemo");
    });
    fastify.post("/apidemo", async (request, reply) => {
      const { ip } = request;
      const session = map.get(ip);
      if (session)
        return reply.redirect("/");
      const expiresIn = new Date(Date.now() + sessionDuration);
      map.set(ip, { expiresIn });
      reply.redirect("/");
    });
    fastify.get("/apidemo", async (_, reply) => {
      return reply.type("application/json").send({
        message: "Demo access page is disabled in this deployment."
      });
    });
    setInterval(
      () => {
        const currentTime = /* @__PURE__ */ new Date();
        for (const [ip, session] of map.entries()) {
          const { expiresIn } = session;
          const sessionTime = new Date(expiresIn);
          if (currentTime.getTime() > sessionTime.getTime()) {
            console.log("session expired for", ip);
            map.delete(ip);
          }
        }
      },
      1e3 * 60 * 60
    );
  }
  console.log(import_chalk.default.green(`Starting server on port ${PORT}... \u{1F680}`));
  console.log(import_chalk.default.yellowBright("Redis removed. Cache disabled."));
  if (!process.env.TMDB_KEY)
    console.warn(
      import_chalk.default.yellowBright("TMDB api key not found. the TMDB meta route may not work.")
    );
  await fastify.register(import_books.default, { prefix: "/books" });
  await fastify.register(import_anime.default, { prefix: "/anime" });
  await fastify.register(import_manga.default, { prefix: "/manga" });
  await fastify.register(import_comics.default, { prefix: "/comics" });
  await fastify.register(import_light_novels.default, { prefix: "/light-novels" });
  await fastify.register(import_movies.default, { prefix: "/movies" });
  await fastify.register(import_meta.default, { prefix: "/meta" });
  await fastify.register(import_news.default, { prefix: "/news" });
  await fastify.register(import_sports.default, { prefix: "/sports" });
  await fastify.register(import_ghoulstreams.default);
  await fastify.register(import_utils.default, { prefix: "/utils" });
  (0, import_watchTogether.registerWatchTogether)(fastify);
  const appendQueryParam = (path, key, value) => {
    const safeValue = String(value || "").trim();
    if (!safeValue)
      return path;
    const joiner = path.includes("?") ? "&" : "?";
    return `${path}${joiner}${encodeURIComponent(key)}=${encodeURIComponent(safeValue)}`;
  };
  const appendRefererParam = (path, referer) => {
    const safeReferer = String(referer || "").trim();
    return appendQueryParam(path, "referer", safeReferer);
  };
  const buildProxyPath = (targetUrl, referer, isSegment = false, baseUrl) => {
    const raw = String(targetUrl || "").trim();
    if (!raw)
      return raw;
    if (/^\/proxy\/hls\//i.test(raw)) {
      const path = appendRefererParam(raw, referer);
      return baseUrl ? `${baseUrl}${path}` : path;
    }
    try {
      const parsed = new URL(raw);
      let path = `/proxy/hls/${parsed.host}${parsed.pathname}${parsed.search}`;
      path = appendRefererParam(path, referer);
      path = appendQueryParam(path, "segment", isSegment ? "1" : "");
      return baseUrl ? `${baseUrl}${path}` : path;
    } catch {
      return raw;
    }
  };
  const rewriteHlsManifest = (manifest, manifestUrl, referer, baseUrl) => {
    const resolveAndProxy = (value, isSegment = false) => {
      const trimmed = String(value || "").trim();
      if (!trimmed)
        return trimmed;
      try {
        const upstreamReferer = manifestUrl || referer;
        return buildProxyPath(
          new URL(trimmed, manifestUrl).toString(),
          upstreamReferer,
          isSegment,
          baseUrl
        );
      } catch {
        return trimmed;
      }
    };
    let output = String(manifest || "");
    output = output.replace(
      /URI="([^"]+)"/g,
      (_match, uri) => `URI="${resolveAndProxy(uri)}"`
    );
    output = output.replace(
      /URI='([^']+)'/g,
      (_match, uri) => `URI='${resolveAndProxy(uri)}'`
    );
    let previousTag = "";
    output = output.split("\n").map((line) => {
      const trimmed = line.trim();
      if (!trimmed)
        return line;
      if (trimmed.startsWith("#")) {
        previousTag = trimmed;
        return line;
      }
      if (/^(data:|blob:)/i.test(trimmed))
        return line;
      const isSegment = /^#EXTINF\b/i.test(previousTag);
      previousTag = "";
      return resolveAndProxy(trimmed, isSegment);
    }).join("\n");
    return output;
  };
  const isLikelyHlsManifest = (body, contentType) => {
    const text = String(body || "").trim();
    if (!text)
      return false;
    if (/application\/(vnd\.apple\.mpegurl|x-mpegURL)|audio\/x-mpegurl/i.test(
      String(contentType || "")
    )) {
      return true;
    }
    return /^#EXTM3U\b/m.test(text);
  };
  const shouldTreatAsManifestRequest = (url, incomingRange) => {
    if (/\.m3u8(?:$|\?)/i.test(url))
      return true;
    if (incomingRange)
      return false;
    if (/(?:ok\.ru|okcdn\.ru)\/.*\/video\//i.test(url))
      return true;
    return /\/(?:hls|oppai)\//i.test(url);
  };
  const fetchHlsResource = async (url, isManifest, incomingRange, referer, cookieHeader) => {
    const isAnimeSaltCdn = /^https?:\/\/(?:as-cdn\d+|z\d+)\.(?:top|ac|pro|xyz|click|link|net|cc|org)\//i.test(url);
    const proxyCandidates = isAnimeSaltCdn ? [""] : [...(0, import_outboundProxy.getProxyCandidatesSync)(), ""];
    let lastError = null;
    const effectiveReferer = (() => {
      const safeReferer = String(referer || "").trim();
      if (!safeReferer)
        return safeReferer;
      const isAnimeSaltSiteReferer = /^https?:\/\/animesalt\.(?:ac|pro|xyz|click)(?:\/|$)/i.test(safeReferer);
      if (isAnimeSaltCdn && isAnimeSaltSiteReferer) {
        return "";
      }
      return safeReferer;
    })();
    for (const proxyUrl of proxyCandidates) {
      try {
        const proxyOptions = proxyUrl ? (0, import_outboundProxy.toAxiosProxyOptions)(proxyUrl) : {};
        const upstreamOrigin = (() => {
          try {
            return new URL(effectiveReferer).origin;
          } catch {
            return "";
          }
        })();
        const response = await import_axios.default.get(url, {
          headers: {
            Referer: effectiveReferer || "https://streameeeeee.site/",
            ...upstreamOrigin ? { Origin: upstreamOrigin } : {},
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            ...cookieHeader ? { Cookie: cookieHeader } : {},
            ...incomingRange ? { Range: incomingRange } : {},
            ...isManifest ? {} : { Accept: "video/mp2t,video/mp4,application/octet-stream,*/*" },
            ...isManifest ? {} : { "Accept-Encoding": "identity" }
          },
          timeout: 15e3,
          responseType: isManifest ? "text" : "arraybuffer",
          validateStatus: (status) => status < 500,
          ...proxyOptions
        });
        const responseContentType = String(response.headers["content-type"] || "");
        if (isManifest && !isLikelyHlsManifest(String(response.data || ""), responseContentType)) {
          lastError = new Error(`Invalid HLS manifest response (${response.status})`);
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("HLS proxy failed");
  };
  fastify.get("/proxy/hls/*", async (request, reply) => {
    const rawRequestUrl = String(request.url || "");
    const [rawPath, rawQuery = ""] = rawRequestUrl.split("?");
    const wildcardPath = rawPath.replace(/^\/proxy\/hls\//i, "").trim();
    const refererParam = String(
      new URLSearchParams(rawQuery).get("referer") || ""
    ).trim();
    const cookieParam = String(new URLSearchParams(rawQuery).get("cookie") || "").trim();
    const segmentParam = String(new URLSearchParams(rawQuery).get("segment") || "").trim() === "1";
    const passthroughQuery = rawQuery.split("&").filter((part) => part && !/^(referer|segment|cookie)=/i.test(part)).join("&");
    const url = `https://${wildcardPath}${passthroughQuery ? `?${passthroughQuery}` : ""}`;
    const incomingRange = String(request.headers.range || "");
    const isManifest = !segmentParam && shouldTreatAsManifestRequest(url, incomingRange);
    const incomingReferer = String(
      request.headers.referer || request.headers.referrer || ""
    ).trim().replace(/#.*$/, "");
    const requestReferer = (refererParam || incomingReferer || "https://streameeeeee.site/").replace(/#.*$/, "");
    if (isManifest && !incomingRange) {
      try {
        const { getCachedHlsManifest } = await import("./utils/browserRuntimeExtractor");
        const cached = getCachedHlsManifest(url);
        if (cached) {
          const content = rewriteHlsManifest(cached.body, url, requestReferer, `${request.protocol}://${request.headers.host || "localhost:3000"}`);
          reply.header("Content-Type", cached.contentType || "application/vnd.apple.mpegurl");
          reply.header("Access-Control-Allow-Origin", "*");
          reply.header("Cache-Control", "public, max-age=60");
          return reply.send(content);
        }
      } catch {
      }
    }
    try {
      const response = await fetchHlsResource(
        url,
        isManifest,
        incomingRange,
        requestReferer,
        cookieParam
      );
      const responseContentType = String(response.headers["content-type"] || "");
      const responseBuffer = Buffer.isBuffer(response.data) ? response.data : response.data instanceof ArrayBuffer ? Buffer.from(response.data) : ArrayBuffer.isView(response.data) ? Buffer.from(
        response.data.buffer,
        response.data.byteOffset,
        response.data.byteLength
      ) : null;
      const responseText = responseBuffer ? responseBuffer.toString("utf8") : String(response.data || "");
      const isKeyResponse = /\/keys\/key\.bin(?:$|\?)/i.test(url);
      const responseIsManifest = isManifest || isLikelyHlsManifest(responseText, responseContentType);
      if (responseIsManifest) {
        const hostHeader = request.headers.host || "localhost:3000";
        const protocol = request.headers["x-forwarded-proto"] || request.protocol || "https";
        const baseUrl = `${protocol}://${hostHeader}`;
        const content = rewriteHlsManifest(responseText, url, requestReferer, baseUrl);
        reply.header("Content-Type", "application/vnd.apple.mpegurl");
        reply.header("Access-Control-Allow-Origin", "*");
        reply.header(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization, Range"
        );
        reply.header("Access-Control-Allow-Methods", "GET, OPTIONS");
        return reply.send(content);
      }
      if (!responseIsManifest) {
        if (isKeyResponse && responseBuffer) {
          const trimmedKey = responseText.replace(/\s+/g, "");
          if (/^[A-Za-z0-9+/=]+$/.test(trimmedKey) && trimmedKey.length >= 24) {
            try {
              const decodedKey = Buffer.from(trimmedKey, "base64");
              if (decodedKey.length >= 16 && decodedKey.length < responseBuffer.length) {
                reply.header("Access-Control-Allow-Origin", "*");
                reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Range");
                reply.header("Access-Control-Allow-Methods", "GET, OPTIONS");
                reply.header("Content-Type", "application/octet-stream");
                reply.header("Content-Length", decodedKey.length);
                return reply.send(decodedKey);
              }
            } catch {
            }
          }
        }
        try {
          const upstreamUrl = new URL(url);
          const isHttps = upstreamUrl.protocol === "https:";
          const transport = isHttps ? import_https.default : import_http.default;
          const agent = isHttps ? hlsHttpsAgent : hlsHttpAgent;
          const segmentReq = transport.request(
            {
              hostname: upstreamUrl.hostname,
              port: upstreamUrl.port || (isHttps ? 443 : 80),
              path: upstreamUrl.pathname + upstreamUrl.search,
              method: "GET",
              agent,
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                Referer: requestReferer,
                ...incomingRange ? { Range: incomingRange } : {},
                ...cookieParam ? { Cookie: cookieParam } : {},
                Accept: "video/mp2t,video/mp4,application/octet-stream,*/*",
                "Accept-Encoding": "identity"
              }
            },
            (upstreamRes) => {
              const resHeaders = {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type, Authorization, Range",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Content-Type": upstreamRes.headers["content-type"] || "application/octet-stream"
              };
              if (upstreamRes.headers["content-length"])
                resHeaders["Content-Length"] = upstreamRes.headers["content-length"];
              if (upstreamRes.headers["content-range"])
                resHeaders["Content-Range"] = upstreamRes.headers["content-range"];
              if (upstreamRes.headers["accept-ranges"])
                resHeaders["Accept-Ranges"] = upstreamRes.headers["accept-ranges"];
              reply.raw.writeHead(upstreamRes.statusCode || 200, resHeaders);
              upstreamRes.pipe(reply.raw);
            }
          );
          segmentReq.on("error", (err) => {
            console.error("HLS segment stream error:", err.message);
            if (!reply.sent) {
              reply.raw.writeHead(500, { "Content-Type": "application/json" });
              reply.raw.end(JSON.stringify({ error: "Segment proxy failed" }));
            }
          });
          segmentReq.end();
          return reply;
        } catch (err) {
          console.error("HLS segment stream error:", err.message);
          return reply.status(500).send({ error: "Segment proxy failed" });
        }
      }
      return reply.status(500).send({ error: "Unexpected proxy state" });
    } catch (error) {
      console.error("HLS Proxy error:", error.message);
      return reply.status(500).send({ error: "Proxy failed" });
    }
  });
  try {
    fastify.get("/", (_, rp) => {
      rp.status(200).send(
        `Welcome to consumet api! \u{1F389} 
${process.env.NODE_ENV === "DEMO" ? "This is a demo of the api. You should only use this for testing purposes." : ""}`
      );
    });
    fastify.get("*", (request, reply) => {
      reply.status(404).send({
        message: "",
        error: "page not found"
      });
    });
    const shouldUsePortFallback = String(process.env.ALLOW_PORT_FALLBACK || "false").toLowerCase() === "true";
    const startServer = async (initialPort, maxRetries = 5) => {
      if (!shouldUsePortFallback) {
        const address = await fastify.listen({ port: initialPort, host: "0.0.0.0" });
        console.log(`server listening on ${address}`);
        return;
      }
      for (let retry = 0; retry <= maxRetries; retry++) {
        const candidatePort = initialPort + retry;
        try {
          const address = await fastify.listen({ port: candidatePort, host: "0.0.0.0" });
          if (retry > 0) {
            console.warn(
              import_chalk.default.yellowBright(
                `Port ${initialPort} is busy. Started on fallback port ${candidatePort} instead.`
              )
            );
          }
          console.log(`server listening on ${address}`);
          return;
        } catch (error) {
          const isPortConflict = error?.code === "EADDRINUSE";
          if (!isPortConflict || retry === maxRetries) {
            throw error;
          }
        }
      }
    };
    await startServer(PORT);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
})();
async function handler(req, res) {
  await fastify.ready();
  fastify.server.emit("request", req, res);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  REDIS_TTL,
  redis,
  tmdbApi
});
