"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ann_1 = __importDefault(require("./ann"));
const routes = async (fastify, options) => {
    fastify.register(ann_1.default, { prefix: '/ann' });
    fastify.get('/', async (_request, reply) => {
        reply.status(200).send('Welcome to Consumet News');
    });
};
exports.default = routes;
