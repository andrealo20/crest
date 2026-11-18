// The rules of the quick panel's Wi-Fi and Bluetooth pages: what each page shows and what a click on a row does. Pure, so they
// can be tested without the app around them.

/** What a network asks to join: nothing, a password typed in the row, or Windows' settings (src-tauri taskbar/wifi.rs `Kind`). */
export type WifiKind = "open" | "personal" | "enterprise";

/** One row of the Wi-Fi page, as Rust sends it: one per name, the network in use first. `bars` is 0 to 4. */
export interface WifiNetwork {
  ssid: string;
  bars: number;
  kind: WifiKind;
  /** Windows has a profile of that name. */
  saved: boolean;
  connected: boolean;
}

/** The Wi-Fi page's read: "ask" until Windows' location consent is given, "denied" when refused, "none" without an adapter. */
export interface WifiList {
  state: "allowed" | "ask" | "denied" | "none";
  networks: WifiNetwork[];
}

/** What the Wi-Fi page shows in place of its rows, or "list" when it lists them. */
export type WifiView = "off" | "loading" | "failed" | "ask" | "denied" | "none" | "settings" | "empty" | "list";

/** The page's view from the radio, the last read (null before the first) and the last read's failure, a fixed word. */
export function wifiView(on: boolean, list: WifiList | null, failed: string | null): WifiView {
  if (!on) return "off";
  if (failed === "settings") return "settings";
  if (list === null) return failed ? "failed" : "loading";
  if (list.state !== "allowed") return list.state;
  return list.networks.length ? "list" : "empty";
}

/** What a click on a network's row does: a company network goes to Settings, a new secured one asks its password in the row. */
export function wifiAction(n: WifiNetwork): "disconnect" | "connect" | "password" | "settings" {
  if (n.connected) return "disconnect";
  if (n.kind === "enterprise") return "settings";
  return n.kind === "open" || n.saved ? "connect" : "password";
}

function connectNote(code: string): string {
  switch (code) {
    case "password":
      return "Falsches Passwort";
    case "settings":
      return "In den Windows-Einstellungen ändern";
    case "unavailable":
      return "Netzwerk nicht erreichbar";
    case "timeout":
      return "Zeitüberschreitung";
    case "denied":
      return "Vom System nicht erlaubt";
    default:
      return "Das hat nicht geklappt";
  }
}

/** A failed connection's answer (a fixed word from Rust): the footer's note (a t() key), and whether the password row or Settings opens. */
export function afterConnect(code: string): { note: string; password: boolean; settings: boolean } {
  return { note: connectNote(code), password: code === "password", settings: code === "settings" };
}

/** The rows the page asks room for: one per network, two for a line with its button, one for a line. */
export function wifiRows(view: WifiView, count: number): number {
  if (view === "list") return count;
  return view === "ask" || view === "denied" ? 2 : 1;
}

/** One paired Bluetooth device, as Rust sends it (src-tauri taskbar/bluetooth.rs `BtRow`): connected ones first, `battery` 0 to 100 or null. */
export interface BtDevice {
  id: string;
  name: string;
  /** Windows' device categories ("Audio.Headphone", "Input.Mouse"), for the icon. */
  categories: string[];
  connected: boolean;
  battery: number | null;
}
