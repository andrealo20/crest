import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useMotionValue, useMotionValueEvent, type MotionValue } from "motion/react";
import { ArrowsDownUp, BatteryHigh, Cpu, Lightning, Thermometer, WifiHigh, type Icon } from "../../ui/iconset";
import { GpuIcon, RamIcon } from "../../ui/icons";
import { Segmented } from "../../ui/controls";
import { Glide, useGlide } from "../../ui/Glide";
import { Ring } from "../../ui/Ring.tsx";
import { content } from "../../design/motion";
import { t } from "../../i18n";
import type { ProcReading } from "../../platform/services";
import { settings, updateSettings } from "../../settings/store";
import { batteryLevel } from "./battery";
import { compactRate, driveSizes, gigabytes, processMemory, processShare, watts } from "./format";
import { ofRate, ofShare, type Level } from "./levels";
import { degrees, tempLevel } from "./temps";
import { holdProcesses, type SystemState } from "./store";
import { SHAPES, loadShape, niceMax, shapePoints, systemFit, type ShapeName } from "./hero";
import { MorphPath } from "./Morph";
import { CoreColumns, NetDetail, ProcessCard, ProcessRow, Trend } from "./SystemView";
import { useHue, type Hue } from "../themes/hues";
import { PortsEntry } from "../ports/PortsPanel";

type Fit = ReturnType<typeof systemFit>;

// Cards rise into place one after the other, 30 ms apart in each column.
const enter = (i: number) => ({
  initial: { opacity: 0, transform: "translateY(6px)" },
  animate: { opacity: 1, transform: "translateY(0px)" },
  transition: { ...content.enter, delay: 0.03 * i },
});

// A card that acts as a button, with the keyboard of today's GPU row.
const press = (click: (() => void) | undefined) =>
  click ? { role: "button", tabIndex: 0, onClick: click, onKeyDown: (e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), click()) } : {};

// Crest writes a space before the percent sign (SystemView.tsx).
const percent = (n: number) => `${n} %`;

/*
 * The hardware under Material, laid out like the hardware page of Stellaria's dashboard:
 *
 *   [◯ CPU  detail     ] [◯ GPU  detail     ]   [ ◠ RAM ] [ ◠ C: ]
 *   [ 54 °C ━━━  ▂▅▂▇ ✿] [ 61 °C ━━━━━━━━ ✿]   [ Processes  CPU|Mem ]
 *   [ ⇅ Net  ↓ ↑          the minute's graph ]   [ ◧ Chrome      12.4 ]
 *   [ Power ] [ Battery ] [ Ping ]                [ …                  ]
 */
