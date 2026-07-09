import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import axios from 'axios';
import http from 'node:http';
import https from 'node:https';
import { BuffStreams } from '../providers/sports/buffstreams';
import { Racing } from '../providers/sports/racing';
import { LiveSportHelper } from '../providers/sports/livesport-helper';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const AVAILABILITY_TTL_MS = 1000 * 60 * 45;
const WATCH_LOOKUP_TTL_MS = 1000 * 20;

type StreamAvailability = { isLive: boolean; reason: string; updatedAt: number };
const streamAvailability = new Map<string, StreamAvailability>();
type CacheEntry<T> = { expiresAt: number; value: T };
const watchLookupCache = new Map<string, CacheEntry<any>>();
const watchLookupInFlight = new Map<string, Promise<any>>();

const isAbsoluteHttpUrl = (value: string) =>
  /^https?:\/\//i.test(String(value || '').trim());

const getQueryValue = (query: Record<string, unknown>, ...keys: string[]) => {
  const map = new Map<string, unknown>();
  for (const [key, value] of Object.entries(query || {}))
    map.set(String(key).toLowerCase(), value);
  for (const key of keys) {
    const value = map.get(String(key).toLowerCase());
    if (value !== undefined && value !== null) return String(value).trim();
  }
  return '';
};

const dropConditionalHeaders = (headers: Record<string, string>) => {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (
      lower === 'if-none-match' ||
      lower === 'if-modified-since' ||
      lower === 'if-match' ||
      lower === 'if-unmodified-since'
    ) {
      continue;
    }
    filtered[key] = value;
  }
  return filtered;
};

const setCorsHeaders = (reply: FastifyReply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Range, Origin, Referer, User-Agent, Accept, Accept-Encoding',
  );
  reply.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  reply.header(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range, Accept-Ranges, Content-Type',
  );
};

const streamUpstreamToReply = async (
  targetUrl: string,
  headers: Record<string, string>,
  reply: FastifyReply,
) => {
  const url = new URL(targetUrl);
  const client = url.protocol === 'https:' ? https : http;

  return await new Promise<void>((resolve, reject) => {
    const req = client.request(
      targetUrl,
      {
        method: 'GET',
        headers,
      },
      (res) => {
        reply.status(res.statusCode || 200);
        for (const [key, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          if (key.toLowerCase() === 'transfer-encoding') continue;
          reply.header(key, value as any);
        }
        setCorsHeaders(reply);

        res.on('error', reject);
        reply.raw.on('close', () => req.destroy());
        res.pipe(reply.raw);
        res.on('end', resolve);
      },
    );

    req.on('error', reject);
    req.end();
  });
};

const pruneAvailability = () => {
  const now = Date.now();
  for (const [id, value] of streamAvailability.entries()) {
    if (!value?.updatedAt || now - value.updatedAt > AVAILABILITY_TTL_MS) {
      streamAvailability.delete(id);
    }
  }
};

const getAvailabilitySnapshot = () => {
  pruneAvailability();
  const snapshot: Record<string, StreamAvailability> = {};
  for (const [id, value] of streamAvailability.entries()) snapshot[id] = value;
  return snapshot;
};

const setStreamAvailability = (id: string, isLive: boolean, reason = '') => {
  const key = String(id || '').trim();
  if (!key) return;
  streamAvailability.set(key, {
    isLive: Boolean(isLive),
    reason: String(reason || ''),
    updatedAt: Date.now(),
  });
};

const getCachedLookup = async <T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = WATCH_LOOKUP_TTL_MS,
): Promise<T> => {
  const cacheKey = String(key || '').trim();
  const now = Date.now();
  const cached = watchLookupCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }
  const inflight = watchLookupInFlight.get(cacheKey);
  if (inflight) return inflight as Promise<T>;

  const promise = (async () => {
    try {
      const value = await fetcher();
      watchLookupCache.set(cacheKey, { expiresAt: Date.now() + ttlMs, value });
      return value;
    } finally {
      watchLookupInFlight.delete(cacheKey);
    }
  })();

  watchLookupInFlight.set(cacheKey, promise);
  return promise;
};

