import { useEffect, useRef, useState } from "react";
import { t } from "../../../i18n";
import { launcher } from "../../../platform/services";
import { AppIcon } from "../../launcher/AppIcon";
import { searchApps } from "../../launcher/apps";
import { launcherApps, loadApps, useIcons } from "../../launcher/store";
import { closePanel } from "../panel";

/** The app menu in the panel above the bar: a search over every Start menu app, and the apps below it; a click starts one. */
export function AppsView() {
  const { apps } = launcherApps.use();
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const results = apps ? searchApps(apps, query, Infinity) : [];
  const icons = useIcons(results.map((a) => a.id));

  useEffect(() => void loadApps(), []);
  useEffect(() => field.current?.focus({ preventScroll: true }), []);

  // The app started takes the keyboard itself; one that does not start leaves the panel open.
  const start = (id: string) => void launcher.open(id).then(() => closePanel(), () => {});

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex h-7 shrink-0 items-center gap-1 rounded-[8px] bg-fill-2 px-2">
        <input
          ref={field}
          value={query}
          spellCheck={false}
          autoComplete="off"
          placeholder={t("Apps durchsuchen")}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-footnote text-label outline-none placeholder:text-label-4"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
        {results.map((a) => (
          <button key={a.id} onClick={() => start(a.id)} className="flex h-9 w-full items-center gap-2.5 rounded-[8px] px-2 text-start hover:bg-fill-2">
            <AppIcon src={icons[a.id]} size={20} />
            <span className="min-w-0 flex-1 truncate text-body text-label">{a.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
