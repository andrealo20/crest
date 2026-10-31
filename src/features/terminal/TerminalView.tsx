import { useEffect, useRef } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { HeaderActions, HeaderButton } from "../../notch/header";
import { nav } from "../../notch/nav";
import { keyboardFocus } from "../../platform/native";
import { settings } from "../../settings/store";
import { t } from "../../i18n";
import { attachTerminal, endSession, focusTerminal, start } from "./session";

/**
 * PowerShell in the notch. The window takes keyboard focus while the terminal is
 * shown (it is created without focus); the notch gives it back to the previous
 * app when it closes (keyboard_focus in lib.rs).
 */
export function TerminalView() {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let detach: (() => void) | null = null;
    let gone = false;
    void attachTerminal(box.current!).then((d) => (gone ? d() : (detach = d)));
    keyboardFocus(true);
    return () => {
      gone = true;
      detach?.();
      // Still on this tool while unmounting = the notch closed (a tool switch changes the tab first).
      if (settings.get().terminal.endOnClose && nav.get().tabId === "terminal") endSession();
    };
  }, []);

  return (
    <div className="flex h-full flex-col px-4 pt-1 pb-1">
      <HeaderActions>
        <HeaderButton
          label={t("Neue Sitzung")}
          onClick={() => {
            void start();
            focusTerminal();
          }}
        >
          <ArrowClockwise size={14} weight="bold" />
        </HeaderButton>
      </HeaderActions>
      {/* No click bubbling: a triple click selects a line here, on the notch it would toggle focus mode. */}
      <div className="min-h-0 flex-1 rounded-[12px] bg-fill-1 py-2 pl-3 pr-1" onPointerDown={focusTerminal} onClick={(e) => e.stopPropagation()}>
        <div ref={box} className="h-full w-full" />
      </div>
    </div>
  );
}
