import {
  MovieParser,
  TvType,
  IMovieInfo,
  IEpisodeServer,
  ISource,
  IMovieResult,
  ISearch,
} from '@consumet/extensions/dist/models';

enum NetMirrorOTT {
  NETFLIX = 'nf',
  PRIME = 'pv',
  DISNEY = 'dp',
  LIONSGATE = 'lg',
}

interface NetMirrorSearchResult {
  searchResult: Array<{ id: string; t: string }>;
}

interface NetMirrorPostData {
  title: string;
  year: string;
  runtime: string;
  type: string;
  genre: string;
  m_desc: string;
  desc: string;
  season?: Array<{
    s: string;
    id: string;
    ep: string;
  }>;
  episodes?: Array<{
    id: string;
    t: string;
    s: string;
    ep: string;
    ep_desc: string;
    time: string;
  }>;
}

interface NetMirrorPlaylist {
  sources: Array<{
    file: string;
    label: string;
  }>;
  tracks: Array<{
    kind: string;
    file: string;
    label: string;
    language?: string;
  }>;
}

class NetMirror extends MovieParser {
  override readonly name = 'NetMirror';
  protected override baseUrl = 'https://net20.cc';
  protected override logo = 'https://net20.cc/img/nf2/icon_x192.png';
  protected override classPath = 'MOVIES.NetMirror';
  override supportedTypes = new Set([TvType.MOVIE, TvType.TVSERIES]);

  private ott: NetMirrorOTT = NetMirrorOTT.NETFLIX;
  private headers = {
    'X-Requested-With': 'XMLHttpRequest',
    Referer: `${this.baseUrl}/home`,
  };

  setOTT(provider: NetMirrorOTT): void {
    this.ott = provider;
  }

