const axios = require('axios');

async function checkLabels(id, title) {
    console.log(`Checking ${title}...`);
    try {
        const res = await axios.get(`http://localhost:3001/meta/tmdb/mediaInfo?id=${id}&type=movie`);
        console.log(`Labels found:`);
        res.data.data.playlist.forEach(s => console.log(`- ${s.label}`));
    } catch (e) {
        console.log(`Error: ${e.message}`);
    }
}

async function run() {
    // A Bollywood movie
    await checkLabels('830784', 'Jawan');
    // Another one
    await checkLabels('857598', 'Pushpa 2');
}

run();
