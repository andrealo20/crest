import { brandColor } from "../../../ui/brands";
import type { UsageProvider } from "../../../platform/services";

export const RING = 12, RING_GAP = 8;

/** Providers that have a quota to show: windows and no error. */
export const ringProviders = (providers: UsageProvider[]) => providers.filter((p) => p.windows.length > 0 && !p.error);

/** The fullest window, 0..100. */
export const ringValue = (p: UsageProvider) => Math.min(100, Math.max(0, ...p.windows.map((w) => w.usedPercent)));

/** One quota as a 12 px ring in the provider's colour, filling counter-clockwise from the top; no letter (three of them start with C). */
export function Ring({ provider }: { provider: UsageProvider }) {
  const v = ringValue(provider);
  return (
    <svg width={RING} height={RING} viewBox="0 0 12 12" className="shrink-0 text-label" aria-hidden>
      <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth="2" />
      {v > 0 && (
        <circle
          cx="6" cy="6" r="5" fill="none" stroke={brandColor[provider.id]} strokeWidth="2" strokeLinecap={v >= 99.9 ? "butt" : "round"}
          pathLength={100} strokeDasharray={v >= 99.9 ? "100 0" : `${v} 100`}
          // Rotated to start at the top, then mirrored: counter-clockwise.
          transform="matrix(-1 0 0 1 12 0) rotate(-90 6 6)"
        />
      )}
    </svg>
  );
}
