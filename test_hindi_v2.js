const axios = require('axios');

async function testMovie(id, title) {
    console.log(`\nTesting ${title} (ID: ${id})...`);
    try {
        const response = await axios.get(`http://localhost:3001/meta/tmdb/mediaInfo`, {
            params: { id, type: 'movie' },
            timeout: 60000 // 60s timeout
        });

        const playlist = response.data.data.playlist;
        console.log(`Found ${playlist.length} sources.`);

        const hindi = playlist.filter(s => s.label.toLowerCase().includes('hindi'));
        if (hindi.length > 0) {
            console.log(`✅ HINDI FOUND:`);
            hindi.forEach(s => console.log(` - ${s.label}`));
        } else {
            console.log(`❌ No Hindi label found in: ${playlist.map(s => s.label).join(', ')}`);
        }
    } catch (e) {
        console.log(`Error for ${title}: ${e.message}`);
    }
}

async function run() {
    // Avengers: Endgame (Common for dubs)
    await testMovie('299534', 'Avengers: Endgame');

    // Deadpool & Wolverine (Recent)
    await testMovie('533535', 'Deadpool & Wolverine');

    // Jawan (Indian Movie)
    await testMovie('830784', 'Jawan');
}

run();
