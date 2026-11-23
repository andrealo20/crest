import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { AppWindow, ArrowDown, ArrowsDownUp, ArrowUp, BatteryHigh, CaretDown, Check, Cpu, HardDrives, Lightning, WifiHigh, X, type Icon } from "../../ui/iconset";
import { GpuIcon, RamIcon } from "../../ui/icons";
import { Segmented, Select } from "../../ui/controls";
import { content, springs } from "../../design/motion";
import { t } from "../../i18n";
import { openBatteryReport, openIpconfig, powerPlans, revealFile, systemIcon, type PowerPlans, type ProcReading } from "../../platform/services";
import { isMac } from "../../platform/native";
import { demo } from "../../dev/showcase-data";
import { settings, updateSettings } from "../../settings/store";
import { batteryLevel, healthLevel } from "./battery";
import { compactRate, driveSizes, duration, ghz, gigabytes, processMemory, processShare, publicIpOf, rate, watts } from "./format";
import { memoryLevel, nextGpu, ofRate, ofShare, schemeColor, type Level } from "./levels";
import { tempLevel, degrees } from "./temps";
import { HISTORY, holdProcesses, system, useSystemShown } from "./store";
import { trendArea, trendLine } from "./hero";
import { useHue, type Hue } from "../themes/hues";
import { PortsEntry } from "../ports/PortsPanel";
import { useCopy } from "../colour/ColourView";
import { design } from "../../design/design";
import { MaterialSystemLayout } from "./MaterialSystem";

/*
 *   ┌───────────────────────────────────────────────┬──────────────────────────┐
 *   │ ▣ CPU   Ryzen 7 · 8C 16T · 4.21 GHz  ╱╲_   23%│ Processes      CPU | Mem │
 *   │   P ▂▅▂▇▂▁▃▂  E ▁▁▂▁                          │ ◧ Chrome            12.4 │
 *   │ ▤ RAM   13.4 / 32 GB                 ‾‾‾   42%│ ◧ Code               3.1 │
 *   │   ███████░░░░ cache 6.2 · commit 21 / 37 GB   │ …                        │
 *   │ ▦ GPU   RTX 4070 Ti · 3D · 54 °C     _╱╲   31%│ Drives                   │
 *   │ ⇅ Net   ↓ 12.3 MB/s ↑ 340 KB/s [LAN] ╱‾╲  12M │ C:  Samsung 990  ▓▓░ 41° │
 *   │ ϟ Power Estimate · CPU 20 W [Plan ⌄] ‾╲_  38 W│                          │
 *   │ ▭ Bat.  2 h 40 min left · 88 %             66%│                          │
 *   │ ◠ Ping  1.1.1.1 [Public IP]          ___ 14 ms│                          │
 *   └───────────────────────────────────────────────┴──────────────────────────┘
 * Rows keep one minute of history as a line (store.ts collects from app start). Readings a machine cannot give
 * (battery on a desktop, power without any meter, temperatures without a sensor) are left out rather than shown as 0,
 * except the CPU's temperature: missing for a while, it shows as - °C with where Crest can read one (issue #67).
 */

/** How long the CPU has to be without a temperature before the row says so: a thermal zone counts only once it moves (temps.ts). */
const NO_SENSOR_MS = 10_000;

/** True once `on` has held for `ms`, false again as soon as it stops. */
function useLasting(on: boolean, ms: number): boolean {
  const [lasted, setLasted] = useState(false);
  useEffect(() => {
    setLasted(false);
    if (!on) return;
    const id = window.setTimeout(() => setLasted(true), ms);
    return () => window.clearTimeout(id);
  }, [on, ms]);
  return on && lasted;
}

