const axios = require('axios');

const url = 'https://bluehorizon4.site/file1/PJZk8rHv2M8wfr3MIXsvarfbOkhHBcR8TP2NfQqTaVMdd61uGolGjBB~O1OyQU9MxsxSUVJZ~csyeKkd9n+Jqc8OiS+rRdZsWFNZRI4aDdypLRCY+EBfDn+vvjuywM8PjZqb94ycKSHGQ1pOdlttgiWOpP0L8aTLt16+NBM0nJc=/cGxheWxpc3QubTN1OA==.m3u8';

async function testReferer(referer) {
    try {
        const response = await axios.get(url, {
            headers: {
                'Referer': referer,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Connection': 'keep-alive',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'cross-site'
            },
            validateStatus: () => true
        });
        console.log(`Referer: ${referer} -> Status: ${response.status}`);
        if (response.status === 403) {
            console.log('Headers:', JSON.stringify(response.headers, null, 2));
            console.log('Body snippet:', response.data.slice(0, 100).toString());
        }
    } catch (err) {
        console.log(`Referer: ${referer} -> Error: ${err.message}`);
    }
}

async function run() {
    await testReferer('https://megacloud.tv/');
}

run();
