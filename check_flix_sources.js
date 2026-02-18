const { MOVIES } = require('@consumet/extensions');

async function testFlixSources(id) {
    const flix = new MOVIES.FlixHQ();
    console.log(`Checking sources for ID: ${id}`);

    try {
        console.log('Fetching Episode Servers...');
        // For movies, mediaId and episodeId are typically the same
        const servers = await flix.fetchEpisodeServers(id, id);
        console.log(`Found ${servers.length} servers`);
        servers.forEach(s => console.log(`- ${s.name} (${s.url})`));

        if (servers.length > 0) {
            console.log('\nFetching sources from first server...');
            const sources = await flix.fetchEpisodeSources(id, id, servers[0].name);
            console.log('Sources:', JSON.stringify(sources, null, 2));
        }
    } catch (e) {
        console.error('Error fetching servers/sources:', e.message);
    }

    // Also try fetchEpisodeSources without server (default)
    try {
        console.log('\nFetching default sources (no server specified)...');
        const sources = await flix.fetchEpisodeSources(id, id);
        console.log('Default Sources:', JSON.stringify(sources, null, 2));
    } catch (e) {
        console.log('Error fetching default sources:', e.message);
    }
}

testFlixSources('movie/watch-the-housemaid-140613');
