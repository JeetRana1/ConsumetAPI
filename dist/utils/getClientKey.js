"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var getClientKey_exports = {};
__export(getClientKey_exports, {
  getClientKey: () => getClientKey
});
module.exports = __toCommonJS(getClientKey_exports);
var import_axios = __toESM(require("axios"));
var cheerio = __toESM(require("cheerio"));
async function getClientKey(embedUrl, referer) {
  const salts = [];
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await import_axios.default.get(embedUrl, {
        headers: {
          Referer: referer,
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        },
        timeout: 1e4
      });
      const html = response.data;
      const $ = cheerio.load(html);
      const noncePattern1 = /\b[a-zA-Z0-9]{48}\b/;
      const match1 = html.match(noncePattern1);
      if (match1) {
        salts.push(match1[0]);
      }
      const noncePattern2 = /\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b/;
      const match2 = html.match(noncePattern2);
      if (match2 && match2.length === 4) {
        const combinedNonce = [match2[1], match2[2], match2[3]].join("");
        salts.push(combinedNonce);
      }
      const scripts = $("script").toArray();
      for (const script of scripts) {
        const content = $(script).html();
        if (!content)
          continue;
        const varMatch = content.match(/_[a-zA-Z0-9_]+\s*=\s*['"]([a-zA-Z0-9]{32,})['"]/);
        if (varMatch?.[1]) {
          salts.push(varMatch[1]);
        }
        const objMatch = content.match(
          /_[a-zA-Z0-9_]+\s*=\s*{[^}]*x\s*:\s*['"]([a-zA-Z0-9]{16,})['"][^}]*y\s*:\s*['"]([a-zA-Z0-9]{16,})['"][^}]*z\s*:\s*['"]([a-zA-Z0-9]{16,})['"]/
        );
        if (objMatch?.[1] && objMatch[2] && objMatch[3]) {
          const key = objMatch[1] + objMatch[2] + objMatch[3];
          salts.push(key);
        }
      }
      const nonceAttr = $("script[nonce]").attr("nonce");
      if (nonceAttr && nonceAttr.length >= 32) {
        salts.push(nonceAttr);
      }
      const metaElements = $("meta[name]").toArray();
      for (const meta of metaElements) {
        const name = $(meta).attr("name");
        if (name?.startsWith("_")) {
          const content = $(meta).attr("content");
          if (content && /[a-zA-Z0-9]{32,}/.test(content)) {
            salts.push(content);
          }
        }
      }
      const dataElement = $("[data-dpi], [data-key], [data-token]").first();
      if (dataElement.length > 0) {
        for (const attr of ["data-dpi", "data-key", "data-token"]) {
          const value = dataElement.attr(attr);
          if (value && /[a-zA-Z0-9]{32,}/.test(value)) {
            salts.push(value);
          }
        }
      }
      const uniqueSalts = [...new Set(salts)].filter(
        (key) => key.length >= 32 && key.length <= 64
      );
      if (uniqueSalts.length > 0) {
        return uniqueSalts[0];
      }
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 1e3 * attempt));
    }
  }
  return "";
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getClientKey
});
