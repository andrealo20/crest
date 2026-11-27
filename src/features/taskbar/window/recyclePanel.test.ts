import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the Recycle Bin's panel reads the bin again as it opens, not only when Windows reports a change", () => {
  // A notice that never came (#107) left the panel with the count the bar had; opening it asks Windows again (recycle.rs).
  assert.match(read("./RecyclePanel.tsx"), /useEffect\(\(\) => \{\s*void taskbar\.recycle\(true\)/);
  assert.match(read("../../../platform/services.ts"), /recycle: \(fresh = false\)[^\n]*invoke<RecycleBin \| null>\("taskbar_recycle", \{ fresh \}\)/);
  assert.match(read("../../../../src-tauri/src/taskbar/recycle.rs"), /pub async fn taskbar_recycle\(app: AppHandle, fresh: Option<bool>\)/);
});
