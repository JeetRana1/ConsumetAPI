import { setCache, getCache } from './src/utils/cache';

async function test() {
    console.log('Testing cache...');
    await setCache('test_key', { hello: 'world' }, 10);
    const val = await getCache('test_key');
    console.log('Retrieved value:', val);
    if (val && val.hello === 'world') {
        console.log('✓ Cache system is working!');
    } else {
        console.log('✗ Cache system failed!');
    }
    process.exit(0);
}

test();
