const { MOVIES } = require('@consumet/extensions');
const fs = require('fs');
const flix = new MOVIES.FlixHQ();

async function test() {
    try {
        const query = 'the housemaid';
        const search = await flix.search(query);
        let out = "";
        search.results.forEach(r => {
            out += `- Title: ${r.title}, ID: ${r.id}, Release: ${r.releaseDate}\n`;
        });
        fs.writeFileSync('search_results.txt', out);
        console.log("Results written to search_results.txt");
    } catch (e) {
        console.error("Search failed:", e);
    }
}

test();
