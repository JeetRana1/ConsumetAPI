import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import axios from 'axios';
import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { Redis } from 'ioredis';

const BASE_URL = 'https://www.desidubanime.me';
const JINA_PREFIX = 'https://r.jina.ai/http://';

type SearchResult = {
  id: string;
  title: string;
  url: string;
  image?: string;
  type?: string;
};

const toJinaUrl = (url: string) => `${JINA_PREFIX}${url.replace(/^https?:\/\//i, '')}`;

const fetchJinaText = async (url: string) => {
  const res = await axios.get(toJinaUrl(url), {
    timeout: 45000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  });
  return String(res.data || '');
};

const extractSlug = (animeUrl: string) => {
  const m = animeUrl.match(/\/anime\/([^\/\s)]+)\/?/i);
  return m ? m[1] : '';
};

const extractEpisodeNumber = (watchSlug: string) => {
  const m = String(watchSlug).match(/-episode-(\d+)(?:\/)?$/i);
  return m ? Number(m[1]) : 0;
};

const parseSearchResultsFromMarkdown = (md: string): SearchResult[] => {
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  const regex = /###\s+\[([^\]]+?)\]\((https?:\/\/www\.desidubanime\.me\/anime\/[^)\s]+)\)/gi;
  let m: RegExpExecArray | null = null;
  while ((m = regex.exec(md)) !== null) {
    const title = String(m[1] || '').trim();
    const url = String(m[2] || '').trim();
    const id = extractSlug(url);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title,
      url,
      type: 'TV',
    });
  }
  return out;
};

const parseInfoFromMarkdown = (id: string, md: string) => {
  const titleMatch = md.match(/^Title:\s*(.+?)\s*-\s*Desi Dub Anime/im);
  const title = String(titleMatch?.[1] || id).trim();

  const overviewMatch = md.match(/Overview:([\s\S]+?)(?:\n\n\*|More Season|Episodes|-{3,}|###)/i);
  const description = overviewMatch ? String(overviewMatch[1]).trim() : '';

  const imgMatch = md.match(/!\[Image[^\]]*\]\((https?:\/\/[^\s)]+)\)/i);
  const image = imgMatch?.[1];

  const epRegex =
    /\[!\[Image[^\]]*\]\([^)]+\)\s+(.+?)\s+play_circle_filled\s+Episode\s+(\d+)\]\((https?:\/\/www\.desidubanime\.me\/watch\/[^)\s]+)\s+/gi;
  const episodes: any[] = [];
  let em: RegExpExecArray | null = null;
  while ((em = epRegex.exec(md)) !== null) {
    const epTitle = String(em[1] || '').trim();
    const number = Number(em[2] || 0);
    const url = String(em[3] || '').trim();
    const watchSlug = url
      .replace(/^https?:\/\/www\.desidubanime\.me\/watch\//i, '')
      .replace(/\/+$/, '');
    if (!watchSlug || !number) continue;
    episodes.push({
      id: watchSlug,
      number,
      title: epTitle || `Episode ${number}`,
      url,
    });
  }

  episodes.sort((a, b) => a.number - b.number);

  return {
    id,
    title,
    image,
    description,
    episodes,
  };
};

const sanitizeSources = (payload: any, opts?: { allowEmbedIfNoDirect?: boolean }) => {
  const sources = Array.isArray(payload?.sources) ? payload.sources : [];
  const direct = sources.filter((s: any) => {
    const u = String(s?.url || '').toLowerCase();
    if (!u) return false;
    if (u.includes('.mpd')) return false;
    return !Boolean(s?.isEmbed) && (Boolean(s?.isM3U8) || u.includes('.m3u8') || u.includes('.mp4'));
  });

  const allowEmbedIfNoDirect = Boolean(opts?.allowEmbedIfNoDirect);
  const embed = allowEmbedIfNoDirect
    ? sources.filter((s: any) => {
        const u = String(s?.url || '').toLowerCase();
        if (!u || u.includes('.mpd')) return false;
        return Boolean(s?.isEmbed);
      })
    : [];
  const filtered = direct.length ? direct : embed;

  return {
    ...payload,
    sources: filtered,
  };
};

const pickBestByTitle = (results: any[], title: string) => {
  const needle = String(title || '').toLowerCase().trim();
  if (!needle) return results[0];
  const exact = results.find((r) => String(r?.title || '').toLowerCase().trim() === needle);
  if (exact) return exact;
  const contains = results.find((r) =>
    String(r?.title || '').toLowerCase().includes(needle),
  );
  if (contains) return contains;
  return results[0];
};

