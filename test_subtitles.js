const axios = require('axios');

async function testSubtitles() {
    try {
        const response = await axios.get('http://localhost:3001/meta/tmdb/mediaInfo', {
            params: {
                id: '1368166',
                type: 'movie'
            }
        });

        console.log('API Response Structure:');
        console.log('- Success:', response.data.success);
        console.log('- Has playlist:', !!response.data.data?.playlist);
        console.log('- Playlist items:', response.data.data?.playlist?.length || 0);
        console.log('- Has subtitles:', !!response.data.data?.subtitles);
        console.log('- Subtitle count:', response.data.data?.subtitles?.length || 0);

        if (response.data.data?.playlist?.length > 0) {
            console.log('\nFirst playlist item:');
            console.log(JSON.stringify(response.data.data.playlist[0], null, 2));
        }

        if (response.data.data?.subtitles?.length > 0) {
            console.log('\nSubtitles:');
            response.data.data.subtitles.forEach((sub, i) => {
                console.log(`${i + 1}. ${sub.lang || 'Unknown'} - ${sub.url}`);
            });
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testSubtitles();
