/** Overview's search line: which engine it searches with, "off" for no line. Rust builds the address (lib.rs `search_url`). */
export type SearchEngine = "google" | "bing" | "duckduckgo" | "brave";
export type SearchSetting = SearchEngine | "off";

export const SEARCH_ENGINES: { id: SearchEngine; name: string }[] = [
  { id: "google", name: "Google" },
  { id: "bing", name: "Bing" },
  { id: "duckduckgo", name: "DuckDuckGo" },
  { id: "brave", name: "Brave Search" },
];

/** A saved value that is no known engine turns the line off. */
export function normalizeSearch(saved: unknown): SearchSetting {
  return SEARCH_ENGINES.some((e) => e.id === saved) ? (saved as SearchEngine) : "off";
}

export const searchEngineName = (id: SearchEngine) => SEARCH_ENGINES.find((e) => e.id === id)?.name ?? id;

/** The engine the bar's search box searches with: Overview's, or Bing while Overview's line is off. */
export const barEngine = (s: SearchSetting): SearchEngine => (s === "off" ? "bing" : s);

/** What the search box does with its text: open a path with its app, or search the web for the text. */
export type SearchTarget = { kind: "path"; path: string } | { kind: "web"; query: string };

/**
 * A drive's path (X: alone is its root, forward slashes read as backslashes) or a network share's (\\server\share) opens, also
 * between one pair of double quotes, as File Explorer copies a path; anything else, a drive-relative c:name or a %VAR% Crest does
 * not expand among it, searches the web as typed. Null for nothing typed.
 */
export function searchTarget(text: string): SearchTarget | null {
  const typed = text.trim();
  if (!typed) return null;
  const bare = /^"(.+)"$/.exec(typed)?.[1].trim() ?? typed;
  if (/^[a-z]:$/i.test(bare)) return { kind: "path", path: `${bare}\\` };
  if (/^[a-z]:[\\/]/i.test(bare)) return { kind: "path", path: bare.replaceAll("/", "\\") };
  if (/^\\\\[^\\]+/.test(bare)) return { kind: "path", path: bare };
  return { kind: "web", query: typed };
}
