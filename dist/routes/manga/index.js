"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mangapill_1 = __importDefault(require("./mangapill"));
const mangadex_1 = __importDefault(require("./mangadex"));
const mangakakalot_1 = __importDefault(require("./mangakakalot"));
const mangahere_1 = __importDefault(require("./mangahere"));
const routes = async (fastify, options) => {
    const supportedProviders = ['mangadex', 'mangahere', 'mangapill', 'mangakakalot'];
    await fastify.register(mangadex_1.default, { prefix: '/mangadex' });
    await fastify.register(mangahere_1.default, { prefix: '/mangahere' });
    await fastify.register(mangapill_1.default, { prefix: '/mangapill' });
    await fastify.register(mangakakalot_1.default, { prefix: '/mangakakalot' });
    fastify.get('/', async (request, reply) => {
        reply
            .status(200)
            .send('Welcome to Consumet Manga our available providers are: ' +
            supportedProviders.join(', '));
    });
    fastify.get('/:mangaProvider', async (request, reply) => {
        const mangaProvider = decodeURIComponent(request.params.mangaProvider);
        try {
            if (supportedProviders.includes(mangaProvider)) {
                reply.redirect(`/manga/${mangaProvider}`);
            }
            else {
                reply
                    .status(404)
                    .send({ message: 'Page not found, please check the provider list.' });
            }
        }
        catch (err) {
            reply.status(500).send('Something went wrong. Please try again later.');
        }
    });
};
exports.default = routes;