export function SystemView() {
  useSystemShown();
  const st = system.use();
  const { colors, sort } = settings.use().system;
  const [detail, setDetail] = useState<ProcReading | null>(null);
  const [plans, setPlans] = useState<PowerPlans | null>(null);
  useEffect(() => void powerPlans.list().then(setPlans).catch(() => {}), []);
  // Closed with the pointer still over the list: the next opening ranks freely again.
  useEffect(() => () => holdProcesses.set(false), []);
  const driveColor = useHue("orange");
  const material = design.use() === "material";
  const noCpuSensor = useLasting(st.cpuTemp === null, NO_SENSOR_MS);
  const s = st.stats;
  if (!s) return null;
  const tone = (l: Level) => schemeColor(colors, l);
  const gb = (b: number) => gigabytes(b);
  const mem = (s.memUsed / s.memTotal) * 100;
  const memLevel = memoryLevel(s.memUsed, s.memTotal, s.memCommit, s.memCommitLimit);
  const cores = s.cores.length;
  const g = st.gpu;
  const gpus = s.gpus ?? [];
  // Name last, so cores, threads and frequency survive truncation; "8-Core" only repeats the count.
  const cpuDetail = [s.physicalCores ? `${s.physicalCores}C ${cores}T` : cores ? `${cores}T` : null, s.cpuMhz ? `${ghz(s.cpuMhz)} GHz` : null, s.cpuName.replace(/\s*\d+-Core\b/i, "")];
  const gpuDetail = g ? [g.name, g.memTotal ? `${gb(g.memUsed)} / ${gb(g.memTotal)} GB` : null, g.engine && g.engine !== "3D" ? g.engine : null] : [t("Nicht verfügbar")];
  const net = st.net, b = st.battery, p = st.power;
  const procs = st.processes ? (sort === "mem" ? st.processes.mem : st.processes.cpu).slice(0, 5) : [];
  const cycleGpu = () => {
    const n = nextGpu(gpus, g);
    if (n) updateSettings((cur) => ({ system: { ...cur.system, gpu: n.name, gpuIndex: n.index } }));
  };

  // Many PCs only have Balanced: then there is nothing to switch.
  const planName = plans?.plans.find((x) => x.id === plans.active)?.name ?? t("Energiesparplan");
  const plan = plans && plans.plans.length > 1 && (
    <Select
      width="shrink-0"
      value={plans.active ?? ""}
      options={plans.plans.map((x) => ({ value: x.id, label: x.name }))}
      onChange={(id) => void powerPlans.set(id).then(setPlans).catch(() => {})}
      trigger={{
        label: `${t("Energiesparplan")} · ${planName}`,
        menuWidth: 180,
        className: "pressable flex max-w-[84px] items-center gap-0.5 rounded-[4px] bg-fill-2 px-1 text-[10px] text-label-2 hover:text-label",
        content: (
          <>
            <span className="truncate">{planName}</span>
            <CaretDown size={8} weight="bold" className="shrink-0" />
          </>
        ),
      }}
    />
  );
  const gpuBadge = gpus.length > 1 && g ? `${gpus.findIndex((x) => x.key === g.key) + 1}/${gpus.length}` : undefined;
  const powerDetail = p ? join([p.source === "parts" && p.via ? p.via : t(p.source === "meter" ? "Gemessen" : p.source === "battery" ? "Akku-Entladung" : "Schätzung"), p.cpu !== null ? `CPU ${watts(p.cpu)} W` : null, p.gpu !== null ? `GPU ${watts(p.gpu)} W` : null]) : "";
  const batteryDetail = b
    ? join([
        b.state === "charging" ? (b.toFull !== null ? t("Voll in {time}", { time: duration(b.toFull, t) }) : t("Lädt")) : b.state === "discharging" ? (b.left !== null ? t("{time} übrig", { time: duration(b.left, t) }) : t("Entlädt")) : b.state === "full" ? t("Voll") : t("Angeschlossen"),
        b.saver ? t("Energiesparen") : null,
      ])
    : "";
  const batteryHealth = b && b.health !== null ? { text: `${t("Zustand")} ${Math.round(b.health * 100)} %`, color: tone(healthLevel(b.health)) } : null;
  // Many PCs give Windows no CPU temperature (temps.ts); the panel says where Crest can read one instead of leaving a gap (issue #67).
  const noCpuTemp = noCpuSensor ? t("Keine CPU-Temperatur von Windows. Solange HWiNFO (mit Shared Memory Support), LibreHardwareMonitor oder Core Temp läuft, liest Crest sie dort.") : undefined;

  if (material) return <MaterialSystemLayout st={st} tone={tone} roles={colors === "calm"} cpuDetail={join(cpuDetail)} noCpuTemp={noCpuTemp} gpuDetail={join(gpuDetail)} gpuBadge={gpuBadge} onGpu={gpus.length > 1 ? cycleGpu : undefined} memLevel={memLevel} powerDetail={powerDetail} batteryDetail={batteryDetail} batteryHealth={batteryHealth} plan={plan} detail={detail} setDetail={setDetail} />;

  let i = 0;
  return (
    <div className="flex h-full gap-2 px-4 pt-1 pb-2">
      <div className="min-w-0 flex-1 divide-y divide-separator rounded-[14px] bg-fill-1">
        <Row i={i++} tick={st.tick} icon={Cpu} hue="red" label="CPU" detail={join(cpuDetail)} temp={st.cpuTemp !== null ? { c: st.cpuTemp, level: tempLevel("cpu", st.cpuTemp), from: st.cpuTempFrom } : null} noTemp={noCpuTemp} tone={tone} values={st.history.cpu} max={100} value={`${Math.round(s.cpu)} %`} level={ofShare(s.cpu)}>
          {cores > 0 && <CoreColumns cores={s.cores} tone={tone} />}
        </Row>
        <Row i={i++} tick={st.tick} icon={RamIcon} hue="violet" label="RAM" detail={`${gb(s.memUsed)} / ${gb(s.memTotal)} GB`} tone={tone} values={st.history.mem} max={100} value={`${Math.round(mem)} %`} level={memLevel}>
          {s.memTotal > 0 && s.memCommitLimit > 0 && <MemoryBar used={s.memUsed} cached={s.memCached} total={s.memTotal} commit={s.memCommit} limit={s.memCommitLimit} level={memLevel} color={tone(memLevel)} />}
        </Row>
        <Row
          i={i++}
          tick={st.tick}
          icon={GpuIcon}
          hue="emerald"
          label="GPU"
          detail={join(gpuDetail)}
          temp={st.gpuTemp !== null ? { c: st.gpuTemp, level: tempLevel("gpu", st.gpuTemp), from: st.gpuTempFrom } : null}
          tone={tone}
          values={st.history.gpu}
          max={100}
          value={g?.usage == null ? "-" : `${Math.round(g.usage)} %`}
          level={ofShare(g?.usage ?? 0)}
          onClick={gpus.length > 1 ? cycleGpu : undefined}
          badge={gpuBadge}
        />
        {net && (
          <Row
            i={i++}
            tick={st.tick}
            icon={ArrowsDownUp}
            hue="cyan"
            label={t("Netz")}
            detail={<NetDetail down={net.down} up={net.up} />}
            tone={tone}
            values={st.history.down}
            second={st.history.up}
            max={Math.max(1e6, ...st.history.down.filter(Number.isFinite), ...st.history.up.filter(Number.isFinite))}
            control={s.localIp ? <LocalIpChip ip={s.localIp} /> : null}
            value={compactRate(net.down)}
            level={ofRate(Math.max(net.down, net.up))}
          />
        )}
        {(p || plan) && (
          <Row
            i={i++}
            tick={st.tick}
            icon={Lightning}
            hue="amber"
            label={t("Leistung")}
            detail={powerDetail}
            control={plan}
            tone={tone}
            values={p ? st.history.power : undefined}
            max={Math.max(30, ...st.history.power.filter(Number.isFinite))}
            value={p ? `${p.estimate ? "~" : ""}${watts(p.watts)} W` : "-"}
            level={0}
          />
        )}
        {b && (
          <Row
            i={i++}
            tick={st.tick}
            icon={BatteryHigh}
            hue="green"
            label={t("Akku")}
            detail={batteryDetail}
            health={batteryHealth}
            tone={tone}
            value={`${Math.round(b.percent)} %`}
            level={batteryLevel(b)}
          />
        )}
        <Row
          i={i++}
          tick={st.tick}
          icon={WifiHigh}
          hue="sky"
          label="Ping"
          detail="1.1.1.1"
          control={<PublicIpChip />}
          tone={tone}
          values={st.history.ping}
          max={Math.max(60, ...st.history.ping.filter(Number.isFinite))}
          value={s.ping === null ? t("Offline") : `${s.ping} ms`}
          level={s.ping === null ? 2 : s.ping >= 150 ? 2 : s.ping >= 60 ? 1 : 0}
        />
      </div>

      <div className="relative flex w-[236px] shrink-0 flex-col gap-2">
        <div className="rounded-[14px] bg-fill-1 pb-1" onPointerEnter={() => holdProcesses.set(true)} onPointerLeave={() => holdProcesses.set(false)}>
          <div className="flex h-8 items-center justify-between pe-1.5 ps-3">
            <span className="text-caption font-medium tracking-wide text-label-3 uppercase">{t("Prozesse")}</span>
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
        </div>
        {st.drives.length > 0 && (
          <div className="rounded-[14px] bg-fill-1 py-1">
            {st.drives.slice(0, 3).map((d) => {
              const sz = driveSizes(d.used, d.total), share = d.total ? (d.used / d.total) * 100 : 0;
              return (
                <div key={d.key} className="flex h-7 items-center gap-2 px-3" title={d.model}>
                  <HardDrives size={13} weight="bold" className={`shrink-0 ${driveColor ? "" : "text-label-3"}`} style={driveColor ? { color: driveColor } : undefined} />
                  <span className="tabular w-[46px] shrink-0 truncate text-footnote font-medium text-label">{d.letters}</span>
                  <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-fill-2">
                    <span className="absolute inset-y-0 start-0 rounded-full" style={{ width: `${share}%`, background: tone(ofShare(share)) }} />
                  </span>
                  <span className="tabular shrink-0 text-caption text-label-3">
                    {sz.used}/{sz.total} {sz.unit}
                  </span>
                  {d.temp !== null && (
                    <span className="tabular w-7 shrink-0 text-end text-caption font-medium" style={{ color: tone(d.tempLevel) }}>
                      {degrees(d.temp)}°
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <AnimatePresence>{detail && <ProcessCard key="card" proc={st.processes?.cpu.find((x) => x.id === detail.id) ?? detail} cores={cores} onClose={() => setDetail(null)} />}</AnimatePresence>
      </div>
      <PortsEntry />
    </div>
  );
}

export const join = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ");

function Row(props: {
  i: number;
  tick: number;
  icon: Icon;
  /** The icon's colour while coloured icons are on (Settings, Themes). */
  hue: Hue;
  label: string;
  detail: ReactNode;
  /** `from`: the program that gave it, shown on hover. */
  temp?: { c: number; level: Level; from?: string | null } | null;
  /** With no `temp`: "- °C", and this on hover saying why. */
  noTemp?: string;
  health?: { text: string; color: string } | null;
  tone: (l: Level) => string;
  values?: number[];
  second?: number[];
  max?: number;
  value: string;
  level: Level;
  onClick?: () => void;
  badge?: string;
  /** A small control after the detail, such as the power plan. */
  control?: ReactNode;
  children?: ReactNode;
}) {
  const I = props.icon;
  const color = props.tone(props.level);
  const iconColor = useHue(props.hue);
  const click = props.onClick;
  return (
    <motion.div
      className={`block w-full px-3 text-start ${click ? "pressable cursor-pointer" : ""}`}
      onClick={click}
      role={click ? "button" : undefined}
      tabIndex={click ? 0 : undefined}
      onKeyDown={click ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), click()) : undefined}
      title={props.onClick ? t("Klicken für die nächste GPU") : undefined}
      initial={{ opacity: 0, transform: "translateY(4px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={{ ...content.enter, delay: 0.03 * props.i }}
    >
      <div className="flex h-[32px] items-center gap-3">
        <I size={15} weight="bold" className={`shrink-0 ${iconColor ? "" : "text-label-3"}`} style={iconColor ? { color: iconColor } : undefined} />
        <span className="w-16 shrink-0 text-footnote font-medium text-label">{props.label}</span>
        {/* Room for a CPU model name; shrinks before the value does: in a narrow panel the detail truncates instead of pushing the value out (issue #5). */}
        <span className="tabular flex min-w-0 flex-[0_1_300px] items-center gap-1.5 truncate text-caption text-label-3">
          <span className="tabular truncate" title={typeof props.detail === "string" ? props.detail : undefined}>
            {props.detail}
          </span>
          {props.temp ? (
            <span dir="ltr" className="tabular shrink-0 font-medium" style={{ color: props.tone(props.temp.level) }} title={props.temp.from ?? undefined}>
              {degrees(props.temp.c)} °C
            </span>
          ) : (
            props.noTemp && (
              // The reason keeps the page's direction (Arabic reads right to left); only the reading itself is left to right.
              <span role="img" aria-label={props.noTemp} className="shrink-0" title={props.noTemp}>
                <span dir="ltr" className="tabular font-medium">
                  - °C
                </span>
              </span>
            )
          )}
          {props.health && <BatteryHealth health={props.health} className="tabular shrink-0 font-medium" />}
          {props.badge && <span className="shrink-0 rounded-[4px] bg-fill-2 px-1 text-[10px] text-label-2">{props.badge}</span>}
          {props.control}
        </span>
        {props.values ? <Trend values={props.values} second={props.second} max={props.max ?? 100} color={color} tick={props.tick} /> : <span className="flex-1" />}
        <span className="tabular w-[58px] shrink-0 text-end text-footnote font-semibold transition-colors duration-300" style={{ color }}>
          {props.value}
        </span>
      </div>
      {props.children && <div className="-mt-1 pb-1.5 ps-[87px]">{props.children}</div>}
    </motion.div>
  );
}

/** One column per logical processor, grouped by kind of core (P fastest, E slowest) where the CPU has more than one kind. */
export function CoreColumns({ cores, tone, fill = false }: { cores: { usage: number; kind: number }[]; tone: (l: Level) => string; fill?: boolean }) {
  const kinds = [...new Set(cores.map((c) => c.kind))].sort();
  const letter = (k: number) => (kinds.length < 2 ? null : k === kinds[0] ? "P" : k === kinds.at(-1) ? "E" : "M");
  // Filling a box, the columns share its width up to 4 px each, a pixel apart past 16 (64 threads go to a pixel).
  const gap = fill && cores.length > 16 ? "gap-px" : "gap-[2px]";
  return (
    <div className={fill ? "flex h-full items-end gap-2" : "flex h-[16px] items-end gap-2"} aria-hidden>
      {kinds.map((k) => (
        <div key={k} className={`flex h-full min-w-0 items-end ${fill ? "flex-1 " : ""}${gap}`}>
          {letter(k) && <span className="me-0.5 self-center text-[9px] font-semibold text-label-4">{letter(k)}</span>}
          {cores
            .filter((c) => c.kind === k)
            .map((c, n) => (
              <span key={n} className={`relative h-full ${fill ? "min-w-0 flex-1 max-w-[4px]" : "w-[4px]"} overflow-hidden rounded-[1.5px] bg-fill-2`}>
                <span className="absolute inset-0 rounded-[1.5px] transition-transform duration-500" style={{ transform: `translateY(${100 - Math.max(6, Math.min(100, c.usage))}%)`, background: tone(ofShare(c.usage)) }} />
              </span>
            ))}
        </div>
      ))}
    </div>
  );
}

/** In use (solid), file cache (light: given to any app that asks), and the commit charge against its limit. */
function MemoryBar(p: { used: number; cached: number; total: number; commit: number; limit: number; level: Level; color: string }) {
  const used = (p.used / p.total) * 100, cached = Math.min(100 - used, (p.cached / p.total) * 100);
  return (
    <div className="flex h-[16px] items-center gap-2">
      <span className="relative h-1.5 w-[90px] shrink-0 overflow-hidden rounded-full bg-fill-2">
        <span className="absolute inset-y-0 start-0" style={{ width: `${used}%`, background: p.color }} />
        <span className="absolute inset-y-0" style={{ insetInlineStart: `${used}%`, width: `${cached}%`, background: p.color, opacity: 0.35 }} />
      </span>
      <span className="tabular truncate text-[10px] text-label-3">
        {p.level > 0 && (
          <span className="font-semibold" style={{ color: p.color }}>
            {t(p.level === 2 ? "Druck kritisch" : "Druck hoch")} ·{" "}
          </span>
        )}
        {t("Cache")} {gigabytes(p.cached)} · {t("Zugesichert")} {gigabytes(p.commit)} / {gigabytes(p.limit)} GB
      </span>
    </div>
  );
}

/** A chip in a reading's detail, like the GPU badge, that is a button. */
const CHIP = "pressable tabular flex shrink-0 items-center gap-0.5 rounded-[4px] bg-fill-2 px-1 text-[10px] text-label-2 outline-none hover:text-label focus-visible:ring-1 focus-visible:ring-label-3 material:rounded-full material:px-1.5";

const copyLabel = (done: { ok: boolean } | null) => (done ? (done.ok ? t("Kopiert") : t("Kopieren fehlgeschlagen")) : t("Kopieren"));
const Copied = ({ done }: { done: { ok: boolean } | null }) => (done ? done.ok ? <Check size={9} weight="bold" /> : <X size={9} weight="bold" className="text-red" /> : null);

/** This PC's address on its network. A click opens ipconfig in a Command Prompt on Windows and copies the address on a Mac. */
export function LocalIpChip({ ip }: { ip: string }) {
  const [done, copy] = useCopy();
  const label = `${t("Lokale IP")} ${ip} · ${isMac ? copyLabel(done) : t("Klicken für ipconfig in der Eingabeaufforderung")}`;
  return (
    <button type="button" dir="ltr" className={CHIP} aria-label={label} title={label} onClick={() => (isMac ? copy("ip", ip) : void openIpconfig().catch(() => {}))}>
      {ip}
      <Copied done={done} />
    </button>
  );
}

/** What get.geojs.io (the weather's service) sees as this PC's address; a fixed documentation address in the demo. */
async function publicIp(): Promise<string | null> {
  if (demo) return "203.0.113.7";
  try {
    return publicIpOf(await (await fetch("https://get.geojs.io/v1/ip.json", { signal: AbortSignal.timeout(5000), cache: "no-store" })).json());
  } catch {
    return null;
  }
}

/** The public address: asked for only on a click and kept only in this component, never saved; once shown, a click copies it. */
export function PublicIpChip() {
  const [state, setState] = useState<"idle" | "loading" | "failed" | { ip: string }>("idle");
  const [done, copy] = useCopy();
  if (typeof state === "object") {
    const label = `${t("Öffentliche IP")} ${state.ip} · ${copyLabel(done)}`;
    return (
      <button type="button" dir="ltr" className={CHIP} aria-label={label} title={label} onClick={() => copy("ip", state.ip)}>
        {state.ip}
        <Copied done={done} />
      </button>
    );
  }
  const ask = () => {
    setState("loading");
    void publicIp().then((ip) => setState(ip ? { ip } : "failed"));
  };
  const text = state === "loading" ? t("Wird geladen …") : state === "failed" ? t("Erneut versuchen") : t("Öffentliche IP");
  return (
    <button
      type="button"
      className={CHIP}
      aria-label={join([t("Öffentliche IP"), state === "idle" ? null : text])}
      aria-busy={state === "loading"}
      title={t("Fragt get.geojs.io nach deiner öffentlichen IP")}
      onClick={state === "loading" ? undefined : ask}
    >
      {text}
    </button>
  );
}

/** The battery's health in its level's colour. On Windows a click makes and opens Windows' battery report; meanwhile, and when it fails, the text says so. */
export function BatteryHealth({ health, className }: { health: { text: string; color: string }; className: string }) {
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const reset = useRef(0);
  useEffect(() => () => window.clearTimeout(reset.current), []);
  if (isMac)
    return (
      <span className={className} style={{ color: health.color }}>
        {health.text}
      </span>
    );
  const run = () => {
    window.clearTimeout(reset.current);
    setState("working");
    openBatteryReport().then(
      () => setState("idle"),
      () => {
        setState("failed");
        reset.current = window.setTimeout(() => setState("idle"), 4000);
      },
    );
  };
  return (
    <button
      type="button"
      className={`pressable rounded-[4px] outline-none hover:underline focus-visible:ring-1 focus-visible:ring-label-3 ${className}`}
      style={{ color: state === "failed" ? "var(--color-red)" : state === "working" ? undefined : health.color }}
      aria-live="polite"
      aria-busy={state === "working"}
      title={t("Klicken für den Akkubericht")}
      onClick={state === "working" ? undefined : run}
    >
      {state === "working" ? t("Akkubericht wird erstellt …") : state === "failed" ? t("Akkubericht fehlgeschlagen") : health.text}
    </button>
  );
}

export function NetDetail({ down, up }: { down: number; up: number }) {
  const d = rate(down), u = rate(up);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex items-center gap-0.5">
        <ArrowDown size={10} weight="bold" />
        {d.n} {d.unit}
      </span>
      <span className="inline-flex items-center gap-0.5">
        <ArrowUp size={10} weight="bold" />
        {u.n} {u.unit}
      </span>
    </span>
  );
}

/** Icons by executable path, asked once each. */
const icons = new Map<string, string | null>();
function useIcon(path: string | null): string | null {
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!path || icons.has(path)) return;
    icons.set(path, null);
    void systemIcon(path).then((url) => {
      icons.set(path, url);
      redraw((n) => n + 1);
    });
  }, [path]);
  return path ? (icons.get(path) ?? null) : null;
}

function AppIcon({ path, size }: { path: string | null; size: number }) {
  const src = useIcon(path);
  return src ? <img src={src} width={size} height={size} className="shrink-0" alt="" /> : <AppWindow size={size} weight="bold" className="shrink-0 text-label-3" />;
}

export function ProcessRow({ proc, value, onClick }: { proc: ProcReading; value: string; onClick: () => void }) {
  return (
    <motion.button layout="position" transition={{ duration: 0.25 }} onClick={onClick} className="pressable flex h-[24px] w-full items-center gap-2 px-3 text-start hover:bg-fill-2">
      <AppIcon path={proc.path} size={14} />
      <span className="min-w-0 flex-1 truncate text-caption text-label-2">{proc.name}</span>
      {proc.count > 1 && <span className="tabular shrink-0 text-[10px] text-label-4">{proc.count}</span>}
      <span className="tabular w-[46px] shrink-0 text-end text-caption font-medium text-label">{value}</span>
    </motion.button>
  );
}

export function ProcessCard({ proc, cores, onClose }: { proc: ProcReading; cores: number; onClose: () => void }) {
  return (
    <motion.div className="absolute inset-x-0 top-0 z-10 rounded-[14px] bg-elevated p-3 shadow-[0_6px_18px_rgb(0_0_0/0.45)] material:shadow-level2">
      <div className="flex items-center gap-2">
        <AppIcon path={proc.path} size={22} />
        <span className="min-w-0 flex-1 truncate text-body font-medium text-label">{proc.name}</span>
        <button onClick={onClose} aria-label={t("Schließen")} className="pressable text-label-3 hover:text-label">
          <X size={13} weight="bold" />
        </button>
      </div>
      <div className="tabular mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-caption">
        <span className="text-label-3">CPU</span>
        <span className="text-label">{processShare(proc.cpu, cores || navigator.hardwareConcurrency)} %</span>
        <span className="text-label-3">{t("Speicher")}</span>
        <span className="text-label">{processMemory(proc.mem)}B</span>
        <span className="text-label-3">{t("Prozesse")}</span>
        <span className="text-label">{proc.count}</span>
        <span className="text-label-3">{t("Pfad")}</span>
        <span className="truncate text-label-2" title={proc.path ?? undefined}>
          {proc.path ?? proc.id}
        </span>
      </div>
      {proc.path && (
        <button onClick={() => revealFile(proc.path!)} className="pressable mt-2 text-caption font-medium text-link">
          {t("Im Explorer zeigen")}
        </button>
      )}
    </motion.div>
  );
}

/**
 * One minute of history; gaps (no value) stay open. Right = now. `second` is drawn fainter (upload under download).
 * The line is drawn one step to the right and glides left by that step every second, so it scrolls smoothly instead of jumping.
 * With `area` it fills its box in a w x h viewBox, with an area under each line and a scale that eases to a new `max`.
 */
export function Trend({ values, second, max, color, secondColor = color, tick, w = 160, h = 22, area = false, className }: { values: number[]; second?: number[]; max: number; color: string; secondColor?: string; tick: number; w?: number; h?: number; area?: boolean; className?: string }) {
  const step = w / (HISTORY - 2);
  // In hundredths, not 1..2: springs.value rests within 0.5, which holds at the scale of the numbers it was made for.
  const scale = useMotionValue(100);
  const scaleY = useTransform(scale, (s) => s / 100);
  const prev = useRef(max);
  const reduced = useReducedMotion() === true;
  useLayoutEffect(() => {
    // Before the paint: the new max must not draw one frame at the old scale. Crest's network, power and ping change max almost every sample: no spring for them.
    if (!area) return;
    const from = prev.current;
    prev.current = max;
    if (max === from) return;
    if (reduced) return void scale.jump(100);
    // The new max draws at once at the old height, then stretches out; from where the scale is, if a spring is still running.
    scale.jump((scale.get() * max) / from);
    animate(scale, 100, springs.value);
  }, [max, area]);
  const line = (vals: number[], opacity: number, key: string, stroke = color) => (
    <path
      // New value → new animation (key); before that the line sits one step to the right.
      key={`${key}${tick}`}
      className="trend-scroll"
      d={trendLine(vals, max, w, h, HISTORY)}
      fill="none"
      stroke={stroke}
      strokeOpacity={opacity}
      strokeWidth={area ? "2" : "1.5"}
      strokeLinejoin="round"
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
      style={{ ["--step" as string]: `${step}px` }}
    />
  );
  const fill = (vals: number[], opacity: number, key: string, paint = color) => (
    <path key={`${key}${tick}`} className="trend-scroll" d={trendArea(vals, max, w, h, HISTORY)} fill={paint} fillOpacity={opacity} style={{ ["--step" as string]: `${step}px` }} />
  );
  const base = <line x1="0" x2={w} y1={h - 1} y2={h - 1} stroke="var(--color-separator)" strokeWidth="1" vectorEffect="non-scaling-stroke" />;
  if (area)
    return (
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={`${className ?? "size-full"} overflow-hidden`}>
        {base}
        <motion.g style={{ scaleY, originY: 1, transformBox: "view-box" }}>
          {second && fill(second, 0.15, "fb", secondColor)}
          {fill(values, 0.2, "fa")}
          {second && line(second, 0.35, "b", secondColor)}
          {line(values, 0.8, "a")}
        </motion.g>
      </svg>
    );
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-[22px] min-w-0 flex-1 overflow-hidden">
      {base}
      {second && line(second, 0.35, "b")}
      {line(values, 0.8, "a")}
    </svg>
  );
}
