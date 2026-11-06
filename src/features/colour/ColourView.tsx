import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Check, Copy, Eyedropper, Trash, X } from "@phosphor-icons/react";
import { fade } from "../../design/motion";
import { HeaderActions, HeaderButton } from "../../notch/header";
import { Button, Empty, Segmented, TextField } from "../../ui/controls";
import { locale, t } from "../../i18n";
import { BLACK, WHITE, contrast, type Rgba } from "../themes/color";
import { formatHex, formatHsl, formatOklch, formatRgb, formatVar, harmonies, levels, parseColour, ratioShown, readableVersion, type HarmonyId } from "./colour";
import { canPickFromScreen, colour, colourActions, pickFromScreen, picking } from "./store";

type Mode = "values" | "contrast" | "harmonies";

const ratioText = (ratio: number) => `${ratioShown(ratio).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}:1`;

const harmonyNames: Record<HarmonyId, string> = { complementary: "Komplementär", triad: "Triade", analogous: "Benachbart" };

/*
 * [■] [ #1a2b3c                ] [⌖ Pick from screen]     ← the colour: typed, pasted or picked
 *  HEX, rgb(), hsl(), oklch() or a name
 *  Values | Contrast | Harmonies                            ← in the header
 *  ● ● ● ● ● ● ●  (the last 12)                      [x] [bin]
 */
export function ColourView() {
  const { current, other, history } = colour.use();
  const pick = picking.use();
  const [mode, setMode] = useState<Mode>("values");
  const base = current ? parseColour(current) : null;
  const canPick = canPickFromScreen();

  return (
    <div className="flex h-full flex-col gap-2 px-4 pt-1 pb-3">
      <HeaderActions>
        <Segmented
          id="colour-mode"
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: "values", label: t("Werte") },
            { value: "contrast", label: t("Kontrast") },
            { value: "harmonies", label: t("Harmonien") },
          ]}
        />
      </HeaderActions>

      <div className="flex items-center gap-2.5">
        <Swatch hex={current} className="size-9" />
        <ColourField value={current} placeholder={t("Farbe")} onShow={colourActions.show} onKeep={colourActions.choose} />
        {canPick && (
          <Button primary icon={Eyedropper} disabled={pick.busy} onClick={() => void pickFromScreen("current")}>
            {pick.busy ? t("Wähle …") : t("Vom Bildschirm wählen")}
          </Button>
        )}
      </div>
      <p role={pick.failed ? "alert" : undefined} className={`min-h-4 text-caption ${pick.failed ? "text-orange" : "text-label-3"}`}>
        {pick.failed
          ? t("Die Farbe konnte nicht vom Bildschirm aufgenommen werden. Tippe sie oder füge sie ein.")
          : !canPick
            ? t("Dieses System kann keine Farbe vom Bildschirm aufnehmen. Tippe eine Farbe oder füge sie ein.")
            : t("HEX, rgb(), hsl(), oklch() oder ein Name")}
      </p>

      <div className="relative min-h-0 flex-1">
        <motion.div key={mode} className="absolute inset-0 overflow-y-auto [scrollbar-width:none]" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: fade }}>
          {!base ? (
            <Empty icon={Eyedropper} title={t("Noch keine Farbe")} text={canPick ? t("Wähle eine Farbe vom Bildschirm oder tippe eine ein.") : t("Tippe eine Farbe ein oder füge sie ein.")} />
          ) : mode === "values" ? (
            <Values c={base} />
          ) : mode === "contrast" ? (
            <Contrast c={base} other={other} canPick={canPick} busy={pick.busy} />
          ) : (
            <Harmonies c={base} />
          )}
        </motion.div>
      </div>

      <History history={history} current={current} />
    </div>
  );
}

function Swatch({ hex, className }: { hex: string | null; className: string }) {
  return <span aria-hidden className={`${className} shrink-0 rounded-[8px] ring-1 ring-separator forced-color-adjust-none ${hex ? "" : "bg-fill-1"}`} style={hex ? { background: hex } : undefined} />;
}

/**
 * Text that means a colour. A valid one shows at once (`onShow`); Enter keeps it (`onKeep`, which also
 * puts it in the history). A colour that comes from elsewhere replaces the text, unless the text already means it.
 */
