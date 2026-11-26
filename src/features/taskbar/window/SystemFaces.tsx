import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { fade } from "../../../design/motion";
import { t } from "../../../i18n";
import { measureTabular } from "../../../notch/row/measure";
import { BtLowest, btLowestWidth, btSpoken } from "../../../notch/row/parts/BtPart";
import { btIcon, type PowerState } from "../../../notch/row/status";
import { STATUS_ICON } from "../../../notch/row/statusIcons";
import { settings } from "../../../settings/store";
import { batteryTint, batteryWidth, type BatteryTint } from "../../../ui/glyphModel";
import { BatteryGlyph } from "../../../ui/glyphs";
import { Lightning } from "../../../ui/iconset";
import { AppIcon } from "../../system/AppIcon";
import { processMemory } from "../../system/format";
import { ofShare, schemeColor } from "../../system/levels";
import { variantOf, type WidgetVariants } from "../model";
import { btLow, btShown, type BtDevice } from "../quickPages";
import { batteryGlyph } from "../statusModel";
import { appFigure, batteryLit, needleAngle, type TopApp } from "../systemWidgets";
import { FanReadings, NetLine, fanReadings, fansWidth, netLineWidth, tempsBody } from "./ReadingFaces";
import type { Body, WidgetContext } from "./Widget";

/*
 * The faces of the bar's Top apps, Battery and Device batteries widgets, and the Hardware widget's network line. Top apps keeps three
 * slots of a fixed width, so a third app turning up or a figure growing moves nothing; the battery is as wide as its widest figure.
 */

/** Top apps: the apps shown, each slot's icon, the room after it and between slots. */
const SLOTS = 3, ICON = 16, ICON_GAP = 3, SLOT_GAP = 6;
const figureWidth = (ram: boolean) => measureTabular(ram ? "88.8G" : "100%");
const slotWidth = (ram: boolean) => ICON + ICON_GAP + figureWidth(ram);
const topAppsWidth = (ram: boolean) => SLOTS * slotWidth(ram) + (SLOTS - 1) * SLOT_GAP;

/** The apps' icons, each beside its figure in the colour of its share; their names are in the label above and in what a screen reader says. */
function TopAppsFace({ apps, ram }: { apps: TopApp[]; ram: boolean }) {
  const colors = settings.use().system.colors;
  const spoken = apps.map((a) => `${a.name} ${ram ? `${processMemory(a.mem)}B` : appFigure(a, false)}`).join(", ");
  return (
    <span className="flex shrink-0 items-center" style={{ gap: SLOT_GAP }} role="img" aria-label={spoken}>
      {Array.from({ length: SLOTS }, (_, i) => {
        const app = apps[i];
        return (
          // One grid cell per slot: another app taking the slot fades over the one leaving it.
          <span key={i} className="grid shrink-0" style={{ width: slotWidth(ram) }}>
            <AnimatePresence initial={false}>
              {app && (
                <motion.span
                  key={app.id}
                  className="col-start-1 row-start-1 flex items-center"
                  style={{ gap: ICON_GAP }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: fade }}
                  exit={{ opacity: 0, transition: fade }}
                >
                  <AppIcon path={app.path} size={ICON} />
                  <span className="tabular text-left text-footnote font-medium" style={{ width: figureWidth(ram), color: schemeColor(colors, ofShare(app.share)) }}>
                    {appFigure(app, ram)}
                  </span>
                </motion.span>
              )}
            </AnimatePresence>
          </span>
        );
      })}
    </span>
  );
}

type BatteryVersion = WidgetVariants["battery"];
/** Each version's shape, the room after it and the charging bolt; Classic is Stato's battery at its size, its bolt inside. */
const CLASSIC = 16;
const SHAPE: Record<BatteryVersion, number> = { ring: 22, cells: 28, gauge: 26, dots: 24, classic: batteryWidth(CLASSIC) };
const GAP = 4, BOLT = 9;
/** The figure beside the shape: not on the ring, which has it inside, and on Classic only with the percentage switched on. */
const figured = (v: BatteryVersion, percent: boolean) => v !== "ring" && (v !== "classic" || percent);
const batteryFaceWidth = (v: BatteryVersion, charging: boolean, percent: boolean) =>
  SHAPE[v] + (figured(v, percent) ? GAP + measureTabular("100%") : 0) + (charging && v !== "classic" ? GAP + BOLT : 0);

