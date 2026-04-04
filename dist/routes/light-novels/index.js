"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const routes = async (fastify, options) => {
    fastify.get('/', async (request, reply) => {
        reply.status(200).send('Welcome to Consumet Light Novels');
    });
};
exports.default = routes;
