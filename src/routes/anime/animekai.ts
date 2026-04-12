import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import * as cheerio from 'cheerio';
import axios, { AxiosRequestConfig } from 'axios';
import { getProxyCandidates, toAxiosProxyOptions } from '../../utils/outboundProxy';

const cloudscraper: any = require('cloudscraper');

const BASE_URL = process.env.ANIMEKAI_BASE_URL || 'https://anikai.to';
const ENC_DEC_API = process.env.ANIMEKAI_ENC_API || 'https://enc-dec.app/api';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const pageHeaders = (referer = `${BASE_URL}/`) => ({
  'User-Agent': UA,
  Accept: 'text/html, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.5',
  Referer: referer,
});

const ajaxHeaders = (referer = `${BASE_URL}/`) => ({
  ...pageHeaders(referer),
  Accept: '*/*',
  'X-Requested-With': 'XMLHttpRequest',
  Cookie: '__p_mov=1; usertype=guest',
});

const toNum = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const akGet = (url: string, config: AxiosRequestConfig = {}) =>
  axios.get(url, {
    ...config,
    proxy: false,
    timeout: config.timeout || 12000,
    validateStatus: (status) => status >= 200 && status < 500,
  });

const akPost = (url: string, data: any, config: AxiosRequestConfig = {}) =>
  axios.post(url, data, {
    ...config,
    proxy: false,
    timeout: config.timeout || 12000,
    validateStatus: (status) => status >= 200 && status < 500,
  });

const akGetWithFallback = async (url: string, config: AxiosRequestConfig = {}) => {
  const directAttempt = async () =>
    await akGet(url, {
      ...config,
      proxy: false,
    });

  try {
    return await directAttempt();
  } catch {
    // Try proxy candidates when direct fetch fails.
  }

  const proxies = await getProxyCandidates();
  for (const proxyUrl of proxies) {
    try {
      const proxyOptions = toAxiosProxyOptions(proxyUrl);
      return await axios.get(url, {
        ...config,
        ...(proxyOptions as any),
        timeout: config.timeout || 12000,
        validateStatus: (status) => status >= 200 && status < 500,
      });
    } catch {
      continue;
    }
  }

  return await directAttempt();
};

const generateToken = async (text: string) => {
  const res = await akGet(`${ENC_DEC_API}/enc-kai?text=${encodeURIComponent(text)}`, {
    headers: { 'User-Agent': UA },
    timeout: 12000,
  });
  return String((res.data as any)?.result || '').trim();
};

const decodeIframeData = async (text: string) => {
  const res = await akPost(
    `${ENC_DEC_API}/dec-kai`,
    JSON.stringify({ text }),
    {
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      timeout: 12000,
    },
  );
  return (res.data as any)?.result || null;
};

const decodeMega = async (text: string) => {
  const res = await akPost(
    `${ENC_DEC_API}/dec-mega`,
    JSON.stringify({ text, agent: UA }),
    {
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      timeout: 12000,
    },
  );
  return (res.data as any)?.result || null;
};

