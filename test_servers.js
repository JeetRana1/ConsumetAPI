const { META, PROVIDERS_LIST, StreamingServers } = require('@consumet/extensions');
const tmdbApi = 'f647c22a49beb48e62a859804d39a43f';

async function testServer(id, serverName) {
    const tmdb = new META.TMDB(tmdbApi);
    console.log(`\n--- Testing Server: ${serverName} ---`);
    try {
        const sources = await tmdb.fetchEpisodeSources(id, id, serverName);
        console.log(`Sources: ${sources.sources?.length || 0}`);
        if (sources.sources?.length > 0) return true;
    } catch (err) {
        console.log(`Error: ${err.message}`);
    }
    return false;
}

async function run() {
    const id = '414906'; // The Batman
    const servers = [
        StreamingServers.UpCloud,
        StreamingServers.VidCloud,
        StreamingServers.MixDrop,
        StreamingServers.VidSrc
    ];

    for (const server of servers) {
        if (await testServer(id, server)) break;
    }
}

run();
