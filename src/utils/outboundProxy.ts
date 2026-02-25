import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';

type AxiosProxyValue =
  | false
  | {
    protocol?: string;
    host: string;
    port: number;
    auth?: { username: string; password: string };
  };

type AxiosProxyOptions = {
  proxy?: AxiosProxyValue;
  httpAgent?: any;
  httpsAgent?: any;
};

const splitList = (raw: string): string[] => {
  if (!raw.trim()) return [];
  if (raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v || '').trim()).filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
};

const FALLBACK_PROXY_LIST_URL =
  'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt';

let remoteProxyCache: { proxies: string[]; expiresAt: number } = {
  proxies: [],
  expiresAt: 0,
};

const normalizeHostPortProxy = (line: string): string | null => {
  const raw = String(line || '').trim();
  if (!raw) return null;
  if (raw.includes('://')) return raw;
  if (!/^[^:\s]+:\d+$/.test(raw)) return null;
  return `http://${raw}`;
};

const parseRemoteProxyBody = (body: string): string[] => {
  return String(body || '')
    .split(/\r?\n/)
    .map((line) => normalizeHostPortProxy(line))
    .filter((v): v is string => Boolean(v));
};

const getRemoteProxyList = async (): Promise<string[]> => {
  const now = Date.now();
  if (remoteProxyCache.expiresAt > now && remoteProxyCache.proxies.length > 0) {
    return remoteProxyCache.proxies;
  }

  try {
    const url = String(process.env.PUBLIC_PROXY_LIST_URL || FALLBACK_PROXY_LIST_URL).trim();
    const ttlMs = Math.max(60_000, Number(process.env.PUBLIC_PROXY_CACHE_TTL_MS || 300_000));
    const timeoutMs = Math.max(2_000, Number(process.env.PUBLIC_PROXY_FETCH_TIMEOUT_MS || 7_000));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`public proxy list http ${res.status}`);
    const text = await res.text();
    const parsed = parseRemoteProxyBody(text);

    // Avoid extremely large pools on serverless cold starts.
    const max = Math.max(20, Number(process.env.PUBLIC_PROXY_MAX || 200));
    const bounded = parsed.slice(0, max);

    remoteProxyCache = {
      proxies: bounded,
      expiresAt: now + ttlMs,
    };
    return bounded;
  } catch {
    return remoteProxyCache.proxies;
  }
};

export const getProxyCandidatesSync = (): string[] => {
  const envA = splitList(String(process.env.OUTBOUND_PROXIES || ''));
  const envB = splitList(String(process.env.PROXY || ''));
  const merged = [...envA, ...envB].filter(Boolean);

  if (String(process.env.ENABLE_TOR_PROXY || '').toLowerCase() === 'true') {
    const torUrl = String(process.env.TOR_PROXY_URL || 'socks5h://127.0.0.1:9050').trim();
    if (torUrl) merged.push(torUrl);
  }

  return merged.filter((v, i) => merged.indexOf(v) === i);
};

export const getProxyCandidates = async (): Promise<string[]> => {
  const merged = [...getProxyCandidatesSync()];
  if (String(process.env.ENABLE_PUBLIC_PROXY_LIST || '').toLowerCase() === 'true') {
    const publicPool = await getRemoteProxyList();
    merged.push(...publicPool);
  }
  return merged.filter((v, i) => merged.indexOf(v) === i);
};

export const toAxiosProxyOptions = (proxyUrl?: string): AxiosProxyOptions => {
  const raw = String(proxyUrl || '').trim();
  if (!raw) return {};

  const parsed = new URL(raw);
  const protocol = parsed.protocol.toLowerCase();

  if (protocol.startsWith('socks')) {
    const agent = new SocksProxyAgent(parsed.toString());
    return {
      proxy: false,
      httpAgent: agent,
      httpsAgent: agent,
    };
  }

  const port =
    parsed.port && Number(parsed.port) > 0
      ? Number(parsed.port)
      : parsed.protocol === 'https:'
        ? 443
        : 80;

  const username = decodeURIComponent(parsed.username || '');
  const password = decodeURIComponent(parsed.password || '');

  return {
    proxy: {
      protocol: parsed.protocol.replace(':', ''),
      host: parsed.hostname,
      port,
      ...(username ? { auth: { username, password } } : {}),
    },
  };
};

/**
 * Drop-in replacement for `axios.get` that automatically routes through
 * the first configured proxy (from the OUTBOUND_PROXIES env var).
 * Falls back to a direct connection if no proxy is configured or if the proxy fails.
 */
export const proxyGet = async <T = any>(
  url: string,
  config: import('axios').AxiosRequestConfig = {},
): Promise<import('axios').AxiosResponse<T>> => {
  const proxies = getProxyCandidatesSync();
  const first = proxies[0];

  if (first) {
    try {
      const proxyOptions = toAxiosProxyOptions(first);
      return await axios.get<T>(url, { ...config, ...(proxyOptions as any) });
    } catch {
      // Proxy failed — fall through to direct request.
    }
  }

  return axios.get<T>(url, config);
};
