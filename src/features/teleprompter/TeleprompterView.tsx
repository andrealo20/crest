import { useMemo, useState } from "react";
import { Play } from "@phosphor-icons/react";
import { HeaderActions, HeaderButton } from "../../notch/header";
import { locale, t } from "../../i18n";
import { MAX_CHARS, countWords, formatClock, clampText } from "./model";
import { prompter, setPrompter } from "./store";
import { Reader } from "./Reader";

/**
 * Prompter: a script that scrolls under the webcam. Opens on the script when there is one (paused, so nothing moves
 * until Space or the button), on the empty field when there is not. Everything stays on this computer.
 */
export function TeleprompterView() {
  const { text } = prompter.use();
  const words = useMemo(() => countWords(text), [text]);
  const [mode, setMode] = useState<"edit" | "read">(() => (countWords(prompter.get().text) > 0 ? "read" : "edit"));
  // Keys go to the reader once the user has asked for it with a click, not when the notch merely opens on it.
  const [asked, setAsked] = useState(false);

  if (mode === "read" && words > 0) return <Reader words={words} focus={asked} onEdit={() => setMode("edit")} />;
  return (
    <Editor
      words={words}
      onRead={() => {
        setAsked(true);
        setMode("read");
      }}
    />
  );
}

function Editor({ words, onRead }: { words: number; onRead: () => void }) {
  const { text, wpm } = prompter.use();
  const number = new Intl.NumberFormat(locale());

  return (
    <div className="flex h-full flex-col px-4 pt-1 pb-1">
      <HeaderActions>
        <HeaderButton label={t("Lesen")} disabled={words === 0} onClick={onRead}>
          <Play size={14} weight="fill" />
        </HeaderButton>
      </HeaderActions>
      <textarea
        value={text}
        autoFocus
        dir="auto"
        maxLength={MAX_CHARS}
        aria-label={t("Skript")}
        placeholder={t("Skript hier einfügen oder schreiben, wird lokal gespeichert")}
        onChange={(e) => setPrompter({ text: clampText(e.target.value) })}
        className="min-h-0 flex-1 resize-none rounded-[12px] bg-fill-1 px-3 py-2.5 text-body text-label outline-none [scrollbar-width:none] placeholder:text-label-4"
      />
      <div className="mt-1.5 flex h-4 items-center justify-between gap-3 px-1 text-caption text-label-3">
        <span className="tabular truncate">
          {number.format(words)} {words === 1 ? t("Wort") : t("Wörter")}
          {words > 0 && ` · ${t("ca. {time} bei {n} WPM", { time: formatClock((words / wpm) * 60), n: wpm })}`}
        </span>
        <span className={`tabular shrink-0 ${text.length >= MAX_CHARS ? "text-orange" : ""}`}>
          {t("{n} von {max} Zeichen", { n: number.format(text.length), max: number.format(MAX_CHARS) })}
        </span>
      </div>
    </div>
  );
}
