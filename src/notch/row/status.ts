// Rules for the closed notch's status alerts (power, network, headphones): which transition deserves a short message. Pure; `tr` is passed in so this stays free of i18n.

export interface PowerState { ac: boolean; percent: number | null; battery: boolean }
export interface StatusAlert { kind: "power" | "net" | "bt"; icon: "plug" | "battery" | "wifi" | "wifi-off" | "headphones"; text: string; tone: "normal" | "warning" | "critical" }
/** Which low-battery levels already fired in this discharge. */
export interface LowBattery { warned20: boolean; warned10: boolean }
type Tr = (de: string, vars?: Record<string, string | number>) => string;

export const STATUS = { showMs: 2500, low: 20, critical: 10 } as const;

/**
 * Plug/unplug, then low battery on reaching 20 % and 10 % (each once per discharge). Updates `low`; plugging in resets it.
 * Unplugging at a low level alerts once in that level's tone; a first state already low only marks the level as seen.
 */
export function powerAlert(prev: PowerState | null, next: PowerState, low: LowBattery, tr: Tr): StatusAlert | null {
  if (next.ac) { low.warned20 = low.warned10 = false; }
  if (!next.battery) return null;
  const p = next.percent;
  const level = next.ac || p === null ? null : p <= STATUS.critical ? "critical" : p <= STATUS.low ? "warning" : null;
  const fresh = level !== null && !(level === "critical" ? low.warned10 : low.warned20);
  if (level) { low.warned20 = true; low.warned10 ||= level === "critical"; }
  if (!prev) return null;
  if (prev.ac !== next.ac) return next.ac
    ? { kind: "power", icon: "plug", text: p === null ? tr("Lädt") : tr("Lädt · {p} %", { p }), tone: "normal" }
    : { kind: "power", icon: "battery", text: p === null ? tr("Am Akku") : tr("Akku · {p} %", { p }), tone: level ?? "normal" };
  return fresh && level && p !== null ? { kind: "power", icon: "battery", text: tr("Akku {p} %", { p }), tone: level } : null;
}

/** What the alerts compare against: `null` (or no headsets) until a seed or an event says otherwise. */
export interface StatusKnown { power: PowerState | null; online: boolean | null; headsets: Set<string> }

/**
 * Merges a seed (the command or the event, in either order, partial or complete) into what is known: it fills only the
 * fields still unknown, so a later, fuller seed completes an early partial one and never overwrites what an event set.
 */
export function mergeSeed(known: StatusKnown, seed: { power: PowerState | null; online: boolean | null; headsets: readonly string[] }): StatusKnown {
  return { power: known.power ?? seed.power, online: known.online ?? seed.online, headsets: new Set([...known.headsets, ...seed.headsets]) };
}

/** Only a change of state; the first reading (`prev` null) is silent. */
export function netAlert(prev: boolean | null, next: boolean, tr: Tr): StatusAlert | null {
  if (prev === null || prev === next) return null;
  return { kind: "net", icon: next ? "wifi" : "wifi-off", text: tr(next ? "Online" : "Offline"), tone: "normal" };
}

/** A headset without a name says nothing useful, so it does not alert. */
export function btAlert(event: { name: string; connected: boolean; battery: number | null }, tr: Tr): StatusAlert | null {
  const name = event.name.trim();
  if (!name) return null;
  const text = !event.connected ? tr("{n} · Getrennt", { n: name }) : event.battery === null ? name : tr("{n} · {p} %", { n: name, p: event.battery });
  return { kind: "bt", icon: "headphones", text, tone: "normal" };
}
