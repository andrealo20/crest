// The report form's handler. It knows nothing of Cloudflare: index.js hands in Turnstile and the mail as `deps`.
// The rules are the page's too (src/scripts/feedback.mjs); change them in both places.

const MAX_MESSAGE = 5000;
const MAX_EMAIL = 254;
const MAX_ATTACHMENTS = 3 * 1048576;
const MAX_FILES = 10;
// The attachments plus the form's own fields and framing; a body over this cannot be a valid report
const MAX_BODY = MAX_ATTACHMENTS + 256 * 1024;
// One address and nothing else: no display name, brackets or comments, which a mail client would show on the reply
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
// The hosts whose pages carry the widget; a token Turnstile issued anywhere else is not one of ours
const HOSTS = ['crestisland.app', 'www.crestisland.app'];
// Printable ASCII only: the address goes raw into the Reply-To header, which send_email may refuse otherwise
const PLAIN = /^[\x21-\x7e]+$/;
const SHORT = /^[0-9A-Za-z.]{1,32}$/;
// The system as people write it: Windows 11 24H2, macOS 15.1
const SYSTEM = /^[0-9A-Za-z.]([0-9A-Za-z. ]{0,30}[0-9A-Za-z.])?$/;
// The type comes from the extension; the one the browser sends is the visitor's word
const TYPES = { log: 'text/plain', txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg' };

const reply = (status, error) => Response.json(error ? { ok: false, error } : { ok: true }, { status });
const extension = (name) => /\.(log|txt|png|jpg)$/i.exec(name)?.[1].toLowerCase();
// Goes into a mail header: plain characters only, the end of the name (and its extension) kept
const safeName = (name) => name.replace(/[^\w. -]/g, '_').slice(-64);
// A field that was left out, left empty or filled with text the rule accepts
const optional = (value, accepts) => value === null || value === '' || (typeof value === 'string' && accepts(value));
// What siteverify answered, for index.js: a pass, for one of the site's own pages
export const passed = (result) => result?.success === true && HOSTS.includes(result.hostname);

// The body up to MAX_BODY bytes, or null past that. Content-Length can be left out, so the bytes are counted here.
async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request.body ?? []) {
    size += chunk.byteLength;
    if (size > MAX_BODY) return null;
    chunks.push(chunk);
  }
  return new Blob(chunks);
}

export async function handle(request, env, deps) {
  if (request.method !== 'POST') return reply(405, 'method');
  if (Number(request.headers.get('Content-Length')) > MAX_BODY) return reply(413, 'too-large');

  let form;
  try {
    const body = await readBody(request);
    if (!body) return reply(413, 'too-large');
    form = await new Response(body, { headers: { 'Content-Type': request.headers.get('Content-Type') ?? '' } }).formData();
  } catch {
    return reply(400, 'form');
  }

  const token = form.get('cf-turnstile-response');
  let human = false;
  try {
    human = typeof token === 'string' && token !== '' && (await deps.verifyTurnstile(token, request.headers.get('CF-Connecting-IP')));
  } catch {} // a check that cannot run is a check that failed
  if (!human) return reply(403, 'turnstile');

  // Browsers send the line breaks of a textarea as CRLF; the page counts them as one character
  const message = typeof form.get('message') === 'string' ? form.get('message').replace(/\r\n?/g, '\n').trim() : '';
  if (message.length < 1 || message.length > MAX_MESSAGE) return reply(400, 'message');
  if (!optional(form.get('email'), (v) => v.length <= MAX_EMAIL && EMAIL.test(v) && PLAIN.test(v))) return reply(400, 'email');
  if (!optional(form.get('version'), (v) => SHORT.test(v))) return reply(400, 'version');
  if (!optional(form.get('system'), (v) => SYSTEM.test(v))) return reply(400, 'system');
  const [email, version, system] = ['email', 'version', 'system'].map((name) => form.get(name) || '');

  // A form with no file chosen still sends one empty, unnamed file; some parsers hand it over as an empty string
  const files = form.getAll('attachments').filter((f) => f !== '' && !(f instanceof File && f.name === '' && f.size === 0));
  if (files.length > MAX_FILES || files.some((f) => !(f instanceof File) || !extension(f.name))) return reply(400, 'attachment');
  if (files.reduce((total, f) => total + f.size, 0) > MAX_ATTACHMENTS) return reply(413, 'too-large');

  const attachments = await Promise.all(
    files.map(async (f) => ({ filename: safeName(f.name), type: TYPES[extension(f.name)], content: new Uint8Array(await f.arrayBuffer()) })),
  );
  const details = [['Version', version], ['System', system], ['Reply to', email]].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);

  try {
    await deps.send({
      subject: version ? `Crest report ${version}` : 'Crest report',
      text: details.length ? `${message}\n\n${details.join('\n')}` : message,
      replyTo: email || undefined,
      attachments,
    });
  } catch {
    return reply(502, 'send');
  }
  return reply(200);
}
