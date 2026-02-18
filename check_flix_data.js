const { MOVIES } = require('@consumet/extensions');

async function checkFlixInfo(id) {
    const flix = new MOVIES.FlixHQ();
    try {
        const info = await flix.fetchMediaInfo(id);
        console.log('FlixHQ Info for', id, ':', JSON.stringify(info, null, 2));
    } catch (e) {
        console.error('Error:', e.message);
    }
}

checkFlixInfo('movie/watch-the-housemaid-9031');
