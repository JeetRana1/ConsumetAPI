"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var providers_exports = {};
__export(providers_exports, {
  default: () => Providers
});
module.exports = __toCommonJS(providers_exports);
var import_extensions = require("@consumet/extensions");
class Providers {
  constructor() {
    this.getProviders = async (fastify, options) => {
      fastify.get(
        "/providers",
        {
          preValidation: (request, reply, done) => {
            const { type } = request.query;
            const providerTypes = Object.keys(import_extensions.PROVIDERS_LIST).map((element) => element);
            if (type === void 0) {
              reply.status(400);
              done(
                new Error(
                  "Type must not be empty. Available types: " + providerTypes.toString()
                )
              );
            }
            if (!providerTypes.includes(type)) {
              reply.status(400);
              done(new Error("Type must be either: " + providerTypes.toString()));
            }
            done(void 0);
          }
        },
        async (request, reply) => {
          const { type } = request.query;
          let providers = Object.values(import_extensions.PROVIDERS_LIST[type]).map((element) => element.toString).filter((p) => p.name !== "DramaCool");
          if (type === "MOVIES") {
            providers.push({
              name: "Vidzen",
              class: "VidzenProvider",
              languages: ["Multi"],
              isDirect: true
            });
          }
          providers.sort((one, two) => one.name.localeCompare(two.name));
          reply.status(200).send(providers);
        }
      );
    };
  }
}
