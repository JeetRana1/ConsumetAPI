const { META } = require('@consumet/extensions');
const anilistManga = new META.Anilist.Manga();
let methods = new Set();
let obj = anilistManga;
while (obj) {
    Object.getOwnPropertyNames(obj).forEach(m => methods.add(m));
    obj = Object.getPrototypeOf(obj);
}
console.log('Anilist Manga methods:', Array.from(methods));