/** A part not lit: the ink faint, or under Material on fill-3 as the Slider's track (TimerRing). */
const DIM_FILL = { fill: "currentColor", fillOpacity: 0.18, className: "material:fill-fill-3 material:[fill-opacity:1]" } as const;
const DIM_STROKE = { stroke: "currentColor", strokeOpacity: 0.25, className: "material:stroke-fill-3 material:[stroke-opacity:1]" } as const;
const LIT_FILL = { fill: "currentColor" } as const;
const share = (percent: number | null) => Math.min(100, Math.max(0, percent ?? 0));

/** A ring filling clockwise from the top, the charge written inside it unless `label` is false (Device batteries puts an icon there). */
function Ring({ percent, label = true }: { percent: number | null; label?: boolean }) {
  const s = share(percent), full = s >= 99.9;
  return (
    <svg width={22} height={22} viewBox="0 0 22 22" className="shrink-0" aria-hidden>
      <circle cx="11" cy="11" r="9.5" fill="none" strokeWidth="2.5" {...DIM_STROKE} />
      {s > 0 && (
        <circle
          cx="11" cy="11" r="9.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap={full ? "butt" : "round"}
          pathLength={100} strokeDasharray={full ? "100 0" : `${s} 100`} transform="rotate(-90 11 11)"
        />
      )}
      {label && (
        <text x="11" y="11.5" textAnchor="middle" dominantBaseline="middle" fontSize="8" fontWeight="700" fill="currentColor" style={{ fontVariantNumeric: "tabular-nums" }}>
          {percent ?? "-"}
        </text>
      )}
    </svg>
  );
}

/** A battery's outline and its nub, five cells lit as far as the charge goes. */
function Cells({ percent }: { percent: number | null }) {
  const lit = batteryLit(percent, 5);
  return (
    <svg width={28} height={13} viewBox="0 0 28 13" className="shrink-0" aria-hidden>
      <rect x="0.75" y="0.75" width="24.5" height="11.5" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeOpacity={0.5} />
      <rect x="26" y="4" width="2" height="5" rx="1" fill="currentColor" fillOpacity={0.5} />
      {Array.from({ length: 5 }, (_, i) => <rect key={i} x={+(2.5 + i * 4.4).toFixed(1)} y="2.5" width="3.4" height="8" rx="1" {...(i < lit ? LIT_FILL : DIM_FILL)} />)}
    </svg>
  );
}

