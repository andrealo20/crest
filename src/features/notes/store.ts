import { createStore } from "../../lib/store";

/** The single note, saved as it is typed. One store per window, shared by the Notes tool and the bar's Note preview there. */
export const note = createStore("", { persist: "note" });
