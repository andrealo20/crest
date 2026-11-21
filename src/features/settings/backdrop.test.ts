import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Checkouts on Windows have CRLF line ends.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const view = read("./SettingsView.tsx");
const materialAt = view.indexOf("  if (material)\n    return (");
const crestAt = view.indexOf("\n  return (", materialAt + 1);
const materialBranch = view.slice(materialAt, crestAt);
const crestBranch = view.slice(crestAt, view.indexOf("\nfunction SearchResults"));

test("the backdrop is on only for the settings window with the switch on, first inside the Material root", () => {
  assert.ok(materialAt > 0 && crestAt > materialAt, "both branches found");
  // Read into a variable first: a hook behind && would run on some renders only.
  assert.match(view, /const contours = settings\.use\(\)\.themes\.contours;\n\s*const backdrop = !!chrome && contours;/);
  assert.match(view, /const \[contoursFailed, setContoursFailed\] = useState\(false\);/);
  const root = materialBranch.lastIndexOf("<div", materialBranch.indexOf("ref={root}"));
  const rootTag = materialBranch.slice(root, materialBranch.indexOf(">", materialBranch.indexOf("data-contours", root)) + 1);
  assert.ok(rootTag.includes('${backdrop ? "isolate" : ""}'), rootTag);
  assert.ok(rootTag.includes("data-contours={(backdrop && !contoursFailed) || undefined}"), rootTag);
  const after = materialBranch.slice(root + rootTag.length).trimStart();
  assert.ok(after.startsWith("{backdrop && <Contours page={viewKey} onFail={setContoursFailed} />}"), after.slice(0, 80));
});

test("the still light comes back in every layout when WebGL fails, and only in the list when the switch is off", () => {
  assert.ok(view.includes('const light = backdrop ? (contoursFailed ? layout : null) : layout === "list" ? "list" : null;'));
  const gradient = 'background: "radial-gradient(closest-side, var(--color-primary), transparent)", opacity: 0.1';
  for (const [name, size] of [["list", "w-[176px]"], ["rail", "w-14"], ["top", "top-14 h-14"]]) {
    const at = materialBranch.indexOf(`light === "${name}" &&`);
    assert.ok(at > 0, name);
    const branch = materialBranch.slice(at, materialBranch.indexOf("/>", at));
    assert.ok(branch.includes(size), `${name}: ${branch}`);
    assert.ok(branch.includes(gradient), `${name}: ${branch}`);
  }
});

test("the list's navigation is opaque over the lines and the rail's is not", () => {
  const navs = [...materialBranch.matchAll(/\$\{layout === "rail" \? "([^"]*)" : "([^"]*)"\}/g)];
  assert.equal(navs.length, 1);
  assert.ok(navs[0][2].includes("contours:bg-elevated"), navs[0][2]);
  assert.ok(!navs[0][1].includes("contours:"), navs[0][1]);
});

test("the Crest branch has no backdrop", () => {
  for (const word of ["Contours", "backdrop", "data-contours"]) assert.ok(!crestBranch.includes(word), word);
});

test("a group is opaque over the lines, after its roomy fill", () => {
  const controls = read("../../ui/controls.tsx");
  const group = controls.slice(controls.indexOf("export function Group("));
  const cls = group.match(/<motion\.section [^>]*className="([^"]*)"/)![1];
  assert.ok(cls.includes("roomy:bg-fill-1"), cls);
  assert.ok(cls.indexOf("contours:bg-elevated") > cls.indexOf("roomy:bg-fill-1"), cls);
});

test("the switch for the backdrop sits under the style cards, under Material only", () => {
  const themes = read("../themes/ThemeSettings.tsx");
  const choice = themes.slice(themes.indexOf("function StyleChoice("), themes.indexOf("function CrestThumb("));
  const cards = choice.indexOf("<StyleCards");
  const row = choice.indexOf('chosen === "material" &&', cards);
  assert.ok(cards > 0 && row > cards, "row after the cards");
  const rest = choice.slice(row);
  assert.ok(
    rest.includes(
      '<Row icon="wallpaper" label={t("Bewegter Hintergrund")} hint={t("Höhenlinien in den Farben des Themes hinter dem Einstellungsfenster, die bei jedem Seitenwechsel weiterziehen")}>',
    ),
  );
  assert.match(rest, /<Switch\s+label=\{t\("Bewegter Hintergrund"\)\}\s+checked=\{[\w.]*contours\}/);
  assert.ok(rest.includes("themes: { ...cur.themes, contours }"));
});

test("the navigation's mark morphs per page in the settings window only, with the page's icon over it", () => {
  const at = view.indexOf("function NavMark(");
  assert.ok(at > 0, "NavMark found");
  const body = view.slice(at, view.indexOf("\nfunction ", at + 1));
  for (const s of ["brandOf(id)", "shapePoints(", "<MorphPath", "fill-primary", "forced-colors:fill-[CanvasText]", "text-on-primary", "forced-colors:text-[Canvas]", "aria-hidden", "transition={crossfade}"])
    assert.ok(body.includes(s), s);
  assert.doesNotMatch(body, /\bt\(/, "no new text in the mark");
  const navAt = view.indexOf("const materialNav = (");
  const nav = view.slice(navAt, view.indexOf("const header =", navAt));
  const uses = [...view.matchAll(/<NavMark/g)].map((m) => m.index!);
  assert.ok(uses.length > 0, "NavMark used");
  for (const use of uses) {
    assert.ok(use > navAt && use < navAt + nav.length, "only inside materialNav");
    const before = view.slice(0, use);
    assert.ok(/\{chrome && \(?\s*$/.test(before), "only after chrome &&");
    const tag = view.slice(use, view.indexOf("/>", use));
    assert.ok(tag.includes("id={viewKey}"), tag);
    assert.ok(tag.includes("size={compact ? 40 : 54}"), tag);
  }
  // Each of the two functions keeps its own doc comment right above it.
  assert.match(view, /\n\/\*\* The settings window's mark[^\n]*\*\/\nfunction NavMark\(/);
  assert.match(view, /\n\/\*\* One settings page's groups[^\n]*\*\/\nfunction PageContent\(/);
});
