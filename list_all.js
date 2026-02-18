const { MOVIES, ANIME, MANGA } = require('@consumet/extensions');
console.log('--- MOVIES ---');
Object.keys(MOVIES).forEach(k => console.log(k));
console.log('--- ANIME ---');
Object.keys(ANIME).forEach(k => console.log(k));
console.log('--- MANGA ---');
Object.keys(MANGA).forEach(k => console.log(k));
