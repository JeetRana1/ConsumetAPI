"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fetch = async (redis, key, fetcher, expires) => {
    try {
        const existing = await get(redis, key);
        if (existing !== null)
            return existing;
        return set(redis, key, fetcher, expires);
    }
    catch (err) {
        // Fail-open cache: never break API responses because Redis is unavailable.
        console.warn(`[cache] bypassing redis for ${key}: ${err?.message || err}`);
        return await fetcher();
    }
};
const get = async (redis, key) => {
    console.log('GET: ' + key);
    const value = await redis.get(key);
    if (value === null)
        return null;
    return JSON.parse(value);
};
const set = async (redis, key, fetcher, expires) => {
    console.log(`SET: ${key}, EXP: ${expires}`);
    const value = await fetcher();
    await redis.set(key, JSON.stringify(value), 'EX', expires);
    return value;
};
const del = async (redis, key) => {
    await redis.del(key);
};
exports.default = { fetch, set, get, del };
