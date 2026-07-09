const { chromium } = require('playwright');

(async () => {
  const startUrl = 'https://gadgetsweb.xyz/?id=djJqZWQ4VFVKRU5ud2VNQ2hNenpzWFpyblFsWCtJaS9YSVFwMndkYlZaNWFZRlIzQkMwNldrMTBaUFhkYWswZVVOcjlIRmlaQnVvU1BDL1FDdDlUY3VSNExQUUkzYU9kTlg3Sk5LZDVYUzA9';
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  const remember = (label, url) => {
    if (!url) return;
    console.log(`[${label}] ${url}`);
  };

  context.on('page', (popup) => {
    remember('popup', popup.url());
    popup.on('framenavigated', (frame) => {
      if (frame === popup.mainFrame()) remember('popup-nav', popup.url());
    });
  });

  page.on('request', (req) => remember('req', req.url()));
  page.on('response', (res) => remember('res', res.url()));
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) remember('nav', page.url());
  });

  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  for (let i = 0; i < 25; i++) {
    try {
      const urls = await page.evaluate(() => {
        const out = [];
        for (const el of Array.from(document.querySelectorAll('[href], [src], [data-href], [onclick], button, a'))) {
          const href = el.getAttribute('href') || el.getAttribute('src') || el.getAttribute('data-href') || '';
          const text = (el.innerText || el.textContent || el.getAttribute('value') || '').trim();
          const onclick = el.getAttribute('onclick') || '';
          out.push({ href, text, onclick });
        }
        return out;
      });
      console.log('--- tick', i, 'url=', page.url());
      for (const row of urls) {
        if ((row.href && /^https?:/i.test(row.href)) || /continue|get links|watch online/i.test(row.text) || /https?:/i.test(row.onclick)) {
          console.log(JSON.stringify(row));
        }
      }
      await page.evaluate(() => {
        const clickables = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'));
        const wanted = [/continue/i, /get\s*links?/i, /watch\s*online/i, /click\s*to\s*continue/i, /proceed/i, /unlock/i];
        for (const el of clickables) {
          const text = String(el.innerText || el.textContent || el.getAttribute('value') || '').trim();
          if (wanted.some((p) => p.test(text))) {
            try { el.click(); } catch {}
          }
        }
      }).catch(() => {});
    } catch (e) {
      console.log('tick-error', e.message);
    }
    await page.waitForTimeout(1000);
  }
  await browser.close();
})();
