/** What the Material weather shows in a body of w x h CSS px: the hours go first, then the detail tiles. */
export function weatherFit(w: number, h: number): { hours: 0 | 8 | 12; details: boolean; big: boolean } {
  return { hours: h < 232 ? 0 : w >= 680 ? 12 : 8, details: w >= 500, big: h >= 360 };
}

/** The fit before when nothing it shows changed, so a resize that only moves pixels gives React the same state and no render. */
export function keepFit(prev: ReturnType<typeof weatherFit>, next: ReturnType<typeof weatherFit>): ReturnType<typeof weatherFit> {
  return prev.hours === next.hours && prev.details === next.details && prev.big === next.big ? prev : next;
}
