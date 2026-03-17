
const axios = require('axios');
const BASE_URL = 'https://animesalt.ac';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function test() {
    try {
        const episodeId = 'jujutsu-kaisen-1x1';
        const res = await axios.get(`${BASE_URL}/episode/${episodeId}/`, {
            headers: { 'User-Agent': UA }
        });
        const iframeMatch = res.data.match(/iframe.*?src=["'](.+?)["']/);
        const iframe1 = iframeMatch ? iframeMatch[1] : null;
        console.log('Iframe:', iframe1);
        
        if (iframe1) {
            const embedUrl = new URL(iframe1);
            const videoId = embedUrl.pathname.split('/').pop();
            const origin = embedUrl.origin;
            
            const pageRes = await axios.get(iframe1, {
                headers: { 'User-Agent': UA, 'Referer': BASE_URL }
            });
            const cookies = (pageRes.headers['set-cookie'] || [])
                .map(c => c.split(';')[0])
                .join('; ');

            const subtitleMatch = pageRes.data.match(/var\s+playerjsSubtitle\s*=\s*(["'])(.+?)\1/);
            if (subtitleMatch) {
                console.log('Subtitles found:', subtitleMatch[2]);
            }
            
            const apiRes = await axios.post(
                `${origin}/player/index.php?data=${videoId}&do=getVideo`,
                `hash=${videoId}&r=${encodeURIComponent(BASE_URL)}`,
                {
                    headers: {
                        'User-Agent': UA,
                        'Referer': iframe1,
                        'X-Requested-With': 'XMLHttpRequest',
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Cookie': cookies
                    }
                }
            );
            
            if (apiRes.data?.videoSource) {
                const sourceUrl = apiRes.data.videoSource;
                console.log('Video Source:', sourceUrl);
                const m3u8Res = await axios.get(sourceUrl, {
                    headers: { 'User-Agent': UA, 'Referer': iframe1 }
                });
                console.log('M3U8 Content (Master):', m3u8Res.data.substring(0, 1000));
                
                // If it's a master manifest, get the first level
                if (m3u8Res.data.includes('#EXT-X-STREAM-INF')) {
                    const lines = m3u8Res.data.split('\n');
                    const firstLevel = lines.find(l => l.trim() && !l.startsWith('#'));
                    if (firstLevel) {
                        const levelUrl = new URL(firstLevel, sourceUrl).toString();
                        console.log('Level URL:', levelUrl);
                        const levelRes = await axios.get(levelUrl, {
                            headers: { 'User-Agent': UA, 'Referer': iframe1 }
                        });
                        console.log('Level M3U8 Content:', levelRes.data.substring(0, 500));
                    }
                }
            }
        }
    } catch (e) {
        console.error('Error:', e.message);
        if (e.response) console.error('Response:', e.response.data);
    }
}
test();
