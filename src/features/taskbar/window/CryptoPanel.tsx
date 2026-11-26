import { t } from "../../../i18n";
import { formatPercent } from "../../../lib/format";
import { settings } from "../../../settings/store";
import { barFeed } from "../barStores";
import { RANGE_LABEL, changeTone, spanPoints } from "../markets";
import { variantOf } from "../model";
import { openPanel, panel } from "../panel";
import { CRYPTO_SIZE } from "../panelModel";
import { TONE, marketLabel, priceText } from "./MarketFaces";

/** The line's box at 100 %: the panel's width inside its 12 px sides, 88 px tall (panelModel.ts CRYPTO_SIZE). */
const LINE_W = CRYPTO_SIZE.w - 24, LINE_H = 88;
/** What the line under each version spans today, when it shows more than the bar: the coin's week and the stock's 5 days. */
const TODAY = { coin: "7 Tage", stock: "5 Tage", portfolio: "Heute" } as const;

/**
 * The crypto widget's panel over it: the coin, the stock (its name under the pointer) or the Depot, its price and its change over the
 * range, its whole line in the change's colour (today the coin's 7 days, the stock's 5 days and the Depot's today; otherwise the
 * range's), and,
 * while the Depot is on in the notch, a button that opens the Depot in this panel's place. It draws what the widget was sent, so it
 * opens at once and reads nothing itself.
 */
export function CryptoPanel() {
  const s = settings.use();
  const market = barFeed.use().crypto;
  const coin = market && market.kind === variantOf(s.taskbar.variants, "crypto") && market.range === s.taskbar.marketRange ? market : null;
  const depot = s.tools.some((tool) => tool.id === "trading" && tool.enabled);
  // Nothing is what the widget's dimmed icon says too (a symbol nobody knows, offline, or no account in the Depot); a read that lands replaces it.
  if (!coin) return <p className="flex h-full items-center justify-center px-5 text-center text-caption text-label-3">{t("Nicht verfügbar")}</p>;
  const tone = TONE[changeTone(coin.change)];
  const pts = spanPoints(coin.line, LINE_W, LINE_H), line = pts.map((p) => p.join(",")).join(" ");
  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <div className="flex h-8 shrink-0 items-center gap-2 ps-1">
        <span className="min-w-0 flex-1 truncate text-footnote font-semibold text-label" title={coin.name ?? undefined}>
          {marketLabel(coin)}
        </span>
        <span className="tabular shrink-0 text-footnote font-semibold text-label">{priceText(coin, false)}</span>
        {coin.change !== null && <span className={`tabular shrink-0 text-footnote font-medium ${tone}`}>{formatPercent(coin.change)}</span>}
      </div>
      {/* Stretched to the panel's own width; the stroke keeps its thickness. */}
      <svg width="100%" height={LINE_H} viewBox={`0 0 ${LINE_W} ${LINE_H}`} preserveAspectRatio="none" className={`shrink-0 ${tone}`} aria-hidden>
        {pts.length > 1 && (
          <>
            <polygon points={`${pts[0][0]},${LINE_H} ${line} ${pts[pts.length - 1][0]},${LINE_H}`} fill="currentColor" fillOpacity={0.15} />
            <polyline points={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      <div className="flex h-8 shrink-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate ps-1 text-caption text-label-3">{t(coin.range === "1d" ? TODAY[coin.kind] : RANGE_LABEL[coin.range])}</span>
        {depot && (
          <button
            onClick={() => {
              const open = panel.get();
              if (open) openPanel({ kind: "tool", tool: "trading" }, open.anchor);
            }}
            className="pressable shrink-0 rounded-full px-2.5 py-1 text-footnote font-medium text-label-2 hover:bg-fill-2 hover:text-label"
          >
            {t("{name} öffnen", { name: t("Depot") })}
          </button>
        )}
      </div>
    </div>
  );
}
