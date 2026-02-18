const { MOVIES } = require('@consumet/extensions');

async function checkHiMoviesInfo(id) {
    const himovies = new MOVIES.HiMovies();
    try {
        console.log(`Checking HiMovies ID: ${id}`);
        const info = await himovies.fetchMediaInfo(id);
        console.log('HiMovies Info:', JSON.stringify({
            id: info.id,
            title: info.title,
            releaseDate: info.releaseDate,
            year: info.year,
            description: info.description
        }, null, 2));
    } catch (e) {
        console.error('Error:', e.message);
    }
}

checkHiMoviesInfo('movie/the-housemaid-9031');
