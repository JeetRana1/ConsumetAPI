const axios = require('axios');
axios.get('http://localhost:3000/meta/tmdb/info/414906?type=movie').then(res => {
    console.log(JSON.stringify(res.data, null, 2));
}).catch(err => console.error(err.message));
