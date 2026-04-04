"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const cheerio_1 = require("cheerio");
const browserRuntimeExtractor_1 = require("../../utils/browserRuntimeExtractor");
const BASE_URL = 'https://vegamovies.actor';
const routes = async (fastify, options) => {
    fastify.get('/:query', async (request, reply) => {
        const query = request.params.query;
        const page = request.query.page || 1;
        try {
            const res = await axios_1.default.get(`${BASE_URL}/page/${page}/?s=${encodeURIComponent(query)}`);
            const $ = (0, cheerio_1.load)(res.data);
            const results = [];
            // Vegamovies articles
            $('.blog-items article').each((i, el) => {
                const title = $(el).find('h2 a').text() || $(el).find('.post-title a').text() || $(el).find('a').attr('title');
                const url = $(el).find('a').attr('href');
                const image = $(el).find('img').attr('src');
                if (title && url) {
                    results.push({
                        id: url,
                        title: title.trim(),
                        url,
                        image: image || '',
                        type: 'Movie'
                    });
                }
            });
            reply.status(200).send({
                currentPage: page,
                hasNextPage: results.length >= 10,
                results
            });
        }
        catch (err) {
            reply.status(500).send({ message: 'Something went wrong. Please try again later.' });
        }
    });
    fastify.get('/info', async (request, reply) => {
        const id = request.query.id;
        if (typeof id === 'undefined') {
            return reply.status(400).send({ message: 'id is required' });
        }
        try {
            const url = id.startsWith('http') ? id : `${BASE_URL}/${id}`;
            const res = await axios_1.default.get(url);
            const $ = (0, cheerio_1.load)(res.data);
            const title = $('h1').first().text() || $('title').text();
            const image = $('img').first().attr('src');
            const description = $('article').text().substring(0, 500).trim();
            const iframes = [];
            // Vegamovies loads iframe dynamically via JS, but IMDB ID is in the raw HTML
            const imdbMatch = String(res.data || '').match(/(tt\d{7,9})/i);
            if (imdbMatch && imdbMatch[1]) {
                iframes.push(`https://kwita408ant.com/play/${imdbMatch[1]}`);
            }
            const episodes = iframes.map((src, i) => ({
                id: src,
                title: `Stream ${i + 1}`,
                url: src
            }));
            if (episodes.length === 0) {
                // Vegamovies often requires download, fallback
                episodes.push({
                    id: url,
                    title: 'Check site manually',
                    url: url
                });
            }
            reply.status(200).send({
                id,
                title: title.replace(' - Vegamovies', '').trim(),
                url,
                image,
                description,
                episodes
            });
        }
        catch (err) {
            console.error('[vegamovies] Error fetching info:', err.message, err.response?.status);
            reply.status(500).send({ message: 'Something went wrong. Please try again later.' });
        }
    });
    fastify.get('/watch', async (request, reply) => {
        const episodeId = request.query.episodeId;
        if (typeof episodeId === 'undefined') {
            return reply.status(400).send({ message: 'episodeId is required' });
        }
        try {
            // EpisodeId is the iframe URL
            if (!episodeId.startsWith('http')) {
                return reply.status(200).send({
                    headers: {},
                    sources: [],
                    subtitles: []
                });
            }
            // Use Playwright extractor since kwita408ant hides the m3u8 behind AES decryption inside the player js.
            // Playwright intercepts the unencrypted traffic automatically after clicking the video!
            let sources = await (0, browserRuntimeExtractor_1.extractDirectSourcesWithPlaywright)(episodeId, BASE_URL, 15000);
            reply.status(200).send({
                headers: {
                    Referer: episodeId,
                },
                sources,
                subtitles: []
            });
        }
        catch (err) {
            reply.status(500).send({ message: 'Something went wrong. Please try again later.' });
        }
    });
};
exports.default = routes;