  private async getCookies(): Promise<string> {
    const res = await fetch(this.baseUrl + '/p.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'init=1',
    });

    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) throw new Error('No Set-Cookie header found');

    const t_hash_t =
      '988a734da1152ddea2c25c8904eede20%3A%3A0cb4f3935641c828678b8946867997e5%3A%3A1768993531%3A%3Ani';

    const tHashMatch = /t_hash=([^;]+)/.exec(setCookie);
    const t_hash = tHashMatch ? tHashMatch[1] : '';

    return `t_hash_t=${t_hash_t}; t_hash=${t_hash}; ott=${this.ott}`;
  }

  override search = async (query: string, page: number = 1): Promise<ISearch<IMovieResult>> => {
    try {
      const { data } = await this.client.get<NetMirrorSearchResult>(
        `${this.baseUrl}/search.php?s=${encodeURIComponent(query)}&t=x`,
        {
          headers: {
            ...this.headers,
            Cookie: await this.getCookies(),
          },
        },
      );

      if (!data.searchResult || !Array.isArray(data.searchResult)) {
        return { currentPage: page, hasNextPage: false, results: [] };
      }

      const results: IMovieResult[] = data.searchResult.map((item) => ({
        id: item.id,
        title: item.t,
        image: `https://imgcdn.kim/poster/342/${item.id}.jpg`,
        type: TvType.MOVIE,
      }));

      return {
        currentPage: page,
        hasNextPage: false,
        results,
      };
    } catch (err) {
      throw new Error(`NetMirror search failed: ${(err as Error).message}`);
    }
  };

  private fetchPostData = async (id: string): Promise<NetMirrorPostData> => {
    try {
      const { data } = await this.client.get<NetMirrorPostData>(
        `${this.baseUrl}/post.php?id=${id}&t=x`,
        {
          headers: {
            ...this.headers,
            Cookie: await this.getCookies(),
          },
        },
      );
      return data;
    } catch (err) {
      throw new Error(`NetMirror fetchPostData failed: ${(err as Error).message}`);
    }
  };

  override fetchMediaInfo = async (mediaId: string): Promise<IMovieInfo> => {
    try {
      const postData = await this.fetchPostData(mediaId);
      const isTvShow = postData.type === 't';

      const movieInfo: IMovieInfo = {
        id: mediaId,
        title: postData.title || '',
        type: isTvShow ? TvType.TVSERIES : TvType.MOVIE,
        image: `https://imgcdn.kim/poster/780/${mediaId}.jpg`,
        cover: `https://imgcdn.kim/poster/1920/${mediaId}.jpg`,
        genres: postData.genre?.split(',').map((g) => g.trim()) || [],
        duration: postData.runtime,
        description: postData.desc || postData.m_desc || '',
        rating: undefined,
        releaseDate: postData.year || undefined,
      };

      if (isTvShow) {
        if (postData.episodes && postData.episodes.length > 0) {
          movieInfo.episodes = postData.episodes.map((ep) => ({
            id: ep.id,
            title: ep.t,
            number: parseInt(ep.ep, 10),
            season: parseInt(ep.s.replace('S', ''), 10),
            description: ep.ep_desc,
            url: ep.time,
          }));
        } else if (postData.season && postData.season.length > 0) {
          movieInfo.episodes = postData.season.flatMap((season) => {
            const episodes = [];
            for (let i = 1; i <= parseInt(season.ep, 10); i += 1) {
              episodes.push({
                id: season.id,
                title: `Season ${season.s} Episode ${i}`,
                number: i,
                season: parseInt(season.s, 10),
              });
            }
            return episodes;
          });
        } else {
          movieInfo.episodes = [{ id: mediaId, title: 'Full Content' }];
        }
      } else {
        movieInfo.episodes = [{ id: mediaId, title: postData.title || 'Full Movie' }];
      }

      return movieInfo;
    } catch (err) {
      throw new Error(`NetMirror fetchMediaInfo failed: ${(err as Error).message}`);
    }
  };

  override fetchEpisodeServers = async (
    episodeId: string,
    mediaId?: string,
  ): Promise<IEpisodeServer[]> => {
    return [
      {
        name: 'NetMirror',
        url: `${this.baseUrl}/playlist.php?id=${episodeId}`,
      },
    ];
  };

  override fetchEpisodeSources = async (
    episodeId: string,
    mediaId?: string,
  ): Promise<ISource> => {
    try {
      const { data } = await this.client.get<NetMirrorPlaylist[]>(
        `${this.baseUrl}/playlist.php?id=${episodeId}&t=Video&tm=${Date.now()}`,
        {
          headers: {
            ...this.headers,
            Cookie: await this.getCookies(),
          },
        },
      );

      if (!data || !Array.isArray(data) || data.length === 0) {
        throw new Error('No playlist data received');
      }

      const playlist = data[0];
      if (!playlist.sources || !Array.isArray(playlist.sources)) {
        throw new Error('No sources in playlist');
      }

      const sources = playlist.sources.map((s) => {
        let quality = '480p';
        if (s.label === 'Full HD') quality = '1080p';
        else if (s.label === 'Mid HD') quality = '720p';

        return {
          url: `${this.baseUrl}${s.file}`,
          quality,
          isM3U8: true,
        };
      });

      const subtitles = playlist.tracks
        ?.filter((t) => t.kind === 'captions')
        .map((t) => ({
          url: t.file.startsWith('//') ? `https:${t.file}` : t.file,
          lang: t.label || t.language || 'Unknown',
        }));

      return {
        headers: { Referer: `${this.baseUrl}/` },
        sources,
        subtitles,
      };
    } catch (err) {
      throw new Error(`NetMirror fetchEpisodeSources failed: ${(err as Error).message}`);
    }
  };

  fetchRecentMovies = async (): Promise<IMovieResult[]> => {
    const data = await this.search('new');
    return data.results;
  };

  fetchTrendingMovies = async (): Promise<IMovieResult[]> => {
    try {
      const { data } = await this.client.get<NetMirrorSearchResult>(
        `${this.baseUrl}/search.php?s=new&t=x`,
        {
          headers: {
            ...this.headers,
            Cookie: await this.getCookies(),
          },
        },
      );

      if (!data.searchResult || !Array.isArray(data.searchResult)) {
        return [];
      }

      return data.searchResult.slice(0, 10).map((item) => ({
        id: item.id,
        title: item.t,
        image: `https://imgcdn.kim/poster/342/${item.id}.jpg`,
        type: TvType.MOVIE,
      }));
    } catch (err) {
      throw new Error(`NetMirror fetchTrendingMovies failed: ${(err as Error).message}`);
    }
  };
}

export default NetMirror;
