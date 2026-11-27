/*
 * The made-up engine of the Files tool in the browser (npm run dev, the try-it demo): a download that counts up, a small
 * catalog and runs that report progress. No file is touched; the outputs are names beside the inputs.
 */
import type { License, Op, OpOption, RunLine } from "../features/files/model";

let installed = false;
let left = 17;
let unlocked = false;
let stop: (() => void) | null = null;

const SIZE = 52 * 1024 * 1024;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const status = async () => ({ version: installed ? "1.0.0" : null, available: true, size: SIZE, buy: false });

export async function download(onProgress: (p: { done: number; total: number }) => void): Promise<string> {
  for (let done = 0; done <= SIZE; done += SIZE / 20) {
    onProgress({ done, total: SIZE });
    await wait(80);
  }
  installed = true;
  return "1.0.0";
}

export async function remove() {
  installed = false;
}

const images = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".bmp", ".gif", ".tif", ".tiff"];
const quality: OpOption = { id: "quality", type: "int", label: "Quality", default: 85, min: 1, max: 100, choices: [] };

export async function catalog(): Promise<Op[]> {
  const op = (id: string, tab: Op["tab"], name: string, extensions: string[], patch: Partial<Op> = {}): Op => ({
    id,
    tab,
    name,
    kinds: [],
    extensions,
    output: null,
    options: [],
    multi: true,
    secret: false,
    ...patch,
  });
  return [
    op("image.convert.png", "convert", "PNG", images, { output: ".png" }),
    op("image.convert.jpg", "convert", "JPG", images, { output: ".jpg", options: [quality] }),
    op("image.convert.webp", "convert", "WebP", images, { output: ".webp", options: [quality] }),
    op("pdf.convert.images", "convert", "Images", [".pdf"]),
    op("audio.convert.mp3", "convert", "MP3", [".wav", ".flac", ".m4a", ".ogg"], { options: [{ id: "bitrate", type: "choice", label: "Bitrate", default: "192", choices: [{ id: "128", label: "128 kbps" }, { id: "192", label: "192 kbps" }, { id: "320", label: "320 kbps" }] }] }),
    op("image.resize", "tools", "Resize", images, {
      options: [
        { id: "width", type: "int", label: "Width", default: 1920, min: 16, max: 16384, choices: [] },
        { id: "keep", type: "bool", label: "Keep proportions", default: true, choices: [] },
      ],
    }),
    op("image.strip", "tools", "Remove metadata", images),
    op("pdf.merge", "tools", "Merge", [".pdf"]),
    op("pdf.protect", "actions", "Add a password", [".pdf"], { multi: false, secret: true }),
    op("files.rename", "actions", "Rename", [], { options: [{ id: "pattern", type: "text", label: "Name", default: "{name} {n}", choices: [] }] }),
  ];
}

export async function run(req: { op: string; files: string[]; out: string | null }, onLine: (line: RunLine) => void): Promise<void> {
  if (!unlocked && left <= 0) {
    onLine({ type: "locked", left: 0 });
    throw "locked";
  }
  let cancelled = false;
  stop = () => void (cancelled = true);
  let ok = 0;
  for (const [index, file] of req.files.entries()) {
    onLine({ type: "start", index, file });
    for (let f = 0.2; f < 1; f += 0.2) {
      await wait(150);
      if (cancelled) throw "cancelled";
      onLine({ type: "progress", index, fraction: f });
    }
    if (file.toLowerCase().includes("broken")) onLine({ type: "error", index, code: "damaged", message: "The file is damaged." });
    else {
      const dot = file.lastIndexOf(".");
      onLine({ type: "done", index, outputs: [`${dot > 0 ? file.slice(0, dot) : file} (converted)${dot > 0 ? file.slice(dot) : ""}`] });
      ok++;
    }
    if (!unlocked) onLine({ type: "allowance", left: (left = Math.max(0, left - 1)) });
  }
  stop = null;
  onLine({ type: "end", ok, failed: req.files.length - ok });
}

export async function cancel() {
  stop?.();
}

export async function license(action: "status" | "activate" | "deactivate", key?: string): Promise<License | { ok: boolean; state?: string; error?: string; message?: string } | null> {
  await wait(300);
  if (action === "activate") {
    if (!key || key.length < 8) return { ok: false, error: "invalid", message: "This key is not valid." };
    unlocked = true;
    return { ok: true, state: "unlocked" };
  }
  if (action === "deactivate") {
    unlocked = false;
    return { ok: true, state: "free" };
  }
  return unlocked ? { state: "unlocked", email: "d***@example.com" } : { state: "free", left, daily: 2, email: null };
}
