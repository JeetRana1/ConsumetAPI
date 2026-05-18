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

  const discovered = new Map<string, string>();
  const subtitles = new Map<string, { url: string; lang: string; kind?: string; default?: boolean }>();
  let browser: any;
  const timeout = Math.max(4000, timeoutMs);
  const isVidkingEmbed = /vidking/i.test(normalizedEmbed);
  const isVideasyEmbed = /videasy/i.test(normalizedEmbed);
  const wantsSubtitles = /[?&]sub\.info=/i.test(normalizedEmbed);
  let activeMirrorLabel = '';

  const addDiscovered = (url?: string, label?: string) => {
    const normalized = normalizeUrl(url);
    if (!normalized || !isDirectMediaUrl(normalized)) return;
    const cleanLabel = String(label || activeMirrorLabel || '').trim();
    if (!discovered.has(normalized) || cleanLabel) discovered.set(normalized, cleanLabel);
  };

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
      addDiscovered(request.url());
    });

    page.on('response', async (response: any) => {
      try {
        const u = normalizeUrl(response.url());
        addDiscovered(u);

        const headers = response.headers() || {};
        const contentType = String(headers['content-type'] || '').toLowerCase();
        if (contentType.includes('json') || contentType.includes('javascript') || contentType.includes('text')) {
          const body = await response.text();
          for (const parsed of parseUrlsFromText(String(body || ''))) addDiscovered(parsed);
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
    if (!isVidkingEmbed && !isVideasyEmbed) await page.evaluate(() => {
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

    if (isVidkingEmbed || isVideasyEmbed) {
      const mirrors = ['Hydrogen', 'Lithium', 'Helium', 'Oxygen'];
      for (const mirror of mirrors) {
        activeMirrorLabel = mirror;
        await page
          .evaluate((target: string) => {
            const norm = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
            const wanted = norm(target);
            const candidates = Array.from(
              document.querySelectorAll('button, [role="button"], [aria-label], [title], .server, .source, .server-item, .source-item, a, li, div'),
            ) as HTMLElement[];
            const ranked = candidates
              .map((el) => {
                const text = norm(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '');
                const rect = el.getBoundingClientRect();
                return { el, text, area: Math.max(1, rect.width * rect.height) };
              })
              .filter(({ text, area }) => {
                if (!text || area <= 1) return false;
                if (text === wanted) return true;
                return text.includes(wanted) && text.length <= wanted.length + 24;
              })
              .sort((a, b) => {
                const exactDelta = Number(b.text === wanted) - Number(a.text === wanted);
                if (exactDelta) return exactDelta;
                return a.text.length - b.text.length || a.area - b.area;
              });
            const hit = ranked[0]?.el;
            if (!hit) return false;
            const text = norm(hit.innerText || hit.textContent || hit.getAttribute('aria-label') || hit.getAttribute('title') || '');
            if (!text.includes(wanted)) return false;
            hit.scrollIntoView({ block: 'center', inline: 'center' });
            hit.click();
            return true;
          }, mirror)
          .catch(() => false);
        await page.waitForTimeout(isVideasyEmbed ? 2500 : 1600).catch(() => undefined);
        if (discovered.size > 0 && (!wantsSubtitles || subtitles.size > 0)) break;
      }
      activeMirrorLabel = '';
    }

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

  const sourceEntries = dropDuplicateHlsVariants([...discovered.keys()])
    .filter((u) => isDirectMediaUrl(u))
    .sort((a, b) => {
      const score = (url: string) => {
        const label = String(discovered.get(url) || '').toLowerCase();
        return (
          (/\.m3u8(?:\?|$)/i.test(url) ? 80 : 0) +
          (/\/master\.m3u8(?:\?|$)/i.test(url) ? 25 : 0) +
          (/\/index\.m3u8(?:\?|$)/i.test(url) ? 15 : 0) +
          (/\.mp4(?:\?|$)/i.test(url) ? 20 : 0) +
          (/hydrogen/.test(label) ? 35 : 0) +
          (/lithium/.test(label) ? 30 : 0) +
          (/helium/.test(label) ? 15 : 0) -
          (/oxygen/.test(label) ? 40 : 0)
        );
      };
      return score(b) - score(a);
    });

  const sources = sourceEntries
    .map((url) => ({
      url,
      quality: discovered.get(url) ? `auto (${discovered.get(url)})` : 'auto',
      server: discovered.get(url) || undefined,
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
