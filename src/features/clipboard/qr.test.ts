import { test } from "node:test";
import assert from "node:assert/strict";
import { qrAction } from "./qr.ts";

test("a QR code's web link opens with its host on the button, a sign-in secret offers nothing, anything else copies", () => {
  assert.deepEqual(qrAction(" https://www.example.com/menu?table=12 "), { kind: "open", host: "example.com" });
  assert.deepEqual(qrAction("http://192.168.1.20:8080/"), { kind: "open", host: "192.168.1.20" });
  // A copy would keep the secret in the history.
  assert.deepEqual(qrAction("otpauth://totp/Crest:me?secret=JBSWY3DPEHPK3PXP"), { kind: "none" });
  assert.deepEqual(qrAction("OTPAUTH-MIGRATION://offline?data=abc"), { kind: "none" });
  // Never opened from here, as clipboard.rs web_link: another scheme, a name before the host.
  for (const t of ["javascript:alert(1)", "file:///C:/Windows/System32/cmd.exe", "WIFI:S:Home;T:WPA;P:secret;;", "https://google.com@evil.example/", "Just some text"])
    assert.deepEqual(qrAction(t), { kind: "copy" }, t);
  assert.deepEqual(qrAction("   "), { kind: "none" });
});

test("the host shows as the browser reads it, so a look-alike name cannot pass for another site", () => {
  assert.deepEqual(qrAction("https://ëxample.com/login"), { kind: "open", host: "xn--xample-ova.com" });
});
