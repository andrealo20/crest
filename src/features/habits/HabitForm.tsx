import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Trash } from "@phosphor-icons/react";
import { HeaderButton } from "../../notch/header";
import { settings } from "../../settings/store";
import { Button, Switch } from "../../ui/controls";
import { hueVar } from "../themes/hues";
import { locale, t } from "../../i18n";
import { ALL_DAYS, HABIT_HUES, NAME_MAX, type Habit, type HabitHue } from "./model";
import { habitActions, habits } from "./store";

const HUE_NAMES: Record<HabitHue, string> = { red: "Rot", orange: "Orange", amber: "Bernstein", green: "Grün", teal: "Türkis", blue: "Blau", violet: "Violett", pink: "Pink" };
/** Monday first; the number is the weekday as Date.getDay() gives it. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/** A day's name in the interface language ("M" or "Monday"). 1 January 2024 was a Monday. */
const weekdayName = (day: number, width: "narrow" | "long") => new Intl.DateTimeFormat(locale(), { weekday: width }).format(new Date(2024, 0, 1 + ((day + 6) % 7)));

/*
 *  [ Habit name                    12/40 ]  [Cancel] [Save]
 *  ● ● ● ● ● ● ● ●                          [↑] [↓] [🗑]
 *  [M][T][W][T][F][S][S]  [Every day]
 *  Tick when the water goal is reached                  ◯
 */
export function HabitForm({ habit, onClose }: { habit?: Habit; onClose: () => void }) {
  const list = habits.use().habits;
  const waterTool = settings.use().tools.some((x) => x.id === "water" && x.enabled);
  const [name, setName] = useState(habit?.name ?? "");
  // A new habit starts with a colour no other habit has yet.
  const [hue, setHue] = useState<HabitHue>(() => habit?.hue ?? HABIT_HUES.find((h) => !list.some((x) => x.hue === h)) ?? HABIT_HUES[0]);
  const [days, setDays] = useState<number[]>(habit?.days ?? ALL_DAYS);
  const [water, setWater] = useState(habit?.water === true);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const id = window.setTimeout(() => setConfirm(false), 3000);
    return () => window.clearTimeout(id);
  }, [confirm]);

  const index = habit ? list.findIndex((h) => h.id === habit.id) : -1;
  const valid = name.trim().length > 0;
  const everyDay = days.length === 7;
  const save = () => {
    if (!valid) return;
    const draft = { name, hue, days, water };
    if (habit) habitActions.update(habit.id, draft);
    else if (!habitActions.add(draft)) return;
    onClose();
  };
  // At least one day stays on.
  const toggleDay = (d: number) => setDays((cur) => (cur.includes(d) ? (cur.length > 1 ? cur.filter((x) => x !== d) : cur) : [...cur, d].sort()));

  return (
    <div
      className="flex h-full flex-col gap-2 px-4 pt-1 pb-2"
      onKeyDown={(e) => {
        // Escape closes the form first and stops there, so it does not also close the notch.
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[12px] bg-fill-1 px-3">
          <input
            autoFocus
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder={t("Name der Gewohnheit")}
            aria-label={t("Name der Gewohnheit")}
            className="min-w-0 flex-1 bg-transparent text-body text-label outline-none placeholder:text-label-4"
          />
          <span className="tabular text-caption text-label-3">{name.length}/{NAME_MAX}</span>
        </div>
        <Button onClick={onClose}>{t("Abbrechen")}</Button>
        <Button primary disabled={!valid} onClick={save}>
          {t("Speichern")}
        </Button>
      </div>

      <div className="flex h-7 items-center justify-between gap-3">
        <div className="flex items-center gap-1.5" role="radiogroup" aria-label={t("Farbe")}>
          {HABIT_HUES.map((h) => (
            <button
              key={h}
              role="radio"
              aria-checked={hue === h}
              aria-label={t(HUE_NAMES[h])}
              title={t(HUE_NAMES[h])}
              onClick={() => setHue(h)}
              className={`pressable size-5 rounded-full outline-offset-2 outline-label ${hue === h ? "outline-2" : ""}`}
              style={{ backgroundColor: hueVar(h) }}
            />
          ))}
        </div>
        {habit && (
          <div className="flex items-center gap-1">
            <HeaderButton label={t("Nach oben")} disabled={index <= 0} onClick={() => habitActions.move(habit.id, -1)}>
              <ArrowUp size={14} weight="bold" />
            </HeaderButton>
            <HeaderButton label={t("Nach unten")} disabled={index < 0 || index >= list.length - 1} onClick={() => habitActions.move(habit.id, 1)}>
              <ArrowDown size={14} weight="bold" />
            </HeaderButton>
            {confirm ? (
              <button onClick={() => {
                  habitActions.remove(habit.id);
                  onClose();
                }} title={t("Gewohnheit mit Verlauf löschen")} className="pressable h-7 rounded-full bg-red px-3 text-footnote font-medium text-black">
                {t("Löschen?")}
              </button>
            ) : (
              <HeaderButton label={t("Löschen")} onClick={() => setConfirm(true)}>
                <Trash size={14} weight="bold" />
              </HeaderButton>
            )}
          </div>
        )}
      </div>

      <div className="flex h-7 items-center gap-1" role="group" aria-label={t("Tage")}>
        {WEEK.map((d) => (
          <button
            key={d}
            aria-pressed={days.includes(d)}
            aria-label={weekdayName(d, "long")}
            title={weekdayName(d, "long")}
            onClick={() => toggleDay(d)}
            className={`pressable size-7 rounded-full text-caption font-medium ${days.includes(d) ? "bg-fill-3 text-label" : "text-label-3 hover:text-label-2"}`}
          >
            {weekdayName(d, "narrow")}
          </button>
        ))}
        <button
          aria-pressed={everyDay}
          onClick={() => setDays(ALL_DAYS)}
          className={`pressable ms-2 h-7 rounded-full px-3 text-footnote font-medium ${everyDay ? "bg-fill-3 text-label" : "text-label-3 hover:text-label-2"}`}
        >
          {t("Jeden Tag")}
        </button>
      </div>

      {(waterTool || water) && (
        <div className="flex items-center justify-between gap-3 px-1">
          <div className="min-w-0">
            <div className="truncate text-body text-label">{t("Abhaken, wenn das Wasserziel erreicht ist")}</div>
            <div className="truncate text-caption text-label-3">{t("Wird von selbst abgehakt, nicht von Hand")}</div>
          </div>
          <Switch label={t("Abhaken, wenn das Wasserziel erreicht ist")} checked={water} onChange={setWater} />
        </div>
      )}
    </div>
  );
}
