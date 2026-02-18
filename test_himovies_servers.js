const { MOVIES, StreamingServers } = require('@consumet/extensions');
const himovies = new MOVIES.HiMovies();

async function testSevers() {
    const mediaId = 'movie/watch-the-batman-77905';
    const episodeId = '77905';
    console.log("Fetching HiMovies servers...");
    try {
        const servers = await himovies.fetchEpisodeServers(episodeId, mediaId);
        console.log("Available servers:", servers.map(s => s.name));
    } catch (err) {
        console.log(`Failed to fetch servers: ${err.message}`);
    }
}

testSevers();
