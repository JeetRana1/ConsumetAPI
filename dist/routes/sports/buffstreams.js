"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const buffstreams_1 = require("../../providers/sports/buffstreams");
const routes = async (fastify, options) => {
    const buffstreams = new buffstreams_1.BuffStreams();
    fastify.get('/', (_, rp) => {
        rp.status(200).send({
            intro: 'Welcome to the BuffStreams sports provider',
            routes: ['/:query', '/info', '/watch'],
        });
    });
    fastify.get('/:query', async (request, reply) => {
        const query = decodeURIComponent(request.params.query);
        const date = request.query.date;
        try {
            let res = await buffstreams.search(query, { date });
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/info', async (request, reply) => {
        const id = request.query.id;
        if (typeof id === 'undefined') {
            return reply.status(400).send({ message: 'id is required' });
        }
        try {
            reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            reply.header('Pragma', 'no-cache');
            reply.header('Expires', '0');
            const res = await buffstreams.fetchMediaInfo(id);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/watch', async (request, reply) => {
        const episodeId = request.query.episodeId;
        if (typeof episodeId === 'undefined') {
            return reply.status(400).send({ message: 'episodeId is required' });
        }
        try {
            let res = await buffstreams.fetchEpisodeSources(episodeId);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/livesport', async (request, reply) => {
        const title = request.query.title;
        const sport = request.query.sport || 'soccer';
        if (typeof title === 'undefined') {
            return reply.status(400).send({ message: 'title is required' });
        }
        try {
            const { LiveSportHelper } = await Promise.resolve().then(() => __importStar(require('../../providers/sports/livesport-helper')));
            const axios = (await Promise.resolve().then(() => __importStar(require('axios')))).default;
            const client = axios.create();
            const res = await LiveSportHelper.getLiveStats(client, title, sport);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
    fastify.get('/directory', async (request, reply) => {
        try {
            const { LiveSportHelper } = await Promise.resolve().then(() => __importStar(require('../../providers/sports/livesport-helper')));
            const axios = (await Promise.resolve().then(() => __importStar(require('axios')))).default;
            const client = axios.create();
            const res = await LiveSportHelper.getGlobalDirectory(client);
            reply.status(200).send(res);
        }
        catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });
};
exports.default = routes;
