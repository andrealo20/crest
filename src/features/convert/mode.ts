import { createStore } from "../../lib/store";

export type ConvertMode = "units" | "currency";

/** Units or currency, as last left: the tool opens there again, and the exchange rate widget opens it on currency. */
export const convertMode = createStore<ConvertMode>("units", { persist: "convert-mode" });
