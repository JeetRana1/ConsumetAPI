"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VidCloud = void 0;
const axios_1 = __importDefault(require("axios"));
const getClientKey_1 = require("./getClientKey");
/**
 * VidCloud extractor for handling Megacloud video sources
 * Handles encrypted video source extraction and decryption
 */
class VidCloud {
    constructor(characterSet = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))) {
        this.DefaultCharacterSet = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
        this.primaryKeyUrl = 'https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json';
        this.characterSet = [...characterSet];
    }
    LinearCongruentialPrng(seed) {
        let currentSeed = seed >>> 0;
        return () => {
            currentSeed = (currentSeed * 16807) % 2147483647;
            return currentSeed;
        };
    }
    hashKeyphraseToSeed(keyphrase) {
        let seed = 0;
        for (let i = 0; i < keyphrase.length; i++) {
            seed = (seed << 5) - seed + keyphrase.charCodeAt(i);
            seed |= 0;
        }
        return seed;
    }
    FisherYatesShuffle(array, keyphrase) {
        const seed = this.hashKeyphraseToSeed(keyphrase);
        const prng = this.LinearCongruentialPrng(seed);
        const result = [...array];
        for (let i = result.length - 1; i > 0; i--) {
            const j = prng() % (i + 1);
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }
    ColumnarTranspositionCipher(encryptedText, keyphrase) {
        const cols = keyphrase.length;
        const key = keyphrase.split('').map((char, index) => ({ char, index }));
        const sortedKey = key.sort((a, b) => a.char.localeCompare(b.char));
        const numRows = Math.ceil(encryptedText.length / cols);
        const numFullCols = encryptedText.length % cols || cols;
        const decryptedGrid = Array.from({ length: numRows }, () => Array(cols).fill(''));
        let charIndex = 0;
        for (const { index: originalColIndex } of sortedKey) {
            for (let row = 0; row < numRows; row++) {
                if (row === numRows - 1 && originalColIndex >= numFullCols) {
                    continue;
                }
                decryptedGrid[row][originalColIndex] = encryptedText[charIndex++];
            }
        }
        return decryptedGrid.flat().join('');
    }
    decrypt(encrypted, nonce, secret, iterations = 3) {
        if (!encrypted || !nonce || !secret) {
            throw new Error('Missing encrypted data, nonce, or secret.');
        }
        let result;
        try {
            result = Buffer.from(encrypted, 'base64').toString('utf8');
        }
        catch (error) {
            throw new Error(`Base64 decoding failed: ${error.message}`);
        }
        const keyphrase = secret + nonce;
        for (let i = 1; i <= iterations; i++) {
            const passphrase = keyphrase + i;
            const shuffled = this.FisherYatesShuffle(this.characterSet, passphrase);
            const mapping = new Map();
            this.characterSet.forEach((char, idx) => {
                mapping.set(shuffled[idx], char);
            });
            result = result
                .split('')
                .map((c) => mapping.get(c) || c)
                .join('');
            result = this.ColumnarTranspositionCipher(result, passphrase);
            const seed = this.hashKeyphraseToSeed(passphrase);
            const prng = this.LinearCongruentialPrng(seed);
            result = result
                .split('')
                .map((char) => {
                const charIndex = this.characterSet.indexOf(char);
                if (charIndex === -1) {
                    return char;
                }
                const offset = prng() % this.characterSet.length;
                return this.characterSet[(charIndex - offset + this.characterSet.length) % this.characterSet.length];
            })
                .join('');
        }
        const lengthStr = result.slice(0, 4);
        const content = result.slice(4);
        const length = parseInt(lengthStr, 10);
        if (isNaN(length) || length <= 0 || length > content.length) {
            return content;
        }
        return content.slice(0, length);
    }
    async fetchKey(url) {
        try {
            const res = await axios_1.default.get(url, { timeout: 10000 });
            const payload = res.data;
            // Keep compatibility with changing upstream key names.
            if (payload && typeof payload === 'object') {
                const key = payload.vidstr || payload.rabbit || payload.megacloud || payload.key;
                if (typeof key === 'string' && key.length > 0) {
                    return key;
                }
            }
            throw new Error('Invalid key format');
        }
        catch (error) {
            throw new Error(`Failed to fetch decryption key: ${error.message}`);
        }
    }
    async extract(videoUrl, referer) {
        let clientKey = null;
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                clientKey = await (0, getClientKey_1.getClientKey)(videoUrl.href, referer);
                if (clientKey)
                    break;
            }
            catch (e) {
                await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
            }
        }
        if (!clientKey)
            throw new Error('Failed to fetch ClientKey');
        const match = /\/([^\/\?]+)(?:\?|$)/.exec(videoUrl.href);
        const sourceId = match?.[1];
        if (!sourceId)
            throw new Error('Failed to fetch sourceId');
        const fullPathname = videoUrl.pathname;
        const lastSlashIndex = fullPathname.lastIndexOf('/');
        const basePathname = fullPathname.substring(0, lastSlashIndex);
        const sourcesBaseUrl = `${videoUrl.origin}${basePathname}/getSources`;
        let res;
        try {
            res = await axios_1.default.get(`${sourcesBaseUrl}?id=${sourceId}&_k=${clientKey}`, {
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                    Referer: videoUrl.href,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                },
                timeout: 15000,
            });
        }
        catch (error) {
            throw new Error(`Failed to fetch sources response: ${error.message}`);
        }
        if (!res || !res.data)
            throw new Error('Failed to fetch sources response');
        const initialResponse = res.data;
        if (!initialResponse.sources)
            throw new Error('No sources found in response');
        const extractedData = { subtitles: [], sources: [] };
        if (initialResponse.encrypted) {
            const key = await this.fetchKey(this.primaryKeyUrl);
            const decrypted = this.decrypt(initialResponse.sources, clientKey, key);
            const sources = JSON.parse(decrypted);
            extractedData.sources = sources.map((s) => ({
                url: s.file,
                isM3u8: s.type === 'hls',
                isM3U8: s.type === 'hls',
                type: s.type,
            }));
        }
        else {
            extractedData.sources = initialResponse.sources.map((s) => ({
                url: s.file,
                isM3u8: s.type === 'hls',
                isM3U8: s.type === 'hls',
                type: s.type,
            }));
        }
        if (initialResponse.tracks && Array.isArray(initialResponse.tracks)) {
            extractedData.subtitles = initialResponse.tracks.map((track) => ({
                url: track.file,
                lang: track.label || track.kind || 'Unknown',
                default: track.default || false,
            }));
        }
        return extractedData;
    }
}
exports.VidCloud = VidCloud;
