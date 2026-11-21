import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MENU_ROW_CLASS } from "../../ui/menu.ts";

const window = (name: string) => readFileSync(join(import.meta.dirname, "window", name), "utf8");

test("the bar's menus open from Material's 0.8 scale as the select menus do, in the shared menu look", () => {
  const src = window("BarMenu.tsx");
  assert.match(src, /const appDesign = design\.use\(\);/);
  assert.ok(src.includes('scale(${appDesign === "material" && !reduced ? 0.8 : 0.96}) translateY(2px)'));
  assert.match(src, /exit=\{\{ opacity: 0, transform: "scale\(0\.98\)"/);
  assert.match(src, /\$\{MENU_PANEL_CLASS\}/);
  assert.match(src, /\$\{MENU_ROW_CLASS\}/);
});

test("a menu row keeps Material's focus ring inside itself, without the press scale of .pressable", () => {
  const classes = MENU_ROW_CLASS.split(/\s+/);
  assert.ok(classes.includes("pressable-wide"));
  assert.ok(!classes.includes("pressable"));
});

test("the tool panel reads the closed notch's ink as a store, so a cover's colours follow a change of theme", () => {
  const src = window("ToolPanel.tsx");
  const body = src.slice(src.indexOf("export function ToolPanel("), src.indexOf("if (!tab) return null"));
  assert.match(body, /inkTheme\.use\(\)/);
  assert.match(src, /ink\.vars/);
  assert.ok(!src.includes("darkInk("));
});

// The class lists a source writes as className="…" or as a quoted constant.
const classLists = (src: string) => [...src.matchAll(/className="([^"]*)"|const \w+ = "([^"]*)"/g)].map((m) => (m[1] ?? m[2]).split(/\s+/));
const list = (src: string, ...has: string[]) => {
  const found = classLists(src).filter((c) => has.every((h) => c.includes(h)));
  assert.equal(found.length, 1, `one class list with ${has.join(" ")}`);
  return found[0];
};
// From `function name(` to the end of the file: enough to leave out the functions above it.
const from = (src: string, name: string) => src.slice(src.indexOf(`function ${name}(`));
const hasAll = (classes: string[], wanted: string) => {
  for (const c of wanted.split(" ")) assert.ok(classes.includes(c), `${c} in ${classes.join(" ")}`);
};

test("the quick panel's split tiles and chips are full pills under Material", () => {
  const src = window("QuickPanel.tsx");
  hasAll(list(src, "overflow-hidden", "rounded-[12px]", "bg-fill-1"), "material:rounded-full");
  hasAll(list(from(src, "Chip"), "rounded-[12px]", "bg-fill-1"), "material:rounded-full");
});

test("the Wi-Fi page's buttons are tonal and grey out when disabled, its rows are pills and its password field is outlined", () => {
  const src = window("WifiPage.tsx");
  const button = list(src, "bg-fill-1", "disabled:opacity-40");
  hasAll(button, "material:bg-secondary-container material:text-on-secondary-container material:hover:bg-secondary-container material:hover:text-on-secondary-container");
  hasAll(button, "material:disabled:bg-fill-2 material:disabled:text-label-4 material:disabled:opacity-100");
  hasAll(list(src, "gap-2.5", "rounded-[10px]", "px-2"), "material:rounded-full");
  const field = list(src, "h-8", "rounded-[8px]", "bg-fill-1");
  hasAll(field, "material:bg-transparent material:border material:border-label-3 material:focus:border-2 material:focus:border-primary material:focus:ring-0 material:focus:px-[9px]");
});

test("the Bluetooth page's rows are pills under Material", () => {
  hasAll(list(window("BluetoothPage.tsx"), "rounded-[10px]", "hover:bg-fill-1"), "material:rounded-full");
});

test("the tray's and the apps' cells are pills under Material, with the focus ring inside and no press scale", () => {
  for (const name of ["TrayPanel.tsx", "AppsPanel.tsx"]) {
    const cell = list(window(name), "rounded-[8px]", "focus-visible:bg-fill-2");
    hasAll(cell, "material:rounded-full pressable-wide");
    assert.ok(!cell.includes("pressable"), `${name}: no .pressable`);
  }
});

test("the app in front in the overflow panel gets Material's tonal pill behind its icon, as on the bar", () => {
  const src = window("AppsPanel.tsx");
  const pill = /\{material && <motion\.span[^\n]*data-front-pill[^\n]*/.exec(src);
  assert.ok(pill, "no pill drawn under a material && branch");
  // The cell is size + 16 square: full width and 4 px off top and bottom gives the bar's size + 16 by size + 8 stadium, not a circle.
  for (const c of ["aria-hidden", "bg-secondary-container", "rounded-full", "inset-x-0 inset-y-1", "marks(mark, appDesign).pill"]) assert.ok(pill[0].includes(c), c);
  assert.doesNotMatch(pill[0], /backgroundColor|width:|height:/);
  // Over the pill: an icon after a positioned span paints under it unless it is positioned too.
  assert.match(src, /<span className="relative flex">\s*<AppIcon/);
});

test("with reduced motion the bar's menus and the select menus open from Crest's 0.96, not Material's 0.8, since MotionConfig keeps a transform string", () => {
  const menu = window("BarMenu.tsx");
  assert.match(menu, /const reduced = useReducedMotion\(\) === true;/);
  assert.ok(menu.includes('scale(${appDesign === "material" && !reduced ? 0.8 : 0.96})'));
  const select = readFileSync(join(import.meta.dirname, "..", "..", "ui", "controls.tsx"), "utf8");
  const body = select.slice(select.indexOf("export function Select<"), select.indexOf("export function Skeleton("));
  assert.match(body, /const reduced = useReducedMotion\(\) === true;/);
  assert.ok(body.includes('scale(${style === "material" && !reduced ? 0.8 : 0.96})'));
  assert.ok(!select.includes('scale(${style === "material" ? 0.8'));
});

test("the preview card's tiles are menu rows under Material, the focus ring inside them, the cross round, and each square slot in a rounded frame that leaves its box where it was", () => {
  const src = window("Preview.tsx");
  assert.match(src, /className=\{`\$\{MENU_PANEL_CLASS\}/);
  hasAll(list(src, "relative", "hover:bg-fill-2"), "rounded-[6px] material:rounded-[12px]");
  const tile = list(src, "w-full", "flex-col", "gap-1.5");
  hasAll(tile, "rounded-[6px] material:rounded-[12px] pressable-wide focus-visible:bg-fill-2");
  assert.ok(!tile.includes("pressable"), "no .pressable: its press scale would move the slots under the thumbnails");
  hasAll(list(src, "absolute", "end-1.5"), "rounded-[4px] material:rounded-full");
  // The frame: as far out as it pads in, so the slot inside keeps its place and size; the slot itself stays square.
  const frame = /<span className="([^"]*)">\s*<span data-slot/.exec(src);
  assert.ok(frame, "no frame right around the slot");
  hasAll(frame[1].split(/\s+/), "flex material:-m-1 material:p-1 material:rounded-[8px] material:bg-fill-1");
  const slot = /<span data-slot=\{win\.id\} className="([^"]*)"/.exec(src);
  assert.ok(slot && !/rounded/.test(slot[1]), "the slot is never rounded");
});

test("the Widgets page's versions are Material radio cards: rounded, the chosen one tonal in secondary-container with a primary ring", () => {
  const src = readFileSync(join(import.meta.dirname, "WidgetsPage.tsx"), "utf8");
  const card = /role="radio"[\s\S]*?className=\{`([^`]*)`\}/.exec(src);
  assert.ok(card, "no version card");
  const classes = card[1];
  for (const c of ["rounded-[10px]", "material:rounded-[16px]", "material:p-1", "ring-2 ring-accent", "material:bg-secondary-container material:ring-primary", "material:hover:bg-fill-2"]) assert.ok(classes.includes(c), c);
  assert.match(src, /i === chosen \? "text-label material:text-on-secondary-container" : "text-label-2"/);
  // The sample's surface inside a 16 px card with 4 px around it: 12 px corners under Material.
  assert.match(src, /className="flex h-11 items-center rounded-\[10px\] px-2 material:rounded-\[12px\]"/);
});

test("the bar's new faces measure their tabular figures as the page draws them, which under Material is Google Sans Flex's tnum", () => {
  const weather = window("WeatherFaces.tsx");
  assert.match(weather, /const widestTemp = \(font\?: string\) => measureTabular\(WIDEST\.temp\.replace\(\/\[0-9\]\/g, "8"\), font\);/);
  const clock = window("BarClock.tsx");
  assert.match(clock, /measureTabular\(formatDiff\(zoneDiff\(Date\.now\(\), zone\)\)\.replace\("-", "\+"\)\)/);
  assert.doesNotMatch(clock, /measureText/);
});

test("under Material the bar's new faces draw on role tokens: tracks and the analog dial in secondary-container, the dial's hands in primary", () => {
  const ring = window("TimerRing.tsx");
  assert.match(ring, /strokeOpacity=\{0\.25\} strokeWidth="2" className="material:stroke-secondary-container material:\[stroke-opacity:1\]"/);
  const analog = from(window("BarClock.tsx"), "BarAnalog");
  assert.match(analog, /<circle r="19" fill="var\(--color-fill-2\)" className="material:fill-secondary-container" \/>/);
  assert.match(analog, /stroke="var\(--color-label-3\)"[^>]*className="material:stroke-on-secondary-container"/);
  assert.equal([...analog.matchAll(/stroke="var\(--color-label\)"[^>]*className="material:stroke-primary"/g)].length, 2);
  assert.match(analog, /<circle r="2\.4" fill="var\(--color-label\)" className="material:fill-primary" \/>/);
  // The inline colour-mix track gives way to secondary-container only under Material, so Crest's stays as it is.
  assert.match(window("ReadingFaces.tsx"), /className="relative block h-1 overflow-hidden rounded-full material:bg-secondary-container!"/);
});
