import axios, { AxiosRequestConfig } from 'axios';
import https from 'https';

export type FetchResponse = {
  success: boolean;
  status: number;
  text: string;
};

const FLIXHQ_FETCH_TIMEOUT_MS = Number(process.env.FLIXHQ_FETCH_TIMEOUT_MS || 12000);
const FLIXHQ_FETCH_CACHE_MS = Number(process.env.FLIXHQ_FETCH_CACHE_MS || 15000);

const flixhqAxios = axios.create({
  timeout: FLIXHQ_FETCH_TIMEOUT_MS,
  httpsAgent: new https.Agent({
    keepAlive: true,
    maxSockets: 64,
  }),
  validateStatus: () => true,
});

const responseCache = new Map<string, { expiresAt: number; value: FetchResponse }>();
const inFlightRequests = new Map<string, Promise<FetchResponse | undefined>>();

const getRequestMethod = (config: AxiosRequestConfig): string =>
  String(config.method || 'GET').toUpperCase();

const getCacheKey = (url: string, config: AxiosRequestConfig): string => {
  const method = getRequestMethod(config);
  const dataPart = typeof config.data === 'string' ? config.data : JSON.stringify(config.data || '');
  return `${method}:${url}:${dataPart}`;
};

/**
 * Custom fetcher for FlixHQ that wraps axios
 * Compatible with CoorenLabs fetcher interface
 */
export const fetcher = async (
  url: string,
  _detectCfCache: boolean = false,
  _cachePrefix: string = 'default',
  config: AxiosRequestConfig = {},
): Promise<FetchResponse | undefined> => {
  const axiosConfig: AxiosRequestConfig = {
    ...config,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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

  const requestPromise = (async (): Promise<FetchResponse | undefined> => {
    try {
      const response = await flixhqAxios(url, axiosConfig);

      const normalized: FetchResponse = {
        success: response.status >= 200 && response.status < 300,
        status: response.status,
        text: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
      };

      if (shouldUseCache && normalized.success) {
        responseCache.set(cacheKey, {
          expiresAt: Date.now() + FLIXHQ_FETCH_CACHE_MS,
          value: normalized,
        });
      }

      return normalized;
    } catch (error: any) {
      if (error.response) {
        return {
          success: false,
          status: error.response.status,
          text: typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data),
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
  } finally {
    inFlightRequests.delete(cacheKey);
  }
};
