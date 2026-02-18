const { ANIME } = require('@consumet/extensions');
const gogo = new ANIME.Gogoanime();
let methods = new Set();
let obj = gogo;
while (obj) {
    Object.getOwnPropertyNames(obj).forEach(m => methods.add(m));
    obj = Object.getPrototypeOf(obj);
}
console.log('Gogoanime methods:', Array.from(methods));