const tryCloudscraperMedia = async (mediaUrl: string, iframeUrl: string) => {
  try {
    const raw = await cloudscraper.get({
      uri: mediaUrl,
      timeout: 30000,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        Referer: iframeUrl,
        Origin: (() => {
          try {
            return new URL(iframeUrl).origin;
          } catch {
            return '';
          }
        })(),
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    const body = String(raw || '').trim();
    if (!body) return null;
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
};

const extractStreams = async (iframeUrl: string) => {
  const mediaUrl = String(iframeUrl || '').replace('/e/', '/media/');
  const mediaRes = await akGetWithFallback(mediaUrl, {
    headers: { 'User-Agent': UA },
    timeout: 12000,
  });

  let payload = mediaRes.data as any;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      // keep original payload
    }
  }

  // Cloudflare sometimes returns challenge HTML to axios; cloudscraper can solve it.
  if (!payload || typeof payload !== 'object' || !payload.result) {
    const cfPayload = await tryCloudscraperMedia(mediaUrl, iframeUrl);
    if (cfPayload && typeof cfPayload === 'object') {
      payload = cfPayload;
    }
  }

  const encrypted = payload?.result;

  // Some hosts may return direct sources payload without encryption.
  if (Array.isArray(payload?.sources)) {
    const directSources = payload.sources
      .map((s: any) => String(s?.file || s?.url || '').trim())
      .filter(Boolean)
      .map((url: string) => ({
        url,
        isM3U8: url.includes('.m3u8') || url.endsWith('m3u8'),
      }));

    const directSubtitles = Array.isArray(payload?.tracks)
      ? payload.tracks.map((t: any) => ({
          kind: t?.kind,
          url: t?.file || t?.url,
          lang: t?.label,
        }))
      : [];

    return {
      sources: directSources,
      subtitles: directSubtitles,
      download: String(payload?.download || ''),
    };
  }

  if (!encrypted) return { sources: [], subtitles: [], download: '' };

  const decrypted = await decodeMega(encrypted);
  const sources = Array.isArray(decrypted?.sources)
    ? decrypted.sources.map((s: any) => ({
        url: String(s?.file || ''),
        isM3U8: String(s?.file || '').includes('.m3u8') || String(s?.file || '').endsWith('m3u8'),
      }))
    : [];
  const subtitles = Array.isArray(decrypted?.tracks)
    ? decrypted.tracks.map((t: any) => ({
        kind: t?.kind,
        url: t?.file,
        lang: t?.label,
      }))
    : [];

  return {
    sources,
    subtitles,
    download: String(decrypted?.download || ''),
  };
};

const routes = async (fastify: FastifyInstance, _options: RegisterOptions) => {
  const handleSearch = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = String((request.params as { query: string }).query || '').trim();
    const page = Math.max(1, toNum((request.query as { page?: number }).page, 1));
    if (!query) return reply.status(400).send({ message: 'query is required' });

    try {
      const res = await akGet(
        `${BASE_URL}/browser?keyword=${encodeURIComponent(query.replace(/[\W_]+/g, '+'))}&page=${page}`,
        { headers: pageHeaders(), timeout: 12000 },
      );
      const $ = cheerio.load(String(res.data || ''));

      const pagination = $('ul.pagination');
      const currentPage =
        parseInt(pagination.find('.page-item.active span.page-link').text().trim(), 10) || page;
      const nextPageHref = pagination.find('.page-item.active').next().find('a.page-link').attr('href');
      const hasNextPage = !!(nextPageHref && nextPageHref.includes('page='));
      const lastPageHref = pagination.find('.page-item:last-child a.page-link').attr('href');
      const totalPages = parseInt(String(lastPageHref || '').split('page=')[1] || String(currentPage), 10) || currentPage;

      const results: any[] = [];
      $('.aitem').each((_, ele) => {
        const card = $(ele);
        const atag = card.find("a[href*='/watch/']").first();
        const href = String(atag.attr('href') || '').trim();
        const id = href.replace('/watch/', '').replace(/^\/+/, '');
        if (!id) return;

        const titleNode = card.find('.title').first();
        const titleText = String(
          titleNode.text().trim() ||
          atag.text().trim() ||
          card.find('img').attr('alt') ||
          '',
        ).trim();

        const infoChildren = card.find('.info').children();
        const typeText = String(infoChildren.last().text() || card.find('.type').first().text() || '').trim();
        const imageSrc =
          card.find('img').attr('data-src') ||
          card.find('img').attr('src') ||
          card.find('[style*=background-image]').attr('style') ||
          '';

        results.push({
          id,
          title: titleText,
          url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
          image: String(imageSrc),
          japaneseTitle: titleNode.attr('data-jp')?.trim() || null,
          type: typeText,
          sub: parseInt(card.find('.info span.sub').text().trim(), 10) || 0,
          dub: parseInt(card.find('.info span.dub').text().trim(), 10) || 0,
          episodes:
            parseInt(card.find('.info').children().eq(-2).text().trim(), 10) ||
            parseInt(card.find('.info span.sub').text().trim(), 10) ||
            0,
        });
      });

      return reply.status(200).send({ currentPage, hasNextPage, totalPages, results });
    } catch (err: any) {
      return reply.status(500).send({ message: 'Error searching AnimeKai', error: err?.message || String(err) });
    }
  };

  // Docs-compatible path.
  fastify.get('/search/:query', handleSearch);
  // Backward-compatible path used by existing frontend provider lookup.
  fastify.get('/:query', handleSearch);

  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = String((request.query as { id?: string }).id || '').trim();
    if (!id) return reply.status(400).send({ message: 'id is required' });

    try {
      const animeSlug = id.split('$')[0] || id;
      const res = await akGet(`${BASE_URL}/watch/${animeSlug}`, {
        headers: pageHeaders(`${BASE_URL}/`),
        timeout: 12000,
      });
      const html = String(res.data || '');
      const $ = cheerio.load(html);

      const info: any = {
        id: animeSlug,
        title: $('.entity-scroll > .title').text().trim(),
        japaneseTitle: $('.entity-scroll > .title').attr('data-jp')?.trim() || null,
        image: $('div.poster > div > img').attr('src'),
        description: $('.entity-scroll > .desc').text().trim(),
        type: $('.entity-scroll > .info').children().last().text().trim().toUpperCase(),
        url: `${BASE_URL}/watch/${animeSlug}`,
      };

      const hasSub = $('.entity-scroll > .info > span.sub').length > 0;
      const hasDub = $('.entity-scroll > .info > span.dub').length > 0;
      info.hasSub = hasSub;
      info.hasDub = hasDub;
      info.subOrDub = hasSub && hasDub ? 'both' : hasDub ? 'dub' : 'sub';

      info.episodes = [];
      const aniId = $('.rate-box#anime-rating').attr('data-id');
      if (aniId) {
        const episodesToken = await generateToken(String(aniId));
        if (episodesToken) {
          const epRes = await akGet(`${BASE_URL}/ajax/episodes/list?ani_id=${aniId}&_=${episodesToken}`, {
            headers: ajaxHeaders(`${BASE_URL}/watch/${animeSlug}`),
            timeout: 12000,
          });
          const epHtml = (epRes.data as any)?.result;
          if (typeof epHtml === 'string') {
            const $$ = cheerio.load(epHtml);
            const subCount = parseInt($('.entity-scroll > .info > span.sub').text().trim(), 10) || 0;
            const dubCount = parseInt($('.entity-scroll > .info > span.dub').text().trim(), 10) || 0;

            $$('div.eplist > ul > li > a').each((_, el) => {
              const numAttr = String($$(el).attr('num') || '').trim();
              const tokenAttr = String($$(el).attr('token') || '').trim();
              const number = parseInt(numAttr || '0', 10);
              if (!numAttr || !tokenAttr || !number) return;

              info.episodes.push({
                id: `${animeSlug}$ep=${numAttr}$token=${tokenAttr}`,
                number,
                title: $$(el).children('span').text().trim() || `Episode ${number}`,
                isFiller: $$(el).hasClass('filler'),
                isSubbed: number <= subCount,
                isDubbed: number <= dubCount,
                url: `${BASE_URL}/watch/${animeSlug}${$$(el).attr('href') || ''}ep=${numAttr}`,
              });
            });
          }
        }
      }

      return reply.status(200).send(info);
    } catch (err: any) {
      return reply.status(500).send({ message: 'Error fetching AnimeKai info', error: err?.message || String(err) });
    }
  });

  fastify.get('/servers/:episodeId', async (request: FastifyRequest, reply: FastifyReply) => {
    const episodeId = String((request.params as { episodeId: string }).episodeId || '').trim();
    const dubParam = String((request.query as { dub?: string }).dub || '').toLowerCase();
    const subOrDub = dubParam === 'true' || dubParam === '1' ? 'dub' : 'softsub';
    if (!episodeId) return reply.status(400).send({ message: 'episodeId is required' });

    try {
      const token = episodeId.split('$token=')[1];
      if (!token) return reply.status(200).send({ servers: [] });

      const ajaxToken = await generateToken(token);
      const linksRes = await akGet(`${BASE_URL}/ajax/links/list?token=${token}&_=${ajaxToken}`, {
        headers: ajaxHeaders(`${BASE_URL}/watch/${episodeId.split('$')[0] || ''}`),
        timeout: 12000,
      });

      const serverHtml = (linksRes.data as any)?.result;
      if (typeof serverHtml !== 'string') return reply.status(200).send({ servers: [] });

      const $ = cheerio.load(serverHtml);
      const serverItems = $(`.server-items.lang-group[data-id="${subOrDub}"] .server`);
      const servers: any[] = [];

      for (const item of serverItems.toArray()) {
        const lid = $(item).attr('data-lid');
        if (!lid) continue;
        const viewToken = await generateToken(String(lid));
        const viewRes = await akGet(`${BASE_URL}/ajax/links/view?id=${lid}&_=${viewToken}`, {
          headers: ajaxHeaders(`${BASE_URL}/watch/${episodeId.split('$')[0] || ''}`),
          timeout: 12000,
        });
        const decoded = await decodeIframeData((viewRes.data as any)?.result);
        if (!decoded?.url) continue;

        servers.push({
          name: `megaup ${$(item).text().trim()}`.toLowerCase(),
          url: decoded.url,
          intro: {
            start: Number(decoded?.skip?.intro?.[0] || 0),
            end: Number(decoded?.skip?.intro?.[1] || 0),
          },
          outro: {
            start: Number(decoded?.skip?.outro?.[0] || 0),
            end: Number(decoded?.skip?.outro?.[1] || 0),
          },
        });
      }

      return reply.status(200).send({ servers });
    } catch (err: any) {
      return reply.status(500).send({ message: 'Error fetching AnimeKai servers', error: err?.message || String(err) });
    }
  });

  fastify.get('/watch/:episodeId', async (request: FastifyRequest, reply: FastifyReply) => {
    const episodeId = String((request.params as { episodeId: string }).episodeId || '').trim();
    const dubParam = String((request.query as { dub?: string }).dub || '').toLowerCase();
    const subOrDub = dubParam === 'true' || dubParam === '1' ? 'dub' : 'softsub';
    if (!episodeId) return reply.status(400).send({ message: 'episodeId is required' });

    try {
      const token = episodeId.split('$token=')[1];
      if (!token) return reply.status(200).send({ headers: { Referer: BASE_URL }, sources: [], subtitles: [] });

      const ajaxToken = await generateToken(token);
      const linksRes = await akGet(`${BASE_URL}/ajax/links/list?token=${token}&_=${ajaxToken}`, {
        headers: ajaxHeaders(`${BASE_URL}/watch/${episodeId.split('$')[0] || ''}`),
        timeout: 12000,
      });
      const serverHtml = (linksRes.data as any)?.result;
      if (typeof serverHtml !== 'string') {
        return reply.status(200).send({ headers: { Referer: BASE_URL }, sources: [], subtitles: [] });
      }

      const $ = cheerio.load(serverHtml);
      const selectors =
        subOrDub === 'dub'
          ? [".server-items.lang-group[data-id='dub']"]
          : [".server-items.lang-group[data-id='softsub']", ".lang-group[data-id='softsub']"];

      const allSources: any[] = [];
      const allSubtitles: any[] = [];
      let intro: any = null;
      let outro: any = null;
      const seenLid = new Set<string>();

      for (const selector of selectors) {
        const isDub = selector.includes("data-id='dub'");
        const items = $(`${selector} .server`);
        for (const item of items.toArray()) {
          const lid = String($(item).attr('data-lid') || '').trim();
          if (!lid || seenLid.has(lid)) continue;
          seenLid.add(lid);

          const viewToken = await generateToken(lid);
          const viewRes = await akGet(`${BASE_URL}/ajax/links/view?id=${lid}&_=${viewToken}`, {
            headers: ajaxHeaders(`${BASE_URL}/watch/${episodeId.split('$')[0] || ''}`),
            timeout: 12000,
          });
          const decoded = await decodeIframeData((viewRes.data as any)?.result);
          if (!decoded?.url) continue;

          const extracted = await extractStreams(decoded.url);
          if (!intro && Array.isArray(decoded?.skip?.intro)) intro = decoded.skip.intro;
          if (!outro && Array.isArray(decoded?.skip?.outro)) outro = decoded.skip.outro;

          for (const s of extracted.sources || []) {
            if (!s?.url) continue;
            const low = String(s.url || '').toLowerCase();
            const directPlayable = !!s.isM3U8 || low.includes('.m3u8') || low.includes('.mp4');
            if (!directPlayable) continue;
            allSources.push({
              url: s.url,
              isM3U8: !!s.isM3U8,
              quality: `AnimeKai ${$(item).text().trim()}${isDub ? ' Dub' : ' Sub'}`,
              isDub,
              referer: decoded.url,
            });
          }

          for (const sub of extracted.subtitles || []) {
            if (!sub?.url) continue;
            allSubtitles.push({
              kind: sub.kind || 'subtitles',
              lang: sub.lang || (isDub ? 'English Dub' : 'English'),
              url: sub.url,
              referer: decoded.url,
            });
          }
        }
      }

      return reply.status(200).send({
        headers: { Referer: BASE_URL },
        sources: allSources,
        subtitles: allSubtitles,
        intro,
        outro,
      });
    } catch (err: any) {
      return reply.status(500).send({ message: 'Error fetching AnimeKai watch sources', error: err?.message || String(err) });
    }
  });
};

export default routes;