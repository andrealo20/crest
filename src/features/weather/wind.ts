import type { Design } from "../../design/design.ts";

/**
 * The rotation that turns NavigationArrow to where the wind blows, away from `from` (degrees, where it comes from). Phosphor's arrow
 * points north-west; Material's near_me points north-east, so it turns 90 degrees less.
 */
export const windArrow = (from: number, style: Design) => from - 135 - (style === "material" ? 90 : 0);
