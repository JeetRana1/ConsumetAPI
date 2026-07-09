import * as cheerio from 'cheerio';
import { MovieParser } from '@consumet/extensions/dist/models';
import { TvType, IMovieInfo, ISource, IEpisodeServer } from '@consumet/extensions';

type StreamHint = {
  requestUrl?: string;
  mediaUrl?: string;
  referer?: string;
  userAgent?: string;
  origin?: string;
};

type ExtractedSource = {
  url: string;
  isM3U8: boolean;
  quality: string;
  server: string;
};

export class Racing extends MovieParser {
  override readonly name = 'Racing';
  override readonly baseUrl =
    process.env.RACING_MEDIA_BASE_URL || 'https://fullraces.com';
  override readonly logo = 'https://fullraces.com/images/logo.png';
  override readonly classPath = 'SPORTS.Racing';
  override readonly supportedTypes = new Set([TvType.MOVIE, TvType.TVSERIES]);

  readonly catalogPath = process.env.RACING_MEDIA_CATALOG_PATH || '/';

  private catalogCache: Record<string, { data: any[]; timestamp: number }> = {};
  private readonly CACHE_TTL_MS = 60000;

  private sourcesCache: Record<string, { data: ISource; timestamp: number }> = {};
  private readonly SOURCES_TTL_MS = 300000;
  private readonly REQUEST_TIMEOUT_MS = 4000;
  private readonly MAX_PAGES = 12;
  private readonly ARCHIVE_STOP_YEAR = 2025;

