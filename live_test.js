const API_BASE = process.env.API_BASE || 'http://127.0.0.1:3000';
const WATCH_URL = process.env.WATCH_URL || `${API_BASE}/sports/buffstreams/all`;
const SOURCE_URL = process.env.SOURCE_URL || `${API_BASE}/sports/buffstreams/watch?episodeId=${encodeURIComponent('https://buffstreams.plus/mlb/houston-astros-toronto-blue-jays/1343078')}`;

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  });
  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = bodyText;
  }
  return { status: response.status, body, raw: bodyText };
}

(async () => {
  console.log('[live_test] API_BASE =', API_BASE);

  const search = await fetchText(WATCH_URL).catch((err) => ({ status: 0, body: String(err.message || err), raw: '' }));
  console.log('[live_test] sports search status =', search.status);
  console.log('[live_test] sports search sample =', Array.isArray(search.body) ? search.body.slice(0, 3) : String(search.raw).slice(0, 500));

  const source = await fetchText(SOURCE_URL).catch((err) => ({ status: 0, body: String(err.message || err), raw: '' }));
  const sourceText = typeof source.body === 'string' ? source.body : JSON.stringify(source.body || {});
  console.log('[live_test] source status =', source.status);
  console.log('[live_test] source payload =', sourceText.slice(0, 1200));
  console.log('[live_test] resolved branch =', /native js/i.test(sourceText) ? 'Native JS' : 'Unknown');

  if (search.status !== 200) process.exitCode = 3;
  if (source.status !== 200) process.exitCode = 4;
})();
