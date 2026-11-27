import { getCurrentWindow } from "@tauri-apps/api/window";
import { X } from "../../../ui/iconset";
import { design } from "../../../design/design";
import { t } from "../../../i18n";
import { HeaderButton } from "../../../notch/header";
import { isNative } from "../../../platform/native";
import { ScopeSwitch, SettingsView, useScopes } from "../SettingsView";

const close = () => isNative && void getCurrentWindow().close();

const drag = (e: React.MouseEvent) => {
  if (e.button === 0 && isNative && !(e.target as Element).closest("button, input, label")) void getCurrentWindow().startDragging();
};

/**
 * The settings window: a title row to drag the window by and to close it, then the settings as the notch shows them. Where the
 * Taskbar's or Pomelo's settings show, the title gives way to the switch between the Notch's pages, the Taskbar's and Pomelo's,
 * which opens the last page used on that side. Under Material the settings draw that row's actions in their own page header.
 * No data-tauri-drag-region: its double click asks for a maximize the window cannot do.
 */
export function SettingsWindow() {
  const scopes = useScopes();
  const material = design.use() === "material";
  // Only with more than the notch's scope: the Taskbar's where the bar can run, Pomelo's on Windows outside the Store.
  const taskbarShown = scopes.length > 1;
  const scopeSwitch = taskbarShown && <ScopeSwitch scopes={scopes} />;
  if (material)
    return (
      <div className="flex h-full flex-col bg-notch">
        <h1 className="sr-only">{t("Einstellungen")}</h1>
        <div className="min-h-0 flex-1">
          <SettingsView chrome={{ onClose: close, onDrag: drag, center: scopeSwitch || undefined }} />
        </div>
      </div>
    );
  return (
    <div className="flex h-full flex-col bg-notch">
      <div className="relative flex h-11 shrink-0 items-center justify-end ps-4 pe-2" onMouseDown={drag}>
        {/* Still the window's heading for a screen reader when the switch takes its place. */}
        <h1 className={taskbarShown ? "sr-only" : "me-auto text-[13px] font-semibold text-label-2"}>{t("Einstellungen")}</h1>
        {taskbarShown && (
          // Centred on the window, not on the room the close button leaves.
          <div className="absolute left-1/2 -translate-x-1/2">{scopeSwitch}</div>
        )}
        <HeaderButton label={t("Schließen")} onClick={close}>
          <X size={14} weight="bold" />
        </HeaderButton>
      </div>
      <div className="min-h-0 flex-1">
        <SettingsView />
      </div>
    </div>
  );
}
