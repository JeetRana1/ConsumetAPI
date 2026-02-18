const axios = require('axios');

async function checkHindiAudio() {
    const query = 'Pushpa 2';
    console.log(`Searching for: ${query}`);

    try {
        // Step 1: Search
        const searchRes = await axios.get(`http://localhost:3001/meta/tmdb/${encodeURIComponent(query)}`);
        const movie = searchRes.data.results.find(res => res.title.includes('Pushpa 2') || res.name.includes('Pushpa 2'));

        if (!movie) {
            console.log('Movie not found in search results.');
            return;
        }

        console.log(`Found Movie: ${movie.title} (ID: ${movie.id})`);

        // Step 2: Get Media Info (Sources)
        console.log('Fetching sources...');
        const infoRes = await axios.get(`http://localhost:3001/meta/tmdb/mediaInfo`, {
            params: {
                id: movie.id,
                type: 'movie'
            }
        });

        const playlist = infoRes.data.data.playlist;
        console.log(`Found ${playlist.length} sources.`);

        const hindiSources = playlist.filter(s => s.label.toLowerCase().includes('hindi'));

        if (hindiSources.length > 0) {
            console.log('\n✅ Found Hindi Audio Sources:');
            hindiSources.forEach(s => {
                console.log(`- ${s.label}`);
            });
        } else {
            console.log('\n❌ No Hindi audio labeled sources found.');
            console.log('Available labels:', playlist.map(s => s.label).join(', '));
        }

        // Test with a movie that typically has dubs (e.g. Avengers)
        console.log('\n--- Testing with Avengers: Endgame (likely to have dubs) ---');
        const avengersRes = await axios.get(`http://localhost:3001/meta/tmdb/mediaInfo`, {
            params: {
                id: '299534',
                type: 'movie'
            }
        });

        const avengersPlaylist = avengersRes.data.data.playlist;
        const avengersHindi = avengersPlaylist.filter(s => s.label.toLowerCase().includes('hindi'));

        if (avengersHindi.length > 0) {
            console.log('✅ Found Hindi Audio Sources for Avengers:');
            avengersHindi.forEach(s => console.log(`- ${s.label}`));
        } else {
            console.log('❌ No Hindi labeled sources found for Avengers.');
            console.log('Available labels:', avengersPlaylist.map(s => s.label).join(', '));
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

checkHindiAudio();
