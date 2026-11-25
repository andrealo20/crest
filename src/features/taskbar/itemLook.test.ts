import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { itemLayer, markShape, markThick, marks } from "./itemLook.ts";
import { contrast, parseColor } from "../themes/color.ts";
import { materialInk, resolveMaterial } from "../themes/material.ts";
import { BUILT_IN_THEMES } from "../themes/themes.ts";

test("each mark style: the mark in front is wider than the open one, and Dot keeps today's 3 and 16", () => {
  for (const style of ["dot", "large", "line"] as const) {
    const { dot, bar } = markShape(style);
    assert.ok(bar.w > dot.w, style);
    assert.ok(markThick(style) >= 3, style);
  }
  assert.deepEqual(markShape("dot"), { dot: { w: 3, h: 3 }, bar: { w: 16, h: 3 } });
});

test("the marks under an app: Crest's of today, and Material's pill in place of the long mark in front", () => {
  const none = { dot: false, bar: false, pill: false };
  assert.deepEqual(marks("open", "crest"), { dot: true, bar: false, pill: false });
  assert.deepEqual(marks("front", "crest"), { dot: false, bar: true, pill: false });
  assert.deepEqual(marks("attention", "crest"), { dot: false, bar: true, pill: false });
  assert.deepEqual(marks("none", "crest"), none);
  assert.deepEqual(marks("open", "material"), { dot: true, bar: false, pill: false });
  assert.deepEqual(marks("front", "material"), { dot: false, bar: false, pill: true });
  assert.deepEqual(marks("attention", "material"), { dot: false, bar: true, pill: false });
  assert.deepEqual(marks("none", "material"), none);
});

test("the pill and the state layer: as wide as the button, centred, as tall as an M3 indicator, or the whole tile", () => {
  assert.deepEqual(itemLayer({ size: 24, width: 40 }), { left: 0, right: 0, top: "50%", height: 32, marginTop: -16, borderRadius: 16 });
  assert.deepEqual(itemLayer({ size: 24, width: 30 }), { left: 0, right: 0, top: "50%", height: 30, marginTop: -15, borderRadius: 15 });
  assert.deepEqual(itemLayer({ size: 24, width: 120, layer: 30 }), { left: 0, right: 0, top: "50%", height: 30, marginTop: -15, borderRadius: 15 });
  assert.deepEqual(itemLayer({ size: 24, width: 40, tile: { radius: 16 } }), { inset: 0, borderRadius: 16 });
});

const window = (name: string) => readFileSync(join(import.meta.dirname, "window", name), "utf8");

test("Item draws the pill and the state layer only under Material, the layer lit by the bar's hovered state and never by :hover", () => {
  const item = window("Item.tsx");
  assert.match(item, /\{material &&[^}]*data-front-pill/);
  const layer = /material && <span[^\n]*m3-layer[^\n]*/.exec(item);
  assert.ok(layer, "no state layer drawn under a material && branch");
  assert.match(layer[0], /data-hover=\{lifted \|\| undefined\}/);
  // The window lets the pointer through off its zones and the page never sees pointerleave there, so a :hover would stay lit.
  assert.doesNotMatch(layer[0], /hover:/);
  assert.equal(item.match(/data-front-pill/g)?.length, 1);
  assert.equal(item.match(/m3-layer/g)?.length, 1);
  assert.match(window("Status.tsx"), /layer=\{pill\?\.height\}/);
});

test("the bar's name reads at 4.5:1 as an M3 tooltip, on the page's theme and on the closed notch's ink", () => {
  for (const t of BUILT_IN_THEMES) {
    for (const level of [0, 1] as const) {
      for (const r of [resolveMaterial(t, { contrast: level }), materialInk(t, { contrast: level })]) {
        const notch = parseColor(r.vars["--color-notch"])!;
        for (const bg of ["--color-label", "--color-red"]) {
          const ratio = contrast(notch, parseColor(r.vars[bg])!);
          assert.ok(ratio >= 4.5, `${t.id}, contrast ${level}: notch on ${bg} is ${ratio.toFixed(2)}:1`);
        }
      }
    }
  }
});

