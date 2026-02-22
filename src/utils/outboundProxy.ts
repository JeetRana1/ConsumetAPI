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

export const getProxyCandidates = (): string[] => {
  const envA = splitList(String(process.env.OUTBOUND_PROXIES || ''));
  const envB = splitList(String(process.env.PROXY || ''));
  const merged = [...envA, ...envB].filter(Boolean);

  if (String(process.env.ENABLE_TOR_PROXY || '').toLowerCase() === 'true') {
    const torUrl = String(process.env.TOR_PROXY_URL || 'socks5h://127.0.0.1:9050').trim();
    if (torUrl) merged.push(torUrl);
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

