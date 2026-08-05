require('dotenv').config();

import Fastify from 'fastify';
import FastifyCors from '@fastify/cors';
import axios from 'axios';
import http from 'http';
import https from 'https';
import { getProxyCandidatesSync, toAxiosProxyOptions } from './utils/outboundProxy';

// --- Global Axios Optimization ---
axios.defaults.httpsAgent = new https.Agent({ family: 4, keepAlive: true });
axios.defaults.headers.common['User-Agent'] =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
axios.defaults.headers.common['Accept'] = 'application/json, text/plain, */*';

// Dedicated keep-alive agents for HLS segment streaming
const hlsHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 128, maxFreeSockets: 64 });
const hlsHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 128, maxFreeSockets: 64, family: 4 });

import books from './routes/books';
import anime from './routes/anime';
import manga from './routes/manga';
import comics from './routes/comics';
import lightnovels from './routes/light-novels';
import movies from './routes/movies';
import meta from './routes/meta';
import news from './routes/news';
import sports from './routes/sports';
import ghoulstreams from './routes/ghoulstreams';
import chalk from 'chalk';
import Utils from './utils';
import { normalizeStreamLinks } from './utils/streamable';
import { registerWatchTogether } from './utils/watchTogether';

export const redis = null;

export const REDIS_TTL = 3600;

