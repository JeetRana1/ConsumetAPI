const axios = require('axios');
axios.get('http://localhost:3000/meta/tmdb/batman').then(res => {
    console.log(JSON.stringify(res.data.results[0], null, 2));
}).catch(err => console.error(err.message));
