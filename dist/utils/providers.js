"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const extensions_1 = require("@consumet/extensions");
class Providers {
    constructor() {
        this.getProviders = async (fastify, options) => {
            fastify.get('/providers', {
                preValidation: (request, reply, done) => {
                    const { type } = request.query;
                    const providerTypes = Object.keys(extensions_1.PROVIDERS_LIST).map((element) => element);
                    if (type === undefined) {
                        reply.status(400);
                        done(new Error('Type must not be empty. Available types: ' + providerTypes.toString()));
                    }
                    if (!providerTypes.includes(type)) {
                        reply.status(400);
                        done(new Error('Type must be either: ' + providerTypes.toString()));
                    }
                    done(undefined);
                },
            }, async (request, reply) => {
                const { type } = request.query;
                let providers = Object.values(extensions_1.PROVIDERS_LIST[type])
                    .map((element) => element.toString)
                    .filter((p) => p.name !== 'DramaCool');
                if (type === 'MOVIES') {
                    providers.push({
                        name: 'Vegamovies',
                        class: 'VegamoviesProvider',
                        languages: ['English', 'Hindi', 'Dual Audio'],
                        isDirect: true,
                    });
                }
                providers.sort((one, two) => one.name.localeCompare(two.name));
                reply.status(200).send(providers);
            });
        };
    }
}
exports.default = Providers;
