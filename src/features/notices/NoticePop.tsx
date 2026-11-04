import { t } from "../../i18n";
import { noticeCard } from "../../notch/row/NoticeCard";
import { BrandLogo, brandColor, brandFor } from "../../ui/brands";
import { noticeText } from "./format";
import type { Notice } from "./history";

const LOGO = 32, RING = 18;

/** The app's logo, or its initial when Windows gave none (crest-notify, desktop programs without a logo). */
export function AppIcon({ n, size, rounded }: { n: Pick<Notice, "icon" | "appName">; size: number; rounded?: boolean }) {
  const corner = rounded ? "rounded-[8px]" : "rounded-[4px]";
  if (n.icon) return <img src={n.icon} alt="" width={size} height={size} className={`shrink-0 ${corner} object-contain`} draggable={false} />;
  // A coding agent's question (crest-notify) has no logo of its own: its brand's, in the brand's colour.
  const brand = brandFor(n.appName);
  if (brand)
    return (
      <span aria-hidden className={`flex shrink-0 items-center justify-center ${corner}`} style={{ width: size, height: size, color: brandColor[brand], background: `color-mix(in srgb, ${brandColor[brand]} 18%, transparent)` }}>
        <BrandLogo id={brand} size={Math.round(size * 0.6)} />
      </span>
    );
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center ${corner} bg-fill-3 font-semibold text-label-2`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.6) }}
    >
      {(n.appName.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

export function ProgressRing({ value, size }: { value: number; size: number }) {
  const r = size / 2 - 1.5, c = 2 * Math.PI * r, f = Math.min(1, Math.max(0, value / 100));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" role="img" aria-label={`${Math.round(value)} %`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-fill-3)" strokeWidth={2} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-label)" strokeWidth={2} strokeDasharray={`${c * f} ${c}`} strokeLinecap="round" />
    </svg>
  );
}

/** A notice in the closed notch as a card: the app's logo, the title (or the app's name) and the first line of the text, a ring while it reports progress. */
export function noticePop(n: Notice, max: number) {
  const first = noticeText(n, t).split("\n")[0].trim();
  const ring = n.progress !== null && n.progress !== undefined;
  return noticeCard(
    {
      // A progress update keeps the key, so it changes in place instead of fading out and in.
      key: `notice:${n.replace ? `${n.appId}:${n.replace}` : n.id}`,
      image: <AppIcon n={n} size={LOGO} rounded />,
      hue: "blue",
      color: brandAccent(n.appName),
      title: n.title || n.appName,
      text: n.title ? first || n.appName : first,
      actions: ring ? <ProgressRing value={n.progress ?? 0} size={RING} /> : undefined,
      actionsWidth: RING,
    },
    max,
  );
}

/** A brand's own colour for a notice's accent line, when the app is one Crest knows. */
export function brandAccent(appName: string): string | undefined {
  const brand = brandFor(appName);
  return brand ? brandColor[brand] : undefined;
}
