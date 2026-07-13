const BUFFSTREAMS_DOMAIN = (process.env.BUFFSTREAMS_BASE_URL || 'https://buffstreams.ir').replace(/\/+$/, '');
const DEFAULT_URL = `${BUFFSTREAMS_DOMAIN}/wnba/golden-state-valkyries-new-york-liberty/1212518`;
const WARNING_RE = /links\s+will\s+appear\s+around\s+60\s+mins\s+prior\s+to\s+game\s+start/i;
const CLOCK_RE = /\b(\d{1,2}):(\d{2}):(\d{2})\b/;

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripHtml(html) {
  return normalizeWhitespace(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
}

function parseLockedCountdown(html) {
  const text = stripHtml(html);
  const timerMatch = text.match(CLOCK_RE);
  if (timerMatch) {
    const hours = Number(timerMatch[1] || 0);
    const minutes = Number(timerMatch[2] || 0);
    const seconds = Number(timerMatch[3] || 0);
    return {
      isLocked: true,
      countdownSeconds: (hours * 3600) + (minutes * 60) + seconds,
      reason: 'countdown-timer',
      rawClock: timerMatch[0],
    };
  }
  if (WARNING_RE.test(text)) {
    return {
      isLocked: true,
      countdownSeconds: null,
      reason: 'links-not-ready',
      rawClock: '',
    };
  }
  return { isLocked: false, countdownSeconds: null, reason: 'unlocked-or-no-clock', rawClock: '' };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: `${BUFFSTREAMS_DOMAIN}/`,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} while fetching ${url}`);
  return text;
}

async function main() {
  const targetUrl = process.argv[2] || DEFAULT_URL;
  const fixture = '<main><section class="match-header"><b>Golden State Valkyries</b><span>01:30:04</span><b>New York Liberty</b></section><div>Links will appear around 60 mins prior to game start. Please check back again</div></main>';
  const fixtureResult = parseLockedCountdown(fixture);
  console.log('[verify_clocks] fixture rawClock:', fixtureResult.rawClock);
  console.log('[verify_clocks] fixture countdownSeconds:', fixtureResult.countdownSeconds);
  console.log('[verify_clocks] fixture payload:', JSON.stringify({ isLocked: fixtureResult.isLocked, countdownSeconds: fixtureResult.countdownSeconds, lockReason: fixtureResult.reason }));

  console.log('[verify_clocks] fetching live watch page:', targetUrl);
  const html = await fetchText(targetUrl);
  const liveResult = parseLockedCountdown(html);
  console.log('[verify_clocks] live rawClock:', liveResult.rawClock || '(none)');
  console.log('[verify_clocks] live countdownSeconds:', liveResult.countdownSeconds);
  console.log('[verify_clocks] local proxy payload:', JSON.stringify({
    id: targetUrl,
    url: targetUrl,
    isLocked: liveResult.isLocked,
    countdownSeconds: liveResult.countdownSeconds,
    lockReason: liveResult.reason,
  }));
}

main().catch((error) => {
  console.error('[verify_clocks] failed:', error.message || error);
  process.exitCode = 1;
});
