// Settings model of the closed notch's row: which parts show and in what order. Pure, so the saved shape can be repaired (and tested) without the app around it.

export const PART_IDS = ["timer", "discord", "rings", "title", "readings", "equalizer", "clock", "github"] as const;
export type PartId = (typeof PART_IDS)[number];
export interface ClosedSettings { order: PartId[]; parts: Record<PartId, boolean>; readings: { cpu: boolean; ram: boolean; gpu: boolean }; clockSeconds: boolean; lineProgress: boolean; quotaAlerts: boolean; statusAlerts: { power: boolean; net: boolean; bt: boolean } }

export const CLOSED_DEFAULTS: ClosedSettings = {
  order: [...PART_IDS],
  parts: { timer: true, discord: true, rings: true, title: false, readings: false, equalizer: true, clock: false, github: false },
  readings: { cpu: true, ram: true, gpu: true },
  clockSeconds: false, lineProgress: true, quotaAlerts: true,
  statusAlerts: { power: true, net: true, bt: true },
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Whatever was saved (0.1 had no `closed` at all) becomes a valid value: valid fields kept, unknown ids dropped, missing parts appended in default order. */
export function normalizeClosed(saved: unknown): ClosedSettings {
  const s = isObj(saved) ? saved : {}, d = CLOSED_DEFAULTS;
  const order = (Array.isArray(s.order) ? s.order : []).filter((id, i, all): id is PartId => PART_IDS.includes(id as PartId) && all.indexOf(id) === i);
  for (const id of PART_IDS) if (!order.includes(id)) order.push(id);
  const parts = isObj(s.parts) ? s.parts : {}, readings = isObj(s.readings) ? s.readings : {}, alerts = isObj(s.statusAlerts) ? s.statusAlerts : {};
  return {
    order,
    parts: Object.fromEntries(PART_IDS.map((id) => [id, bool(parts[id], d.parts[id])])) as Record<PartId, boolean>,
    readings: { cpu: bool(readings.cpu, d.readings.cpu), ram: bool(readings.ram, d.readings.ram), gpu: bool(readings.gpu, d.readings.gpu) },
    clockSeconds: bool(s.clockSeconds, d.clockSeconds), lineProgress: bool(s.lineProgress, d.lineProgress), quotaAlerts: bool(s.quotaAlerts, d.quotaAlerts),
    statusAlerts: { power: bool(alerts.power, d.statusAlerts.power), net: bool(alerts.net, d.statusAlerts.net), bt: bool(alerts.bt, d.statusAlerts.bt) },
  };
}

/** "title · artist"; with only one of them, just that one. */
export const trackCaption = (title: string, artist: string) => [title.trim(), artist.trim()].filter(Boolean).join(" · ");
