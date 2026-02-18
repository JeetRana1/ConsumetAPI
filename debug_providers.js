const { META, PROVIDERS_LIST } = require('@consumet/extensions');
const tmdbApi = 'f647c22a49beb48e62a859804d39a43f';

async function testProvider(providerName, id, type) {
    const provider = providerName ? PROVIDERS_LIST.MOVIES.find(p => p.name.toLowerCase() === providerName.toLowerCase()) : undefined;
    const tmdb = new META.TMDB(tmdbApi, provider);
    console.log(`\n--- Testing Provider: ${providerName || 'Default (FlixHQ)'} ---`);
    try {
        console.log(`Fetching info for ${id}...`);
        const info = await tmdb.fetchMediaInfo(id, type);
        console.log(`Found: ${info.title} (${info.type})`);

        const epId = type === 'movie' ? id : (info.seasons?.[0]?.episodes?.[0]?.id || 'S1E1');
        console.log(`Fetching sources for epId: ${epId}...`);
        const sources = await tmdb.fetchEpisodeSources(epId, id);
        console.log(`Sources found: ${sources.sources?.length || 0}`);
        if (sources.sources?.length > 0) {
            console.log("First source URL:", sources.sources[0].url.substring(0, 50) + "...");
            return true;
        }
    } catch (err) {
        console.log(`Error: ${err.message}`);
    }
    return false;
}

async function run() {
    const id = '1317288'; // The Monkey (2025)
    // Also try a guaranteed one to verify logic
    const backupId = '414906'; // The Batman

    console.log("TESTING 1317288 (The Monkey)");
    await testProvider(undefined, id, 'movie');
    await testProvider('sflix', id, 'movie');
    await testProvider('goku', id, 'movie');

    console.log("\n\nTESTING 414906 (The Batman)");
    await testProvider(undefined, backupId, 'movie');
}

run();
