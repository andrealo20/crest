import { formatTemp } from "../../../lib/format";
import { CAPTION_FONT, measureTabular, measureText } from "../../../notch/row/measure";
import { WIDEST } from "../../system/format";
import { useHue } from "../../themes/hues";
import { describe, type Forecast } from "../../weather/store";
import type { BarFeed } from "../barStores";

/*
 * The weather's versions on Crest's bar beside today's temperature (WeatherPart): the icon alone, the icon with the temperature over
 * the conditions, and the next three hours. Each draws in the closed row's 30 px cell at a fixed width for its input.
 */

export const WEATHER_ICON = 15;
const GAP = 6, HOUR_ICON = 12;
/** The widest temperature, every digit an 8, as the page draws .tabular figures (in Material its own tnum widths). */
const widestTemp = (font?: string) => measureTabular(WIDEST.temp.replace(/[0-9]/g, "8"), font);

/** The condition's icon alone, in its colour while coloured icons are on. */
export function WeatherIcon({ now }: { now: Forecast["current"] }) {
  const { icon: I, text, hue } = describe(now.code, now.day);
  const color = useHue(hue);
  return (
    <span className="flex text-label" title={text}>
      <I size={WEATHER_ICON} weight="fill" className="shrink-0" style={color ? { color } : undefined} />
    </span>
  );
}

export const conditionWidth = (now: Forecast["current"]) => WEATHER_ICON + GAP + Math.max(widestTemp(), measureText(describe(now.code, now.day).text, CAPTION_FONT));

/** The icon, then the temperature over the conditions' words. */
export function WeatherCondition({ now }: { now: Forecast["current"] }) {
  const { icon: I, text, hue } = describe(now.code, now.day);
  const color = useHue(hue);
  return (
    <span className="flex items-center whitespace-nowrap text-label" style={{ gap: GAP, width: conditionWidth(now) }}>
      <I size={WEATHER_ICON} weight="fill" className="shrink-0" style={color ? { color } : undefined} />
      <span className="flex min-w-0 flex-col leading-[13px]">
        <span className="tabular text-footnote font-medium">{formatTemp(now.temp)}</span>
        <span className="text-caption font-medium text-label-2">{text}</span>
      </span>
    </span>
  );
}

const hourColumn = () => Math.max(HOUR_ICON, widestTemp(CAPTION_FONT));
export const hoursWidth = () => 3 * hourColumn() + 2 * GAP;

/** One hour: its icon over its temperature, in the hour's own colour while coloured icons are on. */
function Hour({ hour }: { hour: BarFeed["weatherHours"][number] }) {
  const { icon: I, text, hue } = describe(hour.code, hour.day);
  const color = useHue(hue);
  return (
    <span className="flex flex-col items-center gap-px" style={{ width: hourColumn() }} title={text}>
      {/* The place's clock time, for a screen reader: the face has no room to show it. */}
      <span className="sr-only">{hour.time.slice(11, 16)}</span>
      <I size={HOUR_ICON} weight="fill" className="shrink-0" style={color ? { color } : undefined} />
      <span className="tabular text-caption font-medium leading-none">{formatTemp(hour.temp)}</span>
    </span>
  );
}

/** The next three hours side by side. */
export function WeatherHours({ hours }: { hours: BarFeed["weatherHours"] }) {
  return (
    <span className="flex items-center whitespace-nowrap text-label" style={{ gap: GAP, width: hoursWidth() }}>
      {hours.slice(0, 3).map((h) => <Hour key={h.time} hour={h} />)}
    </span>
  );
}
