import { getCurrentWindow } from "@tauri-apps/api/window";
import { X } from "@phosphor-icons/react";
import { t } from "../../../i18n";
import { HeaderButton } from "../../../notch/header";
import { isNative } from "../../../platform/native";
import { Segmented } from "../../../ui/controls";
import { useTaskbarShown } from "../../taskbar/TaskbarSettings";
import { savedPage, SettingsView } from "../SettingsView";

/**
 * The settings window: a title row to drag the window by and to close it, then the settings as the notch shows them. Where the
 * Taskbar settings show, the title gives way to the switch between the Notch's pages and the Taskbar's, which opens the last
 * page used on that side.
 * No data-tauri-drag-region: its double click asks for a maximize the window cannot do.
 */
export function SettingsWindow() {
  const taskbarShown = useTaskbarShown();
  const { scope } = savedPage.use();
  return (
    <div className="flex h-full flex-col bg-notch">
      <div
        className="relative flex h-11 shrink-0 items-center justify-end ps-4 pe-2"
        onMouseDown={(e) => {
          if (e.button === 0 && isNative && !(e.target as Element).closest("button")) void getCurrentWindow().startDragging();
        }}
      >
        {/* Still the window's heading for a screen reader when the switch takes its place. */}
        <h1 className={taskbarShown ? "sr-only" : "me-auto text-[13px] font-semibold text-label-2"}>{t("Einstellungen")}</h1>
        {taskbarShown && (
          // Centred on the window, not on the room the close button leaves.
          <div className="absolute left-1/2 -translate-x-1/2">
            <Segmented
              id="settings-scope"
              value={scope}
              onChange={(next) => savedPage.set((s) => ({ ...s, scope: next }))}
              options={[
                { value: "notch", label: t("Notch") },
                { value: "taskbar", label: t("Taskleiste") },
              ]}
            />
          </div>
        )}
        <HeaderButton label={t("Schließen")} onClick={() => isNative && void getCurrentWindow().close()}>
          <X size={14} weight="bold" />
        </HeaderButton>
      </div>
      <div className="min-h-0 flex-1">
        <SettingsView />
      </div>
    </div>
  );
}
