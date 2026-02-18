import { PROVIDERS_LIST } from '@consumet/extensions';

console.log('Available Movie Providers:');
PROVIDERS_LIST.MOVIES.forEach(p => {
    console.log(`- ${p.name}`);
});
