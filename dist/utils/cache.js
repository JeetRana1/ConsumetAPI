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
var cache_exports = {};
__export(cache_exports, {
  default: () => cache_default
});
module.exports = __toCommonJS(cache_exports);
const fetch = async (redis, key, fetcher, expires) => {
  try {
    const existing = await get(redis, key);
    if (existing !== null)
      return existing;
    return set(redis, key, fetcher, expires);
  } catch (err) {
    console.warn(`[cache] bypassing redis for ${key}: ${err?.message || err}`);
    return await fetcher();
  }
};
const get = async (redis, key) => {
  console.log("GET: " + key);
  const value = await redis.get(key);
  if (value === null)
    return null;
  return JSON.parse(value);
};
const set = async (redis, key, fetcher, expires) => {
  console.log(`SET: ${key}, EXP: ${expires}`);
  const value = await fetcher();
  await redis.set(key, JSON.stringify(value), "EX", expires);
  return value;
};
const del = async (redis, key) => {
  await redis.del(key);
};
var cache_default = { fetch, set, get, del };
