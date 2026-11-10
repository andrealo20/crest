// npm run site:test (from the repository root)
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMime } from '../src/mime.js';

const base = { from: 'feedback@crestisland.app', to: 'dev@example.com', subject: 'Crest report 1.1.0.0', text: 'Non si apre, è così.\n\nVersion: 1.1.0.0' };

const bytes = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) % 256);

// Splits a message into its headers and the body parts between the boundary lines.
function parse(mime) {
  const [head, ...rest] = mime.split('\r\n\r\n');
  const headers = Object.fromEntries(head.split('\r\n').map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()]));
  const boundary = headers['Content-Type'].match(/boundary="?([^";\s]+)"?/)[1];
  const parts = rest.join('\r\n\r\n').split(`--${boundary}`).slice(1);
  assert.equal(parts.at(-1).trim(), '--', 'closing boundary');
  return { headers, boundary, parts: parts.slice(0, -1).map((p) => p.replace(/^\r\n/, '').replace(/\r\n$/, '')) };
}

const split = (part) => {
  const [header, ...body] = part.split('\r\n\r\n');
  return { header, body: body.join('\r\n\r\n') };
};

const decode = (body) => Uint8Array.from(atob(body.replace(/\r\n/g, '')), (c) => c.charCodeAt(0));

test('the headers: From, To, Subject, Date, Message-ID, MIME-Version and a multipart/mixed boundary', () => {
  const { headers } = parse(buildMime(base));
  assert.equal(headers.From, 'feedback@crestisland.app');
  assert.equal(headers.To, 'dev@example.com');
  assert.equal(headers.Subject, 'Crest report 1.1.0.0');
  assert.equal(headers['MIME-Version'], '1.0');
  assert.match(headers['Content-Type'], /^multipart\/mixed; boundary=\S+$/);
  assert.match(headers['Message-ID'], /^<[^<>\s]+@crestisland.app>$/);
  assert.ok(!Number.isNaN(Date.parse(headers.Date)), headers.Date);
});

test('Reply-To only when given', () => {
  assert.equal(parse(buildMime(base)).headers['Reply-To'], undefined);
  assert.equal(parse(buildMime({ ...base, replyTo: 'ada@example.com' })).headers['Reply-To'], 'ada@example.com');
});

test('the text is the first part: UTF-8 in base64', () => {
  const { parts } = parse(buildMime({ ...base, attachments: [] }));
  assert.equal(parts.length, 1);
  const { header, body } = split(parts[0]);
  assert.match(header, /^Content-Type: text\/plain; charset=utf-8$/m);
  assert.match(header, /^Content-Transfer-Encoding: base64$/m);
  assert.equal(new TextDecoder().decode(decode(body)), base.text);
});

test('each attachment is a part of its own, and its base64 decodes to the original bytes', () => {
  // 0 to 3 bytes cover the padding; 100000 spans several conversion chunks
  const files = [0, 1, 2, 3, 57, 58, 100000].map((n) => ({ filename: `f${n}.png`, type: 'image/png', content: bytes(n) }));
  const { parts } = parse(buildMime({ ...base, attachments: files }));
  assert.equal(parts.length, 1 + files.length);
  files.forEach((file, i) => {
    const { header, body } = split(parts[i + 1]);
    assert.match(header, /^Content-Type: image\/png; name="f\d+\.png"$/m);
    assert.match(header, /^Content-Disposition: attachment; filename="f\d+\.png"$/m);
    assert.match(header, /^Content-Transfer-Encoding: base64$/m);
    assert.deepEqual(decode(body), file.content, file.filename);
  });
});

test('no base64 line is longer than 76 characters', () => {
  const content = bytes(100000);
  const { parts } = parse(buildMime({ ...base, text: 'y'.repeat(5000), attachments: [{ filename: 'a.log', type: 'text/plain', content }] }));
  for (const part of parts) {
    const lines = split(part).body.split('\r\n');
    assert.ok(lines.length > 1);
    for (const line of lines) assert.ok(line.length <= 76, `${line.length} characters`);
  }
});

test('line breaks are CRLF everywhere', () => {
  const mime = buildMime({ ...base, replyTo: 'ada@example.com', attachments: [{ filename: 'a.log', type: 'text/plain', content: bytes(500) }] });
  assert.ok(!/(^|[^\r])\n/.test(mime));
});

test('a line break in a header value cannot start a new header', () => {
  const mime = buildMime({ ...base, subject: 'hi\r\nBcc: eve@example.com', replyTo: 'a@b.co\nBcc: eve@example.com', attachments: [{ filename: 'a"\r\nBcc: x.log', type: 'text/plain', content: bytes(3) }] });
  assert.ok(!/^Bcc:/m.test(mime));
});

test('two messages have different boundaries', () => {
  assert.notEqual(parse(buildMime(base)).boundary, parse(buildMime(base)).boundary);
});
