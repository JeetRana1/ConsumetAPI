const { META } = require('@consumet/extensions');
const tmdbApi = 'f647c22a49beb48e62a859804d39a43f';

async function test() {
    const tmdb = new META.TMDB(tmdbApi);
    try {
        console.log("Fetching sources for S1E1 of 1399...");
        const sources = await tmdb.fetchEpisodeSources('S1E1', '1399');
        console.log(JSON.stringify(sources, null, 2));
    } catch (err) {
        console.error("Error:", err.message);
    }
}

test();
