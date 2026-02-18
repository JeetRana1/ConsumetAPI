const { MOVIES } = require('@consumet/extensions');
const sflix = new MOVIES.SFlix();

async function test() {
    try {
        const id = 'movie/free-hamnet-hd-138796';
        console.log("Checking ID:", id);
        const info = await sflix.fetchMediaInfo(id);
        console.log("Info title:", info.title);

        console.log("Fetching servers...");
        const servers = await sflix.fetchEpisodeServers('138796', id);
        console.log("Servers count:", servers.length);
        console.log("Servers:", JSON.stringify(servers, null, 2));

        if (servers.length === 0) {
            console.log("Fetching sources directly (fallback)...");
            const sources = await sflix.fetchEpisodeSources(id, id);
            console.log("Sources count:", sources.sources.length);
        }
    } catch (e) {
        console.error("Test failed:", e);
    }
}

test();
