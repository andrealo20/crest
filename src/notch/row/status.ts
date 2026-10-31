// Rules for the closed notch's status alerts (power, network, headphones): which transition deserves a short message. Pure; `tr` is passed in so this stays free of i18n.

export interface PowerState { ac: boolean; percent: number | null; battery: boolean }
export interface StatusAlert { kind: "power" | "net" | "bt"; icon: "plug" | "battery" | "wifi" | "wifi-off" | "headphones"; text: string; tone: "normal" | "warning" | "critical" }
/** Which low-battery levels already fired in this discharge. */
export interface LowBattery { warned20: boolean; warned10: boolean }
type Tr = (de: string, vars?: Record<string, string | number>) => string;

export const STATUS = { showMs: 2500, low: 20, critical: 10 } as const;

/** Plug/unplug, then low battery on reaching 20 % and 10 % (each once per discharge). Updates `low`; plugging in resets it. */
export function powerAlert(prev: PowerState | null, next: PowerState, low: LowBattery, tr: Tr): StatusAlert | null {
  if (next.ac) { low.warned20 = low.warned10 = false; }
  if (!prev || !next.battery) return null;
  const p = next.percent;
  if (prev.ac !== next.ac) return p === null ? null : next.ac
    ? { kind: "power", icon: "plug", text: tr("Lädt · {p} %", { p }), tone: "normal" }
    : { kind: "power", icon: "battery", text: tr("Akku · {p} %", { p }), tone: "normal" };
  if (next.ac || p === null) return null;
  const level = p <= STATUS.critical ? "critical" : p <= STATUS.low ? "warning" : null;
  if (!level || (level === "critical" ? low.warned10 : low.warned20)) return null;
  low.warned20 = true; low.warned10 = level === "critical";
  return { kind: "power", icon: "battery", text: tr("Akku {p} %", { p }), tone: level };
}

/** Only a change of state; the first reading (`prev` null) is silent. */
export function netAlert(prev: boolean | null, next: boolean, tr: Tr): StatusAlert | null {
  if (prev === null || prev === next) return null;
  return { kind: "net", icon: next ? "wifi" : "wifi-off", text: tr(next ? "Online" : "Offline"), tone: "normal" };
}

export function btAlert(event: { name: string; connected: boolean; battery: number | null }, tr: Tr): StatusAlert | null {
  const { name, connected, battery } = event;
  const text = !connected ? tr("{n} · Getrennt", { n: name }) : battery === null ? name : tr("{n} · {p} %", { n: name, p: battery });
  return { kind: "bt", icon: "headphones", text, tone: "normal" };
}
