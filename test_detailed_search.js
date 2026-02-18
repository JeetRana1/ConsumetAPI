const { META, MOVIES } = require('@consumet/extensions');

async function testDetailSearch() {
    const sflix = new MOVIES.SFlix();
    const flixhq = new MOVIES.FlixHQ();

    console.log('Searching FlixHQ for "The Housemaid"...');
    const fResults = await flixhq.search('The Housemaid');
    fResults.results.forEach(r => {
        console.log(`[FlixHQ] ID: ${r.id} | Year: ${r.releaseDate} | Title: ${r.title}`);
    });

    console.log('\nSearching SFlix for "The Housemaid"...');
    const sResults = await sflix.search('The Housemaid');
    sResults.results.forEach(r => {
        console.log(`[SFlix] ID: ${r.id} | Year: ${r.releaseDate} | Title: ${r.title}`);
    });
}

testDetailSearch();
