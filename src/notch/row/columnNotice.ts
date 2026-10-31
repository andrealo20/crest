import { createStore } from "../../lib/store";
import type { StatusAlert } from "./status";

/**
 * The status alert on show (power, network, headphones), for the side column's icon-only notice line: on a side edge the wide
 * notice text has no room, so the column shows the alert's icon instead. Set and cleared where the status alerts choose the
 * notice that shows; null while none does.
 */
export const statusNotice = createStore<Pick<StatusAlert, "kind" | "icon" | "tone"> | null>(null);
