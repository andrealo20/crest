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
