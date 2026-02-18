const { META, MOVIES } = require('@consumet/extensions');
const { tmdbApi } = require('./src/main');

async function test() {
    try {
        const flix = new MOVIES.FlixHQ();
        const tmdb = new META.TMDB(tmdbApi, flix);
        const info = await tmdb.fetchMediaInfo('858024', 'movie');
        console.log("Mapped ID for 858024:", info.id);
    } catch (e) {
        console.error("Mapping failed:", e);
    }
}

test();
