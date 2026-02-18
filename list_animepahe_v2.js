const { ANIME } = require('@consumet/extensions');
const animepahe = new ANIME.AnimePahe();
let methods = new Set();
let obj = animepahe;
while (obj) {
    Object.getOwnPropertyNames(obj).forEach(m => methods.add(m));
    obj = Object.getPrototypeOf(obj);
}
console.log('AnimePahe methods:', Array.from(methods));
