// The daily count: POST /api/ping from the app, GET /api/stats for the site's /stats/ page. It knows nothing of Cloudflare:
// index.js hands in the database (store.js) and the country. The app's side of the rules is in the app; change both together.

const PLATFORMS = ['windows', 'macos'];
const CHANNELS = ['store', 'github', 'portable'];
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,4}$/;
const COUNTRY = /^[A-Z]{2}$/;
// Three short fields; anything longer is not the app
const MAX_BODY = 256;
// How many daily totals /api/stats returns, today included
export const DAYS = 30;

// The app's webview sends JSON from its own origin, which asks first; nothing here carries credentials
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' };

export const utcDay = (date) => date.toISOString().slice(0, 10);
const daysBefore = (day, n) => utcDay(new Date(Date.parse(`${day}T00:00:00Z`) - n * 86400000));

// The ping as the app sends it: exactly these three fields, each one of the values the app can have, or null
export function parsePing(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body).sort().join(',');
  if (keys !== 'channel,platform,version') return null;
  const { version, platform, channel } = body;
  if (typeof version !== 'string' || !VERSION.test(version)) return null;
  if (!PLATFORMS.includes(platform) || !CHANNELS.includes(channel)) return null;
  return { version, platform, channel };
}

async function ping(request, store, country, now) {
  const length = Number(request.headers.get('content-length'));
  if (length > MAX_BODY) return new Response(null, { status: 400, headers: CORS });
  const text = await request.text();
  const fields = text.length <= MAX_BODY ? parsePing(text) : null;
  if (!fields) return new Response(null, { status: 400, headers: CORS });
  // Cloudflare's guess from the address, which is used for nothing else; T1 (Tor) and unknown ones count as XX
  await store.add(utcDay(now), { ...fields, country: COUNTRY.test(country ?? '') ? country : 'XX' });
  return new Response(null, { status: 204, headers: CORS });
}

async function stats(store, now) {
  const today = utcDay(now);
  const { breakdown, totals } = await store.read(today, daysBefore(today, DAYS - 1));
  const byDay = new Map(totals.map((t) => [t.day, t.n]));
  const days = Array.from({ length: DAYS }, (_, i) => {
    const day = daysBefore(today, DAYS - 1 - i);
    return { day, n: byDay.get(day) ?? 0 };
  });
  return Response.json(
    { day: today, today: { total: byDay.get(today) ?? 0, ...breakdown }, yesterday: byDay.get(daysBefore(today, 1)) ?? 0, days, read: now.toISOString() },
    // The page reads it again every five minutes, so a copy that old is as good
    { headers: { 'Cache-Control': 'public, max-age=300' } },
  );
}

export async function handle(request, store, { country, now = new Date() } = {}) {
  const { pathname } = new URL(request.url);
  if (pathname === '/api/ping') {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST, OPTIONS' } });
    return ping(request, store, country, now);
  }
  if (pathname === '/api/stats') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    return stats(store, now);
  }
  return new Response(null, { status: 404 });
}
