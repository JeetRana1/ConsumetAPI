import axios from 'axios';
import { fetcher } from './flixhqFetcher';
import { getClientKey } from './getClientKey';

/**
 * VidCloud extractor for handling Megacloud video sources
 * Handles encrypted video source extraction and decryption
 */
export class VidCloud {
  private DefaultCharacterSet = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
  private characterSet: string[];

  constructor(characterSet = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))) {
    this.characterSet = [...characterSet];
  }

  private LinearCongruentialPrng(seed: number) {
    let currentSeed = seed >>> 0;
    return () => {
      currentSeed = (currentSeed * 16807) % 2147483647;
      return currentSeed;
    };
  }

  private hashKeyphraseToSeed(keyphrase: string) {
    let seed = 0;
    for (let i = 0; i < keyphrase.length; i++) {
      seed = (seed << 5) - seed + keyphrase.charCodeAt(i);
      seed |= 0;
    }
    return seed;
  }

  private FisherYatesShuffle(array: string[], keyphrase: string) {
    const seed = this.hashKeyphraseToSeed(keyphrase);
    const prng = this.LinearCongruentialPrng(seed);
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = prng() % (i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  private ColumnarTranspositionCipher(encryptedText: string, keyphrase: string) {
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

  public decrypt(encrypted: string, nonce: string, secret: string, iterations = 3) {
    if (!encrypted || !nonce || !secret) {
      throw new Error('Missing encrypted data, nonce, or secret.');
    }
    let result: string;
    try {
      result = Buffer.from(encrypted, 'base64').toString('utf8');
    } catch (error: any) {
      throw new Error(`Base64 decoding failed: ${error.message}`);
    }
    const keyphrase = secret + nonce;
    for (let i = 1; i <= iterations; i++) {
      const passphrase = keyphrase + i;
      const shuffled = this.FisherYatesShuffle(this.characterSet, passphrase);
      const mapping = new Map<string, string>();
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
          return this.characterSet[
            (charIndex - offset + this.characterSet.length) % this.characterSet.length
          ];
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

  private primaryKeyUrl = 'https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json';

  async fetchKey(url: string) {
    try {
      const res = await axios.get(url, { timeout: 10000 });
      const payload = res.data;
      // Keep compatibility with changing upstream key names.
      if (payload && typeof payload === 'object') {
        const key = payload.vidstr || payload.rabbit || payload.megacloud || payload.key;
        if (typeof key === 'string' && key.length > 0) {
          return key;
        }
      }
      throw new Error('Invalid key format');
    } catch (error: any) {
      throw new Error(`Failed to fetch decryption key: ${error.message}`);
    }
  }

  async extract(videoUrl: URL, referer: string) {
    let clientKey: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        clientKey = await getClientKey(videoUrl.href, referer);
        if (clientKey) break;
      } catch (e) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
    if (!clientKey) throw new Error('Failed to fetch ClientKey');

    const match = /\/([^\/\?]+)(?:\?|$)/.exec(videoUrl.href);
    const sourceId = match?.[1];
    if (!sourceId) throw new Error('Failed to fetch sourceId');

    const fullPathname = videoUrl.pathname;
    const lastSlashIndex = fullPathname.lastIndexOf('/');
    const basePathname = fullPathname.substring(0, lastSlashIndex);
    const sourcesBaseUrl = `${videoUrl.origin}${basePathname}/getSources`;

    let res;
    try {
      res = await axios.get(`${sourcesBaseUrl}?id=${sourceId}&_k=${clientKey}`, {
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Referer: videoUrl.href,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
        timeout: 15000,
      });
    } catch (error: any) {
      throw new Error(`Failed to fetch sources response: ${error.message}`);
    }

    if (!res || !res.data) throw new Error('Failed to fetch sources response');
    const initialResponse = res.data;

    if (!initialResponse.sources) throw new Error('No sources found in response');

    const extractedData: any = { subtitles: [], sources: [] };

    if (initialResponse.encrypted) {
      const key = await this.fetchKey(this.primaryKeyUrl);
      const decrypted = this.decrypt(initialResponse.sources, clientKey, key);
      const sources = JSON.parse(decrypted);
      extractedData.sources = sources.map((s: any) => ({
        url: s.file,
        isM3u8: s.type === 'hls',
        isM3U8: s.type === 'hls',
        type: s.type,
      }));
    } else {
      extractedData.sources = initialResponse.sources.map((s: any) => ({
        url: s.file,
        isM3u8: s.type === 'hls',
        isM3U8: s.type === 'hls',
        type: s.type,
      }));
    }

    if (initialResponse.tracks && Array.isArray(initialResponse.tracks)) {
      extractedData.subtitles = initialResponse.tracks.map((track: any) => ({
        url: track.file,
        lang: track.label || track.kind || 'Unknown',
        default: track.default || false,
      }));
    }

    return extractedData;
  }
}
