// The Report a problem form's rules. They are the Worker's too (feedback-worker/src/handle.js): change them in both places.

/** The Turnstile widget "Crest feedback" of crestisland.app and www (Cloudflare, Turnstile). A site key is public. */
export const TURNSTILE_SITE_KEY = "0x4AAAAAAF7gYx83Bf-bZGy5";
export const ENDPOINT = "/api/feedback";

const MAX_MESSAGE = 5000;
const MAX_EMAIL = 254;
const MAX_ATTACHMENTS = 3 * 1048576;
const MAX_FILES = 10;
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const PLAIN = /^[\x21-\x7e]+$/;
const NOT_ASCII = /[^\x00-\x7f]/;
const SHORT = /^[0-9A-Za-z.]{1,32}$/;
const SYSTEM = /^[0-9A-Za-z.]([0-9A-Za-z. ]{0,30}[0-9A-Za-z.])?$/;
const EXTENSION = /\.(log|txt|png|jpg)$/i;

/** The fields in page order: the first with a problem gets the focus. */
export const FIELDS = ["message", "email", "attachments", "version", "system"] as const;
export type Field = (typeof FIELDS)[number];

export interface Report {
  message: string;
  email: string;
  version: string;
  system: string;
  files: { name: string; size: number }[];
}

/** What is wrong with the form, by field; an empty object means send it. */
export function validate({ message, email, version, system, files }: Report): Partial<Record<Field, string>> {
  const found: Partial<Record<Field, string>> = {};
  const text = message.replace(/\r\n?/g, "\n").trim(); // a line break counts as one character, as in the Worker
  if (!text) found.message = "Tell us what happened.";
  else if (text.length > MAX_MESSAGE) found.message = "Keep it to 5,000 characters or fewer.";
  if (NOT_ASCII.test(email)) found.email = "Use an email address with plain letters, or leave it empty.";
  else if (email && !(email.length <= MAX_EMAIL && EMAIL.test(email) && PLAIN.test(email))) found.email = "That email address doesn't look right.";
  if (version && !SHORT.test(version)) found.version = "Use up to 32 letters, digits or dots, such as 1.1.0.";
  if (system && !SYSTEM.test(system)) found.system = "Use up to 32 letters, digits, dots or spaces, such as Windows 11 24H2.";
  if (files.some((f) => !EXTENSION.test(f.name))) found.attachments = "Attach .log, .txt, .png or .jpg files.";
  else if (files.length > MAX_FILES) found.attachments = "Attach up to 10 files.";
  else if (files.reduce((total, f) => total + f.size, 0) > MAX_ATTACHMENTS) found.attachments = "Attachments can be 3 MB in total.";
  return found;
}
