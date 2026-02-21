type ProviderWithClient = {
  client?: {
    defaults?: {
      timeout?: number;
      headers?: {
        common?: Record<string, string>;
      };
    };
  };
  proxyConfig?: unknown;
};

const parseProxyEnv = (): string | string[] | undefined => {
  const raw = process.env.PROXY?.trim();
  if (!raw) return undefined;

  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        return parsed;
      }
    } catch {
      return undefined;
    }
  }

  return raw;
};

const applyBrowserHeaders = (provider: ProviderWithClient) => {
  const headers = provider.client?.defaults?.headers?.common;
  if (!headers) return;

  headers['User-Agent'] =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  headers['Accept'] =
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8';
  headers['Accept-Language'] = 'en-US,en;q=0.9';
  headers['Accept-Encoding'] = 'gzip, deflate, br';
  headers['Connection'] = 'keep-alive';
  headers['Upgrade-Insecure-Requests'] = '1';
  headers['Sec-Fetch-Dest'] = 'document';
  headers['Sec-Fetch-Mode'] = 'navigate';
  headers['Sec-Fetch-Site'] = 'none';
};

const applyProxyConfig = (provider: ProviderWithClient) => {
  const proxy = parseProxyEnv();
  if (!proxy) return;
  provider.proxyConfig = { url: proxy };
};

const applyTimeoutConfig = (provider: ProviderWithClient) => {
  const defaults = provider.client?.defaults;
  if (!defaults) return;

  const isProduction = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
  const envTimeout = Number(process.env.PROVIDER_FETCH_TIMEOUT_MS || '');
  const timeoutMs = Number.isFinite(envTimeout) && envTimeout > 0
    ? envTimeout
    : (isProduction ? 30000 : 20000);

  defaults.timeout = timeoutMs;
};

export const configureProvider = <T>(provider: T): T => {
  const target = provider as unknown as ProviderWithClient;
  applyBrowserHeaders(target);
  applyProxyConfig(target);
  applyTimeoutConfig(target);
  return provider;
};
