const { MOVIES } = require('@consumet/extensions');

async function checkGoku() {
    const goku = new MOVIES.Goku();
    const query = "The Housemaid";
    console.log(`Searching Goku for: ${query}`);
    try {
        const res = await goku.search(query);
        console.log("Goku Results:");
        res.results.forEach(r => {
            console.log(`Title: ${r.title} | ID: ${r.id} | Date: ${r.releaseDate || 'N/A'}`);
        });
    } catch (e) {
        console.log("Goku Error:", e.message);
    }
}

checkGoku();
