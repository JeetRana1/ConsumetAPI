const { META, MOVIES } = require('@consumet/extensions');

async function testYearDiscrepancy(tmdbId) {
    const flixhq = new MOVIES.FlixHQ();
    const pTmdb = new META.TMDB(undefined, flixhq);

    try {
        console.log('--- META.TMDB Info ---');
        const metaInfo = await pTmdb.fetchMediaInfo(tmdbId, 'movie');
        console.log(`Matched ID: ${metaInfo.id}`);
        console.log(`Reported Year (Meta): ${metaInfo.releaseDate}`);

        console.log('\n--- Direct Provider Info (FlixHQ) ---');
        const flixInfo = await flixhq.fetchMediaInfo(metaInfo.id);
        console.log(`Actual Title: ${flixInfo.title}`);
        console.log(`Actual Year (FlixHQ): ${flixInfo.releaseDate}`);
    } catch (e) {
        console.error('Error:', e.message);
    }
}

testYearDiscrepancy('1368166');
