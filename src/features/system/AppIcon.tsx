import { useEffect, useState } from "react";
import { AppWindow } from "../../ui/iconset";
import { noticeSource, systemIcon } from "../../platform/services";

// A program's icon by its executable, for the Hardware tool's process list and the bar's Top apps widget; an app's by its
// AppUserModelID, for the bar's Unread widget.

/** `key`'s icon from `cache`, loaded once each with `load` for the page's life; null until it comes and where there is none. */
function useIcon(cache: Map<string, string | null>, load: (key: string) => Promise<string | null>, key: string | null): string | null {
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!key || cache.has(key)) return;
    cache.set(key, null);
    void load(key).then((url) => {
      cache.set(key, url);
      redraw((n) => n + 1);
    });
  }, [cache, load, key]);
  return key ? (cache.get(key) ?? null) : null;
}

/** Icons by executable path. */
const icons = new Map<string, string | null>();
/** Icons by lower-case AppUserModelID. */
const appIcons = new Map<string, string | null>();

/** An app's icon by its AppUserModelID (noticeSource.icon); null for `id` null, until it comes and where Windows has none. */
export const useNoticeIcon = (id: string | null) => useIcon(appIcons, noticeSource.icon, id);

export function AppIcon({ path, size }: { path: string | null; size: number }) {
  const src = useIcon(icons, systemIcon, path);
  return src ? <img src={src} width={size} height={size} className="shrink-0" alt="" /> : <AppWindow size={size} weight="bold" className="shrink-0 text-label-3" />;
}
