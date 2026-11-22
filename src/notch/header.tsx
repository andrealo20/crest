import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { content } from "../design/motion";
import { createStore } from "../lib/store";

/*
 * A tool's actions on the right of the header (next to the pin), e.g. "Clear"
 * or "Refresh". The tool renders <HeaderActions> anywhere in its view; the
 * content is portaled into the header and fades in and out with the tool.
 */
export const headerSlot = createStore<HTMLElement | null>(null);

/** The tool on screen (Notch.tsx), and the tool a view belongs to. */
export const activeTool = createStore<string | null>(null);
export const ToolScope = createContext<string | null>(null);
/**
 * The header slot of a view that has a header of its own beside another view's (the bar's clock panel, ToolPanel.tsx), null until it
 * mounts; undefined everywhere else, where the one header belongs to the tool on screen.
 */
export const SlotScope = createContext<HTMLElement | null | undefined>(undefined);

export function HeaderActions({ children }: { children: ReactNode }) {
  const global = headerSlot.use();
  const own = useContext(SlotScope);
  const owner = useContext(ToolScope);
  const active = activeTool.use();
  const slot = own === undefined ? global : own;
  // A view on its way out can be held by its exit animation (fast switching left one behind for good):
  // only the tool on screen puts actions in the header. A view with a header of its own is always on screen.
  if (!slot || (own === undefined && owner !== null && owner !== active)) return null;
  return createPortal(
    <motion.div
      className="col-start-1 row-start-1 flex items-center justify-end gap-1"
      initial={{ opacity: 0, filter: "blur(4px)" }}
      animate={{ opacity: 1, filter: "blur(0px)", transition: content.enter }}
      exit={{ opacity: 0, filter: "blur(4px)", transition: content.exit }}
    >
      {children}
    </motion.div>,
    slot,
  );
}

/** Round icon button for the header, same size as the pin. */
export function HeaderButton(props: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      className={`pressable pressable-fill flex size-7 items-center justify-center rounded-full disabled:opacity-30 ${
        props.active ? "bg-secondary-container text-on-secondary-container" : "text-label-3 hover:text-label-2"
      }`}
    >
      {props.children}
    </button>
  );
}
