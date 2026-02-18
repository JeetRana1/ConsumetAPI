const { META, MOVIES } = require('@consumet/extensions');

async function testSearch(title, year) {
    const flixhq = new MOVIES.FlixHQ();
    const sflix = new MOVIES.SFlix();

    console.log(`Searching for "${title}" (${year})...`);

    try {
        const results = await flixhq.search(title);
        console.log('\n--- FlixHQ Results ---');
        results.results.slice(0, 10).forEach(r => {
            console.log(`ID: ${r.id}, Title: ${r.title}, ReleaseDate: ${r.releaseDate}, Type: ${r.type}`);
        });
    } catch (e) { console.log('FlixHQ search failed'); }

    try {
        const results = await sflix.search(title);
        console.log('\n--- SFlix Results ---');
        results.results.slice(0, 10).forEach(r => {
            console.log(`ID: ${r.id}, Title: ${r.title}, ReleaseDate: ${r.releaseDate}, Type: ${r.type}`);
        });
    } catch (e) { console.log('SFlix search failed'); }
}

async function testMapping(tmdbId, type) {
    const PROVIDERS_LIST = {
        flixhq: new MOVIES.FlixHQ(),
        sflix: new MOVIES.SFlix(),
        goku: new (require('@consumet/extensions').MOVIES).Goku(),
        himovies: new MOVIES.HiMovies()
    };

    console.log(`\n\n--- Testing META.TMDB Mapping for ID: ${tmdbId} ---`);
    for (const p in PROVIDERS_LIST) {
        try {
            const pTmdb = new META.TMDB(undefined, PROVIDERS_LIST[p]);
            const info = await pTmdb.fetchMediaInfo(tmdbId, type);
            console.log(`Provider ${p} matched ID: ${info.id}, Title: ${info.title}, Year: ${info.releaseDate || '?'}`);
        } catch (e) {
            console.log(`Provider ${p} mapping missed or failed: ${e.message}`);
        }
    }
}

testSearch('The Housemaid', '2024').then(() => testMapping('1368166', 'movie'));
