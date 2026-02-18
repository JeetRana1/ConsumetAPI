const { MOVIES } = require('@consumet/extensions');
const axios = require('axios');

async function checkGokuInfo(id) {
    const goku = new MOVIES.Goku();
    const query = "The Housemaid";
    console.log(`Checking Goku Info for ID: ${id}`);

    try {
        const info = await goku.fetchMediaInfo(id);
        console.log(`Title: ${info.title} | ID: ${info.id} | Year: ${info.releaseDate || 'N/A'}`);
    } catch (e) {
        console.error('Error fetching MediaInfo:', e.message);
    }
}

checkGokuInfo('watch-movie/watch-the-housemaid-9031');
