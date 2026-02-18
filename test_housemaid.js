const { MOVIES } = require('@consumet/extensions');
const flix = new MOVIES.FlixHQ();

async function test() {
    try {
        console.log("Searching for 'The Housemaid'...");
        const search = await flix.search('The Housemaid');
        console.log("Search results:", JSON.stringify(search.results.slice(0, 3), null, 2));

        const target = search.results.find(r => r.releaseDate === '2025' || r.releaseDate?.includes('2025'));
        if (target) {
            console.log("Checking info for ID:", target.id);
            const info = await flix.fetchMediaInfo(target.id);
            console.log("Info episodes/structure found.");

            console.log("Fetching servers...");
            const servers = await flix.fetchEpisodeServers(target.id, target.id);
            console.log("Servers:", JSON.stringify(servers, null, 2));

            if (servers.length > 0) {
                console.log("Fetching sources for server:", servers[0].name);
                const sources = await flix.fetchEpisodeSources(target.id, target.id, servers[0].name);
                console.log("Sources found:", sources.sources.length);
            } else {
                console.log("No servers found for this ID.");
            }
        } else {
            console.log("Could not find the 2025 version in search results.");
        }
    } catch (e) {
        console.error("Test failed:", e);
    }
}

test();
