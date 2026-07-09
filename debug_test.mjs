import { HdStream4uProvider } from './dist/providers/custom/hdstream4uProvider.js';
const result = await HdStream4uProvider.fetchSources('https://hdstream4u.com/file/mwmslva0dmqd', 'hdstream4u', false, {});
console.log('Sources:', JSON.stringify(result?.sources?.map(s => s.url?.substring(0, 80))));
console.log('Referer:', result?.headers?.Referer);
