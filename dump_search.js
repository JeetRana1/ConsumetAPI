
const axios = require('axios');
const fs = require('fs');
const BASE_URL = 'https://animesalt.ac';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function dumpSearch(query) {
    try {
        const res = await axios.get(`${BASE_URL}/?s=${encodeURIComponent(query)}`, {
            headers: { 'User-Agent': UA }
        });
        fs.writeFileSync('search_dump.html', res.data);
        console.log('Dumped search results to search_dump.html');
    } catch (e) {
        console.error('Error:', e.message);
    }
}
dumpSearch('jujutsu kaisen 0');
