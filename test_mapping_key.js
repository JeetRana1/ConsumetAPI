const { META, MOVIES } = require('@consumet/extensions');
const tmdbApi = 'f647c22a49beb48e62a859804d39a43f';

async function test() {
    try {
        const flix = new MOVIES.FlixHQ();
        const sflix = new MOVIES.SFlix();
        const tmdb_flix = new META.TMDB(tmdbApi, flix);
        const tmdb_sflix = new META.TMDB(tmdbApi, sflix);

        console.log("TMDB ID: 858024 (The Fall Guy)");
        const info_flix = await tmdb_flix.fetchMediaInfo('858024', 'movie');
        console.log("FlixHQ Mapped ID:", info_flix.id);

        const info_sflix = await tmdb_sflix.fetchMediaInfo('858024', 'movie');
        console.log("SFlix Mapped ID:", info_sflix.id);

    } catch (e) {
        console.error("Mapping failed:", e);
    }
}

test();
