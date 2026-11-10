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
