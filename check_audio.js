const { MOVIES } = require('@consumet/extensions');
const flix = new MOVIES.FlixHQ();

async function checkAudio(id, epId) {
    console.log(`Checking Audio logic for ID: ${id}, Ep: ${epId}`);
    try {
        const servers = await flix.fetchEpisodeServers(epId, id);
        console.log(`Found ${servers.length} servers`);

        for (const server of servers) {
            try {
                console.log(`\nFetching sources from ${server.name}...`);
                const sources = await flix.fetchEpisodeSources(epId, id, server.name);
                console.log(`Sources keys: ${Object.keys(sources)}`);
                console.log('Sources:', JSON.stringify(sources, null, 2));
            } catch (e) {
                console.log(`Error ${server.name}: ${e.message}`);
            }
        }
    } catch (e) {
        console.error('Error:', e.message);
    }
}

// Using the known working IDs for The Housemaid (2025)
checkAudio('movie/watch-the-housemaid-140613', '140613');
