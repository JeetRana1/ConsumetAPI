const axios = require('axios');

async function test() {
    const tmdbId = '1368166';
    const apiUrl = 'http://localhost:3001/meta/tmdb';

    try {
        console.log(`Step 1: Fetching MediaInfo for ${tmdbId}...`);
        const infoRes = await axios.get(`${apiUrl}/mediaInfo?id=${tmdbId}&type=movie`);
        const infoData = infoRes.data;

        if (!infoData.success || !infoData.data || !infoData.data.playlist || infoData.data.playlist.length === 0) {
            console.error('Failed to get playlist from mediaInfo');
            return;
        }

        const firstTrack = infoData.data.playlist[0];
        const cleanFile = firstTrack.file.trim().replace(/\s+/g, '');
        console.log('Cleaned file URL:', cleanFile);
        console.log(`Step 2: Proxing first track...`);

        // The player would call /proxy with the file and referer
        const proxiedPlaylistUrl = `${apiUrl}/proxy?url=${encodeURIComponent(cleanFile)}`;
        console.log(`Fetching playlist: ${proxiedPlaylistUrl}`);

        const playlistRes = await axios.get(proxiedPlaylistUrl);
        const playlistContent = playlistRes.data.toString();
        // console.log('Playlist content snippet:', playlistContent.substring(0, 500));

        // Find a segment URL (which should now be proxied)
        const lines = playlistContent.split('\n');
        const proxiedSegmentUrl = lines.find(line => line.includes('/proxy?url='));

        if (!proxiedSegmentUrl) {
            console.error('Could not find a proxied segment URL in playlist');
            // Try to see what the content looks like
            console.log('Playlist head:', playlistContent.substring(0, 200));
            return;
        }

        console.log(`Step 3: Fetching proxied segment: ${proxiedSegmentUrl}`);
        const segmentRes = await axios.get(proxiedSegmentUrl);
        console.log(`Segment download status: ${segmentRes.status}`);
        console.log(`Content-Type: ${segmentRes.headers['content-type']}`);
        console.log(`Content-Length: ${segmentRes.headers['content-length']}`);

        if (segmentRes.status === 200) {
            console.log('SUCCESS: Proxied segment loaded correctly!');
        } else {
            console.error(`FAILED: Segment load failed with status ${segmentRes.status}`);
        }

    } catch (error) {
        console.error('Error during test:', error.response ? error.response.status : error.message);
        if (error.response && error.response.data) {
            // console.error('Error data:', error.response.data.toString());
        }
    }
}

test();
