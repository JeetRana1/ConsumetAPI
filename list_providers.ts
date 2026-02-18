import { PROVIDERS_LIST } from '@consumet/extensions';

console.log('Available Movie Providers:');
PROVIDERS_LIST.MOVIES.forEach(p => {
    console.log(`- ${p.name}`);
});

console.log('Available Anime Providers:');
PROVIDERS_LIST.ANIME.forEach(p => {
    console.log(`- ${p.toString.name} (${p.name})`);
});
