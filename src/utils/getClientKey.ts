import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Extract client key from video embed HTML
 * Used for VidCloud/Megacloud video extraction
 */
export async function getClientKey(embedUrl: string, referer: string): Promise<string> {
  const salts: string[] = [];
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.get(embedUrl, {
        headers: {
          Referer: referer,
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
        timeout: 10000,
      });

      const html = response.data;
      const $ = cheerio.load(html);

      // Pattern 1: Look for 48-character alphanumeric string
      const noncePattern1 = /\b[a-zA-Z0-9]{48}\b/;
      const match1 = html.match(noncePattern1);
      if (match1) {
        salts.push(match1[0]);
      }

      // Pattern 2: Look for three 16-character sequences
      const noncePattern2 = /\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b/;
      const match2 = html.match(noncePattern2);
      if (match2 && match2.length === 4) {
        const combinedNonce = [match2[1], match2[2], match2[3]].join('');
        salts.push(combinedNonce);
      }

      // Pattern 3: Search in script tags
      const scripts = $('script').toArray();
      for (const script of scripts) {
        const content = $(script).html();
        if (!content) continue;

        // Look for variable assignments like _xyz = "alpha32char"
        const varMatch = content.match(/_[a-zA-Z0-9_]+\s*=\s*['"]([a-zA-Z0-9]{32,})['"]/);
        if (varMatch?.[1]) {
          salts.push(varMatch[1]);
        }

        // Look for object assignments like { x: "key1", y: "key2", z: "key3" }
        const objMatch = content.match(
          /_[a-zA-Z0-9_]+\s*=\s*{[^}]*x\s*:\s*['"]([a-zA-Z0-9]{16,})['"][^}]*y\s*:\s*['"]([a-zA-Z0-9]{16,})['"][^}]*z\s*:\s*['"]([a-zA-Z0-9]{16,})['"]/,
        );
        if (objMatch?.[1] && objMatch[2] && objMatch[3]) {
          const key = objMatch[1] + objMatch[2] + objMatch[3];
          salts.push(key);
        }
      }

      // Pattern 4: Look for nonce attributes
      const nonceAttr = $('script[nonce]').attr('nonce');
      if (nonceAttr && nonceAttr.length >= 32) {
        salts.push(nonceAttr);
      }

      // Pattern 5: Look for meta tags with name starting with underscore
      const metaElements = $('meta[name]').toArray();
      for (const meta of metaElements) {
        const name = $(meta).attr('name');
        if (name?.startsWith('_')) {
          const content = $(meta).attr('content');
          if (content && /[a-zA-Z0-9]{32,}/.test(content)) {
            salts.push(content);
          }
        }
      }

      // Pattern 6: Look for data attributes
      const dataElement = $('[data-dpi], [data-key], [data-token]').first();
      if (dataElement.length > 0) {
        for (const attr of ['data-dpi', 'data-key', 'data-token']) {
          const value = dataElement.attr(attr);
          if (value && /[a-zA-Z0-9]{32,}/.test(value)) {
            salts.push(value);
          }
        }
      }

      // Return the first valid unique salt
      const uniqueSalts = [...new Set(salts)].filter((key) => key.length >= 32 && key.length <= 64);
      if (uniqueSalts.length > 0) {
        return uniqueSalts[0];
      }
    } catch (error) {
      // Try next attempt
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }

  return '';
}
