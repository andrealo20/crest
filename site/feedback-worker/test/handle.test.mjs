// npm run site:test (from the repository root)
import assert from 'node:assert/strict';
import test from 'node:test';
import { handle, passed } from '../src/handle.js';

const MB3 = 3 * 1048576;

// A form as the page sends it; a field set to null is left out.
function post(fields = {}, files = [['report.log', 'line one\nline two']], headers = {}) {
  const all = {
    message: 'The wheel does not open.',
    email: 'ada@example.com',
    version: '1.1.0.0',
    system: 'Windows 11 26300',
    'cf-turnstile-response': 'token-1',
    ...fields,
  };
  const fd = new FormData();
  for (const [key, value] of Object.entries(all)) if (value !== null) fd.append(key, value);
  for (const [name, content] of files) fd.append('attachments', new File([content], name));
  return new Request('https://crestisland.app/api/feedback', { method: 'POST', body: fd, headers });
}

// Simulated Turnstile and mail: records what the handler asked of them.
function deps({ human = true, sendError } = {}) {
  const d = {
    verified: [],
    sent: [],
    async verifyTurnstile(token, ip) {
      d.verified.push({ token, ip });
      if (human instanceof Error) throw human;
      return human;
    },
    async send(message) {
      if (sendError) throw sendError;
      d.sent.push(message);
    },
  };
  return d;
}

async function run(request, d = deps()) {
  const response = await handle(request, {}, d);
  return { status: response.status, body: await response.json(), d };
}

test('a valid report: 200, one email with the subject, the reply address and the attachment', async () => {
  const { status, body, d } = await run(post());
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true });
  assert.equal(d.sent.length, 1);
  const [m] = d.sent;
  assert.equal(m.subject, 'Crest report 1.1.0.0');
  assert.equal(m.replyTo, 'ada@example.com');
  assert.equal(m.text, 'The wheel does not open.\n\nVersion: 1.1.0.0\nSystem: Windows 11 26300\nReply to: ada@example.com');
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].filename, 'report.log');
  assert.equal(m.attachments[0].type, 'text/plain');
  assert.equal(new TextDecoder().decode(m.attachments[0].content), 'line one\nline two');
});

test('the optional fields can be left out: plain subject, only the message in the text, no reply address', async () => {
  const { status, d } = await run(post({ email: null, version: '', system: null }, []));
  assert.equal(status, 200);
  const [m] = d.sent;
  assert.equal(m.subject, 'Crest report');
  assert.equal(m.text, 'The wheel does not open.');
  assert.equal(m.replyTo, undefined);
  assert.deepEqual(m.attachments, []);
});

test('Turnstile gets the token and the visitor address', async () => {
  const { d } = await run(post({}, [], { 'CF-Connecting-IP': '203.0.113.9' }));
  assert.deepEqual(d.verified, [{ token: 'token-1', ip: '203.0.113.9' }]);
});

test('Turnstile says no: 403 and nothing is sent', async () => {
  const { status, body, d } = await run(post(), deps({ human: false }));
  assert.equal(status, 403);
  assert.equal(body.ok, false);
  assert.equal(d.sent.length, 0);
});

test('no Turnstile token: 403, nothing is sent', async () => {
  for (const token of [null, '']) {
    const { status, d } = await run(post({ 'cf-turnstile-response': token }));
    assert.equal(status, 403, String(token));
    assert.equal(d.sent.length, 0);
  }
});

test('a Turnstile check that fails to run counts as no: 403', async () => {
  const { status, d } = await run(post(), deps({ human: new Error('siteverify is down') }));
  assert.equal(status, 403);
  assert.equal(d.sent.length, 0);
});

test('the message is 1 to 5000 characters after the trim: 400 outside that', async () => {
  for (const message of [null, '', '   \n ', 'x'.repeat(5001), `  ${'x'.repeat(5001)}  `]) {
    const { status, d } = await run(post({ message }));
    assert.equal(status, 400, String(message).slice(0, 12));
    assert.equal(d.sent.length, 0);
  }
  for (const message of ['x', 'x'.repeat(5000), `  ${'x'.repeat(5000)}\n`]) {
    assert.equal((await run(post({ message }))).status, 200, String(message.length));
  }
});

