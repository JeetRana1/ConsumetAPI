import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { META, PROVIDERS_LIST, StreamingServers, MOVIES, ANIME } from '@consumet/extensions';
import { tmdbApi } from '../../main';
import axios from 'axios';
import { getCache, setCache } from '../../utils/cache';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  const normalizeResult = (res: any) => {
    const title = res.title || res.name || 'Unknown';
    // Improved type detection: Consumet often returns 'TV Series' or 'Movie'
    // but sometimes TMDB raw returns 'tv' or 'movie'.
    let mediaType = 'movie';
    const rawType = (res.type || res.media_type || '').toLowerCase();
    if (rawType.includes('tv') || rawType.includes('series')) {
      mediaType = 'tv';
    }

    return {
      ...res,
      id: res.id,
      title: title,
      name: title,
      poster_path: res.image || res.poster,
      backdrop_path: res.cover || res.image,
      vote_average: res.rating || 0,
      release_date: res.releaseDate,
      first_air_date: res.releaseDate,
      media_type: mediaType,
    };
  };

  const normalizeInfo = (res: any) => {
    if (!res) return {};
    const title = res.title || res.name || 'Unknown';
    return {
      id: res.id,
      title: title,
      name: title,
      poster_path: res.image || res.poster || res.poster_path,
      backdrop_path: res.cover || res.image || res.backdrop_path,
      vote_average: res.rating || res.vote_average || 0,
      release_date: res.releaseDate || res.release_date || res.first_air_date,
      first_air_date: res.releaseDate || res.first_air_date,
      overview: res.description || res.overview,
      genres: Array.isArray(res.genres)
        ? res.genres.map((g: any) => typeof g === 'string' ? { name: g } : g)
        : [],
      credits: {
        cast: Array.isArray(res.cast)
          ? res.cast.map((c: any) => ({
            name: c.name,
            character: c.character,
            profile_path: c.image || c.profile_path,
          }))
          : [],
        crew: [],
      },
      seasons: Array.isArray(res.seasons)
        ? res.seasons.map((s: any) => ({
          ...s,
          episodes: [] // Strip episodes to reduce payload size
        }))
        : [],
      runtime: res.duration || res.runtime || 0,
      status: res.status || 'Released',
      // Explicitly NOT spreading ...res
    };
  };

  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro:
        "Welcome to the tmdb provider: check out the provider's website @ https://www.themoviedb.org/",
      routes: ['/:query', '/info/:id', '/watch/:episodeId'],
      documentation: 'https://docs.consumet.org/#tag/tmdb',
    });
  });

  fastify.get('/info/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const id = (request.params as { id: string }).id;
      const type = (request.query as { type: string }).type;
      const provider = (request.query as { provider?: string }).provider;
      let tmdb = new META.TMDB(tmdbApi);

      if (!type) return reply.status(400).send({ success: false, message: "The 'type' query is required" });

      // Check cache first
      const cacheKey = `tmdb:info:${id}:${type}:${provider || 'default'}`;
      const cached = await getCache(cacheKey);
      if (cached) {
        console.log(`[Cache HIT] ${cacheKey}`);
        return reply.status(200).send(cached);
      }

      if (typeof provider !== 'undefined') {
        const possibleProvider = PROVIDERS_LIST.MOVIES.find(
          (p) => p.name.toLowerCase() === provider.toLocaleLowerCase(),
        );
        tmdb = new META.TMDB(tmdbApi, possibleProvider);
      }

      let res: any;
      try {
        console.log(`[TMDB Info] Fetching ${type} with ID ${id}...`);
        res = await tmdb.fetchMediaInfo(id, type);
        console.log(`[TMDB Info] Fetch successful, got:`, res?.id, res?.title || res?.name);
      } catch (e: any) {
        console.warn(`[TMDB Info] Primary fetch failed for ${id} (${type}): ${e.message}`);
        if (e.message?.includes('404') || e.response?.status === 404) {
          const fallbackType = type === 'tv' ? 'movie' : 'tv';
          console.log(`[TMDB Info] Trying fallback ${fallbackType} for ${id}...`);
          try {
            res = await tmdb.fetchMediaInfo(id, fallbackType);
          } catch (fallbackErr: any) {
            console.warn(`[TMDB Info] Fallback failed: ${fallbackErr.message}`);
          }
        }
      }

      // Some TV shows (like Pokemon) return empty string for id
      // Check for title/name instead as validation
      if (!res || (!res.title && !res.name)) {
        throw new Error('Media info not found (404)');
      }

      let normalized;
      try {
        normalized = normalizeInfo(res);
        // Ensure we always have the ID from the request
        if (!normalized.id) {
          normalized.id = id;
        }
      } catch (normErr: any) {
        console.error(`[TMDB Info] Normalization failed for ${id}: ${normErr.message}`);
        normalized = res; // Fallback to raw response
      }

      // Wrap in standard response format for player.html
      const responseData = {
        success: true,
        data: normalized
      };

      // Cache for 1 hour
      await setCache(cacheKey, responseData, 3600);
      console.log(`[Cache SET] ${cacheKey}`);

      return reply.status(200).send(responseData);

    } catch (err: any) {
      console.error(`[TMDB Info Fatal Error]`, err);
      return reply.status(500).send({
        success: false,
        message: err.message || 'Failed to fetch media info',
        error: err.toString()
      });
    }
  });

  fastify.get('/trending', async (request: FastifyRequest, reply: FastifyReply) => {
    const validTimePeriods = new Set(['day', 'week'] as const);
    type validTimeType = typeof validTimePeriods extends Set<infer T> ? T : undefined;

    const type = (request.query as { type?: string }).type || 'all';
    let timePeriod =
      (request.query as { timePeriod?: validTimeType }).timePeriod || 'day';

    if (!validTimePeriods.has(timePeriod)) timePeriod = 'day';

    const page = (request.query as { page?: number }).page || 1;

    // Check cache
    const cacheKey = `tmdb:trending:${type}:${timePeriod}:${page}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      console.log(`[Cache HIT] ${cacheKey}`);
      return reply.status(200).send(cached);
    }

    const tmdb = new META.TMDB(tmdbApi);

    try {
      const res = await tmdb.fetchTrending(type, timePeriod, page);
      console.log(`[TMDB Trending] Type: ${type}, Time: ${timePeriod}, Results: ${res.results?.length}`);
      res.results = res.results.map(normalizeResult);

      // Cache for 1 hour
      await setCache(cacheKey, res, 3600);
      console.log(`[Cache SET] ${cacheKey}`);

      reply.status(200).send(res);
    } catch (err) {
      reply.status(500).send({ message: 'Failed to fetch trending media.' });
    }
  });

  fastify.get('/popular', async (request: FastifyRequest, reply: FastifyReply) => {
    const type = (request.query as { type?: string }).type || 'movie';
    const page = (request.query as { page?: number }).page || 1;

    // Check cache
    const cacheKey = `tmdb:popular:${type}:${page}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      console.log(`[Cache HIT] ${cacheKey}`);
      return reply.status(200).send(cached);
    }

    const tmdb = new META.TMDB(tmdbApi);
    try {
      const res = await tmdb.fetchTrending(type, 'day', page);
      res.results = res.results.map(normalizeResult);

      // Cache for 1 hour
      await setCache(cacheKey, res, 3600);
      console.log(`[Cache SET] ${cacheKey}`);

      reply.status(200).send(res);
    } catch (err) {
      reply.status(500).send({ message: 'Failed to fetch popular media.' });
    }
  });

  // Shim for StreamVerse player.html compatibility
  fastify.get('/mediaInfo', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.query as { id: string }).id;
    const type = (request.query as { type: string }).type || 'movie';
    const s = (request.query as { s?: string }).s;
    const e = (request.query as { e?: string }).e;

    const tmdb = new META.TMDB(tmdbApi);

    // Check cache for stream data
    const streamCacheKey = `tmdb:stream:${id}:${type}${s ? `:s${s}` : ''}${e ? `:e${e}` : ''}`;
    const cachedStream = await getCache(streamCacheKey);
    if (cachedStream) {
      console.log(`[Cache HIT] ${streamCacheKey}`);
      return reply.status(200).send(cachedStream);
    }

    try {
      if (type === 'tv' && (!s || !e)) {
        // Return Season/Episode structure
        let info: any;
        try {
          info = await tmdb.fetchMediaInfo(id, 'tv');
        } catch (e: any) {
          if (e.message?.includes('404')) {
            // Check if it's actually a movie - this handles search result mismatches
            console.log(`[TMDB Meta] TV structure failed for ${id}, checking if it's a movie...`);
            const movieInfo = await tmdb.fetchMediaInfo(id, 'movie');
            // Return as a single-episode movie structure for the player
            return reply.status(200).send({
              success: true,
              data: {
                playlist: [{
                  title: 'Feature Film',
                  season: 1,
                  folder: [{
                    title: movieInfo.title || movieInfo.name,
                    id: movieInfo.id,
                    season: 1,
                    episode: 1
                  }]
                }],
                key: ''
              },
              extraSources: []
            });
          }
          throw e;
        }
        const response = {
          success: true,
          data: {
            playlist: ((info.seasons || []) as any[]).map((season) => ({
              title: `Season ${season.number ?? season.season}`,
              season: season.number ?? season.season,
              folder: ((season.episodes || []) as any[]).map((ep) => ({
                title: ep.title || `Episode ${ep.number ?? ep.episode}`,
                id: ep.id,
                season: season.number ?? season.season,
                episode: ep.number ?? ep.episode
              })),
            })),
            key: '',
          },
          extraSources: [],
        };
        return reply.status(200).send(response);
      }

      // If specific episode or movie, fetch sources
      let lastError = 'No stream found for this media.';
      let targetInfo: any;
      let actualType = type;

      try {
        console.log(`[TMDB Meta] Fetching target info for ID ${id} (${type})...`);
        try {
          targetInfo = await tmdb.fetchMediaInfo(id, type);
        } catch (e: any) {
          if (e.message?.includes('404')) {
            const fallbackType = type === 'tv' ? 'movie' : 'tv';
            console.log(`[TMDB Meta] ${type} failed for ${id}, trying fallback ${fallbackType}...`);
            targetInfo = await tmdb.fetchMediaInfo(id, fallbackType);
            actualType = fallbackType;
          } else {
            throw e;
          }
        }
      } catch (e) {
        console.warn(`[TMDB Meta] Could not fetch target info from TMDB for ID ${id}`);
        return reply.status(404).send({ success: false, message: "Media info not found (404)" });
      }

      const targetTitle = (targetInfo.title || targetInfo.name || '').toString();
      const targetYear = targetInfo.releaseDate ? new Date(targetInfo.releaseDate).getFullYear() : null;
      const targetImdbId = targetInfo.external_ids?.imdb_id || null;

      // Determine if this is anime content
      let isAnime = false;
      const genres = targetInfo.genres || [];
      isAnime = genres.some((g: any) => {
        const genreName = typeof g === 'string' ? g : g.name;
        return genreName && genreName.toLowerCase().includes('anim');
      });

      console.log(`[TMDB Meta] Target: "${targetTitle}" (${targetYear}) Content type: ${isAnime ? 'ANIME' : 'MOVIE/TV'}, Genres:`, genres.map((g: any) => typeof g === 'string' ? g : g.name));

      const providers = isAnime ? [
        new ANIME.Hianime(),
        new ANIME.AnimePahe(),
        new MOVIES.FlixHQ(), // FlixHQ has lots of anime too
      ] : [
        new MOVIES.FlixHQ(),
        new MOVIES.SFlix(),
        new MOVIES.Goku(),
        new MOVIES.HiMovies(),
      ];

      const checkProvider = async (provider: any) => {
        const pName = provider?.name || provider?.constructor?.name || 'Unknown';

        try {
          console.log(`[TMDB Meta] Attempting ${pName} for ${id} (${type})...`);

          // Handle anime providers differently
          if (isAnime && type === 'tv' && s && e) {
            console.log(`[TMDB Meta] Using anime provider ${pName} to search for: ${targetTitle}`);

            // Search for the anime
            const searchResults = await provider.search(targetTitle);
            if (!searchResults || !searchResults.results || searchResults.results.length === 0) {
              console.log(`[TMDB Meta] No anime found for: ${targetTitle}`);
              return null;
            }

            // Find best match (search for exact title match if possible)
            let animeMatch = searchResults.results[0];
            const exactMatch = searchResults.results.find((r: any) =>
              r.title.toLowerCase() === targetTitle.toLowerCase() ||
              (r.title.toLowerCase().includes(targetTitle.toLowerCase()) && !r.title.toLowerCase().includes('xyz') && !r.title.toLowerCase().includes('sun'))
            );
            if (exactMatch) animeMatch = exactMatch;

            console.log(`[TMDB Meta] Best anime match: ${animeMatch.title} (ID: ${animeMatch.id})`);

            // Get anime info with episodes
            const animeInfo = await provider.fetchAnimeInfo(animeMatch.id);
            if (!animeInfo || !animeInfo.episodes || animeInfo.episodes.length === 0) {
              console.log(`[TMDB Meta] No episodes found for anime ID: ${animeMatch.id}`);
              return null;
            }

            // Find the episode
            const episodeNumber = parseInt(e!);
            const episode = animeInfo.episodes.find((ep: any) => ep.number === episodeNumber);

            if (!episode) {
              console.log(`[TMDB Meta] Episode ${episodeNumber} not found in anime info.`);
              return null;
            }

            console.log(`[TMDB Meta] Found episode: ${episode.title || `Episode ${episode.number}`} (ID: ${episode.id})`);

            // Fetch sources
            const sources = await provider.fetchEpisodeSources(episode.id);
            if (!sources || !sources.sources || sources.sources.length === 0) {
              console.log(`[TMDB Meta] No sources found for episode ${episode.id}`);
              return null;
            }

            console.log(`[TMDB Meta] Found ${sources.sources.length} sources from ${pName}`);
            const host = request.headers.host || `${request.hostname}:3001`;
            const referer = sources.headers?.Referer || sources.headers?.referer || '';

            return {
              sources: sources.sources.map((src: any) => ({
                file: `${request.protocol}://${host}/meta/tmdb/proxy?url=${encodeURIComponent(src.url)}&proxy_ref=${encodeURIComponent(referer)}`,
                original_file: src.url, // Keep original for reference
                label: src.quality || 'Auto',
                type: src.isM3U8 ? 'hls' : 'mp4',
                headers: sources.headers || {},
                provider: pName
              })),
              subtitles: (sources.subtitles || []).map((sub: any) => ({
                ...sub,
                url: `${request.protocol}://${host}/meta/tmdb/proxy?url=${encodeURIComponent(sub.url)}&proxy_ref=${encodeURIComponent(referer)}`
              }))
            };
          }

          // Original movie/TV provider logic
          const pTmdb = new META.TMDB(tmdbApi, provider);

          let sources: any;
          // 1. Get info
          let info = await pTmdb.fetchMediaInfo(id, type);
          let pId = info.id;

          // 2. Validate Year
          let providerYear: number | null = null;
          try {
            const rawInfo = await provider?.fetchMediaInfo(pId);
            if (rawInfo) {
              if (rawInfo.releaseDate) {
                const d = new Date(rawInfo.releaseDate);
                if (!isNaN(d.getFullYear())) providerYear = d.getFullYear();
                else providerYear = parseInt(rawInfo.releaseDate);
              } else if (rawInfo.year) {
                providerYear = parseInt(rawInfo.year);
              }
            }
            console.log(`[TMDB Meta] Provider ${pName} returned ID: ${pId} with Year: ${providerYear}`);
          } catch (e) {
            console.warn(`[TMDB Meta] Could not verify provider year for ${pName}: ${e}`);
            providerYear = info.releaseDate ? new Date(info.releaseDate).getFullYear() : null;
          }

          if (targetYear && providerYear) {
            if (Math.abs(targetYear - providerYear) > 1) {
              console.log(`[TMDB Meta] Year mismatch for ${pName}: Expected ${targetYear}, got ${providerYear}. Attempting manual search...`);

              let targetTitle = '';
              try {
                const tInfo = await tmdb.fetchMediaInfo(id, type);
                targetTitle = (tInfo.title || tInfo.name || '').toString();
              } catch (e) {
                console.warn(`[TMDB Meta] Could not fetch target title for manual search: ${e}`);
                throw new Error('Target title lookup failed');
              }

              console.log(`[TMDB Meta] Manual search for: ${targetTitle} (${type})`);

              const searchResults: any = await provider?.search(targetTitle).catch(() => ({ results: [] }));
              let match = null;

              if (searchResults && searchResults.results) {
                match = searchResults.results.find((r: any) => {
                  let rYear: number | null = null;
                  if (r.releaseDate) {
                    const d = new Date(r.releaseDate);
                    if (!isNaN(d.getFullYear())) rYear = d.getFullYear();
                    else rYear = parseInt(r.releaseDate);
                  }
                  return rYear && Math.abs(targetYear! - rYear) <= 1;
                });
              }

              if (match) {
                console.log(`[TMDB Meta] Manual search successful! Found: ${match.title} (${match.releaseDate}) ID: ${match.id}`);
                pId = match.id;
                if (type === 'movie') {
                  info = { ...info, id: match.id, episodeId: match.id };
                  try {
                    const newInfo = await provider?.fetchMediaInfo(match.id);
                    if (newInfo) info = { ...info, ...newInfo } as any;
                  } catch (e) { }
                } else {
                  info = { ...info, id: match.id };
                  try {
                    const newInfo = await pTmdb.fetchMediaInfo(match.id, type).catch(() => null);
                    if (newInfo) info = newInfo;
                  } catch (e) { }
                }
              } else {
                console.log(`[TMDB Meta] No matching year found.`);
                throw new Error(`Year validation failed for ${pName}`);
              }
            }
          }

          // 3. Fetch Sources
          let allSources: any[] = [];
          let allSubtitles: any[] = [];

          if (type === 'tv') {
            // Find the correct episode ID from the provider's info
            let episodeId = `S${s}E${e}`; // Default fallback

            if (info.seasons && Array.isArray(info.seasons)) {
              const seasonObj = info.seasons.find((se: any) => se.season === parseInt(s!) || se.number === parseInt(s!));
              if (seasonObj && seasonObj.episodes) {
                const epObj = seasonObj.episodes.find((ep: any) => ep.episode === parseInt(e!) || ep.number === parseInt(e!));
                if (epObj) episodeId = epObj.id;
              }
            }

            console.log(`[TMDB Meta] Fetching servers for episode: ${episodeId} (Provider: ${pName})`);

            const serverList = await (provider as any)?.fetchEpisodeServers(episodeId, pId).catch(() => []);

            if (serverList && serverList.length > 0) {
              // Try servers in parallel but handle errors gracefully
              const serverPromises = serverList.map(async (srv: any) => {
                try {
                  const srvRes = await (provider as any)?.fetchEpisodeSources(episodeId, pId, srv.name);
                  if (srvRes) {
                    return {
                      sources: (srvRes.sources || []).map((src: any) => ({
                        ...src,
                        quality: `${srv.name} ${src.quality || ''}`.trim(),
                        headers: srvRes.headers || {} // Capture headers if available
                      })),
                      subtitles: srvRes.subtitles || []
                    };
                  }
                } catch (err) { return null; }
              });

              const results = await Promise.all(serverPromises);
              results.forEach(r => {
                if (r) {
                  if (r.sources) allSources.push(...r.sources);
                  if (r.subtitles) allSubtitles.push(...r.subtitles);
                }
              });
            } else {
              // Fallback to default source fetch if no servers returned
              const defaults = await (provider as any)?.fetchEpisodeSources(episodeId, pId).catch(() => null);
              if (defaults) {
                if (defaults.sources) allSources.push(...defaults.sources);
                if (defaults.subtitles) allSubtitles.push(...defaults.subtitles);
              }
            }

          } else {
            // MOVIE Logic (already working, but kept consistent)
            let episodeId = info.episodeId || pId;
            const serverList = await (provider as any)?.fetchEpisodeServers(episodeId, pId).catch(() => []);

            if (serverList && serverList.length > 0) {
              const serverPromises = serverList.map(async (srv: any) => {
                try {
                  const srvRes = await (provider as any)?.fetchEpisodeSources(episodeId, pId, srv.name);
                  if (srvRes) {
                    return { sources: srvRes.sources, subtitles: srvRes.subtitles, headers: srvRes.headers };
                  }
                } catch (err) { return null; }
              });

              const results = await Promise.all(serverPromises);
              results.forEach(r => {
                if (r) {
                  if (r.sources) allSources.push(...r.sources);
                  if (r.subtitles) allSubtitles.push(...r.subtitles);
                }
              });
            } else {
              const defaults = await (provider as any)?.fetchEpisodeSources(episodeId, pId).catch(() => null);
              if (defaults) {
                if (defaults.sources) allSources.push(...defaults.sources);
                if (defaults.subtitles) allSubtitles.push(...defaults.subtitles);
              }
            }
          }

          if (allSources.length > 0) {
            console.log(`[TMDB Meta] Found ${allSources.length} sources from ${pName}`);
            const host = request.headers.host || `${request.hostname}:3001`;

            return {
              sources: allSources.map((src: any) => {
                const referer = src.headers?.Referer || src.headers?.referer || '';
                return {
                  file: `${request.protocol}://${host}/meta/tmdb/proxy?url=${encodeURIComponent(src.url)}&proxy_ref=${encodeURIComponent(referer)}`,
                  original_file: src.url,
                  label: src.quality || 'Auto',
                  type: src.isM3U8 ? 'hls' : 'mp4',
                  headers: src.headers || {}, // Pass through headers
                  provider: pName
                };
              }),
              subtitles: allSubtitles.map((sub: any) => {
                // Find a referer from sources if possible, otherwise use empty
                const referer = allSources[0]?.headers?.Referer || allSources[0]?.headers?.referer || '';
                return {
                  ...sub,
                  url: `${request.protocol}://${host}/meta/tmdb/proxy?url=${encodeURIComponent(sub.url)}&proxy_ref=${encodeURIComponent(referer)}`
                };
              })
            };
          }
          return null;

        } catch (err: any) {
          console.log(`Provider ${pName} failed: ${err.message}`);
          return null;
        }
      };

      try {
        // Run all providers in parallel with individual timeouts
        const providerWithTimeout = async (p: any) => {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout for ${p?.name || 'Unknown'}`)), 30000)
          );
          try {
            const res: any = await Promise.race([checkProvider(p), timeoutPromise]);
            if (res && res.sources && res.sources.length > 0) {
              return res;
            }
            throw new Error('No sources found');
          } catch (e) {
            // console.warn(`[TMDB Meta] Provider ${p?.name} skipped: ${e}`);
            throw e; // Propagate error for Promise.any
          }
        };

        let validResults: any[] = [];
        try {
          // Return the FIRST successful provider with sources
          const winner = await Promise.any(providers.map(p => providerWithTimeout(p)));
          validResults = [winner];
        } catch (err) {
          // If all failed, validResults remains empty
          console.log("[TMDB Meta] All providers failed or found no sources.");
        }

        const allPlaylist: any[] = [];
        const allSubtitles: any[] = [];

        validResults.forEach((res: any) => {
          if (res) {
            allPlaylist.push(...res.sources);
            allSubtitles.push(...res.subtitles);
          }
        });

        // ... existing 8Stream removal ...

        // Deduplicate playlist by file URL

        // Deduplicate playlist by file URL
        const uniquePlaylist = allPlaylist.filter((v: any, i: number, a: any[]) =>
          a.findIndex((t: any) => t.file === v.file) === i
        );

        // Deduplicate subtitles by URL
        const deduplicatedSubtitles = allSubtitles.filter((v: any, i: number, a: any[]) =>
          a.findIndex((t: any) => t.url === v.url) === i
        );

        const finalResult = {
          success: uniquePlaylist.length > 0,
          data: {
            playlist: uniquePlaylist,
            key: '',
            subtitles: deduplicatedSubtitles
          },
          extraSources: [],
          message: undefined
        };

        // Cache result
        const cacheKey = `tmdb:stream:${id}:${type}${s ? `:s${s}` : ''}${e ? `:e${e}` : ''}`;
        await setCache(cacheKey, finalResult, 1800);

        return reply.status(200).send(finalResult);
      } catch (e) {
        // Fall through to failure response
      }
      reply.status(200).send({
        success: false,
        message: lastError,
        extraSources: []
      });
    } catch (err: any) {
      reply.status(200).send({
        success: false,
        message: err.message,
        extraSources: []
      });
    }
  });

  const watch = async (request: FastifyRequest, reply: FastifyReply) => {
    let episodeId = (request.params as { episodeId: string }).episodeId;
    if (!episodeId) {
      episodeId = (request.query as { episodeId: string }).episodeId;
    }
    const id = (request.query as { id: string }).id;
    const provider = (request.query as { provider?: string }).provider;
    const server = (request.query as { server?: StreamingServers }).server;

    let tmdb = new META.TMDB(tmdbApi);
    if (typeof provider !== 'undefined') {
      const possibleProvider = PROVIDERS_LIST.MOVIES.find(
        (p) => p.name.toLowerCase() === provider.toLocaleLowerCase(),
      );
      tmdb = new META.TMDB(tmdbApi, possibleProvider);
    }
    try {
      const res = await tmdb
        .fetchEpisodeSources(episodeId, id, server)
        .catch((err) => reply.status(404).send({ message: err }));

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  };
  fastify.get('/watch', watch);
  fastify.get('/watch/:episodeId', watch);

  fastify.get('/discover', async (request: FastifyRequest, reply: FastifyReply) => {
    const type = (request.query as { type?: string }).type || 'movie';
    const page = (request.query as { page?: number }).page || 1;
    const year = (request.query as { year?: number }).year;
    const genre = (request.query as { genre?: string }).genre;

    // Check cache
    const cacheKey = `tmdb:discover:${type}:${page}:${year || 'any'}:${genre || 'all'}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      console.log(`[Cache HIT] ${cacheKey}`);
      return reply.status(200).send(cached);
    }

    const tmdb = new META.TMDB(tmdbApi);
    try {
      // TMDB extension doesn't have a direct discover yet in some versions, 
      // but we can simulate it with trending or search if needed, 
      // or use the internal tmdb structure if available.
      const res = await (tmdb as any).fetchTrending(type, 'week', page);
      res.results = res.results.map(normalizeResult);

      // Cache for 1 hour
      await setCache(cacheKey, res, 3600);
      console.log(`[Cache SET] ${cacheKey}`);

      reply.status(200).send(res);
    } catch (err) {
      reply.status(500).send({ message: 'Failed to discover media.' });
    }
  });

  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.params as { query: string }).query;
    const page = (request.query as { page: number }).page || 1;

    // Check cache
    const cacheKey = `tmdb:search:${query}:${page}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      console.log(`[Cache HIT] ${cacheKey}`);
      return reply.status(200).send(cached);
    }

    const tmdb = new META.TMDB(tmdbApi);

    try {
      const res = await tmdb.search(query, page);
      console.log(`[TMDB Search] Query: ${query}, Results: ${res.results?.length}`);
      res.results = res.results.map(normalizeResult);

      // Cache for 1 hour
      await setCache(cacheKey, res, 3600);
      console.log(`[Cache SET] ${cacheKey}`);

      reply.status(200).send(res);
    } catch (err) {
      reply.status(500).send({ message: 'Failed to search media.' });
    }
  });

  fastify.get('/proxy', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = (request.query as { url: string }).url;
    let proxy_ref = (request.query as { proxy_ref?: string }).proxy_ref;

    if (!url) return reply.status(400).send({ message: 'Url is required' });

    // Auto-detect referer if not provided or null
    if (!proxy_ref || proxy_ref === 'null') {
      if (
        url.includes('megacloud.tv') ||
        url.includes('rabbitstream.net') ||
        url.includes('bluehorizon4.site') ||
        url.includes('mistwolf88.xyz') ||
        url.includes('silvercloud9.pro') ||
        url.includes('stormfox27.live') ||
        url.includes('brightstream12.site') ||
        url.includes('cloudfox.live') ||
        url.includes('aquaguard.pro')
      ) {
        proxy_ref = 'https://megacloud.tv/';
      } else if (url.includes('dokicloud.one')) {
        proxy_ref = 'https://dokicloud.one/';
      } else if (url.includes('vizcloud')) {
        proxy_ref = 'https://vizcloud.co/';
      } else if (url.includes('flixhq')) {
        proxy_ref = 'https://flixhq.to/';
      } else if (url.includes('raffaellocdn.net')) {
        proxy_ref = 'https://flixhq.to/';
      } else if (url.includes('kwik.cx')) {
        proxy_ref = 'https://animepahe.com/';
      }
    }

    try {
      console.log(`[Proxy] Fetching: ${url}`);
      let retryReferers = [
        proxy_ref,
        'https://kwik.cx/',
        'https://megacloud.tv/',
        'https://flixhq.to/',
        'https://rabbitstream.net/',
        'https://dokicloud.one/',
      ];
      let lastResponse: any;
      let lastError: any;

      // Filter out null/undefined/duplicates while preserving order
      retryReferers = [...new Set(retryReferers.filter(r => r !== null && r !== undefined && r !== 'null'))];
      if (retryReferers.length === 0 || retryReferers[0] !== '') {
        // If no specific referer was provided/detected, or if we want to try "None" too
        retryReferers.unshift('');
      }

      for (const ref of retryReferers) {
        try {
          let origin = '';
          if (ref && ref.startsWith('http')) {
            try {
              origin = new URL(ref).origin;
            } catch (e) {
              console.warn(`[Proxy] Invalid referer URL: ${ref}`);
            }
          }

          console.log(`[Proxy] Trying Referer: ${ref || 'None'}`);
          const response = await axios.get(url, {
            headers: {
              Referer: (ref && ref !== 'null' && ref !== 'undefined') ? ref : '',
              Origin: (ref && ref.startsWith('http')) ? new URL(ref).origin : '',
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              Accept: '*/*',
              'Accept-Language': 'en-US,en;q=0.9',
              'Connection': 'keep-alive',
            },
            responseType: 'arraybuffer',
            timeout: 25000, // Timeout increased to 25s for slow streams
            validateStatus: () => true,
          });

          lastResponse = response;
          if (response.status !== 403 && response.status < 500) {
            console.log(`[Proxy] Success with Referer: ${ref || 'None'} (Status: ${response.status})`);
            proxy_ref = ref || '';
            break;
          }
          console.log(`[Proxy] ${response.status} with Referer: ${ref || 'None'}`);
        } catch (err: any) {
          console.error(`[Proxy] Axios error with referer ${ref}: ${err.message}`);
          lastError = err;
        }
      }

      const response = lastResponse;
      if (!response) {
        throw new Error(lastError?.message || 'Failed to fetch from any referer');
      }

      console.log(`[Proxy] Final Status: ${response.status} for ${url}`);

      let responseData = response.data;
      const contentType = (response.headers['content-type'] || '').toLowerCase();

      // If it's an M3U8 manifest, rewrite relative URLs to be absolute and proxied
      if (
        contentType.includes('mpegurl') ||
        contentType.includes('m3u8') ||
        url.includes('.m3u8')
      ) {
        let m3u8Content = Buffer.from(responseData).toString();
        const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);

        m3u8Content = m3u8Content
          .split('\n')
          .map((line) => {
            const trimmedLine = line.trim();
            const host = request.headers.host || `${request.hostname}:3001`;

            if (trimmedLine && !trimmedLine.startsWith('#')) {
              let absoluteUrl = trimmedLine;
              try {
                if (!absoluteUrl.startsWith('http')) {
                  absoluteUrl = new URL(absoluteUrl, baseUrl).href;
                }
                // Proxy the segment/playlist as well
                return `${request.protocol}://${host}/meta/tmdb/proxy?url=${encodeURIComponent(
                  absoluteUrl,
                )}&proxy_ref=${encodeURIComponent(proxy_ref || '')}`;
              } catch (e) {
                return line;
              }
            }

            // Handle keys and maps (e.g., #EXT-X-KEY:METHOD=AES-128,URI="mon.key")
            if (trimmedLine.startsWith('#EXT-X-KEY:') || trimmedLine.startsWith('#EXT-X-MAP:') || trimmedLine.startsWith('#EXT-X-MEDIA:')) {
              return line.replace(/URI=["']([^"']+)["']|URI=([^, \n]+)/, (match, p1, p2) => {
                const originalUri = p1 || p2;
                if (!originalUri) return match;

                try {
                  let absoluteUrl = originalUri;
                  if (!absoluteUrl.startsWith('http')) {
                    absoluteUrl = new URL(absoluteUrl, baseUrl).href;
                  }
                  const proxiedUrl = `${request.protocol}://${host}/meta/tmdb/proxy?url=${encodeURIComponent(
                    absoluteUrl,
                  )}&proxy_ref=${encodeURIComponent(proxy_ref || '')}`;

                  // Wrap in quotes if it was quoted, or just replace
                  if (match.includes('"')) {
                    return `URI="${proxiedUrl}"`;
                  } else if (match.includes("'")) {
                    return `URI='${proxiedUrl}'`;
                  } else {
                    return `URI=${proxiedUrl}`;
                  }
                } catch (e) {
                  return match;
                }
              });
            }

            return line;
          })
          .join('\n');

        responseData = Buffer.from(m3u8Content);
      }

      // Pass through relevant headers
      const headersToPass = ['content-type', 'cache-control', 'content-length'];
      headersToPass.forEach((h) => {
        if (response.headers[h]) {
          reply.header(h, response.headers[h]);
        }
      });

      reply.header('Access-Control-Allow-Origin', '*');
      return reply.status(response.status).send(responseData);
    } catch (err: any) {
      console.error(`[Proxy FATAL] ${err.message} for ${url}`);
      return reply.status(500).send({ message: err.message });
    }
  });

  fastify.post('/getStream', async (request: FastifyRequest, reply: FastifyReply) => {
    const { file, key } = request.body as { file: string; key: string };

    // In our simplified setup, the 'file' is already the link or 
    // it's a URL that we can return directly. 
    // The player's loadAudioTrack expects an object with 'link' or 'url'

    return reply.status(200).send({
      success: true,
      data: {
        link: file,
        url: file,
        headers: (request.body as any).headers || {} // Pass back headers if provided
      }
    });
  });
};

export default routes;
