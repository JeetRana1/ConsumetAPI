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
var sports_exports = {};
__export(sports_exports, {
  BuffStreams: () => import_buffstreams.BuffStreams,
  Racing: () => import_racing.Racing
});
module.exports = __toCommonJS(sports_exports);
var import_buffstreams = require("./buffstreams");
var import_racing = require("./racing");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BuffStreams,
  Racing
});
