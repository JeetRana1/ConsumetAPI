const DIRECT_MEDIA_REGEX =
  /(https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4|mpd)(?:\?[^\s"'<>]*)?)/gi;

const HLS_PROXY_REGEX = /(https?:\/\/[^\s"'<>]+?\/m3u8-proxy\?[^\s"'<>]+|https?:\/\/[^\s"'<>]+?\/getm3u8\/[^\s"'<>]+)/gi;
const SUBTITLE_REGEX = /(https?:\/\/[^\s"'<>]+?\.(?:vtt|srt|ass)(?:\?[^\s"'<>]*)?)/gi;
const subtitleTextCache = new Map<string, { value: string; expiresAt: number }>();
const SUBTITLE_TEXT_CACHE_MS = 30 * 60 * 1000;

const isDirectMediaUrl = (value: string): boolean => {
  const normalized = String(value || '');
  if (!isUsableMediaUrl(normalized)) return false;
  if (/\.(m3u8|mp4|mpd)(\?|$)/i.test(normalized)) return true;
  if (/\/m3u8-proxy\?/i.test(normalized)) return true;
  if (/m3u8-proxy/i.test(normalized) && /[?&]url=/i.test(normalized)) return true;
  if (/\/getm3u8\//i.test(normalized)) return true;
  return false;
};

const isUsableMediaUrl = (value: string): boolean => {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  if (/^blob:/i.test(normalized)) return false;

  try {
    const parsed = new URL(normalized.startsWith('//') ? `https:${normalized}` : normalized);
    const host = parsed.hostname.toLowerCase();
    if (host === 'example.com' || host.endsWith('.example.com')) return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return false;
    if (host.includes('placeholder') || host.includes('dummy')) return false;
  } catch {
    return false;
  }

  return true;
};

const dropDuplicateHlsVariants = (urls: string[]): string[] => {
  const hasMasterForBase = new Set(
    urls
      .filter((url) => /\/master\.m3u8(?:\?|$)/i.test(url))
      .map((url) => url.replace(/\/master\.m3u8(?:\?.*)?$/i, '')),
  );

  return urls.filter((url) => {
    const base = url.replace(/\/index-[^/]+\.m3u8(?:\?.*)?$/i, '');
    return !hasMasterForBase.has(base) || /\/master\.m3u8(?:\?|$)/i.test(url);
  });
};

const normalizeUrl = (value?: string): string | undefined => {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  if (raw.startsWith('//')) return `https:${raw}`;
  return raw;
};

const getSubtitleCacheKeys = (url: string): string[] => {
  const normalized = normalizeUrl(url);
  if (!normalized) return [];
  const keys = new Set<string>([normalized]);
  try {
    const parsed = new URL(normalized);
    keys.add(`${parsed.origin}${parsed.pathname}`);
  } catch {
    // ignore
  }
  return [...keys];
};

export const getCachedSubtitleText = (url: string): string | undefined => {
  for (const key of getSubtitleCacheKeys(url)) {
    const cached = subtitleTextCache.get(key);
    if (!cached) continue;
    if (cached.expiresAt <= Date.now()) {
      subtitleTextCache.delete(key);
      continue;
    }
    return cached.value;
  }
  return undefined;
};

const setCachedSubtitleText = (url: string, value: string) => {
  if (!value || !getSubtitleCacheKeys(url).length) return;
  for (const key of getSubtitleCacheKeys(url)) {
    subtitleTextCache.set(key, {
      value,
      expiresAt: Date.now() + SUBTITLE_TEXT_CACHE_MS,
    });
  }
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

const parseSubtitlesFromText = (text: string): Array<{ url: string; lang: string; kind?: string; default?: boolean }> => {
  const found = new Map<string, { url: string; lang: string; kind?: string; default?: boolean }>();

  const add = (url?: string, lang?: string, kind?: string, isDefault?: boolean) => {
    const normalized = normalizeUrl(url);
    if (!normalized || !isUsableMediaUrl(normalized)) return;
    if (!/\.(vtt|srt|ass)(\?|$)/i.test(normalized)) return;
    const existing = found.get(normalized);
    if (existing && (!lang || lang === 'Unknown')) return;
    found.set(normalized, {
      url: normalized,
      lang: String(lang || 'Unknown'),
      kind,
      default: Boolean(isDefault),
    });
  };

  try {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.tracks)
        ? parsed.tracks
        : Array.isArray(parsed?.subtitles)
          ? parsed.subtitles
          : [];
    for (const item of list) {
      add(item?.file || item?.url || item?.src, item?.label || item?.lang || item?.language, item?.kind, item?.default);
    }
  } catch {
    // Fall back to regex parsing below.
  }

  let match: RegExpExecArray | null;
  while ((match = SUBTITLE_REGEX.exec(text)) !== null) {
    add(match[1]);
  }

  return [...found.values()];
};

export const extractPlaybackWithPlaywright = async (
  embedUrl: string,
  referer?: string,
  timeoutMs = 12000,
): Promise<{
  sources: Array<{ url: string; quality: string; isM3U8: boolean; isEmbed: false }>;
  subtitles: Array<{ url: string; lang: string; kind?: string; default?: boolean }>;
}> => {
  const normalizedEmbed = normalizeUrl(embedUrl);
  if (!normalizedEmbed) return { sources: [], subtitles: [] };

  let chromium: any;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return { sources: [], subtitles: [] };
  }

  const discovered = new Set<string>();
  const subtitles = new Map<string, { url: string; lang: string; kind?: string; default?: boolean }>();
  let browser: any;
  const timeout = Math.max(4000, timeoutMs);

  const addSubtitles = (items: Array<{ url: string; lang: string; kind?: string; default?: boolean }>) => {
    for (const item of items) subtitles.set(item.url, item);
  };

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
          addSubtitles(parseSubtitlesFromText(String(body || '')));
          if (u && /\.(vtt|srt|ass)(\?|$)/i.test(u) && String(body || '').trim()) {
            setCachedSubtitleText(u, String(body || ''));
          }
        }
      } catch {
        // Ignore individual response parse failures.
      }
    });

    await page.goto(normalizedEmbed, { waitUntil: 'domcontentloaded', timeout });

    // Trigger player/network activity in common embed pages.
    await page.evaluate(() => {
      const clickables = Array.from(
        document.querySelectorAll('#adv, .adblock, .rek, button, .jw-icon-playback, .jw-display-icon-container, .play, .vjs-big-play-button, .vjs-play-control, video'),
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
    }).catch(() => undefined);

    const wantsSubtitles = /[?&]sub\.info=/i.test(normalizedEmbed);
    const startedAt = Date.now();
    while (Date.now() - startedAt < Math.min(4500, Math.max(1800, timeout - 2000))) {
      if (discovered.size > 0 && (!wantsSubtitles || subtitles.size > 0)) break;
      await page.waitForTimeout(250);
    }
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

  const sources = dropDuplicateHlsVariants([...discovered])
    .filter((u) => isDirectMediaUrl(u))
    .sort((a, b) => {
      const score = (url: string) =>
        (/\.m3u8(?:\?|$)/i.test(url) ? 50 : 0) +
        (/\/master\.m3u8(?:\?|$)/i.test(url) || /\/index\.m3u8(?:\?|$)/i.test(url) ? 20 : 0) -
        (/\.mp4(?:\?|$)/i.test(url) ? 10 : 0);
      return score(b) - score(a);
    })
    .map((url) => ({
      url,
      quality: 'auto',
      isM3U8: /\.m3u8(\?|$)/i.test(url) || /\/m3u8-proxy\?/i.test(url) || /\/getm3u8\//i.test(url),
      isEmbed: false as const,
    }));

  return { sources, subtitles: [...subtitles.values()] };
};

export const extractDirectSourcesWithPlaywright = async (
  embedUrl: string,
  referer?: string,
  timeoutMs = 12000,
): Promise<Array<{ url: string; quality: string; isM3U8: boolean; isEmbed: false }>> => {
  const playback = await extractPlaybackWithPlaywright(embedUrl, referer, timeoutMs);
  return playback.sources;
};
