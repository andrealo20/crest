import { locale } from "../../../i18n";
import { CAPTION_FONT, measureTabular, measureText } from "../../../notch/row/measure";
import type { BarFeed } from "../barStores";
import { rateText } from "../markets";
import type { Body, WidgetContext } from "./Widget";

/*
 * The faces of the bar's Exchange rate and Crypto widgets: the rate of one unit over its pair. As wide as its widest figures, every
 * digit an 8, so a new reading moves nothing.
 */

type Rate = NonNullable<BarFeed["currency"]>;

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

/** The exchange rate or the coin as the bar draws it; null before the first read, and the bar draws its icon. */
export function marketPart(id: "currency" | "crypto", ctx: WidgetContext): Body | null {
  const { currency } = ctx.feed;
  return id === "currency" && currency ? { node: <CurrencyFace rate={currency} />, width: currencyWidth(currency) } : null;
}
