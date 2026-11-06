import { createStore } from "../../lib/store";
import { settings } from "../../settings/store";
import { todayTotal } from "../water/water";
import { water } from "../water/store";
import { MAX_HABITS, NAME_MAX, dayOf, followWater, normalizeHabits, pruneDone, withDay, type Habit, type HabitHue, type HabitState } from "./model";

export const habits = createStore<HabitState>({ habits: [] }, { persist: "habits" });
// A broken or foreign entry becomes an empty list; ticks older than two years go.
habits.set((s) => normalizeHabits(s, dayOf(Date.now())));

/** What the form edits. */
export interface HabitDraft { name: string; hue: HabitHue; days: number[]; water: boolean }

const patch = (id: string, f: (h: Habit) => Habit) => habits.set((s) => ({ habits: s.habits.map((h) => (h.id === id ? f(h) : h)) }));

export const habitActions = {
  /** False at the limit or with an empty name. */
  add(d: HabitDraft): boolean {
    const name = d.name.trim().slice(0, NAME_MAX);
    if (!name || habits.get().habits.length >= MAX_HABITS) return false;
    const habit: Habit = { id: crypto.randomUUID(), name, hue: d.hue, days: d.days, since: dayOf(Date.now()), done: [], ...(d.water ? { water: true } : {}) };
    habits.set((s) => ({ habits: [...s.habits, habit] }));
    syncWater();
    return true;
  },
  update(id: string, d: HabitDraft) {
    const name = d.name.trim().slice(0, NAME_MAX);
    if (!name) return;
    patch(id, ({ water: _was, ...h }) => ({ ...h, name, hue: d.hue, days: d.days, ...(d.water ? { water: true } : {}) }));
    syncWater();
  },
  remove: (id: string) => habits.set((s) => ({ habits: s.habits.filter((h) => h.id !== id) })),
  move(id: string, by: -1 | 1) {
    habits.set((s) => {
      const i = s.habits.findIndex((h) => h.id === id), j = i + by;
      if (i < 0 || j < 0 || j >= s.habits.length) return s;
      const list = [...s.habits];
      [list[i], list[j]] = [list[j], list[i]];
      return { habits: list };
    });
  },
  /** Ticks or un-ticks today. A habit that follows Water is ticked by Water only. */
  toggleToday(id: string) {
    const today = dayOf(Date.now());
    patch(id, (h) => (h.water ? h : { ...h, done: pruneDone(withDay(h.done, today, !h.done.includes(today)), today) }));
  },
};

/**
 * A habit that follows Water has today ticked while the water goal is reached. Read only: it uses Water's log and the
 * goal setting and changes neither. Runs on a change of either (and at the start), never on a timer, and does nothing
 * while the tool is off or no habit follows Water.
 */
function syncWater() {
  const s = settings.get();
  if (!habits.get().habits.some((h) => h.water) || !s.tools.some((t) => t.id === "habits" && t.enabled)) return;
  const now = Date.now();
  const goal = s.productivity.water.goalMl;
  const next = followWater(habits.get().habits, dayOf(now), goal > 0 && todayTotal(water.get().log, now) >= goal);
  if (next !== habits.get().habits) habits.set({ habits: next });
}

water.subscribe(syncWater);
settings.subscribe(syncWater);
syncWater();
