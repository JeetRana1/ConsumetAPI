const { META, MOVIES } = require('@consumet/extensions');
const axios = require('axios');

async function debug() {
    const flixhq = new MOVIES.FlixHQ();
    const id = '1368166'; // The Housemaid

    try {
        console.log('Fetching search for ID:', id);
        const search = await flixhq.search(id);
        const movie = search.results[0];
        console.log('Movie found:', movie.id);

        console.log('Fetching servers...');
        const servers = await flixhq.fetchEpisodeServers(movie.id, movie.id);
        console.log('Servers found:', JSON.stringify(servers, null, 2));

        for (const server of servers) {
            console.log(`\n--- Testing Server: ${server.name} ---`);
            try {
                const sources = await flixhq.fetchEpisodeSources(movie.id, movie.id, server.name);
                console.log(`Sources for ${server.name}:`, JSON.stringify(sources.sources, null, 2));
            } catch (e) {
                console.log(`Error for ${server.name}:`, e.message);
            }
        }
    } catch (err) {
        console.error('Error:', err.message);
    }
}

debug();
