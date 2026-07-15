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
var flixhqFetcher_exports = {};
__export(flixhqFetcher_exports, {
  fetcher: () => fetcher
});
module.exports = __toCommonJS(flixhqFetcher_exports);
var import_axios = __toESM(require("axios"));
var import_https = __toESM(require("https"));
const FLIXHQ_FETCH_TIMEOUT_MS = Number(process.env.FLIXHQ_FETCH_TIMEOUT_MS || 12e3);
const FLIXHQ_FETCH_CACHE_MS = Number(process.env.FLIXHQ_FETCH_CACHE_MS || 15e3);
const flixhqAxios = import_axios.default.create({
  timeout: FLIXHQ_FETCH_TIMEOUT_MS,
  httpsAgent: new import_https.default.Agent({
    keepAlive: true,
    maxSockets: 64
  }),
  validateStatus: () => true
});
const responseCache = /* @__PURE__ */ new Map();
const inFlightRequests = /* @__PURE__ */ new Map();
const getRequestMethod = (config) => String(config.method || "GET").toUpperCase();
const getCacheKey = (url, config) => {
  const method = getRequestMethod(config);
  const dataPart = typeof config.data === "string" ? config.data : JSON.stringify(config.data || "");
  return `${method}:${url}:${dataPart}`;
};
const fetcher = async (url, _detectCfCache = false, _cachePrefix = "default", config = {}) => {
  const axiosConfig = {
    ...config,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      ...config.headers
    },
    timeout: Number(config.timeout || FLIXHQ_FETCH_TIMEOUT_MS)
  };
  const method = getRequestMethod(axiosConfig);
  const shouldUseCache = method === "GET" && FLIXHQ_FETCH_CACHE_MS > 0;
  const cacheKey = shouldUseCache ? getCacheKey(url, axiosConfig) : "";
  if (shouldUseCache) {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    responseCache.delete(cacheKey);
    const existingRequest = inFlightRequests.get(cacheKey);
    if (existingRequest) {
      return await existingRequest;
    }
  }
  const requestPromise = (async () => {
    try {
      const response = await flixhqAxios(url, axiosConfig);
      const normalized = {
        success: response.status >= 200 && response.status < 300,
        status: response.status,
        text: typeof response.data === "string" ? response.data : JSON.stringify(response.data)
      };
      if (shouldUseCache && normalized.success) {
        responseCache.set(cacheKey, {
          expiresAt: Date.now() + FLIXHQ_FETCH_CACHE_MS,
          value: normalized
        });
      }
      return normalized;
    } catch (error) {
      if (error.response) {
        return {
          success: false,
          status: error.response.status,
          text: typeof error.response.data === "string" ? error.response.data : JSON.stringify(error.response.data)
        };
      }
      return void 0;
    }
  })();
  if (!shouldUseCache) {
    return await requestPromise;
  }
  inFlightRequests.set(cacheKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  fetcher
});
