"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetcher = void 0;
const axios_1 = __importDefault(require("axios"));
const https_1 = __importDefault(require("https"));
const FLIXHQ_FETCH_TIMEOUT_MS = Number(process.env.FLIXHQ_FETCH_TIMEOUT_MS || 12000);
const FLIXHQ_FETCH_CACHE_MS = Number(process.env.FLIXHQ_FETCH_CACHE_MS || 15000);
const flixhqAxios = axios_1.default.create({
    timeout: FLIXHQ_FETCH_TIMEOUT_MS,
    httpsAgent: new https_1.default.Agent({
        keepAlive: true,
        maxSockets: 64,
    }),
    validateStatus: () => true,
});
const responseCache = new Map();
const inFlightRequests = new Map();
const getRequestMethod = (config) => String(config.method || 'GET').toUpperCase();
const getCacheKey = (url, config) => {
    const method = getRequestMethod(config);
    const dataPart = typeof config.data === 'string' ? config.data : JSON.stringify(config.data || '');
    return `${method}:${url}:${dataPart}`;
};
/**
 * Custom fetcher for FlixHQ that wraps axios
 * Compatible with CoorenLabs fetcher interface
 */
const fetcher = async (url, _detectCfCache = false, _cachePrefix = 'default', config = {}) => {
    const axiosConfig = {
        ...config,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            ...config.headers,
        },
        timeout: Number(config.timeout || FLIXHQ_FETCH_TIMEOUT_MS),
    };
    const method = getRequestMethod(axiosConfig);
    const shouldUseCache = method === 'GET' && FLIXHQ_FETCH_CACHE_MS > 0;
    const cacheKey = shouldUseCache ? getCacheKey(url, axiosConfig) : '';
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
                text: typeof response.data === 'string'
                    ? response.data
                    : JSON.stringify(response.data),
            };
            if (shouldUseCache && normalized.success) {
                responseCache.set(cacheKey, {
                    expiresAt: Date.now() + FLIXHQ_FETCH_CACHE_MS,
                    value: normalized,
                });
            }
            return normalized;
        }
        catch (error) {
            if (error.response) {
                return {
                    success: false,
                    status: error.response.status,
                    text: typeof error.response.data === 'string'
                        ? error.response.data
                        : JSON.stringify(error.response.data),
                };
            }
            return undefined;
        }
    })();
    if (!shouldUseCache) {
        return await requestPromise;
    }
    inFlightRequests.set(cacheKey, requestPromise);
    try {
        return await requestPromise;
    }
    finally {
        inFlightRequests.delete(cacheKey);
    }
};
exports.fetcher = fetcher;
