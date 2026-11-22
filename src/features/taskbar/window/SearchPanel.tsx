import { useState } from "react";
import { MagnifyingGlass } from "../../../ui/iconset";
import { TextField } from "../../../ui/controls";
import { t } from "../../../i18n";
import { openFile, webSearch } from "../../../platform/services";
import { settings } from "../../../settings/store";
import { barEngine, searchEngineName, searchTarget } from "../../overview/search";
import { closePanel } from "../panel";

/**
 * The search box's field in the panel over its button: Enter opens a typed path with its app (a drive's folder, a network share) or
 * searches the web with Overview's search engine, Bing while Overview's line is off, and the panel closes. A path that is not there
 * leaves it open, the hint saying so in red until the next key. The hint under the field says which of the two Enter does.
 */
export function SearchPanel() {
  const engine = barEngine(settings.use().productivity.search);
  const [query, setQuery] = useState("");
  const [missing, setMissing] = useState(false);
  const target = searchTarget(query);
  const submit = () => {
    if (!target) return;
    // Opened by Windows as Overview's files are (lib.rs `open_path`, which checks the path first); a typed program runs too.
    if (target.kind === "path") return void openFile(target.path).then(closePanel, () => setMissing(true));
    void webSearch(engine, target.query).catch(() => {});
    closePanel();
  };
  return (
    <div className="flex h-full flex-col justify-center gap-2 px-3">
      <div className="flex items-center gap-2">
        <MagnifyingGlass size={14} weight="bold" className="shrink-0 text-label-3" />
        <TextField
          value={query}
          onChange={(v) => {
            setQuery(v);
            setMissing(false);
          }}
          onSubmit={submit}
          placeholder={t("Im Web suchen oder Pfad öffnen")}
          width="flex-1"
          autoFocus
          invalid={missing}
        />
      </div>
      <p role="status" className={`truncate text-caption ${missing ? "text-red" : "text-label-3"}`}>
        {missing ? t("Pfad nicht gefunden") : target?.kind === "path" ? t("Enter öffnet den Pfad") : t("Enter sucht mit {engine}", { engine: searchEngineName(engine) })}
      </p>
    </div>
  );
}
