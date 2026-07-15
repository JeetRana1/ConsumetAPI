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
var outboundProxy_exports = {};
__export(outboundProxy_exports, {
  getProxyCandidates: () => getProxyCandidates,
  getProxyCandidatesSync: () => getProxyCandidatesSync,
  proxyGet: () => proxyGet,
  proxyPost: () => proxyPost,
  toAxiosProxyOptions: () => toAxiosProxyOptions
});
module.exports = __toCommonJS(outboundProxy_exports);
var import_axios = __toESM(require("axios"));
var import_socks_proxy_agent = require("socks-proxy-agent");
const splitList = (raw) => {
  if (!raw.trim())
    return [];
  if (raw.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v || "").trim()).filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return raw.split(",").map((v) => v.trim()).filter(Boolean);
};
const FALLBACK_PROXY_LIST_URL = "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt";
let remoteProxyCache = {
  proxies: [],
  expiresAt: 0
};
const normalizeHostPortProxy = (line) => {
  const raw = String(line || "").trim();
  if (!raw)
    return null;
  if (raw.includes("://"))
    return raw;
  if (!/^[^:\s]+:\d+$/.test(raw))
    return null;
  return `http://${raw}`;
};
const parseRemoteProxyBody = (body) => {
  return String(body || "").split(/\r?\n/).map((line) => normalizeHostPortProxy(line)).filter((v) => Boolean(v));
};
const getRemoteProxyList = async () => {
  const now = Date.now();
  if (remoteProxyCache.expiresAt > now && remoteProxyCache.proxies.length > 0) {
    return remoteProxyCache.proxies;
  }
  try {
    const url = String(
      process.env.PUBLIC_PROXY_LIST_URL || FALLBACK_PROXY_LIST_URL
    ).trim();
    const ttlMs = Math.max(
      6e4,
      Number(process.env.PUBLIC_PROXY_CACHE_TTL_MS || 3e5)
    );
    const timeoutMs = Math.max(
      2e3,
      Number(process.env.PUBLIC_PROXY_FETCH_TIMEOUT_MS || 7e3)
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok)
      throw new Error(`public proxy list http ${res.status}`);
    const text = await res.text();
    const parsed = parseRemoteProxyBody(text);
    const max = Math.max(20, Number(process.env.PUBLIC_PROXY_MAX || 200));
    const bounded = parsed.slice(0, max);
    remoteProxyCache = {
      proxies: bounded,
      expiresAt: now + ttlMs
    };
    return bounded;
  } catch {
    return remoteProxyCache.proxies;
  }
};
const getProxyCandidatesSync = () => {
  const envA = splitList(String(process.env.OUTBOUND_PROXIES || ""));
  const envB = splitList(String(process.env.PROXY || ""));
  const merged = [...envA, ...envB].filter(Boolean);
  if (String(process.env.ENABLE_TOR_PROXY || "").toLowerCase() === "true") {
    const torUrl = String(process.env.TOR_PROXY_URL || "socks5h://127.0.0.1:9050").trim();
    if (torUrl)
      merged.push(torUrl);
  }
  return merged.filter((v, i) => merged.indexOf(v) === i);
};
const getProxyCandidates = async () => {
  const merged = [...getProxyCandidatesSync()];
  if (String(process.env.ENABLE_PUBLIC_PROXY_LIST || "").toLowerCase() === "true") {
    const publicPool = await getRemoteProxyList();
    merged.push(...publicPool);
  }
  return merged.filter((v, i) => merged.indexOf(v) === i);
};
const toAxiosProxyOptions = (proxyUrl) => {
  const raw = String(proxyUrl || "").trim();
  if (!raw)
    return {};
  const parsed = new URL(raw);
  const protocol = parsed.protocol.toLowerCase();
  if (protocol.startsWith("socks")) {
    const agent = new import_socks_proxy_agent.SocksProxyAgent(parsed.toString());
    return {
      proxy: false,
      httpAgent: agent,
      httpsAgent: agent
    };
  }
  const port = parsed.port && Number(parsed.port) > 0 ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
  const username = decodeURIComponent(parsed.username || "");
  const password = decodeURIComponent(parsed.password || "");
  return {
    proxy: {
      protocol: parsed.protocol.replace(":", ""),
      host: parsed.hostname,
      port,
      ...username ? { auth: { username, password } } : {}
    }
  };
};
const proxyGet = async (url, config = {}) => {
  const proxies = getProxyCandidatesSync();
  const first = proxies[0];
  if (first) {
    try {
      const proxyOptions = toAxiosProxyOptions(first);
      return await import_axios.default.get(url, { ...config, ...proxyOptions });
    } catch {
    }
  }
  return import_axios.default.get(url, config);
};
const proxyPost = async (url, data, config = {}) => {
  const proxies = getProxyCandidatesSync();
  const first = proxies[0];
  if (first) {
    try {
      const proxyOptions = toAxiosProxyOptions(first);
      return await import_axios.default.post(url, data, { ...config, ...proxyOptions });
    } catch {
    }
  }
  return import_axios.default.post(url, data, config);
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getProxyCandidates,
  getProxyCandidatesSync,
  proxyGet,
  proxyPost,
  toAxiosProxyOptions
});
