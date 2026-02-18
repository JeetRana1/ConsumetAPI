const { META } = require('@consumet/extensions');
const tmdbApi = 'f647c22a49beb48e62a859804d39a43f';

async function test() {
    const tmdb = new META.TMDB(tmdbApi);
    try {
        console.log("Fetching Info for 1396 (Breaking Bad)...");
        const info = await tmdb.fetchMediaInfo('1396', 'tv');
        console.log("Keys:", Object.keys(info));
        if (info.seasons) {
            console.log("Seasons count:", info.seasons.length);
            console.log("Season 1 Episodes:", info.seasons[0].episodes.length);
            const epId = info.seasons[0].episodes[0].id;
            console.log("First episode ID:", epId);
            const sources = await tmdb.fetchEpisodeSources(epId, '1396');
            console.log(JSON.stringify(sources, null, 2));
        } else {
            console.log("Episodes count:", info.episodes?.length);
        }
    } catch (err) {
        console.error("Error:", err.message);
    }
}

test();
