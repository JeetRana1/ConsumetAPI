require('dotenv').config(); 

import Redis from 'ioredis';
import Fastify from 'fastify';
import FastifyCors from '@fastify/cors';
import axios from 'axios';
import https from 'https';

// --- Global Axios Optimization ---
// Solves ECONNRESET and 403 blocks by forcing IPv4 and setting a browser User-Agent
axios.defaults.httpsAgent = new https.Agent({ family: 4, keepAlive: true });
axios.defaults.headers.common['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
axios.defaults.headers.common['Accept'] = 'application/json, text/plain, */*';

import books from './routes/books';
import anime from './routes/anime';
import manga from './routes/manga';
import comics from './routes/comics';
import lightnovels from './routes/light-novels';
import movies from './routes/movies';
import meta from './routes/meta';
import news from './routes/news';
import chalk from 'chalk';
import Utils from './utils';
import { normalizeStreamLinks } from './utils/streamable';

export const redis =
  process.env.REDIS_HOST &&
  new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
  });

// Sets default TTL to 1 hour (3600 seconds) if not provided in .env
export const REDIS_TTL = Number(process.env.REDIS_TTL) || 3600;

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
  if (!process.env.REDIS_HOST) {
    console.warn(chalk.yellowBright('Redis not found. Cache disabled.'));
  } else {
    console.log(chalk.green(`Redis connected. Default Cache TTL: ${REDIS_TTL} seconds`));
  }

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
  await fastify.register(Utils, { prefix: '/utils' });

  // HLS Proxy to work around CORS issues
  fastify.get('/proxy/hls/*', async (request, reply) => {
    const url = request.url.replace('/proxy/hls/', 'https://');
    
    try {
      const response = await axios.get(url, {
        headers: {
          'Referer': 'https://streameeeeee.site/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        timeout: 15000,
        responseType: 'text',
      });

      // If it's an M3U8 manifest, rewrite relative URLs to absolute
      if (url.includes('.m3u8')) {
        let content = response.data;
        const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
        
        // Replace all .m3u8 URLs with proxy URLs
        content = content.replace(/(https:\/\/[^\s]+\.m3u8)/g, (match: string) => {
          return `/proxy/hls/${match}`;
        });
        
        // Also proxy .ts segment files
        content = content.replace(/(https:\/\/[^\s]+\.ts)/g, (match: string) => {
          return `/proxy/hls/${match}`;
        });

        reply.header('Content-Type', 'application/vnd.apple.mpegurl');
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
        return reply.send(content);
      }

      // For other content (segments, etc.), proxy as-is
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      reply.header('Content-Type', response.headers['content-type'] || 'application/octet-stream');
      return reply.send(response.data);

    } catch (error: any) {
      console.error('HLS Proxy error:', error.message);
      return reply.status(500).send({ error: 'Proxy failed' });
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

    const shouldUsePortFallback = String(process.env.ALLOW_PORT_FALLBACK || 'false').toLowerCase() === 'true';

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
