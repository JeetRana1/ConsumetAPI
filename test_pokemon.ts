
const dotenv = require('dotenv');
dotenv.config();
import { META } from '@consumet/extensions';

const tmdbApi = process.env.TMDB_KEY;
console.log("Using key:", tmdbApi);
const tmdb = new META.TMDB(tmdbApi);

(async () => {
    try {
        console.log("Fetching Pokemon info (ID: 60572)...");
        const res = await tmdb.fetchMediaInfo('60572', 'tv');
        console.log("Success!");
        console.log("Title:", res.title);
        // console.log("Seasons:", res.seasons?.length);
    } catch (e: any) {
        console.error("Error fetching:");
        console.error(e.message);
        if (e.response) {
            console.error("Status:", e.response.status);
            console.error("Data:", JSON.stringify(e.response.data));
        }
    }
})();