/** A half dial from empty on the left to full on the right, its needle in the label's colour (primary under Material) whatever the tint. */
function Gauge({ percent }: { percent: number | null }) {
  const s = share(percent), arc = "M 2.25 13 A 10.75 10.75 0 0 1 23.75 13";
  return (
    <svg width={26} height={15} viewBox="0 0 26 15" className="shrink-0" aria-hidden>
      <path d={arc} fill="none" strokeWidth="2.5" strokeLinecap="round" {...DIM_STROKE} />
      {s > 0 && <path d={arc} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" pathLength={100} strokeDasharray={`${s} 100`} />}
      <line x1="13" y1="13" x2="13" y2="5" stroke="var(--color-label)" strokeWidth="1.5" strokeLinecap="round" transform={`rotate(${needleAngle(percent)} 13 13)`} className="material:stroke-primary" />
      <circle cx="13" cy="13" r="1.75" fill="var(--color-label)" className="material:fill-primary" />
    </svg>
  );
}

/** Ten dots in five columns of two, lit column by column from the left, the lower first. */
function Dots({ percent }: { percent: number | null }) {
  const lit = batteryLit(percent, 10);
  return (
    <svg width={24} height={9} viewBox="0 0 24 9" className="shrink-0" aria-hidden>
      {Array.from({ length: 10 }, (_, i) => <circle key={i} cx={2 + 5 * Math.floor(i / 2)} cy={i % 2 ? 2 : 7} r="1.75" {...(i < lit ? LIT_FILL : DIM_FILL)} />)}
    </svg>
  );
}

/** Stato's battery, green while charging. */
function Classic({ percent, charging, tint }: { percent: number | null; charging: boolean; tint: BatteryTint }) {
  return <BatteryGlyph percent={percent} charging={charging} tint={tint} size={CLASSIC} />;
}

const SHAPES: Record<BatteryVersion, (p: { percent: number | null; charging: boolean; tint: BatteryTint }) => ReactNode> = { ring: Ring, cells: Cells, gauge: Gauge, dots: Dots, classic: Classic };

/** The charge as its version draws it, then its figure (the ring has it inside) and the bolt while charging; red as Stato's battery warns, yellow in Energy saver. */
function BatteryFace({ power: p, version: v, percent }: { power: PowerState; version: BatteryVersion; percent: boolean }) {
  const warning = batteryGlyph(p) === "warning", saver = p.saver === true;
  const tint = batteryTint(warning, saver, false);
  const tone = tint === "red" ? "text-red" : tint === "yellow" ? "text-yellow" : "text-label";
  const label = p.percent === null ? t("Akku") : p.charging ? t("Akku {p} %, lädt", { p: p.percent }) : t("Akku {p} %", { p: p.percent });
  const Shape = SHAPES[v];
  return (
    <span className={`flex shrink-0 items-center ${tone}`} style={{ gap: GAP }} role="img" aria-label={label}>
      <Shape percent={p.percent} charging={p.charging} tint={batteryTint(warning, saver, p.charging)} />
      {figured(v, percent) && (
        <span className="tabular text-left text-footnote font-medium" style={{ width: measureTabular("100%") }}>
          {p.percent === null ? "-" : `${p.percent}%`}
        </span>
      )}
      {p.charging && v !== "classic" && <Lightning size={BOLT} weight="fill" className="shrink-0" />}
    </span>
  );
}

/** Top apps, the battery or the temperatures as the bar draws it; null while it has nothing to show, and the bar draws its icon. */
export function systemPart(id: "processes" | "battery" | "temps", ctx: WidgetContext): Body | null {
  if (id === "temps") {
    const temps = ctx.feed.temps;
    if (variantOf(ctx.variants, "temps") === "history") return tempsBody(temps);
    const n = fanReadings(temps.fans).length;
    return n ? { node: <FanReadings fans={temps.fans} />, width: fansWidth(n) } : null;
  }
  if (id === "processes") {
    const apps = ctx.feed.topApps;
    if (!apps.length) return null;
    const ram = variantOf(ctx.variants, "processes") === "ram";
    return { node: <TopAppsFace apps={apps} ram={ram} />, width: topAppsWidth(ram), tip: apps.map((a) => a.name).join(", ") };
  }
  // No battery (a desktop) or nothing heard from Windows yet: the dimmed icon.
  const p = ctx.feed.power;
  if (!p?.battery) return null;
  const v = variantOf(ctx.variants, "battery");
  const percent = ctx.batteryPercent !== false;
  return { node: <BatteryFace power={p} version={v} percent={percent} />, width: batteryFaceWidth(v, p.charging, percent) };
}

const RING = 22, RING_GAP = 4, RING_ICON = 11;

/** Each device as the Battery widget's ring with its icon inside, by name; red at 20 % or less. A ring arriving or leaving fades. */
function BtRings({ list }: { list: BtDevice[] }) {
  return (
    <span className="flex shrink-0 items-center" style={{ gap: RING_GAP }} role="img" aria-label={btSpoken(list)}>
      <AnimatePresence initial={false} mode="popLayout">
        {list.map((d) => {
          const Icon = STATUS_ICON[btIcon(d.categories)];
          return (
            <motion.span
              key={d.id}
              className={`grid shrink-0 place-items-center ${btLow(d.battery ?? 0) ? "text-red" : "text-label"}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: fade }}
              exit={{ opacity: 0, transition: fade }}
            >
              <span className="col-start-1 row-start-1 flex">
                <Ring percent={d.battery} label={false} />
              </span>
              <Icon size={RING_ICON} weight="regular" className="col-start-1 row-start-1" aria-hidden />
            </motion.span>
          );
        })}
      </AnimatePresence>
    </span>
  );
}

const ringsWidth = (n: number) => n * RING + (n - 1) * RING_GAP;

/** The Device batteries widget: the lowest battery, or every device as a ring; null without one, and the bar draws its icon. */
export function bluetoothPart(ctx: WidgetContext): Body | null {
  const v = variantOf(ctx.variants, "bluetooth");
  // Through btShown here too, so the Widgets page's preview, which starts from the sample, shows the lowest.
  const list = btShown(ctx.feed.btDevices, v);
  if (!list.length) return null;
  const tip = btSpoken(list);
  return v === "lowest" ? { node: <BtLowest device={list[0]} />, width: btLowestWidth(), tip } : { node: <BtRings list={list} />, width: ringsWidth(list.length), tip };
}

/** The Hardware widget's line of the network's download and upload; null draws its dials, which then hold download and upload. */
export function netPart(ctx: WidgetContext): Body | null {
  const f = ctx.feed;
  return f.netSpark.down.length && f.readings.some((r) => r.id === "down") ? { node: <NetLine readings={f.readings} spark={f.netSpark} />, width: netLineWidth(f.readings) } : null;
}
