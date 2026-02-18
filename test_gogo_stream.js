const axios = require('axios');

async function testStream() {
    try {
        console.log('1. Searching for Naruto...');
        const searchRes = await axios.get('http://localhost:3001/anime/gogoanime/naruto');
        const animeId = searchRes.data.results[0].id;
        console.log(`Found Anime ID: ${animeId}`);

        console.log(`\n2. Fetching Info for ${animeId}...`);
        const infoRes = await axios.get(`http://localhost:3001/anime/gogoanime/info/${encodeURIComponent(animeId)}`);
        const episodeId = infoRes.data.episodes[0].id;
        console.log(`Found Episode ID: ${episodeId}`);

        console.log(`\n3. Fetching Stream for ${episodeId}...`);
        const watchRes = await axios.get(`http://localhost:3001/anime/gogoanime/watch/${encodeURIComponent(episodeId)}`);

        console.log('\n--- Stream Results ---');
        console.log('Sources:', watchRes.data.sources);
        if (watchRes.data.sources && watchRes.data.sources.length > 0) {
            console.log('\n✅ SUCCESS: Stream found!');
            console.log('First Source URL:', watchRes.data.sources[0].url);
        } else {
            console.log('\n❌ FAILURE: No sources found.');
        }

    } catch (err) {
        console.error('Error:', err.response ? err.response.data : err.message);
    }
}

testStream();
