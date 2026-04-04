"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tmdbApi = exports.REDIS_TTL = exports.redis = void 0;
require('dotenv').config();
const ioredis_1 = __importDefault(require("ioredis"));
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const axios_1 = __importDefault(require("axios"));
const https_1 = __importDefault(require("https"));
// --- Global Axios Optimization ---
// Solves ECONNRESET and 403 blocks by forcing IPv4 and setting a browser User-Agent
axios_1.default.defaults.httpsAgent = new https_1.default.Agent({ family: 4, keepAlive: true });
axios_1.default.defaults.headers.common['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
axios_1.default.defaults.headers.common['Accept'] = 'application/json, text/plain, */*';
const books_1 = __importDefault(require("./routes/books"));
const anime_1 = __importDefault(require("./routes/anime"));
const manga_1 = __importDefault(require("./routes/manga"));
const comics_1 = __importDefault(require("./routes/comics"));
const light_novels_1 = __importDefault(require("./routes/light-novels"));
const movies_1 = __importDefault(require("./routes/movies"));
const meta_1 = __importDefault(require("./routes/meta"));
const news_1 = __importDefault(require("./routes/news"));
const chalk_1 = __importDefault(require("chalk"));
const utils_1 = __importDefault(require("./utils"));
const streamable_1 = require("./utils/streamable");
exports.redis = process.env.REDIS_HOST &&
    new ioredis_1.default({
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT),
        password: process.env.REDIS_PASSWORD,
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
    });
// Sets default TTL to 1 hour (3600 seconds) if not provided in .env
exports.REDIS_TTL = Number(process.env.REDIS_TTL) || 3600;
const fastify = (0, fastify_1.default)({
    maxParamLength: 1000,
    logger: true,
});
exports.tmdbApi = process.env.TMDB_KEY && process.env.TMDB_KEY;
(async () => {
    const PORT = Number(process.env.PORT) || 3000;
    await fastify.register(cors_1.default, {
        origin: true, // Transparently reflect the request origin
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        credentials: true,
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    });
    fastify.addHook('preSerialization', async (_request, _reply, payload) => {
        return (0, streamable_1.normalizeStreamLinks)(payload);
    });
    if (process.env.NODE_ENV === 'DEMO') {
        console.log(chalk_1.default.yellowBright('DEMO MODE ENABLED'));
        const map = new Map();
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
                if (request.url === '/apidemo')
                    return reply.redirect('/');
                return;
            }
            // if route is not /apidemo, redirect to the demo request page
            if (request.url === '/apidemo')
                return;
            console.log('session not found');
            reply.redirect('/apidemo');
        });
        fastify.post('/apidemo', async (request, reply) => {
            const { ip } = request;
            // check if the requester ip has a session (temporary access)
            const session = map.get(ip);
            if (session)
                return reply.redirect('/');
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
        setInterval(() => {
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
        }, 1000 * 60 * 60);
    }
    console.log(chalk_1.default.green(`Starting server on port ${PORT}... 🚀`));
    if (!process.env.REDIS_HOST) {
        console.warn(chalk_1.default.yellowBright('Redis not found. Cache disabled.'));
    }
    else {
        console.log(chalk_1.default.green(`Redis connected. Default Cache TTL: ${exports.REDIS_TTL} seconds`));
    }
    if (!process.env.TMDB_KEY)
        console.warn(chalk_1.default.yellowBright('TMDB api key not found. the TMDB meta route may not work.'));
    await fastify.register(books_1.default, { prefix: '/books' });
    await fastify.register(anime_1.default, { prefix: '/anime' });
    await fastify.register(manga_1.default, { prefix: '/manga' });
    await fastify.register(comics_1.default, { prefix: '/comics' });
    await fastify.register(light_novels_1.default, { prefix: '/light-novels' });
    await fastify.register(movies_1.default, { prefix: '/movies' });
    await fastify.register(meta_1.default, { prefix: '/meta' });
    await fastify.register(news_1.default, { prefix: '/news' });
    await fastify.register(utils_1.default, { prefix: '/utils' });
    try {
        fastify.get('/', (_, rp) => {
            rp.status(200).send(`Welcome to consumet api! 🎉 \n${process.env.NODE_ENV === 'DEMO'
                ? 'This is a demo of the api. You should only use this for testing purposes.'
                : ''}`);
        });
        fastify.get('*', (request, reply) => {
            reply.status(404).send({
                message: '',
                error: 'page not found',
            });
        });
        const shouldUsePortFallback = String(process.env.ALLOW_PORT_FALLBACK || 'false').toLowerCase() === 'true';
        const startServer = async (initialPort, maxRetries = 5) => {
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
                        console.warn(chalk_1.default.yellowBright(`Port ${initialPort} is busy. Started on fallback port ${candidatePort} instead.`));
                    }
                    console.log(`server listening on ${address}`);
                    return;
                }
                catch (error) {
                    const isPortConflict = error?.code === 'EADDRINUSE';
                    if (!isPortConflict || retry === maxRetries) {
                        throw error;
                    }
                }
            }
        };
        await startServer(PORT);
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
})();
async function handler(req, res) {
    await fastify.ready();
    fastify.server.emit('request', req, res);
}
exports.default = handler;
