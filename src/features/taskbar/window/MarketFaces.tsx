import { locale, t } from "../../../i18n";
import { formatMoney, formatPercent } from "../../../lib/format";
import { CAPTION_FONT, measureTabular, measureText } from "../../../notch/row/measure";
import type { BarFeed } from "../barStores";
import { changeTone, dayLine, rateText, spanPoints, type Tone } from "../markets";
import { variantOf } from "../model";
import { SAMPLE_MARKETS } from "../sampleFeed";
import type { Body, WidgetContext } from "./Widget";

/*
 * The faces of the bar's Exchange rate and Crypto widgets: the rate of one unit over its pair, and a coin's, a stock's or the
 * Depot's last day as a small line beside its price over its symbol and change. Each as wide as its widest figures, every digit
 * an 8, so a new reading moves nothing.
 */

type Rate = NonNullable<BarFeed["currency"]>;
type Coin = NonNullable<BarFeed["crypto"]>;

/** The line's box on the bar, 28 by 14. */
const LINE_W = 28, LINE_H = 14, GAP = 6;
/** A change's colour: green up, red down, faint while flat or not known. */
export const TONE: Record<Tone, string> = { up: "text-green", down: "text-red", flat: "text-label-3" };

const widest = (text: string, font?: string) => measureTabular(text.replace(/\d/g, "8"), font);

const currencyWidth = (c: Rate) => Math.max(widest(rateText(c.rate, locale())), measureText(`${c.from}/${c.to}`, CAPTION_FONT));

/** One unit's rate over the pair, "1.1835" over "GBP/EUR". */
function CurrencyFace({ rate: c }: { rate: Rate }) {
  return (
    <span className="flex flex-col items-center whitespace-nowrap leading-[13px] text-label" style={{ width: currencyWidth(c) }}>
      <span className="tabular text-footnote font-medium">{rateText(c.rate, locale())}</span>
      <span className="text-caption font-medium text-label-2">
        {c.from}/{c.to}
      </span>
    </span>
  );
}

/** The amounts of a masked portfolio, as the Depot masks them while the screen is shared. */
export const MASK = "••••••";

/** The price as the bar shows it: whole units from 1,000 up, where the cents only take room; masked while hidden. */
export const priceText = (c: Coin, compact = true) => (c.hidden ? MASK : formatMoney(c.price, c.base, { compact: compact && c.price >= 1000 }));

/** What the change follows: the coin's or the stock's symbol, or the Depot's name. */
export const marketLabel = (c: Coin) => (c.kind === "portfolio" ? t("Depot") : c.symbol);

const cryptoWidth = (c: Coin) => LINE_W + GAP + Math.max(widest(priceText(c)), measureText(`${marketLabel(c)} `, CAPTION_FONT) + widest(formatPercent(-88.88), CAPTION_FONT));

/** The last day as a line in its change's colour (dayLine: the coin's 24 hours, the stock's session, the Depot's today), then the
 *  price over the symbol and the change. */
function CryptoFace({ coin: c }: { coin: Coin }) {
  const tone = TONE[changeTone(c.change)];
  const pts = spanPoints(dayLine(c), LINE_W, LINE_H), line = pts.map((p) => p.join(",")).join(" ");
  return (
    <span className="flex items-center whitespace-nowrap text-label" style={{ gap: GAP, width: cryptoWidth(c) }}>
      <svg width={LINE_W} height={LINE_H} viewBox={`0 0 ${LINE_W} ${LINE_H}`} className={`shrink-0 ${tone}`} aria-hidden>
        {pts.length > 1 && (
          <>
            <polygon points={`${pts[0][0]},${LINE_H} ${line} ${pts[pts.length - 1][0]},${LINE_H}`} fill="currentColor" fillOpacity={0.15} />
            <polyline points={line} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
          </>
        )}
      </svg>
      <span className="flex min-w-0 flex-col leading-[13px]">
        <span className="tabular text-footnote font-medium">{priceText(c)}</span>
        <span className="text-caption font-medium text-label-2">
          {marketLabel(c)}
          {c.change !== null && <span className={`tabular ${tone}`}> {formatPercent(c.change)}</span>}
        </span>
      </span>
    </span>
  );
}

/**
 * The exchange rate, or the coin, stock or portfolio of the crypto widget's version over its range, as the bar draws it; null before
 * the first read or while the slice is still another version's or range's, and the bar draws its icon. The Widgets page's previews
 * draw each version's sample.
 */
export function marketPart(id: "currency" | "crypto", ctx: WidgetContext): Body | null {
  const { currency } = ctx.feed;
  if (id === "currency") return currency && { node: <CurrencyFace rate={currency} />, width: currencyWidth(currency) };
  const v = variantOf(ctx.variants, "crypto");
  const crypto = ctx.sample ? SAMPLE_MARKETS[v] : ctx.feed.crypto;
  const fits = crypto && crypto.kind === v && (ctx.sample || crypto.range === (ctx.marketRange ?? "1d"));
  return crypto && fits ? { node: <CryptoFace coin={crypto} />, width: cryptoWidth(crypto) } : null;
}
