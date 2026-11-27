// npm run site:test (from the repository root). The SQL runs for real, on node:sqlite behind the few calls of D1 that store.js uses.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { DAYS, handle, parsePing } from '../src/handle.js';
import { d1Store } from '../src/store.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({
    bind: (...a) => statement(sql, a),
    run: async () => db.prepare(sql).run(...args),
    all: async () => ({ results: db.prepare(sql).all(...args).map((r) => ({ ...r })) }),
  });
  return {
    prepare: (sql) => statement(sql),
    async batch(list) {
      db.exec('BEGIN');
      for (const s of list) await s.run();
      db.exec('COMMIT');
    },
  };
}

const NOV27 = new Date('2026-11-27T10:00:00Z');
const body = (fields = {}) => JSON.stringify({ version: '1.3.3', platform: 'windows', channel: 'github', ...fields });
const ping = (text, method = 'POST') => new Request('https://crestisland.app/api/ping', { method, body: method === 'POST' ? text : undefined });
const stats = () => new Request('https://crestisland.app/api/stats');

test('parsePing takes the three fields and nothing else', () => {
  assert.deepEqual(parsePing(body()), { version: '1.3.3', platform: 'windows', channel: 'github' });
  assert.equal(parsePing(body({ id: 'abc' })), null);
  assert.equal(parsePing(JSON.stringify({ version: '1.3.3', platform: 'windows' })), null);
  assert.equal(parsePing(body({ version: '1.3.3-beta' })), null);
  assert.equal(parsePing(body({ platform: 'linux' })), null);
  assert.equal(parsePing(body({ channel: 'steam' })), null);
  assert.equal(parsePing('[1,2,3]'), null);
  assert.equal(parsePing('not json'), null);
});

test('a ping counts the day, its country and fields, and stats reads them back', async () => {
  const store = d1Store(d1());
  assert.equal((await handle(ping(body()), store, { country: 'IT', now: NOV27 })).status, 204);
  await handle(ping(body({ platform: 'macos' })), store, { country: 'IT', now: NOV27 });
  await handle(ping(body({ channel: 'store' })), store, { country: 'T1', now: NOV27 });
  const res = await handle(stats(), store, { now: NOV27 });
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
  const s = await res.json();
  assert.equal(s.day, '2026-11-27');
  assert.equal(s.today.total, 3);
  assert.deepEqual(s.today.country, { IT: 2, XX: 1 });
  assert.deepEqual(s.today.platform, { windows: 2, macos: 1 });
  assert.deepEqual(s.today.channel, { github: 2, store: 1 });
  assert.deepEqual(s.today.version, { '1.3.3': 3 });
  assert.equal(s.days.length, DAYS);
  assert.deepEqual(s.days.at(-1), { day: '2026-11-27', n: 3 });
  assert.equal(s.days[0].day, '2026-10-29');
});

test('a bad ping counts nothing', async () => {
  const store = d1Store(d1());
  assert.equal((await handle(ping(body({ id: 'x' })), store, { country: 'IT', now: NOV27 })).status, 400);
  assert.equal((await handle(ping('x'.repeat(300)), store, { now: NOV27 })).status, 400);
  assert.equal((await handle(ping(null, 'GET'), store, { now: NOV27 })).status, 405);
  assert.equal((await (await handle(stats(), store, { now: NOV27 })).json()).today.total, 0);
});

test('the app webview may ask first', async () => {
  const res = await handle(ping(null, 'OPTIONS'), d1Store(d1()), { now: NOV27 });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('access-control-allow-headers'), /Content-Type/);
});

test('prune keeps the totals of past days and drops their breakdowns', async () => {
  const store = d1Store(d1());
  await handle(ping(body()), store, { country: 'IT', now: new Date('2026-11-26T23:00:00Z') });
  await handle(ping(body()), store, { country: 'DE', now: NOV27 });
  await store.prune('2026-11-27');
  const s = await (await handle(stats(), store, { now: NOV27 })).json();
  assert.equal(s.yesterday, 1);
  assert.deepEqual(s.today.country, { DE: 1 });
  assert.deepEqual(s.days.slice(-2).map((d) => d.n), [1, 1]);
});

test('other paths are not this Worker', async () => {
  assert.equal((await handle(new Request('https://crestisland.app/api/other'), d1Store(d1()))).status, 404);
});
