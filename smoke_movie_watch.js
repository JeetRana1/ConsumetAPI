const axios = require('axios');

const base = 'http://127.0.0.1:3000';
const providers = ['flixhq', 'goku', 'sflix', 'himovies'];
const query = 'avengers';

const isDirect = (url) => /\.(m3u8|mp4|mpd)(\?|$)/i.test(String(url || '')) || /m3u8-proxy/i.test(String(url || ''));

(async () => {
  for (const provider of providers) {
    console.log(`\n=== ${provider} ===`);
    try {
      const search = await axios.get(`${base}/movies/${provider}/${encodeURIComponent(query)}?page=1`, { timeout: 30000 });
      const items = Array.isArray(search.data?.results)
        ? search.data.results
        : Array.isArray(search.data)
          ? search.data
          : [];

      if (!items.length) {
        console.log('No search results');
        continue;
      }

      let found = false;
      for (const item of items.slice(0, 10)) {
        const id = String(item?.id || '').trim();
        if (!id) continue;

        try {
          const info = await axios.get(`${base}/movies/${provider}/info?id=${encodeURIComponent(id)}`, { timeout: 30000 });
          const episodes = Array.isArray(info.data?.episodes) ? info.data.episodes : [];
          const episodeId = String(episodes[0]?.id || info.data?.episodeId || '').trim();
          if (!episodeId) continue;

          const watch = await axios.get(
            `${base}/movies/${provider}/watch?episodeId=${encodeURIComponent(episodeId)}&mediaId=${encodeURIComponent(id)}`,
            { timeout: 45000 },
          );

          const sources = Array.isArray(watch.data?.sources) ? watch.data.sources : [];
          const direct = sources.filter((s) => isDirect(s?.url));
          console.log(`id=${id} sources=${sources.length} direct=${direct.length}`);
          if (direct.length) {
            console.log(`firstDirect=${direct[0].url}`);
            found = true;
            break;
          }
        } catch {
          continue;
        }
      }

      if (!found) console.log('No working direct source in first 10 items');
    } catch (err) {
      console.log(`Provider failed: ${err?.message || String(err)}`);
    }
  }
})();
