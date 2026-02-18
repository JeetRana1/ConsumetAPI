const { MOVIES } = require('@consumet/extensions');
const flix = new MOVIES.FlixHQ();

async function checkFlixInfo(id) {
    console.log(`Checking Info for ID: ${id}`);
    try {
        const info = await flix.fetchMediaInfo(id);
        console.log(`\nMedia Info found!`);
        console.log(`Title: ${info.title} (${info.releaseDate})`);

        console.log(`\nEpisode ID: ${info.episodeId}`);
        console.log(`Episodes: ${info.episodes ? info.episodes.length : 0}`);

        if (info.episodes && info.episodes.length > 0) {
            const epId = info.episodes[0].id;
            console.log(`\nTrying first episode ID: ${epId}`);

            try {
                const servers = await flix.fetchEpisodeServers(epId, id);
                console.log(`Found ${servers.length} servers for episode ${epId}`);
                servers.forEach(s => console.log(`- ${s.name}`));

                // Try fetching sources
                if (servers.length > 0) {
                    console.log(`\nTrying to fetch sources for server: ${servers[0].name}`);
                    const sources = await flix.fetchEpisodeSources(epId, id, servers[0].name);
                    console.log('Sources found:', sources.sources.length);
                }
            } catch (err) {
                console.log("Error fetching servers/sources for epId:", err.message);
            }
        }

    } catch (e) {
        console.error('Error fetching MediaInfo:', e.message);
    }
}

checkFlixInfo('movie/watch-the-housemaid-140613');
