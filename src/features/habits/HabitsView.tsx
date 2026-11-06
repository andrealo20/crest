import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Drop, Flame, Plus } from "@phosphor-icons/react";
import { fade, springs } from "../../design/motion";
import { HeaderActions, HeaderButton } from "../../notch/header";
import { Button, Empty } from "../../ui/controls";
import { hueVar } from "../themes/hues";
import { t } from "../../i18n";
import { MAX_HABITS, dayOf, dots, isActive, streaks, type Habit } from "./model";
import { habitActions, habits } from "./store";
import { HabitForm } from "./HabitForm";

/*
 *  ◯ Read          ▪▪▪▪▪▪▪ ▪▪▪▪▪▪▪ ▪▪▪▪▪▪▪ ▪▪▪▪▪▪▪ ▪▪▪▪▪▪◉   🔥 5
 *  ● Stretch       ▪▪▪▪▪▪▪ ▪▪▪▪▪▪▪ ▪▪▪▪▪▪▪ ▪▪▪▪▪▪▪ ▪▪▪▪▪▪◉   🔥 12
 *                  five weeks, today last                      Best 20
 * The circle ticks today (tap again to undo); a click on the name edits. The streak rules are in model.ts.
 */
export function HabitsView() {
  const { habits: list } = habits.use();
  const today = useToday();
  const [editing, setEditing] = useState<string | null>(null);
  const target = list.find((h) => h.id === editing);
  const form = editing === "new" || target !== undefined;

  return (
    <motion.div key={form ? "form" : "list"} className="h-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade}>
      {form ? (
        <HabitForm habit={target} onClose={() => setEditing(null)} />
      ) : (
        <div className="flex h-full flex-col px-4 pt-1 pb-1">
          <HeaderActions>
            <HeaderButton label={list.length >= MAX_HABITS ? t("Bis zu {n} Gewohnheiten", { n: MAX_HABITS }) : t("Neue Gewohnheit")} disabled={list.length >= MAX_HABITS} onClick={() => setEditing("new")}>
              <Plus size={14} weight="bold" />
            </HeaderButton>
          </HeaderActions>
          {list.length === 0 ? (
            <Empty
              icon={Flame}
              title={t("Noch keine Gewohnheiten")}
              text={t("Jeden Tag abhaken, dann wächst die Serie")}
              action={
                <Button primary icon={Plus} onClick={() => setEditing("new")}>
                  {t("Neue Gewohnheit")}
                </Button>
              }
            />
          ) : (
            <div className="-mx-1 flex-1 overflow-y-auto overscroll-contain px-1 scroll-smooth motion-reduce:scroll-auto [scrollbar-width:none]">
              {list.map((h) => (
                <HabitRow key={h.id} habit={h} today={today} onEdit={() => setEditing(h.id)} />
              ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

/** The local day, rechecked twice a minute while the tool is on screen so midnight turns the dots over. */
function useToday(): number {
  const [today, setToday] = useState(() => dayOf(Date.now()));
  useEffect(() => {
    const id = window.setInterval(() => setToday(dayOf(Date.now())), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return today;
}

function HabitRow({ habit, today, onEdit }: { habit: Habit; today: number; onEdit: () => void }) {
  const reduced = useReducedMotion();
  const color = hueVar(habit.hue);
  const done = habit.done.includes(today);
  const { current, best } = streaks(habit, today);
  const grid = dots(habit, today);
  const counted = grid.filter((d) => d.state !== "off");
  const doneCount = grid.filter((d) => d.state === "done").length;
  // A tick that is already there (the days were edited since) can still be taken back.
  const restDay = !isActive(habit, today, today) && !done;
  const locked = restDay || habit.water === true;
  const pop = reduced ? "scale(1)" : "scale(0.4)";

  return (
    <div className="group flex h-8 items-center gap-2.5 rounded-[10px] px-2 hover:bg-fill-1">
      <button
        aria-pressed={done}
        aria-label={done ? t("{name} für heute zurücknehmen", { name: habit.name }) : t("{name} für heute abhaken", { name: habit.name })}
        title={habit.water ? t("Das Tool Wasser hakt das ab") : restDay ? t("Heute ist ein freier Tag") : undefined}
        disabled={locked}
        onClick={() => habitActions.toggleToday(habit.id)}
        className={`pressable flex size-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors duration-200 disabled:cursor-default ${locked && !done ? "border-dashed opacity-60" : ""}`}
        style={{ borderColor: color, backgroundColor: done ? color : "transparent" }}
      >
        <AnimatePresence initial={false}>
          {done && (
            <motion.span className="flex text-black" initial={{ opacity: 0, transform: pop }} animate={{ opacity: 1, transform: "scale(1)" }} exit={{ opacity: 0, transform: pop }} transition={springs.snappy}>
              <Check size={13} weight="bold" />
            </motion.span>
          )}
        </AnimatePresence>
        {!done && habit.water && <Drop size={11} weight="fill" style={{ color }} />}
      </button>

      <button onClick={onEdit} aria-label={t("{name} bearbeiten", { name: habit.name })} title={habit.name} className="min-w-0 flex-1 truncate text-start text-body text-label transition-colors duration-150 hover:text-label-2">
        {habit.name}
      </button>

      {/* Time runs left to right in every language, like the song's time bar. */}
      <div dir="ltr" className="flex shrink-0 items-center gap-[2px]" role="img" aria-label={t("Letzte 5 Wochen: {done} von {total} Tagen", { done: doneCount, total: counted.length })}>
        {grid.map((d, i) => {
          const last = i === grid.length - 1;
          const cls = `size-[5px] rounded-full ${i > 0 && i % 7 === 0 ? "ms-[3px]" : ""} ${d.state === "off" ? "bg-fill-1" : d.state === "done" ? "" : "bg-fill-3"} ${last ? "ring-1 ring-label-3" : ""}`;
          const style = d.state === "done" ? { backgroundColor: color } : undefined;
          // Today's dot pops when it is ticked.
          return last ? (
            <motion.span key={d.day} className={cls} style={style} initial={false} animate={{ opacity: d.state === "done" ? 1 : 0.8, transform: reduced || d.state === "done" ? "scale(1)" : "scale(0.8)" }} transition={springs.snappy} />
          ) : (
            <span key={d.day} className={cls} style={style} />
          );
        })}
      </div>

      <div role="img" className="flex w-[50px] shrink-0 flex-col items-end" aria-label={t("Serie {n}, beste {best}", { n: current, best })}>
        <span className={`tabular flex items-center gap-0.5 text-body font-semibold ${current > 0 ? "text-label" : "text-label-3"}`}>
          <Flame size={12} weight="fill" style={current > 0 ? { color } : undefined} aria-hidden />
          {current}
        </span>
        <span className="tabular text-caption text-label-3">{t("Beste {n}", { n: best })}</span>
      </div>
    </div>
  );
}
