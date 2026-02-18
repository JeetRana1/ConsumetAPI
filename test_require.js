try {
    const Gogoanime = require('@consumet/extensions/dist/providers/anime/gogoanime').default;
    console.log('Gogoanime found via direct require');
} catch (e) {
    console.log('Gogoanime NOT found via direct require:', e.message);
}
