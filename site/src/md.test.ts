import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inline, markdown } from "./md.ts";

test("headings, lists and paragraphs", () => {
  assert.equal(markdown("# Title\n\nOne\nline.\n\n- a\n- b\n\n## Next"), "<h1>Title</h1>\n<p>One line.</p>\n<ul><li>a</li><li>b</li></ul>\n<h2>Next</h2>");
});

test("inline marks, and code keeps its stars", () => {
  assert.equal(inline("**Settings** in *Pictures* and `a*b*c`"), "<strong>Settings</strong> in <em>Pictures</em> and <code>a*b*c</code>");
  assert.equal(inline("[the site](https://example.com/x)"), '<a href="https://example.com/x">the site</a>');
});

test("markup in the source is shown, never run", () => {
  assert.equal(inline('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(inline("[x](javascript:alert(1))"), "[x](javascript:alert(1))");
});

test("a table with a header row", () => {
  const html = markdown("| A | B |\n| --- | --- |\n| 1 | `2` |");
  assert.equal(html, '<div class="table"><table><thead><tr><th scope="col">A</th><th scope="col">B</th></tr></thead><tbody><tr><td>1</td><td><code>2</code></td></tr></tbody></table></div>');
});

test("PRIVACY.md renders with no Markdown left over", () => {
  const html = markdown(readFileSync(new URL("../../PRIVACY.md", import.meta.url), "utf8"));
  assert.match(html, /<h1>Crest privacy policy<\/h1>/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html.replace(/<code>[^<]*<\/code>/g, ""), /\*\*|^#|\]\(/m);
});
