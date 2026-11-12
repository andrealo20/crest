import { demo, showcase } from "./showcase-data";

/*
 * Browser only: the screen behind the window for the glass (src/notch/glass/snapshot.ts), which the browser cannot copy. WebGL does not
 * see DesktopMock's DOM, so this draws the same desktop into an image (its gradient, the File Explorer window, the taskbar), and the
 * glass's bands carry on what is around them. ?glassBackdrop=stripes draws black and white diagonal stripes instead, to judge how the
 * rim bends; ?glassBackdrop=light a white page of dark text, the worst backdrop for dark themes. BGRA, like the copy from Rust.
 */

let last: { key: string; bytes: Uint8Array<ArrayBuffer> } | null = null;

/** The fake copy, `w` by `h` device pixels of the page; kept for the next peek of the same size and kind. */
export function fakeBackdrop(w: number, h: number, kind: string | null): Uint8Array<ArrayBuffer> {
  const key = `${w}x${h}|${kind}`;
  if (last?.key === key) return last.bytes;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const scale = devicePixelRatio;
  ctx.scale(scale, scale);
  if (kind === "stripes") stripes(ctx, w / scale, h / scale);
  else if (kind === "light") page(ctx, w / scale, h / scale);
  else desktop(ctx, w / scale, h / scale);
  const bytes = new Uint8Array(ctx.getImageData(0, 0, w, h).data.buffer);
  for (let i = 0; i < bytes.length; i += 4) {
    const r = bytes[i];
    bytes[i] = bytes[i + 2];
    bytes[i + 2] = r;
  }
  last = { key, bytes };
  return bytes;
}

/** DesktopMock's dark desktop in CSS px of the page; the showcase and the demo have its clean one, without the window. */
function desktop(ctx: CanvasRenderingContext2D, W: number, H: number) {
  if (showcase || demo) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#2a3c9e");
    sky.addColorStop(0.55, "#121a5c");
    sky.addColorStop(1, "#080c2a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    glow(ctx, W, H, [0.88, 1.05, 0.7, 0.7], [[0, "#8a4dff"], [0.62, "rgba(138, 77, 255, 0)"]]);
    glow(ctx, W, H, [0.5, 0, 0.6, 0.55], [[0, "#6d8cff"], [0.72, "rgba(109, 140, 255, 0)"]]);
  } else {
    glow(ctx, W, H, [0.6, 1.15, 0.9, 0.7], [[0, "#3c7bff"], [0.3, "#1d3fa6"], [0.6, "#0b1a4a"], [1, "#050a1c"]]);
    // The maximized File Explorer at DesktopMock's margins: title bar at 70 %, three rows at 60 %.
    const x = 0.12 * W, y = 0.14 * H, font = getComputedStyle(document.body).fontFamily;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, 0.76 * W, 0.68 * H, 8);
    ctx.clip();
    ctx.fillStyle = "#202020";
    ctx.fillRect(x, y, 0.76 * W, 0.68 * H);
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = "#2b2b2b";
    ctx.fillRect(x, y, 0.76 * W, 32);
    ctx.fillStyle = "#eeeeee";
    ctx.textBaseline = "middle";
    ctx.font = `12px ${font}`;
    ctx.fillText("File Explorer", x + 12, y + 16);
    ctx.globalAlpha = 0.6;
    ctx.font = `14px ${font}`;
    ["Documents", "Downloads", "Pictures"].forEach((row, i) => ctx.fillText(row, x + 24, y + 32 + 24 + 10 + i * 28));
    ctx.restore();
  }
  ctx.fillStyle = "rgba(28, 28, 28, 0.8)";
  ctx.fillRect(0, H - 48, W, 48);
}

/** A CSS radial-gradient with an elliptic size: centre and radii as shares of the page, [cx, cy, rx, ry]. */
function glow(ctx: CanvasRenderingContext2D, W: number, H: number, [cx, cy, rx, ry]: number[], stops: [number, string][]) {
  ctx.save();
  ctx.translate(cx * W, cy * H);
  ctx.scale(rx * W, ry * H);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  stops.forEach(([at, color]) => g.addColorStop(at, color));
  ctx.fillStyle = g;
  ctx.fillRect(-cx / rx, -cy / ry, 1 / rx, 1 / ry);
  ctx.restore();
}

function stripes(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ffffff";
  ctx.transform(1, 0, 1, 1, 0, 0); // x + y: upright bands lean at 45°
  for (let x = -H; x < W; x += 16) ctx.fillRect(x, 0, 8, H);
}

/** A light page, like a document or a site: white with rows of dark text, the worst backdrop for dark themes. */
function page(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#202124";
  ctx.font = `14px ${getComputedStyle(document.body).fontFamily}`;
  ctx.textBaseline = "middle";
  for (let y = 24; y < H; y += 22) ctx.fillText("The quick brown fox jumps over the lazy dog. ".repeat(6), 12, y);
}
