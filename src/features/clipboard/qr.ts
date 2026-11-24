/*
 * What an image's preview offers for the QR code Rust found in it (clipboard.rs clipboard_read). This only picks the button: a
 * link opens through clipboard_open_qr, which reads the code again itself and holds the same rule (web_link), so the page never
 * names the address that opens.
 */

export type QrAction = { kind: "open"; host: string } | { kind: "copy" } | { kind: "none" };

/**
 * A web link (http or https, with a host and no name before it) opens, its host on the button as the browser reads it, punycode
 * included; a sign-in secret (otpauth, an authenticator's export) offers nothing, since a copy would keep it in the history;
 * any other text copies.
 */
export function qrAction(text: string): QrAction {
  const t = text.trim();
  if (!t || /^otpauth(-migration)?:/i.test(t)) return { kind: "none" };
  try {
    const u = new URL(t);
    if ((u.protocol === "http:" || u.protocol === "https:") && u.hostname && !u.username && !u.password) return { kind: "open", host: u.hostname.replace(/^www\./, "") };
  } catch {
    // Not an address: copied as text.
  }
  return { kind: "copy" };
}
