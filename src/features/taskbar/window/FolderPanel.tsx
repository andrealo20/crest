import { useEffect, useRef, useState, type ReactNode } from "react";
import { t } from "../../../i18n";
import { settings } from "../../../settings/store";
import { TextField } from "../../../ui/controls";
import { nextName, renameFolder } from "../folderModel";
import { panel } from "../panel";
import { setTaskbar } from "../store";

/** A new folder's name in the current language: "Ordner", then "Ordner 2", "Ordner 3" while the name is taken. */
export const folderLabel = (n: number) => (n === 1 ? t("Ordner") : t("Ordner {n}", { n }));

/** Folder `id` renamed: `text` trimmed and cut, or with nothing typed the default name no other folder has. Written only when it changes. */
function rename(id: string, text: string) {
  const saved = settings.get().taskbar.folders;
  const folders = renameFolder(saved, id, text.trim() || nextName(saved.filter((f) => f.id !== id), folderLabel));
  if (folders !== saved) setTaskbar({ folders });
}

/**
 * A folder in the panel above the bar, sized by FOLDER_SIZE: its name over its apps (`children`, the bar's AppsPanel). A click on the
 * name makes it a field, as Rename in the folder's menu does (`focus` "name"); Enter or leaving the field keeps what is typed, Esc
 * goes back and leaves the panel open, a second Esc closes it (BarPanel). Opened from the keyboard (`focus` "first") the keyboard is
 * on its first app. Its box (`data-folder-panel`) is where an app dragged out of it stays in the folder (PinDrop).
 */
export function FolderPanel({ id, name, focus, children }: { id: string; name: string; focus?: "first" | "name"; children: ReactNode }) {
  const [draft, setDraft] = useState<string | null>(focus === "name" ? name : null);
  // Set while the field is open: Enter, Esc and the blur that follows either end it once.
  const editing = useRef(focus === "name");
  const box = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLButtonElement>(null);
  // At each opening, also one that brings the panel back while it closes, which keeps this FolderPanel with what it had.
  const opened = panel.use();
  useEffect(() => {
    if (!opened) return;
    if (focus === "first") box.current?.querySelector<HTMLElement>("[data-app-cell]")?.focus({ preventScroll: true });
    else if (focus === "name" && !editing.current) {
      editing.current = true;
      setDraft(name);
    }
  }, [opened]);
  // The whole name selected as the field opens, so typing replaces it.
  const open = draft !== null;
  useEffect(() => {
    if (open) box.current?.querySelector("input")?.select();
  }, [open]);
  const end = (keep: boolean, back: boolean) => {
    if (!editing.current) return;
    editing.current = false;
    if (keep && draft !== null) rename(id, draft);
    setDraft(null);
    // From the keyboard the keyboard goes back to the name; a click elsewhere keeps what it clicked.
    if (back) requestAnimationFrame(() => title.current?.focus({ preventScroll: true }));
  };
  return (
    <div ref={box} data-folder-panel className="flex h-full flex-col">
      <div
        className="flex h-9 shrink-0 items-end px-3"
        onKeyDown={(e) => {
          if (e.key !== "Escape" || !editing.current) return;
          // Kept from the panel's own Esc, which would close it.
          e.preventDefault();
          end(false, true);
        }}
      >
        {open ? (
          <TextField value={draft} onChange={setDraft} onSubmit={() => end(true, true)} onBlur={() => end(true, false)} placeholder={t("Ordnername")} width="flex-1" autoFocus />
        ) : (
          <button
            ref={title}
            aria-label={`${name}, ${t("Umbenennen")}`}
            onClick={() => {
              editing.current = true;
              setDraft(name);
            }}
            className="h-7 min-w-0 truncate rounded-[8px] px-2 text-start text-title font-semibold outline-none hover:bg-fill-2 focus-visible:bg-fill-2 material:rounded-full"
          >
            {name}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
