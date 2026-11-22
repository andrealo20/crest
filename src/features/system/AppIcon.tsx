import { useEffect, useState } from "react";
import { AppWindow } from "../../ui/iconset";
import { systemIcon } from "../../platform/services";

// A program's icon by its executable, for the Hardware tool's process list and the bar's Top apps widget.

/** Icons by executable path, asked once each. */
const icons = new Map<string, string | null>();
function useIcon(path: string | null): string | null {
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!path || icons.has(path)) return;
    icons.set(path, null);
    void systemIcon(path).then((url) => {
      icons.set(path, url);
      redraw((n) => n + 1);
    });
  }, [path]);
  return path ? (icons.get(path) ?? null) : null;
}

export function AppIcon({ path, size }: { path: string | null; size: number }) {
  const src = useIcon(path);
  return src ? <img src={src} width={size} height={size} className="shrink-0" alt="" /> : <AppWindow size={size} weight="bold" className="shrink-0 text-label-3" />;
}
