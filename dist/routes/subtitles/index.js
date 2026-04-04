"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const whvx_subs_1 = require("whvx-subs");
const routes = async (fastify, options) => {
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: 'Welcome to the subtitles provider',
            routes: ['/search', '/:id', '/:id/:season/:episode'],
            documentation: 'Fetch subtitles for movies and TV shows using IMDb or TMDb IDs',
        });
    });
    // Fetch subtitles by ID (IMDb or TMDb)
    fastify.get('/:id', async (request, reply) => {
        const id = request.params.id;
        const season = request.query.season;
        const episode = request.query.episode;
        if (!id) {
            return reply.status(400).send({ message: 'ID parameter is required' });
        }
        try {
            const subtitles = await (0, whvx_subs_1.searchSubtitles)(id, season, episode);
            // Normalize the response
            const normalized = {
                subtitles: Array.isArray(subtitles) ? subtitles : (subtitles?.subtitles || []),
                count: 0,
            };
            if (normalized.subtitles.length > 0) {
                normalized.count = normalized.subtitles.length;
                reply.status(200).send(normalized);
            }
            else {
                // Return empty array instead of error - subtitles not available is not an error
                reply.status(200).send({ subtitles: [], count: 0, message: 'No subtitles found' });
            }
        }
        catch (error) {
            console.warn('Error fetching subtitles for ID:', id, error);
            // Don't fail the request - just return empty subtitles
            reply.status(200).send({
                subtitles: [],
                count: 0,
                message: 'Subtitles service unavailable'
            });
        }
    });
    // Fetch subtitles with season and episode in path
    fastify.get('/:id/:season/:episode', async (request, reply) => {
        const id = request.params.id;
        const season = Number(request.params.season);
        const episode = Number(request.params.episode);
        if (!id) {
            return reply.status(400).send({ message: 'ID parameter is required' });
        }
        try {
            const subtitles = await (0, whvx_subs_1.searchSubtitles)(id, season, episode);
            // Normalize the response
            const normalized = {
                subtitles: Array.isArray(subtitles) ? subtitles : (subtitles?.subtitles || []),
                count: 0,
                season,
                episode,
            };
            if (normalized.subtitles.length > 0) {
                normalized.count = normalized.subtitles.length;
                reply.status(200).send(normalized);
            }
            else {
                reply.status(200).send({ subtitles: [], count: 0, message: 'No subtitles found', season, episode });
            }
        }
        catch (error) {
            console.warn('Error fetching subtitles for ID:', id, 'S' + season + 'E' + episode, error);
            // Return empty instead of error
            reply.status(200).send({
                subtitles: [],
                count: 0,
                message: 'Subtitles service unavailable',
                season,
                episode,
            });
        }
    });
    // Search subtitles with query params
    fastify.get('/search', async (request, reply) => {
        const id = request.query.id;
        const season = request.query.season;
        const episode = request.query.episode;
        if (!id) {
            return reply.status(400).send({ message: 'id query parameter is required' });
        }
        try {
            const subtitles = await (0, whvx_subs_1.searchSubtitles)(id, season, episode);
            // Normalize the response
            const normalized = {
                subtitles: Array.isArray(subtitles) ? subtitles : (subtitles?.subtitles || []),
                count: 0,
            };
            if (normalized.subtitles.length > 0) {
                normalized.count = normalized.subtitles.length;
                reply.status(200).send(normalized);
            }
            else {
                reply.status(200).send({ subtitles: [], count: 0, message: 'No subtitles found' });
            }
        }
        catch (error) {
            console.warn('Error searching subtitles:', error);
            reply.status(200).send({
                subtitles: [],
                count: 0,
                message: 'Subtitles service unavailable'
            });
        }
    });
};
exports.default = routes;
