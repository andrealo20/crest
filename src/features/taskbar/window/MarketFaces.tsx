import { locale } from "../../../i18n";
import { formatMoney, formatPercent } from "../../../lib/format";
import { CAPTION_FONT, measureTabular, measureText } from "../../../notch/row/measure";
import type { BarFeed } from "../barStores";
import { changeTone, rateText, spanPoints, type Tone } from "../markets";
import type { Body, WidgetContext } from "./Widget";

/*
 * The faces of the bar's Exchange rate and Crypto widgets: the rate of one unit over its pair, and a coin's last day as a small line
 * beside its price over its symbol and change. Each as wide as its widest figures, every digit an 8, so a new reading moves nothing.
 */

type Rate = NonNullable<BarFeed["currency"]>;
type Coin = NonNullable<BarFeed["crypto"]>;

/** The coin's line on the bar: its last 24 hours, 25 of the feed's hourly points, in a 28 by 14 box. */
const DAY_POINTS = 25, LINE_W = 28, LINE_H = 14, GAP = 6;
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

/** The price as the bar shows it: whole units from 1,000 up, where the cents only take room. */
const priceText = (c: Coin) => formatMoney(c.price, c.base, { compact: c.price >= 1000 });

const cryptoWidth = (c: Coin) => LINE_W + GAP + Math.max(widest(priceText(c)), measureText(`${c.symbol} `, CAPTION_FONT) + widest(formatPercent(-88.88), CAPTION_FONT));

/** The coin's last day as a line in its change's colour, then its price over its symbol and its change over 24 hours. */
function CryptoFace({ coin: c }: { coin: Coin }) {
  const tone = TONE[changeTone(c.change)];
  const pts = spanPoints(c.line.slice(-DAY_POINTS), LINE_W, LINE_H), line = pts.map((p) => p.join(",")).join(" ");
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
          {c.symbol}
          {c.change !== null && <span className={`tabular ${tone}`}> {formatPercent(c.change)}</span>}
        </span>
      </span>
    </span>
  );
}

/** The exchange rate or the coin as the bar draws it; null before the first read, and the bar draws its icon. */
export function marketPart(id: "currency" | "crypto", ctx: WidgetContext): Body | null {
  const { currency, crypto } = ctx.feed;
  if (id === "currency") return currency && { node: <CurrencyFace rate={currency} />, width: currencyWidth(currency) };
  return crypto && { node: <CryptoFace coin={crypto} />, width: cryptoWidth(crypto) };
}
