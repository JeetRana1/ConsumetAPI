const { chromium } = require('playwright');

(async () => {
  const startUrl = 'https://watchhd.upns.live/#ml6ebj';
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    extraHTTPHeaders: { Referer: 'https://greenmountmotors.com/' },
  });
  const page = await context.newPage();
  page.on('request', (req) => {
    const url = req.url();
    if (/m3u8|mp4|mkv|manifest|playlist|watchhd|upns/i.test(url)) console.log('[req]', url);
  });
  page.on('response', async (res) => {
    const url = res.url();
    if (/m3u8|mp4|mkv|manifest|playlist|watchhd|upns/i.test(url)) {
      console.log('[res]', url, res.status());
      try {
        const ct = String(res.headers()['content-type'] || '');
        if (/json|text|javascript|mpegurl/i.test(ct)) {
          const text = await res.text();
          console.log(text.slice(0, 1000));
        }
      } catch {}
    }
  });
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  for (let i = 0; i < 15; i++) {
    console.log('tick', i, page.url());
    try {
      const body = await page.content();
      const matches = body.match(/https?:\/\/[^"'\s<>]+/g) || [];
      matches.filter((u) => /m3u8|mp4|mkv|watchhd|upns/i.test(u)).slice(0, 20).forEach((u) => console.log('match', u));
    } catch {}
    await page.evaluate(() => {
      const clickables = Array.from(document.querySelectorAll('button, a, div, [role="button"], #player-button, #downloadButton, .jw-icon-playback, .jw-display-icon-container, video'));
      for (const el of clickables) { try { el.click(); } catch {} }
      const video = document.querySelector('video');
      if (video) { try { video.muted = true; video.play(); } catch {} }
    }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  await browser.close();
})();
