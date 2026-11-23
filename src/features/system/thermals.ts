// The bar's Temperatures widget: the fans it shows and the last 10 minutes of the temperatures, kept by the notch's system store.
// Pure, so it can be tested without the app around it.

/** The fans the widget shows, rpm: the CPU's, the GPU's and the fastest case fan; null for one not known. */
export interface Fans {
  cpu: number | null;
  gpu: number | null;
  case: number | null;
  /** The GPU's is a percent of its top speed (NVML), where neither a monitoring program nor the driver gives rpm. */
  gpuPercent?: true;
}

export const NO_FANS: Fans = { cpu: null, gpu: null, case: null };
/** Above this a reading is broken (65535 from a missing sensor). */
export const FAN_MAX = 20_000;

/** One point per 15 s, 40 of them: the last 10 minutes, a pixel each in the bar's 40 px line. */
export const TEMP_STEP_MS = 15_000, TEMP_POINTS = 40;
/** The line's fixed scale, °C: a degree of noise never becomes a peak, and the height says how hot. */
export const TEMP_FLOOR = 20, TEMP_TOP = 100;

/** The bucket of the newest point (ms since the probe started / TEMP_STEP_MS) and both series, oldest first, always as long. */
export interface TempLine {
  bucket: number;
  cpu: (number | null)[];
  gpu: (number | null)[];
}

export const NO_TEMPS: TempLine = { bucket: 0, cpu: [], gpu: [] };

const whole = (v: number | null) => (v === null ? null : Math.round(v));
const hotter = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));

/**
 * The line after a read at `at` ms (the probe's own clock, Stats.at): the bucket's hottest value in whole degrees, so a few seconds of load
 * stay visible and the feed changes only when the drawing does; a null for each bucket passed without a read.
 */
export function addTemps(line: TempLine, at: number, cpu: number | null, gpu: number | null): TempLine {
  const bucket = Math.floor(at / TEMP_STEP_MS);
  if (line.cpu.length && bucket <= line.bucket) {
    return { bucket: line.bucket, cpu: [...line.cpu.slice(0, -1), hotter(line.cpu.at(-1) ?? null, whole(cpu))], gpu: [...line.gpu.slice(0, -1), hotter(line.gpu.at(-1) ?? null, whole(gpu))] };
  }
  const gap = line.cpu.length ? Math.min(TEMP_POINTS, bucket - line.bucket - 1) : 0;
  const next = (s: (number | null)[], v: number | null) => [...s, ...Array<null>(gap).fill(null), whole(v)].slice(-TEMP_POINTS);
  return { bucket, cpu: next(line.cpu, cpu), gpu: next(line.gpu, gpu) };
}

/**
 * The feed's temperatures for the `history` version: whole degrees now and both lines, each line only once its series has shown a value
 * this session (`seen` keeps which), so a hybrid laptop's discrete GPU resting unread for 10 minutes keeps its column and the bar does not
 * rearrange; never seen, its line is empty and the widget leaves it out.
 */
export function tempsFeed(line: TempLine, cpu: number | null, gpu: number | null, seen: Set<"cpu" | "gpu">) {
  const some = (s: (number | null)[]) => s.some((v) => v !== null);
  if (cpu !== null || some(line.cpu)) seen.add("cpu");
  if (gpu !== null || some(line.gpu)) seen.add("gpu");
  return { cpu: whole(cpu), gpu: whole(gpu), cpuLine: seen.has("cpu") ? line.cpu : [], gpuLine: seen.has("gpu") ? line.gpu : [], fans: NO_FANS };
}

/** A fan to 10 rpm; none above FAN_MAX. */
const rpm = (v: number | null | undefined) => (v == null || !Number.isFinite(v) || v < 0 || v > FAN_MAX ? null : Math.round(v / 10) * 10);

/**
 * The fans the widget shows, to 10 rpm: HWiNFO's or LibreHardwareMonitor's first, the GPU's from its driver otherwise. A driver's GPU
 * fan counts once it has read above 0 since Crest started (`spun` keeps its adapter): until then 0 is a driver that does not report
 * it, after that a fan stopped at rest. Without either, NVML's percent for the GPU (`nvml`, desktops with an NVIDIA card).
 */
export function fansOf(ext: { cpu: number | null; case: number | null; gpu: number | null } | null, gpu: { key: string; fan: number | null } | null, nvml: number | null, spun: Set<string>): Fans {
  if (gpu && (rpm(gpu.fan) ?? 0) > 0) spun.add(gpu.key);
  const driver = gpu && spun.has(gpu.key) ? rpm(gpu.fan) : null;
  const fans: Fans = { cpu: rpm(ext?.cpu), gpu: rpm(ext?.gpu) ?? driver, case: rpm(ext?.case) };
  if (fans.gpu === null && nvml !== null && Number.isFinite(nvml)) return { ...fans, gpu: Math.round(Math.min(100, Math.max(0, nvml))), gpuPercent: true };
  return fans;
}