const routes = async (fastify: FastifyInstance, _options: RegisterOptions) => {
  fastify.get('/', async (_, reply) => {
    reply.status(200).send({
      intro: `Welcome to the desidubanime provider: ${BASE_URL}`,
      note: 'Catalog is read from desidubanime.me. On watch failure, fallback is Satoru only.',
      routes: ['/:query', '/info', '/info/:id', '/watch/:episodeId'],
    });
  });

  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.params as { query: string }).query;
    const page = Number((request.query as { page?: number }).page || 1);

    try {
      const key = `desidubanime:search:${query}:${page}`;
      const data = redis
        ? await cache.fetch(
            redis as Redis,
            key,
            async () => {
              const md = await fetchJinaText(`${BASE_URL}/search?keyword=${encodeURIComponent(query)}`);
              return parseSearchResultsFromMarkdown(md);
            },
            REDIS_TTL,
          )
        : parseSearchResultsFromMarkdown(
            await fetchJinaText(`${BASE_URL}/search?keyword=${encodeURIComponent(query)}`),
          );

      reply.status(200).send({
        currentPage: page,
        hasNextPage: false,
        results: data,
      });
    } catch (err) {
      reply.status(500).send({
        message: (err as Error).message,
      });
    }
  });

  const infoHandler = async (id: string, reply: FastifyReply) => {
    try {
      const key = `desidubanime:info:${id}`;
      const data = redis
        ? await cache.fetch(
            redis as Redis,
            key,
            async () => {
              const md = await fetchJinaText(`${BASE_URL}/anime/${id}/`);
              return parseInfoFromMarkdown(id, md);
            },
            REDIS_TTL,
          )
        : parseInfoFromMarkdown(id, await fetchJinaText(`${BASE_URL}/anime/${id}/`));

      reply.status(200).send(data);
    } catch (err) {
      reply.status(500).send({
        message: (err as Error).message,
      });
    }
  };

  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = String((request.query as { id?: string }).id || '').trim();
    if (!id) return reply.status(400).send({ message: 'id is required' });
    return infoHandler(id, reply);
  });

  fastify.get('/info/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = String((request.params as { id: string }).id || '').trim();
    if (!id) return reply.status(400).send({ message: 'id is required' });
    return infoHandler(id, reply);
  });

  fastify.get('/watch/:episodeId', async (request: FastifyRequest, reply: FastifyReply) => {
    const episodeId = String((request.params as { episodeId: string }).episodeId || '').trim();

    if (!episodeId) return reply.status(400).send({ message: 'episodeId is required' });

    try {
      const epNumber = extractEpisodeNumber(episodeId);
      if (!epNumber) {
        return reply.status(404).send({ message: 'Could not parse episode number from id.' });
      }

      const md = await fetchJinaText(`${BASE_URL}/watch/${episodeId}/`);
      const animeLinkMatch = md.match(
        /####\s+\[[^\]]+?\]\(https?:\/\/www\.desidubanime\.me\/anime\/([^\/)\s]+)\/?/i,
      );
      const animeSlug = String(animeLinkMatch?.[1] || '').trim();
      if (!animeSlug) {
        return reply.status(404).send({ message: 'Could not resolve anime slug from episode page.' });
      }

      const info = parseInfoFromMarkdown(animeSlug, await fetchJinaText(`${BASE_URL}/anime/${animeSlug}/`));
      const title = String(info?.title || animeSlug.replace(/-/g, ' ')).trim();
      // Fallback policy requested by user: Satoru only.
      const sSearchRes = await fastify.inject({
        method: 'GET',
        url: `/anime/satoru/${encodeURIComponent(title)}`,
      });
      if (sSearchRes.statusCode >= 400) {
        return reply.status(502).send({ message: 'DesiDubAnime failed and Satoru search failed.' });
      }
      const sSearchPayload: any = JSON.parse(sSearchRes.body || '{}');
      const sResults = Array.isArray(sSearchPayload?.results) ? sSearchPayload.results : [];
      if (!sResults.length) {
        return reply.status(404).send({ message: 'DesiDubAnime failed and no Satoru match found.' });
      }
      const picked = pickBestByTitle(sResults, title);
      if (!picked?.id) {
        return reply.status(404).send({ message: 'DesiDubAnime failed and no Satoru match found.' });
      }

      const sInfoRes = await fastify.inject({
        method: 'GET',
        url: `/anime/satoru/info/${encodeURIComponent(String(picked.id))}`,
      });
      if (sInfoRes.statusCode >= 400) {
        return reply.status(502).send({ message: 'DesiDubAnime failed and Satoru info failed.' });
      }
      const sInfoPayload: any = JSON.parse(sInfoRes.body || '{}');
      const sEpisodes = Array.isArray(sInfoPayload?.episodes) ? sInfoPayload.episodes : [];
      const sEpisode =
        sEpisodes.find((ep: any) => Number(ep?.number) === epNumber) ||
        sEpisodes[Math.max(0, Math.min(sEpisodes.length - 1, epNumber - 1))];
      if (!sEpisode?.id) {
        return reply.status(404).send({ message: 'DesiDubAnime failed and Satoru episode not found.' });
      }

      const encodedWatchId = encodeURIComponent(String(sEpisode.id));
      const watchCandidates = [
        `/anime/satoru/watch/${encodedWatchId}`,
        `/anime/satoru/watch/${encodedWatchId}?serverId=hd-1`,
      ];

      for (const watchUrl of watchCandidates) {
        const sWatchRes = await fastify.inject({
          method: 'GET',
          url: watchUrl,
        });
        if (sWatchRes.statusCode >= 400) continue;
        const sWatchPayload: any = JSON.parse(sWatchRes.body || '{}');
        const clean = sanitizeSources(sWatchPayload, { allowEmbedIfNoDirect: true });
        if (Array.isArray(clean?.sources) && clean.sources.length) {
          return reply.status(200).send(clean);
        }
      }

      return reply.status(502).send({ message: 'DesiDubAnime failed and Satoru watch returned no sources.' });
    } catch (err) {
      reply.status(500).send({
        message: (err as Error).message,
      });
    }
  });
};

export default routes;
