const { ANIME } = require('@consumet/extensions');
const gogo = new ANIME.Gogoanime();
console.log('Testing Gogoanime search...');
gogo.search('naruto').then(res => {
    console.log('Results:', res.results.length);
    if (res.results.length > 0) {
        console.log('First result:', res.results[0].title);
    }
}).catch(err => {
    console.error('Error:', err.message);
});