function ColourField(props: { value: string | null; placeholder: string; onShow: (hex: string) => void; onKeep: (hex: string) => void }) {
  const [draft, setDraft] = useState(props.value ?? "");
  const parsed = parseColour(draft);
  const invalid = draft.trim() !== "" && !parsed;
  useEffect(() => {
    if (props.value && !(parsed && formatHex(parsed) === props.value)) setDraft(props.value);
    // Only a change of the colour itself; the draft is read as it stands.
  }, [props.value]);

  return (
    <div className={`min-w-0 flex-1 ${invalid ? "[&>div]:ring-1 [&>div]:ring-red" : ""}`}>
      <TextField
        value={draft}
        width="w-full"
        placeholder={props.placeholder}
        onChange={(v) => {
          setDraft(v);
          const p = parseColour(v);
          if (p) props.onShow(formatHex(p));
        }}
        onSubmit={() => parsed && props.onKeep(formatHex(parsed))}
      />
      <span className="sr-only" role="status">
        {invalid ? t("Keine gültige Farbe") : ""}
      </span>
    </div>
  );
}

/** Copies on click and says so for a moment ("Copied", or "Copy failed" when the clipboard is refused). */
function useCopy() {
  const [done, setDone] = useState<{ id: string; ok: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = (id: string, text: string) => {
    window.clearTimeout(timer.current);
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(() => true, () => false)
      .then((ok) => {
        setDone({ id, ok });
        timer.current = window.setTimeout(() => setDone(null), 1400);
      });
  };
  return [done, copy] as const;
}

function Values({ c }: { c: Rgba }) {
  const [done, copy] = useCopy();
  const rows: [string, string][] = [
    ["HEX", formatHex(c)],
    ["RGB", formatRgb(c)],
    ["HSL", formatHsl(c)],
    ["OKLCH", formatOklch(c)],
    [t("CSS-Variable"), formatVar(c)],
  ];
  return (
    <div className="flex flex-col">
      {rows.map(([label, value]) => (
        <button key={label} title={t("Kopieren")} onClick={() => copy(label, value)} className="pressable pressable-fill pressable-wide flex h-8 shrink-0 items-center gap-3 rounded-[8px] px-2 text-start">
          <span className="w-24 shrink-0 text-caption text-label-3">{label}</span>
          <span className="tabular min-w-0 flex-1 truncate font-mono text-footnote text-label">{value}</span>
          <span className={`flex shrink-0 items-center gap-1 text-caption ${done?.id === label ? (done.ok ? "text-green" : "text-red") : "text-label-3"}`}>
            {done?.id === label ? (
              done.ok ? (
                <>
                  <Check size={12} weight="bold" /> {t("Kopiert")}
                </>
              ) : (
                <>
                  <X size={12} weight="bold" /> {t("Kopieren fehlgeschlagen")}
                </>
              )
            ) : (
              <Copy size={13} weight="bold" />
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

function Contrast({ c, other, canPick, busy }: { c: Rgba; other: string | null; canPick: boolean; busy: boolean }) {
  const second = other ? parseColour(other) : null;
  return (
    <div className="flex flex-col gap-1">
      <ContrastRow fg={c} bg={WHITE} label={<span className="text-footnote text-label-2">{t("Auf Weiß")}</span>} />
      <ContrastRow fg={c} bg={BLACK} label={<span className="text-footnote text-label-2">{t("Auf Schwarz")}</span>} />
      <ContrastRow
        fg={c}
        bg={second}
        label={
          <div className="flex items-center gap-1">
            <ColourField value={other} placeholder={t("Zweite Farbe")} onShow={colourActions.setOther} onKeep={colourActions.setOther} />
            {canPick && (
              <HeaderButton label={t("Zweite Farbe vom Bildschirm wählen")} disabled={busy} onClick={() => void pickFromScreen("other")}>
                <Eyedropper size={14} weight="bold" />
              </HeaderButton>
            )}
          </div>
        }
      />
    </div>
  );
}

/**
 * [Aa] [Aa]  4.48:1  [AA] [AA large] [AAA]       ← `fg` on `bg`, and the other way round
 *  Darker ■ #6b6b6b  4.95:1  [Use]                ← only while AA is missed
 * Without a `bg` the row waits for one.
 */
function ContrastRow(props: { fg: Rgba; bg: Rgba | null; label: ReactNode }) {
  const { fg, bg } = props;
  const ratio = bg ? contrast(fg, bg) : null;
  const ok = ratio === null ? null : levels(ratio);
  const fix = bg ? readableVersion(fg, bg) : null;
  const fixHex = fix && formatHex(fix.colour);
  return (
    <div className="flex flex-col rounded-[10px] bg-fill-1 px-2.5 py-1.5">
      <div className="flex min-h-8 items-center gap-2.5">
        <div className="w-36 shrink-0">{props.label}</div>
        <div className="flex shrink-0 gap-1">
          <Sample fg={fg} bg={bg} />
          <Sample fg={bg} bg={fg} />
        </div>
        <span className="tabular w-16 shrink-0 text-end text-body font-semibold text-label">{ratio === null ? "" : ratioText(ratio)}</span>
        <div className="flex min-w-0 items-center gap-1">
          <Level name="AA" ok={ok?.aa} />
          <Level name={t("AA groß")} ok={ok?.aaLarge} />
          <Level name="AAA" ok={ok?.aaa} />
        </div>
      </div>
      {fix && fixHex && (
        <div className="flex h-7 items-center gap-2 text-caption text-label-2">
          <span>{fix.lighter ? t("Heller für AA") : t("Dunkler für AA")}</span>
          <Swatch hex={fixHex} className="size-4" />
          <span className="tabular font-mono text-label">{fixHex}</span>
          <span className="tabular text-label-3">{ratioText(fix.ratio)}</span>
          <button onClick={() => colourActions.choose(fixHex)} aria-label={t("{hex} übernehmen", { hex: fixHex })} className="pressable pressable-fill ms-auto h-6 rounded-full px-2.5 text-caption font-medium text-label">
            {t("Übernehmen")}
          </button>
        </div>
      )}
    </div>
  );
}

/** "Aa" in `fg` on `bg`; an empty box until both are known. */
function Sample({ fg, bg }: { fg: Rgba | null; bg: Rgba | null }) {
  const on = fg && bg;
  return (
    <span
      aria-hidden
      className={`flex h-8 w-12 items-center justify-center rounded-[8px] text-body font-semibold ring-1 ring-separator forced-color-adjust-none ${on ? "" : "bg-fill-1"}`}
      style={on ? { background: formatRgb(bg), color: formatRgb(fg) } : undefined}
    >
      {on && "Aa"}
    </span>
  );
}

function Level({ name, ok }: { name: string; ok: boolean | undefined }) {
  const state = ok === undefined ? "" : ok ? t("erfüllt") : t("nicht erfüllt");
  return (
    <span
      role="img"
      aria-label={`${name}: ${state}`}
      className={`flex h-5 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-caption font-medium ${ok === undefined ? "bg-fill-1 text-label-4" : ok ? "bg-green/15 text-green" : "bg-fill-2 text-label-3"}`}
    >
      {ok !== undefined && (ok ? <Check size={10} weight="bold" /> : <X size={10} weight="bold" />)}
      {name}
    </span>
  );
}

function Harmonies({ c }: { c: Rgba }) {
  return (
    <div className="flex flex-col gap-1">
      {harmonies(c).map((h) => (
        <div key={h.id} className="flex items-center gap-3 rounded-[10px] bg-fill-1 px-2.5 py-1.5">
          <span className="w-28 shrink-0 text-footnote text-label-2">{t(harmonyNames[h.id])}</span>
          <div className="flex gap-1.5">
            {h.colours.map((x, i) => {
              const hex = formatHex(x);
              return (
                <button key={i} onClick={() => colourActions.choose(hex)} title={t("Übernehmen")} aria-label={`${t(harmonyNames[h.id])}: ${hex}`} className="pressable flex w-[72px] flex-col items-center gap-1">
                  <Swatch hex={hex} className="h-7 w-full" />
                  <span className="tabular font-mono text-caption text-label-2">{hex}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function History({ history, current }: { history: string[]; current: string | null }) {
  return (
    <div className="flex min-h-7 items-center gap-1.5">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" role="group" aria-label={t("Zuletzt gewählte Farben")}>
        {history.length === 0 ? (
          <span className="text-caption text-label-4">{t("Gewählte Farben erscheinen hier")}</span>
        ) : (
          history.map((hex) => (
            <button
              key={hex}
              title={hex}
              aria-label={hex}
              aria-pressed={hex === current}
              onClick={() => colourActions.show(hex)}
              className={`pressable size-5 rounded-full forced-color-adjust-none ${hex === current ? "ring-2 ring-label ring-offset-2 ring-offset-notch" : "ring-1 ring-separator"}`}
              style={{ background: hex }}
            />
          ))
        )}
      </div>
      <HeaderButton label={t("Aus dem Verlauf entfernen")} disabled={!current || !history.includes(current)} onClick={() => current && colourActions.forget(current)}>
        <X size={14} weight="bold" />
      </HeaderButton>
      <HeaderButton label={t("Verlauf leeren")} disabled={history.length === 0} onClick={colourActions.clearHistory}>
        <Trash size={14} weight="bold" />
      </HeaderButton>
    </div>
  );
}
