import { useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { webSearch } from "../../platform/services";
import { TextField } from "../../ui/controls";
import { t } from "../../i18n";
import { searchEngineName, type SearchEngine } from "./search";

/** Height Overview grows by while the line shows (src/notch/tabs.ts): the 28 px field and the 10 px gap above it. */
export const SEARCH_LINE_H = 38;

/** A field that searches the web with the chosen engine in the default browser; Enter searches and empties it. */
export function SearchLine({ engine }: { engine: SearchEngine }) {
  const [query, setQuery] = useState("");
  const search = () => {
    if (!query.trim()) return;
    void webSearch(engine, query).catch(() => {});
    setQuery("");
  };
  return (
    <div className="flex shrink-0 items-center gap-2">
      <MagnifyingGlass size={13} weight="bold" className="shrink-0 text-label-3" />
      <TextField value={query} onChange={setQuery} onSubmit={search} placeholder={t("Mit {engine} im Web suchen", { engine: searchEngineName(engine) })} width="flex-1" />
    </div>
  );
}
