const { MOVIES } = require('@consumet/extensions');
const flix = new MOVIES.FlixHQ();

async function test() {
    try {
        const query = 'the housemaid';
        const search = await flix.search(query);
        console.log("Search results for:", query);
        search.results.forEach(r => {
            console.log(`- Title: ${r.title}, ID: ${r.id}, Release: ${r.releaseDate}`);
        });
    } catch (e) {
        console.error("Search failed:", e);
    }
}

test();
