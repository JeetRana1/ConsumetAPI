const { META } = require('@consumet/extensions');

async function checkTmdb(id) {
    const tmdb = new META.TMDB();
    try {
        const info = await tmdb.fetchMediaInfo(id, 'movie');
        console.log('TMDB Info:', JSON.stringify({
            title: info.title,
            releaseDate: info.releaseDate,
            id: info.id
        }, null, 2));
    } catch (e) {
        console.error('TMDB Error:', e.message);
    }
}

checkTmdb('1368166');