test('the email is one plain address of at most 254 characters: 400 for a line break or anything else', async () => {
  const long = `${'a'.repeat(250)}@b.co`;
  const bad = ['ada@example.com\nBcc: eve@example.com', 'ada@example.com\r\n', 'ada@example.com ', 'ada example@x.co', 'ada@example', '@example.com', long,
    'Billing<eve@example.com>', '=?utf-8?b?UGF5UGFs?=<eve@example.com>', 'ada@example.com,eve@example.com', 'ada@(x)example.com'];
  for (const email of bad) {
    const { status, d } = await run(post({ email }));
    assert.equal(status, 400, JSON.stringify(email).slice(0, 30));
    assert.equal(d.sent.length, 0);
  }
  assert.equal((await run(post({ email: `${'a'.repeat(248)}@b.co` }))).status, 200); // 254 exactly
});

test('an email address with letters outside ASCII: 400, nothing is sent (send_email may refuse it in a header)', async () => {
  for (const email of ['andré@example.com', 'ada@exämple.com', 'ada@例え.jp']) {
    const { status, body, d } = await run(post({ email }));
    assert.equal(status, 400, email);
    assert.equal(body.error, 'email');
    assert.equal(d.sent.length, 0);
  }
});

test('the message length is counted with line breaks as one character, as the page counts it', async () => {
  // 4000 letters and 1000 line breaks: 5000 characters, but 6000 as CRLF on the wire
  const lines = [...Array(997).fill('xxxx'), ...Array(4).fill('xxx')];
  const message = lines.join('\r\n');
  assert.equal(message.length, 6000);
  const { status, d } = await run(post({ message }));
  assert.equal(status, 200);
  assert.equal(d.sent[0].text.split('\n')[0], 'xxxx');
  assert.ok(!d.sent[0].text.includes('\r'));
  assert.equal(d.sent[0].text.split('\n\n')[0], lines.join('\n'));
  assert.equal((await run(post({ message: `${message}\r\nx` }))).status, 400); // 5002
});

test('the version is up to 32 letters, digits and dots: 400 otherwise', async () => {
  for (const value of ['1.0 beta', '1.0\nX: y', '1.0-rc', '<b>', '1'.repeat(33)]) {
    assert.equal((await run(post({ version: value }))).status, 400, JSON.stringify(value));
  }
  assert.equal((await run(post({ version: '1.2.3.4abc' }))).status, 200);
  assert.equal((await run(post({ version: '1'.repeat(32) }))).status, 200);
});

test('the system is up to 32 letters, digits, dots and inner spaces: 400 otherwise', async () => {
  for (const value of [' macOS', 'macOS ', '10\nX: y', '10-rc', '<b>', '1'.repeat(33)]) {
    assert.equal((await run(post({ system: value }))).status, 400, JSON.stringify(value));
  }
  for (const value of ['Windows 11 24H2', 'macOS 15.1', '1'.repeat(32)]) assert.equal((await run(post({ system: value }))).status, 200, value);
});

test('attachments over 3 MB in all: 413, nothing is sent', async () => {
  const { status, body, d } = await run(post({}, [['a.log', new Uint8Array(MB3 - 5)], ['b.png', new Uint8Array(6)]]));
  assert.equal(status, 413);
  assert.equal(body.ok, false);
  assert.equal(d.sent.length, 0);
});

test('attachments of exactly 3 MB in all go through', async () => {
  const { status, d } = await run(post({}, [['a.log', new Uint8Array(MB3 - 5)], ['b.png', new Uint8Array(5)]]));
  assert.equal(status, 200);
  assert.equal(d.sent[0].attachments.length, 2);
});

test('only .log, .txt, .png and .jpg attachments: 400 for the rest', async () => {
  for (const name of ['setup.exe', 'photo.jpeg', 'notes', 'report.log.exe', 'archive.zip']) {
    const { status, d } = await run(post({}, [['ok.txt', 'fine'], [name, 'x']]));
    assert.equal(status, 400, name);
    assert.equal(d.sent.length, 0);
  }
  const names = ['a.log', 'b.TXT', 'c.png', 'd.JPG'];
  const { status, d } = await run(post({}, names.map((n) => [n, 'x'])));
  assert.equal(status, 200);
  assert.deepEqual(d.sent[0].attachments.map((a) => a.type), ['text/plain', 'text/plain', 'image/png', 'image/jpeg']);
});