const fastify = Fastify({
  maxParamLength: 1000,
  logger: true,
});
export const tmdbApi = process.env.TMDB_KEY && process.env.TMDB_KEY;
(async () => {
  const PORT = Number(process.env.PORT) || 3000;

  await fastify.register(FastifyCors, {
    origin: true, // Transparently reflect the request origin
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  fastify.addHook('preSerialization', async (_request, _reply, payload) => {
    return normalizeStreamLinks(payload);
  });

  if (process.env.NODE_ENV === 'DEMO') {
    console.log(chalk.yellowBright('DEMO MODE ENABLED'));

    const map = new Map<string, { expiresIn: Date }>();
    // session duration in milliseconds (5 hours)
    const sessionDuration = 1000 * 60 * 60 * 5;

    fastify.addHook('onRequest', async (request, reply) => {
      const ip = request.ip;
      const session = map.get(ip);

      // check if the requester ip has a session (temporary access)
      if (session) {
        // if session is found, check if the session is expired
        const { expiresIn } = session;
        const currentTime = new Date();
        const sessionTime = new Date(expiresIn);

        // check if the session has been expired
        if (currentTime.getTime() > sessionTime.getTime()) {
          console.log('session expired');
          // if expired, delete the session and continue
          map.delete(ip);

          // redirect to the demo request page
          return reply.redirect('/apidemo');
        }
        console.log('session found. expires in', expiresIn);
        if (request.url === '/apidemo') return reply.redirect('/');
        return;
      }

      // if route is not /apidemo, redirect to the demo request page
      if (request.url === '/apidemo') return;

      console.log('session not found');
      reply.redirect('/apidemo');
    });

    fastify.post('/apidemo', async (request, reply) => {
      const { ip } = request;

      // check if the requester ip has a session (temporary access)
      const session = map.get(ip);

      if (session) return reply.redirect('/');

      // if no session, create a new session
      const expiresIn = new Date(Date.now() + sessionDuration);
      map.set(ip, { expiresIn });

      // redirect to the demo request page
      reply.redirect('/');
    });

    fastify.get('/apidemo', async (_, reply) => {
      return reply.type('application/json').send({
        message: 'Demo access page is disabled in this deployment.',
      });
    });

    // set interval to delete expired sessions every 1 hour
    setInterval(
      () => {
        const currentTime = new Date();
        for (const [ip, session] of map.entries()) {
          const { expiresIn } = session;
          const sessionTime = new Date(expiresIn);

          // check if the session is expired
          if (currentTime.getTime() > sessionTime.getTime()) {
            console.log('session expired for', ip);
            // if expired, delete the session and continue
            map.delete(ip);
          }
        }
      },
      1000 * 60 * 60,
    );
  }

  console.log(chalk.green(`Starting server on port ${PORT}... 🚀`));
  console.log(chalk.yellowBright('Redis removed. Cache disabled.'));

  if (!process.env.TMDB_KEY)
    console.warn(
      chalk.yellowBright('TMDB api key not found. the TMDB meta route may not work.'),
    );

  await fastify.register(books, { prefix: '/books' });
  await fastify.register(anime, { prefix: '/anime' });
  await fastify.register(manga, { prefix: '/manga' });
  await fastify.register(comics, { prefix: '/comics' });
  await fastify.register(lightnovels, { prefix: '/light-novels' });
  await fastify.register(movies, { prefix: '/movies' });
  await fastify.register(meta, { prefix: '/meta' });
  await fastify.register(news, { prefix: '/news' });
  await fastify.register(sports, { prefix: '/sports' });
  await fastify.register(ghoulstreams);
  await fastify.register(Utils, { prefix: '/utils' });
  registerWatchTogether(fastify);

  const appendQueryParam = (path: string, key: string, value?: string): string => {
    const safeValue = String(value || '').trim();
    if (!safeValue) return path;

    const joiner = path.includes('?') ? '&' : '?';
    return `${path}${joiner}${encodeURIComponent(key)}=${encodeURIComponent(safeValue)}`;
  };

  const appendRefererParam = (path: string, referer?: string): string => {
    const safeReferer = String(referer || '').trim();
    return appendQueryParam(path, 'referer', safeReferer);
  };

  const buildProxyPath = (
    targetUrl: string,
    referer?: string,
    isSegment = false,
    baseUrl?: string,
  ): string => {
    const raw = String(targetUrl || '').trim();
    if (!raw) return raw;
    if (/^\/proxy\/hls\//i.test(raw)) {
      const path = appendRefererParam(raw, referer);
      return baseUrl ? `${baseUrl}${path}` : path;
    }

    try {
      const parsed = new URL(raw);
      let path = `/proxy/hls/${parsed.host}${parsed.pathname}${parsed.search}`;
      path = appendRefererParam(path, referer);
      path = appendQueryParam(path, 'segment', isSegment ? '1' : '');
      return baseUrl ? `${baseUrl}${path}` : path;
    } catch {
      return raw;
    }
  };

  const rewriteHlsManifest = (
    manifest: string,
    manifestUrl: string,
    referer?: string,
    baseUrl?: string,
  ): string => {
    const resolveAndProxy = (value: string, isSegment = false): string => {
      const trimmed = String(value || '').trim();
      if (!trimmed) return trimmed;

      try {
        // Preserve the provider's page referer for child playlists and segments.
        // Using the parent manifest URL as Referer causes AnimeKai CDN requests to 403.
        const upstreamReferer = referer || manifestUrl;
        return buildProxyPath(
          new URL(trimmed, manifestUrl).toString(),
          upstreamReferer,
          isSegment,
          baseUrl,
        );
      } catch {
        return trimmed;
      }
    };

    let output = String(manifest || '');

    output = output.replace(
      /URI="([^"]+)"/g,
      (_match, uri) => `URI="${resolveAndProxy(uri)}"`,
    );
    output = output.replace(
      /URI='([^']+)'/g,
      (_match, uri) => `URI='${resolveAndProxy(uri)}'`,
    );

    let previousTag = '';
    output = output
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith('#')) {
          previousTag = trimmed;
          return line;
        }
        if (/^(data:|blob:)/i.test(trimmed)) return line;
         // AnimeSalt subtitle URLs can be extensionless or end in .js. They may
         // follow an EXTINF line in the manifest, but must not receive the
         // segment marker or the HLS proxy will fetch them as media bytes.
         const isSubtitleResource = /(?:\/p\/|\.(?:vtt|srt|ass|js)(?:\?|$))/i.test(trimmed);
         const isSegment = /^#EXTINF\b/i.test(previousTag) && !isSubtitleResource;
        previousTag = '';
        return resolveAndProxy(trimmed, isSegment);
      })
      .join('\n');

     // StreamVerse attaches external subtitle tracks itself. Some AnimeSalt
     // manifests advertise their subtitle file as an HLS playlist even though
     // it is a plain subtitle payload, which makes HLS.js abort video startup.
     output = output
       .split('\n')
       .filter((line) => !/^#EXT-X-MEDIA:/i.test(line) || !/TYPE=SUBTITLES/i.test(line))
       .join('\n');

     return output;
  };

  const isLikelyHlsManifest = (body: string, contentType?: string): boolean => {
    const text = String(body || '').trim();
    if (!text) return false;

    if (
      /application\/(vnd\.apple\.mpegurl|x-mpegURL)|audio\/x-mpegurl/i.test(
        String(contentType || ''),
      )
    ) {
      return true;
    }

    return /^#EXTM3U\b/m.test(text);
  };

  const shouldTreatAsManifestRequest = (url: string, incomingRange: string): boolean => {
    if (/\.m3u8(?:$|\?)/i.test(url)) return true;
    if (incomingRange) return false;
    if (/(?:ok\.ru|okcdn\.ru)\/.*\/video\//i.test(url)) return true;
    return /\/(?:hls|oppai)\//i.test(url);
  };

  const fetchHlsResource = async (
    url: string,
    isManifest: boolean,
    incomingRange: string,
    referer: string,
    cookieHeader: string,
  ) => {
    const isAnimeSaltCdn = /^https?:\/\/(?:as-cdn\d+|z\d+)\.(?:top|ac|pro|xyz|click|link|net|cc|org)\//i.test(url);
    // AnimeKai's Megaplay playlists can use a CDN for segments.
    // Those requests are reachable directly but commonly hang through the
    // configured outbound proxies, adding 15 seconds per segment retry.
    const isIbyteCdn = /^https?:\/\/[^/]*\.ibyteimg\.com\//i.test(url);
    const proxyCandidates = isAnimeSaltCdn || isIbyteCdn ? [''] : [...getProxyCandidatesSync(), ''];
    let lastError: unknown = null;
    const effectiveReferer = (() => {
      const safeReferer = String(referer || '').trim();
      if (!safeReferer) return safeReferer;
      const isAnimeSaltSiteReferer = /^https?:\/\/animesalt\.(?:ac|pro|xyz|click)(?:\/|$)/i.test(safeReferer);
      if (isAnimeSaltCdn && isAnimeSaltSiteReferer) {
        return '';
      }
      return safeReferer;
    })();

    for (const proxyUrl of proxyCandidates) {
      try {
        const proxyOptions = proxyUrl ? toAxiosProxyOptions(proxyUrl) : {};
        const upstreamOrigin = (() => {
          try { return new URL(effectiveReferer).origin; } catch { return ''; }
        })();
        const response = await axios.get(url, {
          headers: {
            Referer: effectiveReferer || 'https://streameeeeee.site/',
            ...(upstreamOrigin ? { Origin: upstreamOrigin } : {}),
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
            ...(incomingRange ? { Range: incomingRange } : {}),
            ...(isManifest
              ? {}
              : { Accept: 'video/mp2t,video/mp4,application/octet-stream,*/*' }),
            ...(isManifest ? {} : { 'Accept-Encoding': 'identity' }),
          },
          timeout: isIbyteCdn ? 30000 : 15000,
          responseType: isManifest ? 'text' : 'arraybuffer',
          validateStatus: (status: number) => status < 500,
          ...(proxyOptions as any),
        });

        const responseContentType = String(response.headers['content-type'] || '');

        if (response.status >= 400) {
          const upstreamError = new Error(`Upstream HLS response (${response.status})`);
          (upstreamError as Error & { statusCode?: number }).statusCode = response.status;
          lastError = upstreamError;
          continue;
        }

        if (
          isManifest &&
          !isLikelyHlsManifest(String(response.data || ''), responseContentType)
        ) {
          lastError = new Error(`Invalid HLS manifest response (${response.status})`);
          continue;
        }

        return response;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error('HLS proxy failed');
  };

  // HLS Proxy to work around CORS issues
  fastify.get('/proxy/hls/*', async (request, reply) => {
    const rawRequestUrl = String(request.url || '');
    const [rawPath, rawQuery = ''] = rawRequestUrl.split('?');
    const wildcardPath = rawPath.replace(/^\/proxy\/hls\//i, '').trim();
    const refererParam = String(
      new URLSearchParams(rawQuery).get('referer') || '',
    ).trim();
    const cookieParam = String(new URLSearchParams(rawQuery).get('cookie') || '').trim();
    const segmentParam =
      String(new URLSearchParams(rawQuery).get('segment') || '').trim() === '1';
    const passthroughQuery = rawQuery
      .split('&')
      .filter((part) => part && !/^(referer|segment|cookie)=/i.test(part))
      .join('&');

    const url = `https://${wildcardPath}${passthroughQuery ? `?${passthroughQuery}` : ''}`;
    const incomingRange = String(request.headers.range || '');
    const isManifest = !segmentParam && shouldTreatAsManifestRequest(url, incomingRange);
    const incomingReferer = String(
      request.headers.referer || request.headers.referrer || '',
    )
      .trim()
      .replace(/#.*$/, '');
    const requestReferer = (
      refererParam || incomingReferer || 'https://streameeeeee.site/'
    ).replace(/#.*$/, '');

    // Serve from Playwright-captured HLS manifest cache to avoid expired tokens.
    if (isManifest && !incomingRange) {
      try {
        const { getCachedHlsManifest } = await import('./utils/browserRuntimeExtractor');
        const cached = getCachedHlsManifest(url);
        if (cached) {
          const content = rewriteHlsManifest(cached.body, url, requestReferer, `${request.protocol}://${request.headers.host || 'localhost:3000'}`);
          reply.header('Content-Type', cached.contentType || 'application/vnd.apple.mpegurl');
          reply.header('Access-Control-Allow-Origin', '*');
          reply.header('Cache-Control', 'public, max-age=60');
          return reply.send(content);
        }
      } catch {
        // Cache lookup is best-effort.
      }
    }

    try {
      const response = await fetchHlsResource(
        url,
        isManifest,
        incomingRange,
        requestReferer,
        cookieParam,
      );

      const responseContentType = String(response.headers['content-type'] || '');
      const responseBuffer = Buffer.isBuffer(response.data)
        ? response.data
        : response.data instanceof ArrayBuffer
          ? Buffer.from(response.data)
          : ArrayBuffer.isView(response.data)
            ? Buffer.from(
                response.data.buffer,
                response.data.byteOffset,
                response.data.byteLength,
              )
            : null;
      const responseText = responseBuffer
        ? responseBuffer.toString('utf8')
        : String(response.data || '');
      const isKeyResponse = /\/keys\/key\.bin(?:$|\?)/i.test(url);
      const responseIsManifest =
        isManifest || isLikelyHlsManifest(responseText, responseContentType);

      // If it's an M3U8 manifest, rewrite relative URLs to absolute/proxied URLs.
      // Some AnimeSalt variant playlists are extensionless /hls/<token> URLs, so
      // content sniffing is required instead of relying only on ".m3u8".
      if (responseIsManifest) {
        const hostHeader = request.headers.host || 'localhost:3000';
        const protocol = request.headers['x-forwarded-proto'] || request.protocol || 'https';
        const baseUrl = `${protocol}://${hostHeader}`;
        const content = rewriteHlsManifest(responseText, url, requestReferer, baseUrl);

        reply.header('Content-Type', 'application/vnd.apple.mpegurl');
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, Range',
        );
        reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
        return reply.send(content);
      }

      // For segments (non-manifest), stream directly using keep-alive agents
      if (!responseIsManifest) {
        if (isKeyResponse && responseBuffer) {
          const trimmedKey = responseText.replace(/\s+/g, '');
          if (/^[A-Za-z0-9+/=]+$/.test(trimmedKey) && trimmedKey.length >= 24) {
            try {
              const decodedKey = Buffer.from(trimmedKey, 'base64');
              if (decodedKey.length >= 16 && decodedKey.length < responseBuffer.length) {
                reply.header('Access-Control-Allow-Origin', '*');
                reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
                reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
                reply.header('Content-Type', 'application/octet-stream');
                reply.header('Content-Length', decodedKey.length);
                return reply.send(decodedKey);
              }
            } catch {
              // Fall back to raw key payload when decoding fails.
            }
          }
        }

        // Stream segment directly via keep-alive agents
        try {
          const upstreamUrl = new URL(url);
          const isHttps = upstreamUrl.protocol === 'https:';
          const transport = isHttps ? https : http;
          const agent = isHttps ? hlsHttpsAgent : hlsHttpAgent;

          const segmentReq = transport.request(
            {
              hostname: upstreamUrl.hostname,
              port: upstreamUrl.port || (isHttps ? 443 : 80),
              path: upstreamUrl.pathname + upstreamUrl.search,
              method: 'GET',
              agent,
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                Referer: requestReferer,
                ...(incomingRange ? { Range: incomingRange } : {}),
                ...(cookieParam ? { Cookie: cookieParam } : {}),
                Accept: 'video/mp2t,video/mp4,application/octet-stream,*/*',
                'Accept-Encoding': 'identity',
              },
            },
            (upstreamRes) => {
              const resHeaders: Record<string, string> = {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Content-Type':
                  upstreamRes.headers['content-type'] || 'application/octet-stream',
              };
              if (upstreamRes.headers['content-length'])
                resHeaders['Content-Length'] = upstreamRes.headers['content-length'] as string;
              if (upstreamRes.headers['content-range'])
                resHeaders['Content-Range'] = upstreamRes.headers['content-range'] as string;
              if (upstreamRes.headers['accept-ranges'])
                resHeaders['Accept-Ranges'] = upstreamRes.headers['accept-ranges'] as string;

              reply.raw.writeHead(upstreamRes.statusCode || 200, resHeaders);
              upstreamRes.pipe(reply.raw);
            },
          );

          segmentReq.on('error', (err: Error) => {
            console.error('HLS segment stream error:', err.message);
            if (!reply.sent) {
              reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
              reply.raw.end(JSON.stringify({ error: 'Segment proxy failed' }));
            }
          });

          segmentReq.end();
          return reply;
        } catch (err: any) {
          console.error('HLS segment stream error:', err.message);
          return reply.status(500).send({ error: 'Segment proxy failed' });
        }
      }

      // Should never reach here — all paths in the non-manifest block return above
      return reply.status(500).send({ error: 'Unexpected proxy state' });
    } catch (error: any) {
      console.error('HLS Proxy error:', error.message);
      const upstreamStatus = Number(error?.statusCode || error?.response?.status || 0);
      const status = upstreamStatus >= 400 && upstreamStatus < 600 ? upstreamStatus : 502;
      return reply.status(status).send({
        error: 'Proxy failed',
        ...(upstreamStatus ? { upstreamStatus } : {}),
      });
    }
  });

  try {
    fastify.get('/', (_, rp) => {
      rp.status(200).send(
        `Welcome to consumet api! 🎉 \n${
          process.env.NODE_ENV === 'DEMO'
            ? 'This is a demo of the api. You should only use this for testing purposes.'
            : ''
        }`,
      );
    });
    fastify.get('*', (request, reply) => {
      reply.status(404).send({
        message: '',
        error: 'page not found',
      });
    });

    const shouldUsePortFallback =
      String(process.env.ALLOW_PORT_FALLBACK || 'false').toLowerCase() === 'true';

    const startServer = async (initialPort: number, maxRetries = 5) => {
      if (!shouldUsePortFallback) {
        const address = await fastify.listen({ port: initialPort, host: '0.0.0.0' });
        console.log(`server listening on ${address}`);
        return;
      }

      for (let retry = 0; retry <= maxRetries; retry++) {
        const candidatePort = initialPort + retry;

        try {
          const address = await fastify.listen({ port: candidatePort, host: '0.0.0.0' });

          if (retry > 0) {
            console.warn(
              chalk.yellowBright(
                `Port ${initialPort} is busy. Started on fallback port ${candidatePort} instead.`,
              ),
            );
          }

          console.log(`server listening on ${address}`);
          return;
        } catch (error: any) {
          const isPortConflict = error?.code === 'EADDRINUSE';

          if (!isPortConflict || retry === maxRetries) {
            throw error;
          }
        }
      }
    };

    await startServer(PORT);
  } catch (err: any) {
    fastify.log.error(err);
    process.exit(1);
  }
})();
export default async function handler(req: any, res: any) {
  await fastify.ready();
  fastify.server.emit('request', req, res);
}
