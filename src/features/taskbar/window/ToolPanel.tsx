import { useEffect, useLayoutEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { content } from "../../../design/motion";
import { t } from "../../../i18n";
import { createStore } from "../../../lib/store";
import { HEADER_HEIGHT } from "../../../notch/geometry";
import { ToolScope, activeTool, headerSlot } from "../../../notch/header";

type Tabs = typeof import("../../../notch/tabs");

/** The notch's tool registry once it has loaded, kept for the page's life. */
const registry = createStore<Tabs | null>(null);
let loading: Promise<void> | null = null;

/**
 * The notch's tool registry (src/notch/tabs.ts), imported the first time `load` is true. It pulls in the code of every tool, which
 * the bar's page leaves alone until a tool opens in its panel: the app menu needs none of it.
 */
export function useTabs(load: boolean): Tabs | null {
  const tabs = registry.use();
  useEffect(() => {
    if (load) loading ??= import("../../../notch/tabs").then(registry.set);
  }, [load]);
  return tabs;
}

/** The title's id, which names the panel for screen readers while it shows a tool. */
export const TOOL_TITLE_ID = "bar-panel-tool-title";

/**
 * A notch tool in the bar's panel, a second copy of the one in the notch: the notch's header without its pin, since the panel always
 * closes on a click outside, and the tool's view without the tool bar. A switch to another tool keeps the header, whose slot takes
 * the new tool's own buttons (HeaderActions), and crossfades the title and the view as the notch does.
 */
export function ToolPanel({ tool }: { tool: string }) {
  const tab = useTabs(true)?.findTab(tool);
  const id = tab?.id;
  // The header's buttons follow the tool on screen (header.tsx).
  useLayoutEffect(() => {
    if (id) activeTool.set(id);
  }, [id]);
  if (!tab) return null;
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 ps-5 pe-3" style={{ height: HEADER_HEIGHT + 4 }}>
        <div id={TOOL_TITLE_ID} className="relative min-w-0 flex-1">
          {/* The notch's title also blurs as it changes; the bar animates opacity and transforms only. */}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.h2
              key={tab.id}
              className="truncate text-title font-semibold"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: content.enter }}
              exit={{ opacity: 0, transition: content.exit }}
            >
              {t(tab.label)}
            </motion.h2>
          </AnimatePresence>
        </div>
        {/* Tools render here via <HeaderActions> (header.tsx). The grid stacks old and new during a switch. */}
        <div ref={headerSlot.set} className="grid" />
      </div>
      <div className="relative min-h-0 flex-1 overflow-clip">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={tab.id}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: content.enter }}
            exit={{ opacity: 0, transition: content.exit }}
          >
            <ToolScope.Provider value={tab.id}>
              <tab.View />
            </ToolScope.Provider>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
