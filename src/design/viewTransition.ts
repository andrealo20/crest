import type { Design } from "./design.ts";

/**
 * A change of style crossfades as one picture when the engine has view transitions (WebKit before Safari 18 does not). The first
 * paint has no style before it and draws at once.
 */
export function wantsViewTransition(from: Design | undefined, to: Design, supported: boolean): boolean {
  return supported && from !== undefined && from !== to;
}
