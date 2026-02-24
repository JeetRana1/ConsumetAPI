const DIRECT_MEDIA_REGEX =
  /(https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4|mpd)(?:\?[^\s"'<>]*)?)/gi;

const HLS_PROXY_REGEX = /(https?:\/\/[^\s"'<>]+?\/m3u8-proxy\?[^\s"'<>]+)/gi;

const isDirectMediaUrl = (value: string): boolean => {
  const normalized = String(value || '');
  if (/\.(m3u8|mp4|mpd)(\?|$)/i.test(normalized)) return true;
  if (/\/m3u8-proxy\?/i.test(normalized)) return true;
  if (/m3u8-proxy/i.test(normalized) && /[?&]url=/i.test(normalized)) return true;
  return false;
};

const normalizeUrl = (value?: string): string | undefined => {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  if (raw.startsWith('//')) return `https:${raw}`;
  return raw;
};

const parseUrlsFromText = (text: string): string[] => {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = DIRECT_MEDIA_REGEX.exec(text)) !== null) {
    const url = normalizeUrl(match[1]);
    if (url && isDirectMediaUrl(url)) found.add(url);
  }

  while ((match = HLS_PROXY_REGEX.exec(text)) !== null) {
    const url = normalizeUrl(match[1]);
    if (url && isDirectMediaUrl(url)) found.add(url);
  }

  return [...found];
};

export const extractDirectSourcesWithPlaywright = async (
  embedUrl: string,
  referer?: string,
  timeoutMs = 12000,
): Promise<Array<{ url: string; quality: string; isM3U8: boolean; isEmbed: false }>> => {
  const normalizedEmbed = normalizeUrl(embedUrl);
  if (!normalizedEmbed) return [];

  let chromium: any;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return [];
  }

  const discovered = new Set<string>();
  let browser: any;
  const timeout = Math.max(4000, timeoutMs);

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({
      extraHTTPHeaders: referer ? { Referer: referer } : undefined,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    page.on('request', (request: any) => {
      const u = normalizeUrl(request.url());
      if (u && isDirectMediaUrl(u)) discovered.add(u);
    });

    page.on('response', async (response: any) => {
      try {
        const u = normalizeUrl(response.url());
        if (u && isDirectMediaUrl(u)) discovered.add(u);

        const headers = response.headers() || {};
        const contentType = String(headers['content-type'] || '').toLowerCase();
        if (contentType.includes('json') || contentType.includes('javascript') || contentType.includes('text')) {
          const body = await response.text();
          for (const parsed of parseUrlsFromText(String(body || ''))) discovered.add(parsed);
        }
      } catch {
        // Ignore individual response parse failures.
      }
    });

    await page.goto(normalizedEmbed, { waitUntil: 'domcontentloaded', timeout });

    // Trigger player/network activity in common embed pages.
    await page.evaluate(() => {
      const clickables = Array.from(
        document.querySelectorAll('button, .jw-icon-playback, .jw-display-icon-container, .play, .vjs-big-play-button'),
      ) as HTMLElement[];
      for (const el of clickables) {
        try {
          el.click();
        } catch {
          // ignore
        }
      }

      const video = document.querySelector('video') as HTMLVideoElement | null;
      if (video) {
        video.muted = true;
        video.play().catch(() => undefined);
      }
    });

    await page.waitForTimeout(Math.min(7000, Math.max(2500, timeout - 2000)));
    await context.close();
  } catch {
    // Swallow browser failures and return empty set.
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
  }

  return [...discovered]
    .filter((u) => isDirectMediaUrl(u))
    .map((url) => ({
      url,
      quality: 'auto',
      isM3U8: /\.m3u8(\?|$)/i.test(url) || /\/m3u8-proxy\?/i.test(url),
      isEmbed: false as const,
    }));
};