  async fetchCatalogLatest({ query = '', forceRefresh = false } = {}): Promise<any[]> {
    const now = Date.now();
    const cacheKey = this.getCatalogCacheKey(query);
    const cached = this.catalogCache[cacheKey];
    if (!forceRefresh && cached && now - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const categoryPath = this.resolveCategoryPath(query);
      const results: any[] = [];
      const seen = new Set<string>();
      let pageUrl = this.buildCatalogPageUrl(categoryPath, 1);

      const isGeneralPage = categoryPath === '/' || categoryPath === this.catalogPath;

      for (let page = 1; page <= this.MAX_PAGES && pageUrl; page += 1) {
        const url = pageUrl;
        let html = '';
        try {
          const response = await this.client.get(url, {
            headers: this.buildBrowserHeaders(url),
            timeout: this.REQUEST_TIMEOUT_MS,
            responseType: 'text',
            transformResponse: [(data) => data],
            decompress: true,
          });
          html = this.precleanHtml(String(response.data || ''));
        } catch (err: any) {
          if (err.response?.status === 404) {
            break;
          }
          console.warn(
            `[racing] Error fetching page ${page} of ${categoryPath}:`,
            err.message,
          );
          break;
        }

        const { items: pageItems } = this.parseCatalogPage(
          html,
          isGeneralPage ? query : '',
        );
        if (!pageItems.length) break;

        for (const item of pageItems) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          results.push(item);
        }

        pageUrl = this.extractNextPageUrl(html, url, page + 1, categoryPath);
      }

      this.catalogCache[cacheKey] = { data: results, timestamp: now };
      return results;
    } catch (error) {
      console.error('[racing] Error fetching catalog:', error);
      return this.catalogCache[cacheKey]?.data || [];
    }
  }

  private getCatalogCacheKey(query: string): string {
    return `racing:catalog:${this.normalizeQuery(query) || 'all'}`;
  }

  private resolveCategoryPath(query: string): string {
    const wanted = this.normalizeQuery(query);
    const mapping: Record<string, string> = {
      indycar: '/indycar',
      nascar: '/nascar',
      formula1: '/formula1-replays',
      f1: '/formula1-replays',
      formula: '/formula1-replays',
      'formula-1': '/formula1-replays',
      motogp: '/motogp',
      wec: '/wec',
      rally: '/wrc',
      wrc: '/wrc',
      wsbk: '/wsbk',
      formula2: '/f2-full-races',
      'formula-2': '/f2-full-races',
      f2: '/f2-full-races',
      formula3: '/f3-full-races',
      'formula-3': '/f3-full-races',
      f3: '/f3-full-races',
      'formula-e': '/formula-e',
      formulae: '/formula-e',
      fe: '/formula-e',
      'f1-academy': '/f1-academy',
      f1academy: '/f1-academy',
    };

    if (wanted && mapping[wanted]) return mapping[wanted];
    if (wanted) {
      const slug = wanted
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      return `/${slug}`;
    }
    return this.catalogPath || '/';
  }

  private buildCatalogPageUrl(categoryPath: string, page = 1): string {
    const normalizedPath = categoryPath.startsWith('/')
      ? categoryPath
      : `/${categoryPath}`;
    const cleanBase = this.baseUrl.replace(/\/+$/, '');
    const cleanPath = normalizedPath === '/' ? '' : normalizedPath.replace(/\/+$/, '');
    if (page <= 1) return `${cleanBase}${cleanPath || '/'}`;
    return `${cleanBase}${cleanPath || '/'}${cleanPath.includes('?') ? '&' : '?'}page${page}`;
  }

  private extractNextPageUrl(
    html: string,
    currentUrl: string,
    expectedPage: number,
    categoryPath: string,
  ): string {
    const $ = cheerio.load(html);
    const candidates: string[] = [];

    $('a[rel="next"], .nav-links a, .pagination a, a.page-numbers').each((_, el) => {
      const href = $(el).attr('href');
      if (href) candidates.push(this.sanitizeUrl(href));
    });

    for (const href of candidates) {
      const normalized = this.normalizeUrl(href);
      if (!normalized || normalized === currentUrl) continue;
      if (
        /[?&]page\d+\b/i.test(normalized) ||
        /[?&]page=\d+\b/i.test(normalized) ||
        /\/page\/\d+/i.test(normalized)
      ) {
        return normalized;
      }
    }

    return this.buildCatalogPageUrl(categoryPath, expectedPage);
  }

  private parseCatalogPage(
    html: string,
    query = '',
  ): { items: any[]; hasCurrentYear: boolean } {
    const $ = cheerio.load(html);
    const wanted = this.normalizeQuery(query);
    const items: any[] = [];
    let hasCurrentYear = false;
    const currentYear = new Date().getFullYear();

    $(
      '.short_item, .post-item, .card, article, [data-provider-card], .post, .grid-item, .elementor-post, .wp-block-post',
    ).each((_, el) => {
      const root = $(el);
      const dateText = this.extractCardDateText(root);
      const year = this.extractYearFromDateText(dateText);
      if (year !== null && year >= currentYear) hasCurrentYear = true;

      let title =
        root.find('h3, h2, h1, h4, .entry-title, .post-title, a[title]').first().text() ||
        root.find('a').first().text() ||
        '';
      title = title.trim().replace(/\s+/g, ' ');
      if (!title) return;

      let id = root.find('a').first().attr('href') || '';
      id = this.normalizeUrlPath(id);
      if (!id) return;

      const image = this.normalizeUrl(
        root.find('img').first().attr('src') ||
          root.find('img').first().attr('data-src') ||
          '',
      );
      const category = (
        root
          .find('.short_cat, .category, .tag, .term, .series, .label, [data-category]')
          .first()
          .text() || ''
      )
        .trim()
        .replace(/\s+/g, ' ');
      const duration = (
        root.find('.duration, .runtime, .time, time').first().text() || ''
      )
        .trim()
        .replace(/\s+/g, ' ');

      if (wanted && !`${title} ${category}`.toLowerCase().includes(wanted)) return;

      items.push({
        id,
        title,
        image,
        thumbnail: image,
        category: category || 'Racing',
        duration,
        publishedAt: dateText,
        year: year ?? undefined,
        sources: [],
      });
    });

    return { items, hasCurrentYear };
  }

  override async search(query: string): Promise<any[]> {
    return this.fetchCatalogLatest({ query });
  }

  override async fetchMediaInfo(mediaId: string): Promise<IMovieInfo> {
    for (const cached of Object.values(this.catalogCache)) {
      const cachedItem = cached.data.find((item) => item.id === mediaId);
      if (cachedItem) {
        return {
          id: mediaId,
          title: cachedItem.title,
          url: this.normalizeUrl(mediaId),
        } as IMovieInfo;
      }
    }

    const url = this.normalizeUrl(mediaId);
    try {
      const response = await this.client.get(url, {
        headers: this.buildBrowserHeaders(url),
        timeout: this.REQUEST_TIMEOUT_MS,
        responseType: 'text',
        transformResponse: [(data) => data],
        decompress: true,
      });
      const list = this.parseCatalogPage(
        this.precleanHtml(String(response.data || '')),
      ).items;
      return {
        id: mediaId,
        title: list[0]?.title || 'Racing Event',
        url,
      } as IMovieInfo;
    } catch {
      return {
        id: mediaId,
        title: 'Racing Event',
        url,
      } as IMovieInfo;
    }
  }

  private detectRaceCategory(episodeId: string, pageTitle = ''): string {
    const signals = `${episodeId} ${pageTitle}`.toLowerCase();
    if (/\bf1\b|formula.?1|formula.?one/.test(signals)) return 'F1';
    if (/nascar/.test(signals)) return 'NASCAR';
    if (/indycar|indy.?500/.test(signals)) return 'IndyCar';
    if (/motogp|moto.?gp/.test(signals)) return 'MotoGP';
    if (/wec|endurance/.test(signals)) return 'WEC';
    if (/rally|wrc/.test(signals)) return 'Rally';
    return 'Racing';
  }

  private getPriorityServers(category: string): RegExp[] {
    const fallback: RegExp[] = [
      /ok\.?\s*f1tv.*1080|1080.*ok\.?\s*f1tv/i,
      /ok\.?\s*f1tv/i,
      /server\s*#?1\s*\(ok\)/i,
      /server\s*#?1/i,
      /ok\.?ru.*1080|1080.*ok\.?ru/i,
      /ok\.?ru/i,
      /adaptive|master|hls|mp4/i,
    ];

    switch (category) {
      case 'F1':
        return [/ok\.?\s*f1tv.*1080|1080.*ok\.?\s*f1tv/i, /ok\.?\s*f1tv/i, ...fallback];
      case 'NASCAR':
      case 'IndyCar':
        return [/server\s*#?1\s*\(ok\)/i, /server\s*#?1/i, ...fallback];
      default:
        return fallback;
    }
  }

  private resolveServerLabel(rawLabel: string, pattern: RegExp): string {
    const src = pattern.source.toLowerCase();
    if (/f1tv.*1080|1080.*f1tv/.test(src)) return 'OK. F1TV (1080p)';
    if (/f1tv/.test(src)) return 'OK. F1TV (1080p)';
    if (/server.*1.*ok|ok.*server.*1/.test(src)) return 'Server #1 (OK)';
    if (/server.*1/.test(src)) return 'Server #1';
    if (/ok\.ru/.test(src)) return 'OK.RU 1080p';
    return rawLabel.replace(/\s+/g, ' ').trim() || 'Premium Priority Stream Server';
  }

  override async fetchEpisodeSources(episodeId: string): Promise<ISource> {
    const now = Date.now();
    const cached = this.sourcesCache[episodeId];
    if (cached && now - cached.timestamp < this.SOURCES_TTL_MS) {
      return cached.data;
    }

    const pageUrl = this.normalizeUrl(episodeId);

    try {
      const requestHeaders = this.buildBrowserHeaders(pageUrl);
      const response = await this.client.get(pageUrl, {
        headers: requestHeaders,
        timeout: this.REQUEST_TIMEOUT_MS,
        responseType: 'text',
        transformResponse: [(data) => data],
        decompress: true,
      });

      const html = this.truncateMainDocument(
        this.precleanHtml(String(response.data || '')),
      );
      const embedUrl = this.extractEmbeddedIframeUrlFast(html, pageUrl);

      let extractedSource: ExtractedSource | null = null;

      if (!embedUrl) {
        const parentHint = this.extractStreamHintFast(html, pageUrl);
        if (!parentHint) {
          console.log(`[racing] No stream hint found for: ${pageUrl}`);
          return { sources: [] } as ISource;
        }

        extractedSource = await this.resolveStreamHint(parentHint, pageUrl);
        if (!extractedSource) {
          console.log(`[racing] Failed to resolve stream hint for: ${pageUrl}`);
          return { sources: [] } as ISource;
        }
      } else {
        const iframeHtml = await this.fetchIframeDocument(embedUrl, pageUrl);
        if (!iframeHtml) {
          console.log(`[racing] Failed to fetch iframe document: ${embedUrl}`);
          return { sources: [] } as ISource;
        }

        extractedSource = this.extractStreamSourceFromEmbed(
          iframeHtml,
          embedUrl,
          pageUrl,
        );
        if (!extractedSource) {
          console.log(`[racing] No stream source found in embed: ${embedUrl}`);
          return { sources: [] } as ISource;
        }
      }

      const result: ISource = {
        sources: [extractedSource],
        headers: this.buildBrowserHeaders(pageUrl),
      } as ISource;

      this.sourcesCache[episodeId] = { data: result, timestamp: now };
      return result;
    } catch (error: any) {
      console.error(`[racing] fetchEpisodeSources error for ${pageUrl}:`, error.message);
      return { sources: [] } as ISource;
    }
  }

  override async fetchEpisodeServers(_: string): Promise<IEpisodeServer[]> {
    return [];
  }

  private extractStreamHint(html: string, pageUrl: string): StreamHint | null {
    const decoded = this.decodeHtmlEntities(String(html || ''));
    const scriptBlocks = decoded.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
    const blobs = [decoded, ...scriptBlocks];

    for (const blob of blobs) {
      const manifest = this.extractManifestUrlFast(blob);
      if (manifest) {
        return {
          mediaUrl: manifest,
          referer: pageUrl,
          userAgent: this.defaultUserAgent(),
        };
      }

      const flashvars = this.extractNamedValue(
        blob,
        /(?:flashvars|data-options|playerConfig|videoConfig|sourceConfig)\s*[:=]\s*(['"])([\s\S]*?)\1/i,
      );
      if (flashvars) {
        const hinted = this.extractUrlFromStringFast(flashvars);
        if (hinted)
          return {
            requestUrl: hinted,
            referer: pageUrl,
            userAgent: this.defaultUserAgent(),
          };
      }

      const urlBridge =
        this.extractNamedValue(
          blob,
          /(?:file|src|source|manifest|streamUrl|hls|m3u8|mp4)\s*[:=]\s*(['"])(https?:\/\/[^'"]+)\1/i,
        ) || this.extractUrlFromStringFast(blob);
      if (urlBridge) {
        return {
          requestUrl: urlBridge,
          referer: pageUrl,
          userAgent: this.defaultUserAgent(),
        };
      }
    }

    return null;
  }

  private extractEmbeddedIframeUrl(html: string, pageUrl: string): string {
    const decoded = this.decodeHtmlEntities(String(html || ''));
    const $ = cheerio.load(decoded);
    const candidates: string[] = [];

    $('iframe[src], frame[src]').each((_, el) => {
      const src = this.normalizeUrl(this.sanitizeUrl($(el).attr('src') || ''));
      if (src) candidates.push(src);
    });

    const iframeRegexes = [
      /<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi,
      /<frame\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi,
    ];

    for (const regex of iframeRegexes) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(decoded))) {
        const src = this.normalizeUrl(this.sanitizeUrl(match[1]));
        if (src) candidates.push(src);
      }
    }

    const priority = this.getPriorityEmbedPatterns();
    for (const candidate of candidates) {
      if (this.isLikelyEmbedUrl(candidate, pageUrl, priority)) return candidate;
    }

    return (
      candidates.find((candidate) => this.isLikelyEmbedUrl(candidate, pageUrl)) || ''
    );
  }

  private getPriorityEmbedPatterns(): RegExp[] {
    return [
      /ok\.?ru/i,
      /vk\.com/i,
      /vkvideo/i,
      /player/i,
      /embed/i,
      /iframe/i,
      /video/i,
      /stream/i,
    ];
  }

  private isLikelyEmbedUrl(
    url: string,
    pageUrl: string,
    patterns = this.getPriorityEmbedPatterns(),
  ): boolean {
    const value = String(url || '').trim();
    if (!value) return false;
    if (this.isDirectMediaUrl(value)) return false;
    if (/javascript:|data:|blob:/i.test(value)) return false;
    if (value.includes(pageUrl)) return false;

    return patterns.some((pattern) => pattern.test(value));
  }

  private async fetchIframeDocument(embedUrl: string, pageUrl: string): Promise<string> {
    const requestUrl = this.normalizeUrl(this.sanitizeUrl(embedUrl));
    if (!requestUrl) return '';

    try {
      const response = await this.client.get(requestUrl, {
        headers: this.buildEmbedHeaders(requestUrl, pageUrl),
        timeout: this.REQUEST_TIMEOUT_MS,
        responseType: 'text',
        transformResponse: [(data) => data],
        decompress: true,
      });

      return this.truncateMainDocument(this.precleanHtml(String(response.data || '')));
    } catch (error: any) {
      console.error(`[racing] Failed to fetch iframe ${requestUrl}:`, error.message);
      return '';
    }
  }

  private extractStreamSourceFromEmbed(
    iframeHtml: string,
    embedUrl: string,
    pageUrl: string,
  ): ExtractedSource | null {
    const cleaned = this.truncateMainDocument(
      this.decodeHtmlEntities(String(iframeHtml || '')),
    );
    const $embed = cheerio.load(cleaned);
    const target = this.extractStreamUrlFromEmbedDocument(
      $embed,
      cleaned,
      embedUrl,
      pageUrl,
    );
    if (!target) return null;

    return {
      url: target,
      isM3U8: /\.m3u8(\?|#|$)/i.test(target),
      quality: /\.m3u8(\?|#|$)/i.test(target) ? 'auto' : '1080p',
      server: 'Premium Nested Server',
    };
  }

  private extractStreamUrlFromEmbedDocument(
    $embed: cheerio.CheerioAPI,
    iframeHtml: string,
    embedUrl: string,
    pageUrl: string,
  ): string {
    const prioritizedBlocks: string[] = [];
    let directTarget = '';

    $embed(
      '[data-options], [data-json], [data-config], [flashvars], script, source, video, iframe',
    ).each((index, el) => {
      const node = $embed(el);
      const attribs = ((el as any).attribs || {}) as Record<string, string>;
      const joinedAttrs = Object.values(attribs).filter(Boolean).join(' ');
      const text = node.text();
      const src = node.attr('src') || '';

      const directPayloads = [
        attribs['data-options'],
        attribs['data-json'],
        attribs['data-config'],
        attribs.flashvars,
      ].filter(Boolean) as string[];
      for (const payload of directPayloads) {
        const parsed = this.parseJsonPayload(payload);
        if (parsed) {
          const target = this.findStreamUrlInObject(parsed);
          if (target) {
            directTarget = target;
            return false;
          }
        }
        prioritizedBlocks.push(payload);
      }

      prioritizedBlocks.push([joinedAttrs, text, src].filter(Boolean).join(' '));
      if (index > 12) return false;
    });

    if (directTarget) return directTarget;
    prioritizedBlocks.push(iframeHtml);

    for (const blob of prioritizedBlocks) {
      const fastPath = this.extractUrlFromJsonishPayloadFast(blob, embedUrl, pageUrl);
      if (fastPath) return fastPath;

      const regexMatch = this.extractMediaUrlFromPayload(blob);
      if (regexMatch) return regexMatch;
    }

    return '';
  }

  private parseJsonPayload(payload: string): any {
    const normalized = this.normalizeJsonLikeString(String(payload || ''));
    const trimmed = normalized.trim();
    if (!trimmed) return null;

    try {
      return JSON.parse(trimmed);
    } catch {
      const cleaned = trimmed.replace(/^[^{[]+/, '').replace(/[^}\]]+$/, '');
      try {
        return JSON.parse(cleaned);
      } catch {
        return null;
      }
    }
  }

  private extractUrlFromJsonishPayloadFast(
    blob: string,
    embedUrl: string,
    pageUrl: string,
  ): string {
    const text = this.decodeHtmlEntities(String(blob || ''));
    const jsonPatterns = [
      /(?:data-options|flashvars|playerConfig|videoConfig|sourceConfig)\s*=\s*["']([^"']+)["']/i,
      /(?:data-options|flashvars|playerConfig|videoConfig|sourceConfig)\s*:\s*["']([^"']+)["']/i,
      /(?:data-options|flashvars|playerConfig|videoConfig|sourceConfig)\s*[:=]\s*(\{[\s\S]*?\}|\[[\s\S]*?\])/i,
    ];

    for (const pattern of jsonPatterns) {
      const match = text.match(pattern);
      const raw = match?.[1] ? String(match[1]) : '';
      if (!raw) continue;

      const normalized = this.normalizeJsonLikeString(raw);
      const candidates = this.extractTargetsFromStringFast(normalized);
      if (candidates.length) return candidates[0];

      try {
        const parsed = JSON.parse(normalized);
        const jsonTarget = this.findStreamUrlInObject(parsed);
        if (jsonTarget) return jsonTarget;
      } catch {
        // ignore malformed JSON-like payloads
      }
    }

    const direct = this.findStreamUrlInObject(this.parseLooseJsonPayloadFast(text));
    if (direct) return direct;

    return this.extractTargetsFromStringFast(text)[0] || '';
  }

  private normalizeJsonLikeString(value: string): string {
    return String(value || '')
      .replace(/"/g, '"')
      .replace(/'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\u0026/g, '&')
      .trim();
  }

  private parseLooseJsonPayloadFast(text: string): any {
    const source = this.normalizeJsonLikeString(String(text || ''));
    const objectMatches = [
      source.match(
        /(?:data-options|flashvars|playerConfig|videoConfig|sourceConfig)\s*[:=]\s*(\{[\s\S]*\})/i,
      ),
      source.match(
        /window\.(?:playerConfig|videoConfig|sourceConfig)\s*=\s*(\{[\s\S]*\});?/i,
      ),
    ];

    for (const match of objectMatches) {
      const raw = match?.[1];
      if (!raw) continue;
      try {
        return JSON.parse(raw);
      } catch {
        continue;
      }
    }

    return null;
  }

  private findStreamUrlInObject(value: any): string {
    if (!value) return '';
    if (typeof value === 'string') {
      return this.extractTargetsFromStringFast(value)[0] || '';
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = this.findStreamUrlInObject(entry);
        if (found) return found;
      }
      return '';
    }

    if (typeof value === 'object') {
      const preferredKeys = [
        'hlsManifestUrl',
        'manifest',
        'm3u8',
        'streamUrl',
        'file',
        'src',
        'url',
        'playlist',
      ];
      for (const key of preferredKeys) {
        const candidate = value[key];
        const found = this.findStreamUrlInObject(candidate);
        if (found) return found;
      }

      for (const entry of Object.values(value)) {
        const found = this.findStreamUrlInObject(entry);
        if (found) return found;
      }
    }

    return '';
  }

  private extractTargetsFromStringFast(blob: string): string[] {
    const patterns = [
      /https?:\/\/[^"'`\s>]+?\.m3u8(?:\?[^"'`\s>]*)?/gi,
      /https?:\/\/[^"'`\s>]+?\.mp4(?:\?[^"'`\s>]*)?/gi,
      /\/\/[^"'`\s>]+?\.m3u8(?:\?[^"'`\s>]*)?/gi,
      /\/\/[^"'`\s>]+?\.mp4(?:\?[^"'`\s>]*)?/gi,
    ];

    const found: string[] = [];
    for (const pattern of patterns) {
      const matches = String(blob || '').match(pattern) || [];
      for (const match of matches) {
        const normalized = this.normalizeUrl(this.sanitizeUrl(match));
        if (this.isDirectMediaUrl(normalized) && !found.includes(normalized)) {
          found.push(normalized);
        }
      }
    }

    return found;
  }

  private extractManifestUrlFast(html: string): string {
    const patterns = [
      /["']hlsManifestUrl["']\s*:\s*["'](https?:\/\/[^"']+?\.m3u8[^"']*)["']/i,
      /hlsManifestUrl=([^&"'\s]+?\.m3u8[^&"'\s]*)/i,
      /(https?:\/\/[^"'`\s>]+?\.m3u8(?:\?[^"'`\s>]*)?)/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        return this.normalizeUrl(this.sanitizeUrl(match[1]));
      }
    }

    return '';
  }

  private async resolveStreamHint(
    hint: StreamHint,
    pageUrl: string,
  ): Promise<ExtractedSource | null> {
    const primaryUrl = this.normalizeUrl(
      this.sanitizeUrl(hint.mediaUrl || hint.requestUrl || ''),
    );
    if (!primaryUrl) return null;

    if (this.isDirectMediaUrl(primaryUrl)) {
      console.log('[racing] Direct media URL resolved:', primaryUrl.substring(0, 100));
      return {
        url: primaryUrl,
        isM3U8: /\.m3u8(\?|#|$)/i.test(primaryUrl),
        quality: /\.m3u8(\?|#|$)/i.test(primaryUrl) ? 'auto' : '1080p',
        server: 'OK. F1TV (1080p)',
      };
    }

    try {
      const response = await this.client.get(primaryUrl, {
        headers: {
          'User-Agent': hint.userAgent || this.defaultUserAgent(),
          Referer: hint.referer || pageUrl,
          Origin: this.baseUrl,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      const payload = this.precleanHtml(String(response.data || ''));
      console.log('[racing] Tier2 payload length:', payload.length);

      const resolved = this.extractMediaUrlFromPayload(payload);
      console.log('[racing] Resolved media URL:', resolved || 'none');

      if (!resolved) return null;

      return {
        url: resolved,
        isM3U8: /\.m3u8(\?|#|$)/i.test(resolved),
        quality: /\.m3u8(\?|#|$)/i.test(resolved) ? 'auto' : '1080p',
        server: 'OK. F1TV (1080p)',
      };
    } catch (error: any) {
      console.error('[racing] Tier2 handshake failed:', error.message);
      return null;
    }
  }

  private extractMediaUrlFromPayload(payload: string): string {
    const clean = this.precleanHtml(this.decodeHtmlEntities(String(payload || '')));
    const patterns = [
      /["'](https?:\/\/[^"'`\s>]+?\.m3u8(?:\?[^"'`\s>]*)?)["']/i,
      /["'](https?:\/\/[^"'`\s>]+?\.mp4(?:\?[^"'`\s>]*)?)["']/i,
      /(https?:\/\/[^"'`\s>]+?\.m3u8(?:\?[^"'`\s>]*)?)/i,
      /(https?:\/\/[^"'`\s>]+?\.mp4(?:\?[^"'`\s>]*)?)/i,
    ];

    for (const pattern of patterns) {
      const match = clean.match(pattern);
      if (match?.[1]) {
        const url = this.normalizeUrl(this.sanitizeUrl(match[1]));
        if (this.isDirectMediaUrl(url)) return url;
      }
    }

    return '';
  }

  private extractNamedValue(blob: string, pattern: RegExp): string {
    const match = blob.match(pattern);
    return match?.[2] ? String(match[2]) : '';
  }

  private extractUrlFromStringFast(blob: string): string {
    const patterns = [
      /https?:\/\/[^"'`\s>]+?\.m3u8(?:\?[^"'`\s>]*)?/i,
      /https?:\/\/[^"'`\s>]+?\.mp4(?:\?[^"'`\s>]*)?/i,
      /https?:\/\/[^"'`\s>]+?\/(?:video|embed|player)[^"'`\s>]*/i,
    ];

    for (const pattern of patterns) {
      const match = blob.match(pattern);
      if (match?.[0]) return this.normalizeUrl(this.sanitizeUrl(match[0]));
    }

    return '';
  }

  private isDirectMediaUrl(url: string): boolean {
    const value = String(url || '').trim();
    if (!value) return false;
    if (/\/videoembed\//i.test(value)) return false;
    if (/player\.html/i.test(value)) return false;
    return /\.(m3u8|mp4)(\?|#|$)/i.test(value);
  }

  private precleanHtml(html: string): string {
    const input = String(html || '');
    if (!input) return '';
    return input
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(
        /<script\b[^>]*>(?:[\s\S]*?)(?:analytics|tracking|gtag|googletag|fbq|adsbygoogle|dataLayer)(?:[\s\S]*?)<\/script>/gi,
        '',
      )
      .replace(
        /<script\b[^>]*src=["'][^"']*(?:analytics|tracking|gtag|googletag|doubleclick|adservice|adsbygoogle)[^"']*["'][^>]*><\/script>/gi,
        '',
      );
  }

  private truncateMainDocument(html: string): string {
    const input = String(html || '');
    if (!input) return '';

    const startMarkers = [
      '<main',
      '<article',
      '<section',
      '<div class="player',
      '<div id="player',
      '<iframe',
      '<script',
    ];
    let start = -1;
    for (const marker of startMarkers) {
      const idx = input.indexOf(marker);
      if (idx >= 0 && (start === -1 || idx < start)) start = idx;
    }

    if (start <= 0) return input.slice(0, 140000);

    const endMarkers = ['</main>', '</article>', '</section>', '</body>'];
    let end = input.length;
    for (const marker of endMarkers) {
      const idx = input.indexOf(marker, start);
      if (idx > 0 && idx < end) end = idx + marker.length;
    }

    return input.slice(start, Math.min(end, start + 140000));
  }

  private decodeHtmlEntities(value: string): string {
    return String(value || '')
      .replace(/"/g, '"')
      .replace(/'/g, "'")
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/\\u0026/g, '&');
  }

  private sanitizeUrl(value: string): string {
    return this.decodeHtmlEntities(String(value || ''))
      .replace(/\\&/g, '&')
      .replace(/\\/g, '')
      .trim();
  }

  private normalizeQuery(query: string): string {
    const lowered = String(query || '')
      .toLowerCase()
      .trim();
    return lowered === 'all' || lowered === 'racing' || lowered === 'f1' ? '' : lowered;
  }

  private extractCardDateText(root: cheerio.Cheerio<any>): string {
    const candidates = [
      root.find('time').first().text(),
      root.find('.date, .post-date, .entry-date, .meta-date, .published').first().text(),
      root.text(),
    ];

    for (const candidate of candidates) {
      const normalized = String(candidate || '')
        .trim()
        .replace(/\s+/g, ' ');
      if (normalized && /\b\d{4}\b/.test(normalized)) return normalized;
    }

    return '';
  }

  private extractYearFromDateText(dateText: string): number | null {
    const match = String(dateText || '').match(/\b(19|20)\d{2}\b/);
    return match?.[0] ? Number(match[0]) : null;
  }

  private extractItemYear(item: any): number | null {
    if (typeof item?.year === 'number') return item.year;
    return this.extractYearFromDateText(item?.publishedAt || '');
  }

  private defaultUserAgent(): string {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  }

  private buildBrowserHeaders(referer: string): Record<string, string> {
    return {
      'User-Agent': this.defaultUserAgent(),
      Referer: referer || this.baseUrl,
      Origin: this.baseUrl,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
    };
  }

  private buildEmbedHeaders(embedUrl: string, referer: string): Record<string, string> {
    const origin = this.getOriginFromUrl(embedUrl) || this.baseUrl;
    return {
      'User-Agent': this.defaultUserAgent(),
      Referer: referer || this.baseUrl,
      Origin: origin,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'iframe',
      'Accept-Encoding': 'gzip, deflate, br',
    };
  }

  private getOriginFromUrl(value: string): string {
    try {
      const parsed = new URL(this.normalizeUrl(value));
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return '';
    }
  }

  private normalizeUrlPath(value: string): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw) || raw.startsWith('//')) return this.normalizeUrl(raw);
    return raw.startsWith('/') ? raw : `/${raw}`;
  }

  normalizeUrl(value: string): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('//')) return `https:${raw}`;
    return `${this.baseUrl}${raw.startsWith('/') ? '' : '/'}${raw}`;
  }

  private extractEmbeddedIframeUrlFast(html: string, pageUrl: string): string {
    const source = this.truncateMainDocument(String(html || ''));
    const iframePatterns = [
      /<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i,
      /<frame\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i,
      /\b(?:src|data-src)=["']([^"']*(?:ok\.ru|vk\.com|vkvideo|embed|player|video)[^"']*)["']/i,
    ];

    for (const pattern of iframePatterns) {
      const match = source.match(pattern);
      if (match?.[1]) {
        const candidate = this.normalizeUrl(this.sanitizeUrl(match[1]));
        if (candidate && this.isLikelyEmbedUrl(candidate, pageUrl)) return candidate;
      }
    }

    return '';
  }

  private extractStreamHintFast(html: string, pageUrl: string): StreamHint | null {
    const source = this.truncateMainDocument(String(html || ''));

    const manifestMatch =
      source.match(
        /["']hlsManifestUrl["']\s*:\s*["'](https?:\/\/[^"']+?\.m3u8[^"']*)["']/i,
      ) || source.match(/hlsManifestUrl=([^&"'\s]+?\.m3u8[^&"'\s]*)/i);
    if (manifestMatch?.[1]) {
      return {
        mediaUrl: this.normalizeUrl(this.sanitizeUrl(manifestMatch[1])),
        referer: pageUrl,
        userAgent: this.defaultUserAgent(),
      };
    }

    const playerBlobMatch = source.match(
      /(?:flashvars|data-options|playerConfig|videoConfig|sourceConfig)\s*[:=]\s*(['"])([\s\S]*?)\1/i,
    );
    if (playerBlobMatch?.[2]) {
      const payload = this.decodeHtmlEntities(playerBlobMatch[2]);
      const direct = this.extractTargetsFromStringFast(payload)[0];
      if (direct) {
        return { mediaUrl: direct, referer: pageUrl, userAgent: this.defaultUserAgent() };
      }
    }

    const urlMatch = source.match(
      /https?:\/\/[^"'`\s>]+?\.(?:m3u8|mp4)(?:\?[^"'`\s>]*)?/i,
    );
    if (urlMatch?.[0]) {
      return {
        mediaUrl: this.normalizeUrl(this.sanitizeUrl(urlMatch[0])),
        referer: pageUrl,
        userAgent: this.defaultUserAgent(),
      };
    }

    return null;
  }
}
