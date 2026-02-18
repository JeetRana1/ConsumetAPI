const { ANIME } = require('@consumet/extensions');
const hianime = new ANIME.Hianime();

console.log('Testing Hianime search...');
hianime.search('naruto').then(res => {
    console.log('Results:', res.results.length);
    if (res.results.length > 0) {
        console.log('First result:', res.results[0].title);
    }
}).catch(err => {
    console.error('Error:', err.message);
});