test("the name bubble turns into an M3 tooltip under Material and keeps every Crest class", () => {
  const bubble = /function Bubble[\s\S]*?className=\{`([^`]*)`\}/.exec(window("Item.tsx"));
  assert.ok(bubble, "no Bubble class string");
  const classes = bubble[1];
  for (const c of ["material:rounded-[4px]", "material:shadow-none", "material:ring-0", "material:text-notch"]) assert.ok(classes.includes(c), c);
  assert.ok(classes.includes('${failed ? "text-red material:bg-red" : "text-label material:bg-label"}'));
  for (const c of ["rounded-[8px]", "bg-elevated", "shadow-[0_4px_14px_rgb(0_0_0/0.4)]", "ring-1 ring-separator", "px-2 py-1 text-footnote font-medium"]) assert.ok(classes.includes(c), c);
});

test("under Liquid Glass + a tile keeps its glass: the pill and the state layer are the centred M3 indicator, not the whole tile", () => {
  assert.match(window("Item.tsx"), /itemLayer\(\{ size: props\.size, width: props\.width \?\? props\.size \+ 16, layer: props\.layer, tile: props\.plus \? undefined : props\.tile \}\)/);
  assert.deepEqual(itemLayer({ size: 24, width: 40, tile: undefined }), { left: 0, right: 0, top: "50%", height: 32, marginTop: -16, borderRadius: 16 });
  // Every item takes it from the bar's common props: the apps, the tray, Stato, the widgets and the tools.
  assert.match(window("TaskbarWindow.tsx"), /const item = \(key: string, name: string\) => \(\{[^}]*plus: look\.look === "plus",/);
  assert.match(window("Tray.tsx"), /Pick<ItemProps, [^>]*"plus"/);
  assert.match(window("Widget.tsx"), /Pick<ItemProps, [^>]*"plus"/);
});

test("Stato's state layer rides in the lifted pill, over its fill, so it never shows as a band under it", () => {
  const item = window("Item.tsx");
  assert.match(item, /const inPill = props\.layer !== undefined;/);
  assert.match(item, /className=\{`m3-layer absolute\$\{inPill \? " inset-0 rounded-full" : ""\}`\} style=\{inPill \? undefined : shape\}/);
  assert.match(item, /\{!inPill && layer\}/);
  assert.match(item, /\{props\.children\}\s*\{inPill && layer\}\s*<\/motion\.span>/);
});

test("a window's button draws its title from the start edge, cut to its width, and finds its app's own icon by the app's key", () => {
  const item = window("Item.tsx");
  assert.match(item, /\$\{props\.labelled \? "justify-start px-2" : "justify-center"\}/);
  assert.match(item, /\$\{props\.labelled \? " min-w-0" : ""\}/);
  const bar = window("TaskbarWindow.tsx");
  assert.match(bar, /<span dir="auto" className="ms-2 min-w-0 truncate text-footnote">/);
  assert.match(bar, /magnify=\{titled \? undefined : mag\}/);
  // A window's key ends with its handle, which no icon is stored under (model.ts windowButtons).
  assert.doesNotMatch(bar, /ownIcons\[(b|cardButton)\.key\]/);
  assert.equal(bar.match(/ownIcons\[appKey\(/g)?.length, 3);
  assert.match(window("AppsPanel.tsx"), /aria-label=\{b\.title \?\? b\.name\}\s*title=\{b\.title \?\? b\.name\}/);
});

test("a hover draws only the button it leaves and the one it reaches, and a redraw of the bar leaves the marks alone", () => {
  const item = window("Item.tsx");
  const bar = window("TaskbarWindow.tsx");
  // The bar holds no hover of its own: each button reads barHover for its key, so the bar is not drawn again (4 to 5 ms a time).
  assert.doesNotMatch(bar, /setHovered|\bhovered\b/);
  assert.ok(item.includes("export const barHover = createStore<string | null>(null)"));
  assert.ok(item.includes("const lifted = useHovered(props.hover)"));
  assert.ok(bar.includes("onEnter: () => barHover.set(key)"));
  // A note or an error wins over the name, and a menu, a panel, a drag or a card hides both (label null).
  assert.ok(item.includes("const label = props.label !== undefined ? props.label : lifted ? (props.hoverLabel ?? null) : null"));
  for (const name of ["Mark", "ProgressLine", "Label"]) assert.ok(item.includes(`const ${name} = memo(function ${name}(`), name);
});

test("a window Windows keeps back says so on its button, from the button, a preview tile or the list of windows (#94)", () => {
  const bar = window("TaskbarWindow.tsx"), preview = window("Preview.tsx"), menu = window("BarMenu.tsx");
  assert.ok(bar.includes("taskbar.window(c.id, c.kind).catch(refusedOn(b))"));
  assert.ok(bar.includes('if (code === "refused") setError({ key: b.key'));
  assert.ok(bar.includes("onRefused={refusedOn(cardButton)}") && bar.includes("onRefused={refusedOn(menu.b)}"));
  for (const [name, src] of [["Preview.tsx", preview], ["BarMenu.tsx", menu]]) assert.ok(src.includes('taskbar.window(win.id, "activate").catch(onRefused)'), name);
  // Only "refused" speaks: a window closed meanwhile (not-found) stays quiet, as before.
  assert.doesNotMatch(bar, /code === "not-found"[^\n]*nach vorn/);
});
