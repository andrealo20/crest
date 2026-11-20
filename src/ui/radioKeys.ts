/** How far an arrow key moves the choice in a radio group: down and right go on, up and left back, the horizontal ones mirrored right to left. */
export function arrowStep(key: string, rtl: boolean): -1 | 0 | 1 {
  if (key === "ArrowDown") return 1;
  if (key === "ArrowUp") return -1;
  if (key === "ArrowRight") return rtl ? -1 : 1;
  if (key === "ArrowLeft") return rtl ? 1 : -1;
  return 0;
}
