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