export function MaterialSystemLayout(p: {
  st: SystemState;
  tone: (l: Level) => string;
  cpuDetail: string;
  gpuDetail: string;
  gpuBadge: string | undefined;
  onGpu: (() => void) | undefined;
  memLevel: Level;
  powerDetail: string;
  batteryDetail: string;
  batteryHealth: { text: string; color: string } | null;
  plan: ReactNode;
  detail: ProcReading | null;
  setDetail: (proc: ProcReading | null) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  // The Standard size, for the first render only: the layout effect measures before anything is painted.
  const [fit, setFit] = useState(() => systemFit(688, 286));
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setFit(systemFit(rect.width, rect.height));
    const observer = new ResizeObserver(([entry]) => setFit(systemFit(entry.contentRect.width, entry.contentRect.height)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { st, tone } = p;
  const s = st.stats!;
  const g = st.gpu;
  const cores = s.cores.length;
  const chips = fit.tiles === "chips";

  return (
    <div className="flex h-full px-4 pt-1 pb-2">
      <div ref={body} className="grid min-w-0 flex-1 grid-cols-[minmax(0,1.93fr)_minmax(0,1fr)] gap-2">
        <div className={`grid min-h-0 min-w-0 gap-2 ${chips ? "grid-rows-[minmax(100px,120fr)_minmax(64px,76fr)_28px]" : "grid-rows-[minmax(100px,120fr)_minmax(64px,76fr)_minmax(64px,74fr)]"}`}>
          <div className="grid min-h-0 grid-cols-2 gap-2">
            <GaugeCard i={0} icon={Cpu} hue="red" label="CPU" detail={p.cpuDetail} percent={s.cpu} tone={tone} fit={fit}>
              {st.cpuTemp !== null && <Reading icon={Thermometer} text={`${degrees(st.cpuTemp)} °C`} color={tone(tempLevel("cpu", st.cpuTemp))} fraction={st.cpuTemp / 100} bar={fit.tempBar} title={st.cpuTempFrom ?? undefined} />}
              {fit.cores && cores > 0 && (
                <div className="min-h-0 max-h-10 flex-1">
                  <CoreColumns cores={s.cores} tone={tone} fill />
                </div>
              )}
            </GaugeCard>
            <GaugeCard i={1} icon={GpuIcon} hue="emerald" label="GPU" detail={p.gpuDetail} badge={p.gpuBadge} percent={g?.usage ?? null} tone={tone} fit={fit} onClick={p.onGpu}>
              {st.gpuTemp !== null && <Reading icon={Thermometer} text={`${degrees(st.gpuTemp)} °C`} color={tone(tempLevel("gpu", st.gpuTemp))} fraction={st.gpuTemp / 100} bar={fit.tempBar} title={st.gpuTempFrom ?? undefined} />}
              {g && g.memTotal > 0 && <Reading icon={RamIcon} text={`${gigabytes(g.memUsed)} / ${gigabytes(g.memTotal)} GB`} color={tone(ofShare((g.memUsed / g.memTotal) * 100))} fraction={g.memUsed / g.memTotal} bar={fit.tempBar} />}
            </GaugeCard>
          </div>
          <NetCard st={st} tone={tone} />
          <Tiles st={st} tone={tone} chips={chips} plan={p.plan} powerDetail={p.powerDetail} batteryDetail={p.batteryDetail} batteryHealth={p.batteryHealth} />
        </div>

        <div className="relative grid min-h-0 min-w-0 grid-rows-[minmax(104px,126fr)_minmax(80px,152fr)] gap-2">
          <div className={`grid min-h-0 gap-2 ${st.drives.length ? "grid-cols-2" : "grid-cols-1"}`}>
            <MemoryCard st={st} tone={tone} level={p.memLevel} ring={fit.ring} />
            {st.drives.length > 0 && <DriveCard drives={st.drives} tone={tone} ring={fit.ring} />}
          </div>
          <ProcessesCard st={st} fit={fit} cores={cores} setDetail={p.setDetail} />
          <AnimatePresence>{p.detail && <ProcessCard key="card" proc={st.processes?.cpu.find((x) => x.id === p.detail!.id) ?? p.detail} cores={cores} onClose={() => p.setDetail(null)} />}</AnimatePresence>
        </div>
      </div>
      <PortsEntry />
    </div>
  );
}

/** CPU or GPU: a ring of the load around the icon, the name and detail, and in the corner the shape of the load with its percent. */
function GaugeCard(p: { i: number; icon: Icon; hue: Hue; label: string; detail: string; badge?: string; percent: number | null; tone: (l: Level) => string; fit: Fit; onClick?: () => void; children?: ReactNode }) {
  const I = p.icon;
  const iconColor = useHue(p.hue);
  // From 0 on opening, so ring, number and shape fill together.
  const glided = useGlide(p.percent ?? 0, 0);
  const color = p.tone(ofShare(p.percent ?? 0));
  const shape = p.fit.shape;
  return (
    <motion.div
      {...enter(p.i)}
      {...press(p.onClick)}
      title={p.onClick ? t("Klicken für die nächste GPU") : undefined}
      className={`relative flex min-h-0 min-w-0 flex-col rounded-[24px] bg-fill-1 p-3 ${p.onClick ? "pressable cursor-pointer" : ""}`}
    >
      <div className="flex items-center gap-2">
        <Ring size={40} stroke={4} sweep={360} arcs={[{ value: glided, color }]}>
          <I size={18} weight="regular" className={iconColor ? "" : "text-label-2"} style={iconColor ? { color: iconColor } : undefined} />
        </Ring>
        <div className={`flex min-w-0 flex-1 flex-col ${shape === 48 ? "pe-14" : ""}`}>
          <span className="flex items-center gap-1.5">
            <span className="text-[15px] leading-5 font-medium text-label">{p.label}</span>
            {p.badge && <span className="tabular shrink-0 rounded-full bg-fill-2 px-1.5 text-[10px] text-label-2">{p.badge}</span>}
          </span>
          <span className="tabular truncate text-caption text-label-2" title={p.detail}>
            {p.detail}
          </span>
        </div>
      </div>
      <div className="mt-2 flex min-h-0 flex-1 flex-col justify-end gap-1" style={{ marginInlineEnd: shape + 8 }}>
        {p.children}
      </div>
      <div className="absolute end-3 bottom-3 flex items-center justify-center" style={{ width: shape, height: shape }}>
        <LoadShape value={p.percent === null ? null : glided} size={shape} />
        {p.percent === null ? (
          <span className="relative text-[15px] leading-5 font-semibold text-on-secondary-container forced-colors:text-[CanvasText]">-</span>
        ) : (
          <Glide value={glided} format={percent} className="relative text-[15px] leading-5 font-semibold tabular text-on-secondary-container forced-colors:text-[CanvasText]" />
        )}
      </div>
    </motion.div>
  );
}

/** A reading under the gauge: icon, value in its level's colour, and with `bar` a bar filled to `fraction` from the start. */
function Reading({ icon: I, text, color, fraction, bar, title }: { icon: Icon; text: string; color: string; fraction: number; bar: boolean; title?: string }) {
  return (
    <div className="flex h-4 min-w-0 shrink-0 items-center gap-1.5" title={title}>
      <I size={14} weight="regular" className="shrink-0 text-label-3" />
      <span dir="ltr" className="tabular shrink-0 text-caption font-medium" style={{ color }}>
        {text}
      </span>
      {bar && (
        <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-fill-2">
          <span className="absolute inset-0 origin-left rounded-[3px] rtl:origin-right" style={{ transform: `scaleX(${Math.min(1, Math.max(0, fraction))})`, background: color }} />
        </span>
      )}
    </div>
  );
}

/** The shape of a load, from Stellaria: it changes only when the gliding percent crosses a threshold, and morphs then. */
function LoadShape({ value, size }: { value: MotionValue<number> | null; size: 48 | 60 | 72 }) {
  // Under reduced motion the value is already the load at mount, and no change comes to tell.
  const [shape, setShape] = useState<ShapeName>(() => (value ? loadShape("cookie4", value.get()) : "cookie4"));
  const idle = useMotionValue(0);
  useMotionValueEvent(value ?? idle, "change", (v) => value && setShape((prev) => loadShape(prev, v)));
  const shown = value ? shape : "cookie4";
  const points = useMemo(() => shapePoints(SHAPES[shown][0], SHAPES[shown][1]), [shown]);
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="absolute inset-0" aria-hidden>
      <MorphPath points={points} className="fill-secondary-container forced-colors:fill-[Canvas] forced-colors:stroke-[CanvasText] [vector-effect:non-scaling-stroke]" />
    </svg>
  );
}

/** The network: rates on one line, and the minute's graph with its area filling the rest of the card. */
function NetCard({ st, tone }: { st: SystemState; tone: (l: Level) => string }) {
  const net = st.net;
  const iconColor = useHue("cyan");
  const color = tone(ofRate(net ? Math.max(net.down, net.up) : 0));
  return (
    <motion.div {...enter(2)} className="flex min-h-0 min-w-0 flex-col rounded-[20px] bg-fill-1 px-3 pt-2 pb-2">
      <div className="flex h-5 shrink-0 items-center gap-2">
        <ArrowsDownUp size={15} weight="regular" className={`shrink-0 ${iconColor ? "" : "text-label-2"}`} style={iconColor ? { color: iconColor } : undefined} />
        <span className="shrink-0 text-footnote font-medium text-label">{t("Netz")}</span>
        <span className="tabular min-w-0 flex-1 truncate text-caption text-label-2">{net && <NetDetail down={net.down} up={net.up} />}</span>
        <span className="tabular shrink-0 text-footnote font-semibold" style={{ color }}>
          {net ? compactRate(net.down) : "-"}
        </span>
      </div>
      <div className="mt-1 min-h-0 flex-1">
        <Trend area w={424} h={40} values={st.history.down} second={st.history.up} max={niceMax([...st.history.down, ...st.history.up])} color={color} tick={st.tick} className="block size-full" />
      </div>
    </motion.div>
  );
}

/** Power, battery and ping; a tile without a reading is left out and the others widen. */
function Tiles(p: { st: SystemState; tone: (l: Level) => string; chips: boolean; plan: ReactNode; powerDetail: string; batteryDetail: string; batteryHealth: { text: string; color: string } | null }) {
  const { st, tone } = p;
  const pw = st.power, b = st.battery, ping = st.stats!.ping;
  let i = 3;
  return (
    <div className="flex min-h-0 min-w-0 gap-2">
      {(pw || p.plan) && (
        <Tile
          i={i++}
          chips={p.chips}
          icon={Lightning}
          hue="amber"
          label={t("Leistung")}
          value={pw ? pw.watts * 10 : null}
          format={(n) => `${pw?.estimate ? "~" : ""}${watts(n / 10)} W`}
          empty="-"
          color={tone(0)}
          detail={p.powerDetail}
          control={p.plan}
        />
      )}
      {b && <Tile i={i++} chips={p.chips} icon={BatteryHigh} hue="green" label={t("Akku")} value={b.percent} format={percent} empty="-" color={tone(batteryLevel(b))} detail={p.batteryDetail} title={p.batteryHealth?.text} />}
      <Tile i={i++} chips={p.chips} icon={WifiHigh} hue="sky" label="Ping" value={ping} format={(n) => `${n} ms`} empty={t("Offline")} color={tone(ping === null ? 2 : ping >= 150 ? 2 : ping >= 60 ? 1 : 0)} detail="1.1.1.1" />
    </div>
  );
}

// A component of its own so each tile calls its hooks once. Tiles start at their value and glide from sample to sample.
function Tile(p: { i: number; chips: boolean; icon: Icon; hue: Hue; label: string; value: number | null; format: (n: number) => string; empty: string; color: string; detail: string; title?: string; control?: ReactNode }) {
  const I = p.icon;
  const iconColor = useHue(p.hue);
  const glided = useGlide(p.value);
  const icon = <I size={14} weight="regular" className={`shrink-0 ${iconColor ? "" : "text-label-2"}`} style={iconColor ? { color: iconColor } : undefined} />;
  const value = (className: string) =>
    p.value === null ? (
      <span className={className} style={{ color: p.color }}>
        {p.empty}
      </span>
    ) : (
      <Glide value={glided} format={p.format} className={`tabular ${className}`} />
    );
  // Chips grow from their content, so the plan menu in the power chip never squeezes its value.
  if (p.chips)
    return (
      <motion.div {...enter(p.i)} className="flex h-7 min-w-0 flex-auto items-center gap-1.5 rounded-[14px] bg-fill-1 px-2.5" title={[p.label, p.detail, p.title].filter(Boolean).join(" · ")}>
        {icon}
        <span className="shrink-0" style={{ color: p.color }}>
          {value("text-footnote font-semibold")}
        </span>
        {p.control && <span className="ms-auto flex min-w-0">{p.control}</span>}
      </motion.div>
    );
  return (
    <motion.div {...enter(p.i)} className="flex min-h-0 min-w-0 flex-1 flex-col justify-center rounded-[20px] bg-fill-1 px-3 py-2" title={p.title}>
      <div className="flex h-3.5 min-w-0 items-center gap-1">
        {icon}
        <span className="min-w-0 truncate text-caption text-label-2">{p.label}</span>
        {p.control && <span className="ms-auto flex min-w-0">{p.control}</span>}
      </div>
      <span className="truncate" style={{ color: p.color }}>
        {value("text-display font-semibold")}
      </span>
      <span className="tabular truncate text-caption text-label-3">{p.detail}</span>
    </motion.div>
  );
}

/** Memory in use and file cache after it on a ring open at the bottom; under pressure the detail says so in its colour. */
function MemoryCard({ st, tone, level, ring }: { st: SystemState; tone: (l: Level) => string; level: Level; ring: Fit["ring"] }) {
  const s = st.stats!;
  const used = s.memTotal ? (s.memUsed / s.memTotal) * 100 : 0;
  const cached = s.memTotal ? Math.min(100 - used, (s.memCached / s.memTotal) * 100) : 0;
  const usedGlide = useGlide(used, 0);
  const cacheGlide = useGlide(cached, 0);
  const color = tone(level);
  return (
    <motion.div
      {...enter(0)}
      className="flex min-h-0 min-w-0 flex-col items-center rounded-[24px] bg-fill-1 pt-2.5 pb-1.5"
      title={`${t("Cache")} ${gigabytes(s.memCached)} · ${t("Zugesichert")} ${gigabytes(s.memCommit)} / ${gigabytes(s.memCommitLimit)} GB`}
    >
      <Ring size={ring} stroke={8} sweep={270} arcs={[{ value: usedGlide, color }, { value: cacheGlide, offset: usedGlide, color, opacity: 0.35 }]}>
        <Glide value={usedGlide} format={percent} className="text-[15px] leading-5 font-semibold tabular text-label" />
      </Ring>
      {/* Up into the ring's open bottom, so the label and detail fit the smallest card. */}
      <span className="-mt-2 text-caption font-medium text-label">RAM</span>
      {level > 0 ? (
        <span className="max-w-full truncate px-2 text-caption font-medium" style={{ color }}>
          {t(level === 2 ? "Druck kritisch" : "Druck hoch")}
        </span>
      ) : (
        <span className="tabular max-w-full truncate px-2 text-caption text-label-2">
          {gigabytes(s.memUsed)} / {gigabytes(s.memTotal)} GB
        </span>
      )}
    </motion.div>
  );
}

/** One drive at a time, like Stellaria's button; with more than one a click goes to the next and the ring glides to its share. */
function DriveCard({ drives, tone, ring }: { drives: SystemState["drives"]; tone: (l: Level) => string; ring: Fit["ring"] }) {
  const [index, setIndex] = useState(0);
  const d = drives[index % drives.length];
  const share = d.total ? (d.used / d.total) * 100 : 0;
  const glided = useGlide(share, 0);
  const sz = driveSizes(d.used, d.total);
  const many = drives.length > 1;
  return (
    <motion.div
      {...enter(1)}
      {...press(many ? () => setIndex((i) => (i + 1) % drives.length) : undefined)}
      title={many ? `${d.model} · ${t("Klicken für das nächste Laufwerk")}` : d.model}
      className={`relative flex min-h-0 min-w-0 flex-col items-center rounded-[24px] bg-fill-1 pt-2.5 pb-1.5 ${many ? "pressable cursor-pointer" : ""}`}
    >
      {many && <span className="tabular absolute end-2.5 top-2 rounded-full bg-fill-2 px-1.5 text-[10px] text-label-2">{`${(index % drives.length) + 1}/${drives.length}`}</span>}
      <Ring size={ring} stroke={8} sweep={270} arcs={[{ value: glided, color: tone(ofShare(share)) }]}>
        <Glide value={glided} format={percent} className="text-[15px] leading-5 font-semibold tabular text-label" />
      </Ring>
      <span className="-mt-2 flex max-w-full items-center gap-1 px-2 text-caption font-medium">
        <span className="tabular truncate text-label">{d.letters}</span>
        {d.temp !== null && (
          <span className="tabular shrink-0" style={{ color: tone(d.tempLevel) }}>
            {degrees(d.temp)}°
          </span>
        )}
      </span>
      <span className="tabular max-w-full truncate px-2 text-caption text-label-2">
        {sz.used}/{sz.total} {sz.unit}
      </span>
    </motion.div>
  );
}

/** Today's process list, as many rows as fit the card; the ranking holds still while the pointer is over it. */
function ProcessesCard({ st, fit, cores, setDetail }: { st: SystemState; fit: Fit; cores: number; setDetail: (proc: ProcReading) => void }) {
  const { sort } = settings.use().system;
  const procs = st.processes ? (sort === "mem" ? st.processes.mem : st.processes.cpu).slice(0, fit.rows) : [];
  return (
    <motion.div {...enter(2)} className="min-h-0 min-w-0 rounded-[24px] bg-fill-1 pb-1" onPointerEnter={() => holdProcesses.set(true)} onPointerLeave={() => holdProcesses.set(false)}>
      <div className="flex h-7 items-center justify-between gap-1 pe-1.5 ps-3">
        {/* At the smallest sizes the column is narrower than the label and the switch together: the label gives way. */}
        <span className="min-w-0 truncate text-caption font-medium tracking-wide text-label-3 uppercase">{t("Prozesse")}</span>
        <Segmented
          id="system-sort"
          label={t("Prozesse")}
          size="sm"
          value={sort}
          onChange={(v) => updateSettings((cur) => ({ system: { ...cur.system, sort: v } }))}
          options={[{ value: "cpu", label: "CPU" }, { value: "mem", label: t("Speicher") }]}
        />
      </div>
      {procs.map((proc) => (
        <ProcessRow key={proc.id} proc={proc} value={sort === "mem" ? processMemory(proc.mem) : `${processShare(proc.cpu, cores || navigator.hardwareConcurrency)} %`} onClick={() => setDetail(proc)} />
      ))}
      {!procs.length && <div className="px-3 py-2 text-caption text-label-3">{t("Wird gelesen …")}</div>}
    </motion.div>
  );
}
