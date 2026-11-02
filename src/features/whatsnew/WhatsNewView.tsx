import { useEffect, useState } from "react";
import { Heart } from "@phosphor-icons/react";
import { between, changelog, useUnseen } from "../../lib/changelog";
import { installUpdate, update } from "../../lib/update";
import { openSponsors } from "../../platform/services";
import { t } from "../../i18n";
import { Button } from "../../ui/controls";
import { ChangelogList } from "./ChangelogList";
import type { WhatsNew } from "./model";
import { dismissWhatsNew, opened } from "./store";

/*
 *   New in Crest 0.3.2
 *   0.3.2                    2 Nov 2026
 *   · A month in the Calendar …
 *   ─────────────────────────────────────
 *   Crest is free … support it.   [♥ Support on GitHub]
 */
export function WhatsNewView() {
  const u = update.use();
  const unseen = useUnseen();
  // Opening the page marks its notice seen, which empties `unseen`: what to show is taken once, on mount.
  const [news] = useState<WhatsNew>(() => opened.get() ?? (unseen[0] ? { kind: "updated", version: unseen[0].version } : null));
  const [installed] = useState(() => (unseen.length ? unseen : changelog.filter((e) => e.version === u.current)));
  useEffect(() => {
    if (news) dismissWhatsNew(news);
  }, [news]);

  const available = news?.kind === "available" && (u.phase === "available" || u.phase === "downloading");
  const entries = available ? (u.notes && u.current && u.version ? between(u.notes, u.current, u.version) : []) : installed;
  const version = available ? u.version : (news?.version ?? u.current);

  return (
    <div className="flex h-full flex-col px-4 pt-1 pb-3">
      <h2 className="px-3 pb-1 text-title font-semibold text-label">
        {available ? t("Crest {v} ist verfügbar", { v: version ?? "" }) : t("Neu in Crest {v}", { v: version ?? "" })}
      </h2>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 [scrollbar-width:none]" style={{ maskImage: "linear-gradient(180deg, #000 calc(100% - 20px), transparent)" }}>
        <ChangelogList entries={entries} />
      </div>
      <div className="mx-3 flex items-center gap-3 border-t border-separator pt-3">
        <p className="min-w-0 flex-1 text-caption text-label-3">{t("Crest ist kostenlos, ohne Werbung, und wird von einer Person entwickelt. Wenn es dir gefällt, kannst du es unterstützen.")}</p>
        <Button icon={Heart} primary={!available} onClick={openSponsors}>
          {t("Auf GitHub unterstützen")}
        </Button>
        {available &&
          (u.phase === "downloading" ? (
            <span className="tabular shrink-0 text-footnote text-label-2">{t("Wird geladen … {n} %", { n: Math.round(u.progress * 100) })}</span>
          ) : (
            <Button primary onClick={() => void installUpdate()}>
              {t("Jetzt aktualisieren")}
            </Button>
          ))}
      </div>
    </div>
  );
}
