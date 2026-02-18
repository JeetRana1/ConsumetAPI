const { MOVIES } = require('@consumet/extensions');
const flix = new MOVIES.FlixHQ();

async function check(id) {
    try {
        const info = await flix.fetchMediaInfo(id);
        const epId = info.episodes[0].id;
        console.log(`Media ID: ${id}`);
        console.log(`Episode ID: ${epId}`);
        console.log(`Are they same? ${id === epId}`);

        console.log(`\nTesting fetchEpisodeServers(epId, id)...`);
        await flix.fetchEpisodeServers(epId, id);
        console.log(`Success!`);
    } catch (e) {
        console.log(`Fail: ${e.message}`);
    }
}
check('movie/watch-the-housemaid-140613');
