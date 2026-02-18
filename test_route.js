const axios = require('axios');
async function test() {
    try {
        const res = await axios.get('http://localhost:3001/anime/gogoanime/naruto');
        console.log('Results:', res.data.results.length);
        if (res.data.results.length > 0) {
            console.log('First result:', res.data.results[0].title);
        }
    } catch (err) {
        console.error('Error:', err.response ? err.response.data : err.message);
    }
}
test();
