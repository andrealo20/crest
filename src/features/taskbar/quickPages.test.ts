import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BT_LOW, BT_RINGS, afterConnect, btLine, btLow, btRows, btShown, btView, wifiAction, wifiRows, wifiView, type BtDevice, type WifiNetwork } from "./quickPages.ts";

const net = (p: Partial<WifiNetwork>): WifiNetwork => ({ ssid: "Home", bars: 3, kind: "personal", saved: false, connected: false, ...p });

test("the Wi-Fi page says what keeps the list away before it lists", () => {
  const list = { state: "allowed" as const, networks: [net({})] };
  assert.equal(wifiView(false, list, null), "off");
  assert.equal(wifiView(true, null, "settings"), "settings");
  assert.equal(wifiView(true, null, null), "loading");
  assert.equal(wifiView(true, null, "failed"), "failed"); // a first read that fails does not spin as loading
  assert.equal(wifiView(true, null, "denied"), "failed");
  assert.equal(wifiView(true, { state: "ask", networks: [] }, null), "ask");
  assert.equal(wifiView(true, { state: "denied", networks: [] }, null), "denied");
  assert.equal(wifiView(true, { state: "none", networks: [] }, null), "none");
  assert.equal(wifiView(true, { state: "allowed", networks: [] }, null), "empty");
  assert.equal(wifiView(true, list, null), "list");
  assert.equal(wifiView(true, list, "failed"), "list"); // a failed refresh keeps the last list
});

test("a click connects to an open or saved network, asks a new one's password and sends a company network to Settings", () => {
  assert.equal(wifiAction(net({ kind: "open" })), "connect");
  assert.equal(wifiAction(net({ saved: true })), "connect");
  assert.equal(wifiAction(net({})), "password");
  assert.equal(wifiAction(net({ kind: "enterprise", saved: true })), "settings");
  assert.equal(wifiAction(net({ connected: true })), "disconnect");
});

test("a failed connection says why, and a rejected key opens the password", () => {
  assert.deepEqual(afterConnect("password"), { note: "Falsches Passwort", password: true, settings: false });
  assert.deepEqual(afterConnect("settings"), { note: "In den Windows-Einstellungen ändern", password: false, settings: true });
  assert.deepEqual(afterConnect("unavailable"), { note: "Netzwerk nicht erreichbar", password: false, settings: false });
  assert.deepEqual(afterConnect("timeout"), { note: "Zeitüberschreitung", password: false, settings: false });
  assert.deepEqual(afterConnect("denied"), { note: "Vom System nicht erlaubt", password: false, settings: false });
  assert.deepEqual(afterConnect("anything"), { note: "Das hat nicht geklappt", password: false, settings: false });
});

test("the page asks room for its rows: one per network, two for a line with a button, one for a line", () => {
  assert.equal(wifiRows("list", 5), 5);
  assert.equal(wifiRows("ask", 0), 2);
  assert.equal(wifiRows("denied", 0), 2);
  assert.equal(wifiRows("off", 7), 1);
  assert.equal(wifiRows("loading", 0), 1);
  assert.equal(wifiRows("failed", 0), 1);
});

test("the Wi-Fi page keeps the password in the row's state alone: never logged, stored or kept aside", () => {
  const src = readFileSync(new URL("./window/WifiPage.tsx", import.meta.url), "utf8");
  assert.match(src, /const \[value, setValue\] = useState\(""\)/);
  for (const leak of ["console.", "localStorage", "sessionStorage", "createStore", "useRef(value", ".current = value", "setNote(value", "setFailed(value"]) {
    assert.ok(!src.includes(leak), `WifiPage.tsx must not contain ${leak}`);
  }
});

test("the Wi-Fi page scans each time it sees the radio come on, at its consent and on Refresh, never on a timer", () => {
  const src = readFileSync(new URL("./window/WifiPage.tsx", import.meta.url), "utf8");
  // As the page opens with the radio on, and when the radio comes on while it is open (its switch or Windows'): one scan each.
  assert.match(src, /useEffect\(\(\) => \{\s*if \(on\) void read\(true\);\s*\}, \[on\]\);/);
  // The page's three scans: the radio coming on, the consent's answer, the refresh button.
  assert.equal(src.match(/read\(true\)/g)?.length, 3);
  for (const timer of ["setInterval", "setTimeout"]) assert.ok(!src.includes(timer), `WifiPage.tsx must not contain ${timer}`);
});

const dev = (p: Partial<BtDevice>): BtDevice => ({ id: "1", name: "Buds", categories: [], connected: false, battery: null, ...p });

test("the Bluetooth page lists the paired devices once its radio is on and they are read", () => {
  assert.equal(btView(false, [dev({})], false), "off");
  assert.equal(btView(true, null, false), "loading");
  assert.equal(btView(true, null, true), "failed"); // a failed first read is not "no paired devices"
  assert.equal(btView(true, [], false), "empty");
  assert.equal(btView(true, [dev({})], false), "list");
  assert.equal(btView(true, [dev({})], true), "list"); // a failed reread keeps the last list
  // Opened from the Device batteries widget, before the radios are read: loading, not "Bluetooth is off".
  assert.equal(btView(null, null, false), "loading");
  assert.equal(btRows("failed", 0), 1);
  assert.equal(btRows("list", 3), 3);
  assert.equal(btRows("empty", 0), 1);
});

test("a connected device says so with its battery, a paired one says nothing", () => {
  assert.deepEqual(btLine(dev({ connected: true, battery: 80 })), ["Verbunden · {p} %", { p: 80 }]);
  assert.deepEqual(btLine(dev({ connected: true })), ["Verbunden"]);
  assert.equal(btLine(dev({})), null);
});

test("Device batteries draws the connected devices that report a battery: the lowest alone, or the four lowest by name", () => {
  const list = [
    dev({ id: "p", name: "Paired", battery: 5 }),
    dev({ id: "n", name: "No battery", connected: true }),
    ...[["e", "Earbuds", 50], ["m", "Mouse", 15], ["k", "Keyboard", 70], ["c", "Controller", 15], ["h", "Headset", 90]].map(([id, name, battery]) =>
      dev({ id: id as string, name: name as string, connected: true, battery: battery as number }),
    ),
  ];
  // Two at 15: the name decides.
  assert.deepEqual(btShown(list, "lowest").map((d) => d.id), ["c"]);
  assert.deepEqual(btShown(list, "devices").map((d) => d.id), ["c", "e", "k", "m"]);
  assert.equal(BT_RINGS, 4);
  assert.deepEqual(btShown([dev({ connected: true })], "lowest"), []);
  assert.ok(btLow(20) && !btLow(21));
  assert.equal(BT_LOW, 20);
});
