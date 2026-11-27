/**
 * Material's settings shell at a CSS width. Windows' text size leaves the 820 x 600 window 547 x 400 CSS px at 150 % and
 * 364 x 267 at 225 %, so the pill list gives way to a rail of icons below 600 and to a row on top below 420.
 */
export function shellLayout(width: number): "list" | "rail" | "top" {
  return width >= 600 ? "list" : width >= 420 ? "rail" : "top";
}

/** The page title leaves the header to the Notch | Taskbar switch below 760 px: the chosen item already says where you are. */
export function showsHeaderTitle(width: number, scopeSwitch: boolean): boolean {
  return !scopeSwitch || width >= 760;
}

/** Whether a page's groups rise one after another: never with reduced motion, in the search, or when the page opens at a target. */
export function cascades(c: { material: boolean; reduced: boolean; searching: boolean; target: boolean }): boolean {
  return c.material && !c.reduced && !c.searching && !c.target;
}

/**
 * The settings window's scopes, in the switch's order: the Taskbar's where the bar can run, then Pomelo's. Pomelo's joins only a switch
 * the Taskbar already brings, or while its scope is open (reached from Files), so the way back shows: without the bar, the window
 * looks as it always did to anyone who does not open it.
 */
export function scopeOptions(taskbar: boolean, pomelo: boolean, pomeloOpen = false): ("notch" | "taskbar" | "pomelo")[] {
  return ["notch", ...(taskbar ? ["taskbar" as const] : []), ...(pomelo && (taskbar || pomeloOpen) ? ["pomelo" as const] : [])];
}
