import { createContext, useContext } from "react";
import { isNative } from "../../../platform/native";
import { settings } from "../../../settings/store";
import type { BarEdge } from "../model";

/** The edge of the bar this page draws; the bottom outside a bar (Settings' previews, the site's demo). */
export const BarEdgeContext = createContext<BarEdge>("bottom");
export const useBarEdge = () => useContext(BarEdgeContext);

/** The bar's edge as the settings have it now, for code outside React (a drop's place); the site's demo keeps the bottom. */
export const barEdgeNow = (): BarEdge => (isNative ? settings.get().taskbar.position : "bottom");
