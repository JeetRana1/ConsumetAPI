const { META } = require('@consumet/extensions');
const anilist = new META.Anilist();
let methods = new Set();
let obj = anilist;
while (obj) {
    Object.getOwnPropertyNames(obj).forEach(m => methods.add(m));
    obj = Object.getPrototypeOf(obj);
}
console.log('Anilist methods:', Array.from(methods));
