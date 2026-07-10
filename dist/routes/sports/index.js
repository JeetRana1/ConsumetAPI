"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const buffstreams_1 = __importDefault(require("./buffstreams"));
const racing_1 = __importDefault(require("./racing"));
const routes = async (fastify, options) => {
    fastify.register(buffstreams_1.default, { prefix: '/buffstreams' });
    fastify.register(racing_1.default, { prefix: '/racing' });
    fastify.get('/', async (_request, reply) => {
        reply.status(200).send('Welcome to Consumet Sports');
    });
};
exports.default = routes;
