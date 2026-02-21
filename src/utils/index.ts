import { FastifyInstance, RegisterOptions } from 'fastify';
import axios from 'axios';

import Providers from './providers';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  await fastify.register(new Providers().getProviders);

  // Handle audio track requests - return minimal valid m3u8 with dummy segment to prevent HLS errors
  // The segment URL points to a valid location but will return empty content
  const dummySegmentUrl = 'data:application/octet-stream;';
  
  // Direct routes
  fastify.get('/audio_tam/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/audio_hin/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/audio_tel/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/audio_mal/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/audio_ben/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/audio_eng/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/audio_jpn/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  // Routes under /utils/ for proxied audio tracks
  fastify.get('/utils/audio_tam/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/utils/audio_hin/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/utils/audio_tel/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/utils/audio_mal/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/utils/audio_ben/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/utils/audio_eng/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });
  fastify.get('/utils/audio_jpn/*', async (request, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,${dummySegmentUrl}\n#EXT-X-ENDLIST`);
  });

  fastify.get('/proxy', async (request: any, reply: any) => {
    const url = String(request.query?.url || '');
    const referer = String(request.query?.referer || '');
    const incomingRange = String(request.headers?.range || '');
    if (!url) return reply.status(400).send({ message: 'url is required' });

    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return reply.status(400).send({ message: 'invalid url' });
    }

    if (!['http:', 'https:'].includes(target.protocol)) {
      return reply.status(400).send({ message: 'invalid protocol' });
    }

    try {
      const pathLower = target.pathname.toLowerCase();
      const queryLower = target.search.toLowerCase();
      const looksLikeM3u8 =
        pathLower.endsWith('.m3u8') ||
        pathLower.includes('playlist') ||
        queryLower.includes('.m3u8');

      const upstream = await axios.get(target.toString(), {
        responseType: looksLikeM3u8 ? 'arraybuffer' : 'stream',
        timeout: looksLikeM3u8 ? 25000 : 60000,
        headers: {
          Referer: referer || `${target.protocol}//${target.host}/`,
          Origin: referer
            ? (() => {
                try {
                  const u = new URL(referer);
                  return `${u.protocol}//${u.host}`;
                } catch {
                  return `${target.protocol}//${target.host}`;
                }
              })()
            : `${target.protocol}//${target.host}`,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          ...(incomingRange ? { Range: incomingRange } : {}),
        },
        maxRedirects: 5,
        validateStatus: () => true,
      });

      if (upstream.status >= 400) {
        return reply.status(upstream.status).send({
          message: `upstream error ${upstream.status}`,
        });
      }

      const contentType = String(upstream.headers['content-type'] || '');
      const isM3u8 =
        looksLikeM3u8 ||
        contentType.includes('mpegurl') ||
        contentType.includes('application/x-mpegurl');

      if (isM3u8) {
        const raw = Buffer.from(upstream.data).toString('utf8');
        const base = target.toString();

        const rewriteUri = (candidate: string) => {
          try {
            const abs = new URL(candidate, base).toString();
            const refererQuery = referer ? `&referer=${encodeURIComponent(referer)}` : '';
            return `/utils/proxy?url=${encodeURIComponent(abs)}${refererQuery}`;
          } catch {
            return candidate;
          }
        };

        // Rewrite all URIs in the manifest, including audio tracks
        const rewritten = raw
          .split('\n')
          .map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;
            // Rewrite URI in #EXT-X-MEDIA tags (for audio tracks)
            if (trimmed.startsWith('#EXT-X-MEDIA:') && trimmed.includes('URI="')) {
              return line.replace(/URI="([^"]+)"/, (_m, uri) => `URI="${rewriteUri(uri)}"`);
            }
            // Rewrite URI in #EXT-X-KEY tags
            if (trimmed.startsWith('#EXT-X-KEY') && trimmed.includes('URI="')) {
              return line.replace(/URI="([^"]+)"/, (_m, uri) => `URI="${rewriteUri(uri)}"`);
            }
            // Keep other tags as-is
            if (trimmed.startsWith('#')) return line;
            // Rewrite non-tag lines (URIs)
            return rewriteUri(trimmed);
          })
          .join('\n');

        return reply
          .header('Content-Type', 'application/vnd.apple.mpegurl')
          .send(rewritten);
      }

      const statusCode = Number(upstream.status) || 200;
      if (statusCode === 206) {
        reply.status(206);
      }

      const passHeaders = [
        'accept-ranges',
        'content-range',
        'content-length',
        'cache-control',
        'etag',
        'last-modified',
      ];
      for (const h of passHeaders) {
        const v = upstream.headers?.[h];
        if (v != null) reply.header(h, String(v));
      }

      if (!isM3u8 && upstream.data && typeof (upstream.data as any).pipe === 'function') {
        return reply
          .header('Content-Type', contentType || 'application/octet-stream')
          .send(upstream.data);
      }

      return reply
        .header('Content-Type', contentType || 'application/octet-stream')
        .send(Buffer.from(upstream.data));
    } catch (err: any) {
      return reply.status(502).send({ message: err?.message || 'proxy failed' });
    }
  });

  fastify.get('/', async (request: any, reply: any) => {
    reply.status(200).send('Welcome to Consumet Utils!');
  });
};

export default routes;
