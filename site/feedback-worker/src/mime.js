// A multipart/mixed email as the text send_email takes: the report as a UTF-8 text part, then one part per attachment.
// shortcut: headers are ASCII only, so no RFC 2047 encoding. They are because handle.js refuses an email address, a
// version or a system name with other characters and rewrites the file names, and the subject is built from those.
// Add the encoding if a header ever carries other text.

const CRLF = '\r\n';

// A header value or file name cannot carry a line break (that would start a new header) or a quote.
const clean = (s) => String(s).replace(/[\r\n"]+/g, '_');

const utf8 = (s) => new TextEncoder().encode(s);

// Base64 in lines of 76 characters. Chunks of a multiple of 3 bytes join without padding in the middle.
function base64Lines(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 12288) out += btoa(String.fromCharCode(...bytes.subarray(i, i + 12288)));
  return out.match(/.{1,76}/g)?.join(CRLF) ?? '';
}

export function buildMime({ from, to, subject, text, replyTo, attachments = [] }) {
  const boundary = `crest-${crypto.randomUUID()}`;
  const headers = [
    `From: ${clean(from)}`,
    `To: ${clean(to)}`,
    `Subject: ${clean(subject)}`,
    ...(replyTo ? [`Reply-To: ${clean(replyTo)}`] : []),
    // Mail providers score a message without a Date or a Message-ID as spam
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${clean(from).split('@').pop()}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary=${boundary}`,
  ];
  const part = (partHeaders, bytes) => [`--${boundary}`, ...partHeaders, '', base64Lines(bytes)].join(CRLF);
  const parts = [
    part(['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64'], utf8(text)),
    ...attachments.map(({ filename, type, content }) =>
      part(
        [
          `Content-Type: ${clean(type)}; name="${clean(filename)}"`,
          `Content-Disposition: attachment; filename="${clean(filename)}"`,
          'Content-Transfer-Encoding: base64',
        ],
        content,
      ),
    ),
  ];

  return [...headers, '', ...parts, `--${boundary}--`, ''].join(CRLF);
}
