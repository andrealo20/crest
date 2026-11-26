// Files and folders in the bar's search: the rows for what Windows' index found (src-tauri/src/file_search.rs), and a search
// that asks only for the last text typed and drops late answers to older text. Pure.

import type { FoundFile } from "../../../platform/services.ts";
import { fold } from "../../settings/search.ts";
import type { Hit } from "./model.ts";

/** The folder a path is in, for the row's second line. */
const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"))) || path;

/** The rows for the found items, names starting with the text first (the index's newest-first order otherwise). */
export function fileHits(found: readonly FoundFile[], query: string): Hit[] {
  const first = fold(query).split(/\s+/).filter(Boolean)[0] ?? "";
  return [...found]
    .sort((a, b) => Number(!fold(a.name).startsWith(first)) - Number(!fold(b.name).startsWith(first)))
    .map((f) => ({
      key: `file:${f.path}`,
      kind: "file",
      title: f.name,
      subtitle: parentOf(f.path),
      icon: { file: f.path, folder: f.folder },
      action: { do: "file", path: f.path },
      alt: { do: "reveal", path: f.path },
    }));
}

/**
 * A search that asks `find` only for the last text, `delay` ms after the typing pauses, and hands `deliver` only the answer
 * for the text asked last: an older search that answers late never shows. No text empties the files at once.
 */
export function latestSearch(find: (q: string) => Promise<FoundFile[]>, deliver: (q: string, found: FoundFile[]) => void, delay = 120): (q: string) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest = 0;
  return (q) => {
    clearTimeout(timer);
    const ask = ++latest;
    if (!q.trim()) return deliver(q, []);
    timer = setTimeout(() => {
      find(q).then(
        (found) => ask === latest && deliver(q, found),
        () => ask === latest && deliver(q, []),
      );
    }, delay);
  };
}
