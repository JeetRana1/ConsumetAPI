const { MOVIES, StreamingServers } = require('@consumet/extensions');
const flixhq = new MOVIES.FlixHQ();

async function testSevers() {
    const mediaId = 'movie/watch-the-batman-77905';
    const episodeId = '77905';
    console.log("Fetching servers...");
    const servers = await flixhq.fetchEpisodeServers(episodeId, mediaId);
    console.log("Available servers:", servers.map(s => s.name));

    for (const server of [StreamingServers.UpCloud, StreamingServers.VidCloud, StreamingServers.MixDrop]) {
        console.log(`\nTesting ${server}...`);
        try {
            const sources = await flixhq.fetchEpisodeSources(episodeId, mediaId, server);
            console.log(`Success! Found ${sources.sources.length} sources.`);
            break;
        } catch (err) {
            console.log(`Failed: ${err.message}`);
        }
    }
}

testSevers();
