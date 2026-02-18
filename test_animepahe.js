const { ANIME } = require('@consumet/extensions');
(async () => {
    const anime = new ANIME.AnimePahe();
    console.log('Searching for Pokemon...');
    const search = await anime.search('Pokémon');
    console.log('Search results:', search.results.length);
    if (search.results.length > 0) {
        console.log('First result:', search.results[0].title, 'ID:', search.results[0].id);
        console.log('Fetching Episode 1 of ID:', search.results[0].id);
        const info = await anime.fetchAnimeInfo(search.results[0].id);
        console.log('Episodes count:', info.episodes.length);
        const ep = info.episodes.find(e => e.number === 1);
        if (ep) {
            console.log('Episode 1 ID:', ep.id);
            const sources = await anime.fetchEpisodeSources(ep.id);
            console.log('Sources:', JSON.stringify(sources, null, 2));
        }
    }
})();
