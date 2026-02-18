const { MOVIES } = require('@consumet/extensions');

async function testYearSearch() {
    const flixhq = new MOVIES.FlixHQ();
    console.log('Searching for "The Housemaid 2025"...');
    const results = await flixhq.search('The Housemaid 2025');
    console.log('Results:', JSON.stringify(results.results, null, 2));
}

testYearSearch();
