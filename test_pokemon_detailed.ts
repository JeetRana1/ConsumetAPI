import { META } from '@consumet/extensions';
import dotenv from 'dotenv';
dotenv.config();

const tmdbApi = process.env.TMDB_KEY;
const tmdb = new META.TMDB(tmdbApi);

(async () => {
    try {
        console.log("Testing Pokemon (60572) as TV...");
        const res = await tmdb.fetchMediaInfo('60572', 'tv');
        console.log("Success! Got:", {
            id: res.id,
            title: res.title || res.name,
            hasSeasons: !!res.seasons,
            seasonCount: res.seasons?.length
        });
        console.log("\nFull object keys:", Object.keys(res));
    } catch (e: any) {
        console.error("Failed:", e.message);
        console.error("Stack:", e.stack);
    }
})();
