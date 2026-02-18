
const { META } = require('@consumet/extensions');
const tmdb = new META.TMDB();

(async () => {
    try {
        console.log("Fetching Pokemon info...");
        const res = await tmdb.fetchMediaInfo('60572', 'tv');
        console.log("Success!");
        console.log("Title:", res.title);
        console.log("Seasons:", res.seasons?.length);
    } catch (e) {
        console.error("Error fetching:", e);
    }
})();
