import { createStore } from "../../lib/store";
import { PROMPTER_DEFAULTS, normalizePrompter, type PrompterState } from "./model";

/** The script and its look, saved on every change (localStorage, nothing leaves the PC). */
export const prompter = createStore<PrompterState>(PROMPTER_DEFAULTS, { persist: "teleprompter" });
prompter.set(normalizePrompter);

export const setPrompter = (patch: Partial<PrompterState>) => prompter.set((s) => normalizePrompter({ ...s, ...patch }));
