import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { ANIME, StreamingServers } from '@consumet/extensions';

import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { Redis } from 'ioredis';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
    const gogoanime = new ANIME.Gogoanime();

    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: `Welcome to the gogoanime provider: check out the provider's website @ ${gogoanime.toString.baseUrl}`,
            routes: ['/:query', '/info/:id', '/watch/:episodeId', '/recent-episodes', '/top-airing'],
            documentation: 'https://docs.consumet.org/#tag/gogoanime',
        });
    });

    fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
        const query = (request.params as { query: string }).query;
        const page = (request.query as { page: number }).page;

        try {
            let res = redis
                ? await cache.fetch(
                    redis as Redis,
                    `gogoanime:search:${query}:${page}`,
                    async () => await gogoanime.search(query, page),
                    REDIS_TTL,
                )
                : await gogoanime.search(query, page);

            reply.status(200).send(res);
        } catch (err) {
            reply.status(500).send({
                message: 'Something went wrong. Contact developer for help.',
            });
        }
    });

    fastify.get('/recent-episodes', async (request: FastifyRequest, reply: FastifyReply) => {
        const page = (request.query as { page: number }).page;
        const type = (request.query as { type: number }).type;
        try {
            let res = redis
                ? await cache.fetch(
                    redis as Redis,
                    `gogoanime:recent-episodes:${page}:${type}`,
                    async () => await gogoanime.fetchRecentEpisodes(page, type),
                    REDIS_TTL,
                )
                : await gogoanime.fetchRecentEpisodes(page, type);

            reply.status(200).send(res);
        } catch (error) {
            reply.status(500).send({
                message: 'Something went wrong. Contact developer for help.',
            });
        }
    });

    fastify.get('/top-airing', async (request: FastifyRequest, reply: FastifyReply) => {
        const page = (request.query as { page: number }).page;
        try {
            let res = redis
                ? await cache.fetch(
                    redis as Redis,
                    `gogoanime:top-airing:${page}`,
                    async () => await gogoanime.fetchTopAiring(page),
                    REDIS_TTL,
                )
                : await gogoanime.fetchTopAiring(page);

            reply.status(200).send(res);
        } catch (error) {
            reply.status(500).send({
                message: 'Something went wrong. Contact developer for help.',
            });
        }
    });

    fastify.get('/info/:id', async (request: FastifyRequest, reply: FastifyReply) => {
        const id = decodeURIComponent((request.params as { id: string }).id);

        try {
            let res = redis
                ? await cache.fetch(
                    redis as Redis,
                    `gogoanime:info:${id}`,
                    async () => await gogoanime.fetchAnimeInfo(id),
                    REDIS_TTL,
                )
                : await gogoanime.fetchAnimeInfo(id);

            reply.status(200).send(res);
        } catch (err) {
            console.error('Gogoanime Info Error:', err);
            reply.status(500).send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });

    fastify.get('/watch/:episodeId', async (request: FastifyRequest, reply: FastifyReply) => {
        const episodeId = decodeURIComponent((request.params as { episodeId: string }).episodeId);
        const server = (request.query as { server: StreamingServers }).server;

        try {
            let res = redis
                ? await cache.fetch(
                    redis as Redis,
                    `gogoanime:watch:${episodeId}:${server}`,
                    async () => await gogoanime.fetchEpisodeSources(episodeId, server),
                    REDIS_TTL,
                )
                : await gogoanime.fetchEpisodeSources(episodeId, server);


            reply.status(200).send(res);
        } catch (err) {
            console.error('Gogoanime Watch Error:', err);
            reply.status(500).send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });

    fastify.get('/servers/:episodeId', async (request: FastifyRequest, reply: FastifyReply) => {
        const episodeId = decodeURIComponent((request.params as { episodeId: string }).episodeId);

        try {
            let res = redis
                ? await cache.fetch(
                    redis as Redis,
                    `gogoanime:servers:${episodeId}`,
                    async () => await gogoanime.fetchEpisodeServers(episodeId),
                    REDIS_TTL,
                )
                : await gogoanime.fetchEpisodeServers(episodeId);

            reply.status(200).send(res);
        } catch (err) {
            console.error('Gogoanime Servers Error:', err);
            reply.status(500).send({ message: 'Something went wrong. Contact developer for help.' });
        }
    });
};

export default routes;