const buildHlsProxyPath = (targetUrl: string, referer = '') => {
  const hostEnd = targetUrl.indexOf('/', targetUrl.indexOf('://') + 3);
  if (hostEnd === -1) return `/proxy/hls/${new URL(targetUrl).host}/`;
  const qsStart = targetUrl.indexOf('?', hostEnd);
  const rawPath =
    qsStart >= 0 ? targetUrl.slice(hostEnd, qsStart) : targetUrl.slice(hostEnd);
  const rawQuery = qsStart >= 0 ? targetUrl.slice(qsStart + 1) : '';
  const host = new URL(targetUrl).host;
  const newQuery = referer
    ? `${rawQuery}${rawQuery ? '&' : ''}referer=${encodeURIComponent(referer)}`
    : rawQuery;
  return `/proxy/hls/${host}${rawPath}${newQuery ? `?${newQuery}` : ''}`;
};

const noStoreHeaders = async (_request: FastifyRequest, reply: FastifyReply) => {
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
  reply.header('Surrogate-Control', 'no-store');
};

const routes = async (fastify: FastifyInstance, _options: RegisterOptions) => {
  const buffstreams = new BuffStreams();
  const racing = new Racing();

  fastify.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      await noStoreHeaders(request, reply);
    }
  });

  fastify.post('/api/search', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { query, date } = (request.body as { query?: string; date?: string }) || {};
      const results = await buffstreams.search(String(query || ''), {
        date: String(date || '') || undefined,
      });
      for (const result of results || []) {
        if (result?.isLive === true) {
          setStreamAvailability(
            String(result.id || result.url || ''),
            true,
            'source_available',
          );
        }
      }
      return reply.send({ success: true, data: results });
    } catch (error: any) {
      return reply.send({ success: false, error: error?.message || 'search_failed' });
    }
  });

  fastify.get('/api/stream-statuses', async (_request, reply) => {
    return reply.send({ success: true, data: getAvailabilitySnapshot() });
  });

  fastify.post(
    '/api/report-stream-status',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id, isLive, reason } =
          (request.body as { id?: string; isLive?: boolean; reason?: string }) || {};
        setStreamAvailability(
          String(id || ''),
          Boolean(isLive),
          String(reason || 'reported'),
        );
        return reply.send({ success: true });
      } catch (error: any) {
        return reply.send({ success: false, error: error?.message || 'report_failed' });
      }
    },
  );

  fastify.post('/api/fetchInfo', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = (request.body as { id?: string }) || {};
      const target = String(id || '').trim();
      const cacheKey = `fetchInfo:${target}`;
      const isRacing = /fullraces|formula-1|nascar|indycar|motogp|racing/i.test(target);
      const info = await getCachedLookup(cacheKey, async () =>
        isRacing
          ? await racing.fetchMediaInfo(target)
          : await buffstreams.fetchMediaInfo(target),
      );
      return reply.send({ success: true, data: info });
    } catch (error: any) {
      return reply.send({ success: false, error: error?.message || 'fetch_info_failed' });
    }
  });

  fastify.post(
    '/api/fetchSources',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { eventUrl, embedUrl } =
          (request.body as { eventUrl?: string; embedUrl?: string }) || {};
        const target = String(eventUrl || embedUrl || '').trim();
        const cacheKey = `fetchSources:${target}`;
        const isRacing = /fullraces|formula-1|nascar|indycar|motogp|racing/i.test(target);
        const data = await getCachedLookup(cacheKey, async () =>
          isRacing
            ? await racing.fetchEpisodeSources(target)
            : await buffstreams.fetchEpisodeSources(target),
        );
        if (Array.isArray((data as any)?.sources) && (data as any).sources.length > 0) {
          setStreamAvailability(target, true, 'source_available');
        }
        return reply.send({ success: true, data });
      } catch (error: any) {
        return reply.send({
          success: false,
          error: error?.message || 'fetch_sources_failed',
        });
      }
    },
  );

  fastify.post(
    '/api/matchDetails',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { title, sport } =
          (request.body as { title?: string; sport?: string }) || {};
        if (!title) return reply.send({ success: false, error: 'title required' });
        const client = axios.create();
        const cacheKey = `matchDetails:${String(title || '').trim()}:${String(
          sport || 'sports',
        )
          .trim()
          .toLowerCase()}`;
        const data = await getCachedLookup(cacheKey, async () =>
          LiveSportHelper.getLiveStats(client, String(title), String(sport || 'sports')),
        );
        return reply.send({ success: true, data: data || null });
      } catch (error: any) {
        return reply.send({
          success: true,
          data: null,
          error: error?.message || 'match_details_failed',
        });
      }
    },
  );

  fastify.get(
    '/api/livesport-directory',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const client = axios.create();
        const data = await LiveSportHelper.getGlobalDirectory(client);
        return reply.send({ success: true, data: data || { matches: [] } });
      } catch (error: any) {
        return reply.send({
          success: true,
          data: { matches: [] },
          error: error?.message || 'livesport_directory_failed',
        });
      }
    },
  );

  fastify.get(
    '/api/racing/catalog',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const category = String(
          (request.query as { category?: string })?.category || '',
        ).trim();
        const data = await racing.fetchCatalogLatest({
          query: category === 'racing' ? '' : category,
          forceRefresh: false,
        });
        return reply.send({ success: true, data });
      } catch (error: any) {
        return reply.send({
          success: true,
          data: [],
          error: error?.message || 'racing_catalog_failed',
        });
      }
    },
  );

  fastify.get(
    '/api/racing/watch',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const episodeId = String(
          (request.query as { episodeId?: string; url?: string })?.episodeId ||
            (request.query as { url?: string })?.url ||
            '',
        ).trim();
        if (!episodeId)
          return reply.send({
            success: false,
            error: 'episodeId required',
            data: { sources: [] },
          });
        const data = await racing.fetchEpisodeSources(episodeId);
        return reply.send({ success: true, data });
      } catch (error: any) {
        return reply.send({
          success: true,
          data: { sources: [] },
          error: error?.message || 'racing_watch_failed',
        });
      }
    },
  );

  fastify.get(
    '/api/media-proxy',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const query = request.query as Record<string, unknown>;
        const targetUrl = getQueryValue(query, 'url', 'URL');
        const referer = getQueryValue(query, 'referer', 'Referer');
        const rootReferer = getQueryValue(
          query,
          'root_referer',
          'rootReferer',
          'root-referer',
        );
        const origin = getQueryValue(query, 'origin', 'Origin');
        const userAgent = getQueryValue(query, 'user_agent', 'user-agent', 'User-Agent');
        if (!targetUrl || !isAbsoluteHttpUrl(targetUrl)) {
          return reply.status(400).send('Invalid or missing target URL parameter');
        }

        const outboundHeaders = dropConditionalHeaders({
          Referer: referer || rootReferer || 'https://streameeeeee.site/',
          ...(origin ? { Origin: origin } : {}),
          'User-Agent': userAgent || USER_AGENT,
          Accept: 'application/vnd.apple.mpegurl,text/plain,video/*,audio/*,*/*;q=0.8',
          'Accept-Encoding': 'identity',
          ...(request.headers.range ? { Range: String(request.headers.range) } : {}),
        } as Record<string, string>);

        setCorsHeaders(reply);
        reply.header(
          'Cache-Control',
          'no-store, no-cache, must-revalidate, proxy-revalidate',
        );
        reply.header('Pragma', 'no-cache');
        reply.header('Expires', '0');
        reply.removeHeader('etag');
        reply.removeHeader('last-modified');

        return await streamUpstreamToReply(targetUrl, outboundHeaders, reply);
      } catch (error: any) {
        setCorsHeaders(reply);
        return reply.status(500).send(error?.message || 'media_proxy_failed');
      }
    },
  );

  fastify.get(
    '/api/image-proxy',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const targetUrl = String((request.query as { url?: string }).url || '').trim();
        if (!targetUrl || !isAbsoluteHttpUrl(targetUrl)) {
          return reply.status(400).send('Invalid or missing image URL');
        }
        const response = await axios.get(targetUrl, {
          responseType: 'arraybuffer',
          timeout: 15000,
          headers: { 'User-Agent': USER_AGENT, Accept: 'image/*,*/*;q=0.8' },
          validateStatus: (status: number) => status < 500,
        });
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Cache-Control', 'public, max-age=86400');
        if (response.headers['content-type'])
          reply.header('Content-Type', response.headers['content-type']);
        return reply.status(response.status).send(Buffer.from(response.data));
      } catch (error: any) {
        return reply.status(500).send(error?.message || 'image_proxy_failed');
      }
    },
  );
};

export default routes;