test('an attachment name is made safe for a mail header, and the extension is kept', async () => {
  const { d } = await run(post({}, [['my "bad"\r\nname;.log', 'x'], ['C:\\temp\\shot é.png', 'x']]));
  for (const { filename } of d.sent[0].attachments) assert.match(filename, /^[\w. -]+$/);
  assert.match(d.sent[0].attachments[0].filename, /\.log$/);
  assert.match(d.sent[0].attachments[1].filename, /\.png$/);
});

test('the browser sends an empty unnamed file when none is chosen: ignored', async () => {
  // Node hands the empty file back as an empty string; the runtime of the Worker may hand it back as a file
  for (const empty of [new File([], ''), '']) {
    const fd = new FormData();
    fd.append('message', 'hi');
    fd.append('cf-turnstile-response', 't');
    fd.append('attachments', empty);
    const { status, d } = await run(new Request('https://crestisland.app/api/feedback', { method: 'POST', body: fd }));
    assert.equal(status, 200);
    assert.deepEqual(d.sent[0].attachments, []);
  }
});

test('an attachments field that is not a file: 400', async () => {
  const { status } = await run(post({ attachments: 'not a file' }));
  assert.equal(status, 400);
});

test('a body that is not a form: 400', async () => {
  const request = new Request('https://crestisland.app/api/feedback', { method: 'POST', body: '{"message":"hi"}', headers: { 'Content-Type': 'application/json' } });
  const { status, d } = await run(request);
  assert.equal(status, 400);
  assert.equal(d.sent.length, 0);
});

test('a body far over the limit is refused before it is read: 413', async () => {
  const request = new Request('https://crestisland.app/api/feedback', { method: 'POST', body: 'x', headers: { 'Content-Length': String(50 * 1048576) } });
  const { status, d } = await run(request);
  assert.equal(status, 413);
  assert.equal(d.verified.length, 0);
});

test('a body over the limit sent without Content-Length: 413, and Turnstile is not asked', async () => {
  const big = new Uint8Array(4 * 1048576);
  const body = new ReadableStream({
    start(c) {
      for (let i = 0; i < big.length; i += 65536) c.enqueue(big.subarray(i, i + 65536));
      c.close();
    },
  });
  const request = new Request('https://crestisland.app/api/feedback', { method: 'POST', body, duplex: 'half', headers: { 'Content-Type': 'multipart/form-data; boundary=x' } });
  assert.equal(request.headers.get('Content-Length'), null);
  const { status, d } = await run(request);
  assert.equal(status, 413);
  assert.equal(d.verified.length, 0);
});

test('up to 10 attachments: 400 for 11, nothing is sent', async () => {
  const files = (n) => Array.from({ length: n }, (_, i) => [`part${i}.txt`, 'x']);
  assert.equal((await run(post({}, files(10)))).status, 200);
  const { status, d } = await run(post({}, files(11)));
  assert.equal(status, 400);
  assert.equal(d.sent.length, 0);
});

test("passed: Turnstile's yes counts only for a page of crestisland.app or www", () => {
  assert.equal(passed({ success: true, hostname: 'crestisland.app' }), true);
  assert.equal(passed({ success: true, hostname: 'www.crestisland.app' }), true);
  for (const result of [{ success: true, hostname: 'localhost' }, { success: true, hostname: 'crest-island.pages.dev' }, { success: true }, { success: false, hostname: 'crestisland.app' }, { success: 'true', hostname: 'crestisland.app' }, null]) {
    assert.equal(passed(result), false, JSON.stringify(result));
  }
});

test('the mail cannot be sent: 502', async () => {
  const { status, body } = await run(post(), deps({ sendError: new Error('send_email refused') }));
  assert.equal(status, 502);
  assert.deepEqual(body, { ok: false, error: 'send' });
});

test('any method but POST: 405, and nothing is asked of Turnstile or the mail', async () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const d = deps();
    const { status, body } = await run(new Request('https://crestisland.app/api/feedback', { method }), d);
    assert.equal(status, 405, method);
    assert.equal(body.ok, false);
    assert.equal(d.verified.length + d.sent.length, 0);
  }
});

test('the answer is JSON', async () => {
  const response = await handle(post(), {}, deps());
  assert.match(response.headers.get('Content-Type'), /^application\/json/);
});
