const { META, PROVIDERS_LIST, StreamingServers } = require('@consumet/extensions');
console.log("StreamingServers:", StreamingServers);

const flixhq = PROVIDERS_LIST.MOVIES.find(p => p.name.toLowerCase() === 'flixhq');
console.log("FlixHQ Provider Info:", flixhq.name);
