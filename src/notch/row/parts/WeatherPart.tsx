import { describe, useForecast, type Forecast } from "../../../features/weather/store";
import { useHue } from "../../../features/themes/hues";
import { formatTemp } from "../../../lib/format";
import { measureText } from "../measure";

/** The weather now while the part is on, read again every quarter of an hour (the row stays up for hours). */
export function useWeatherNow(on: boolean): Forecast["current"] | null {
  const f = useForecast(15 * 60_000, on);
  return on && f && f !== "error" ? f.current : null;
}

const ICON = 15, GAP = 4;

export const weatherWidth = (temp: number) => ICON + GAP + measureText(formatTemp(temp));

/** The weather's icon, in its colour while coloured icons are on, and the temperature. */
export function WeatherPart({ now }: { now: Forecast["current"] }) {
  const { icon: I, text, hue } = describe(now.code, now.day);
  const color = useHue(hue);
  return (
    <span className="flex items-center whitespace-nowrap text-footnote font-medium text-label" style={{ gap: GAP }} title={text}>
      <I size={ICON} weight="fill" className="shrink-0" style={color ? { color } : undefined} />
      <span className="tabular">{formatTemp(now.temp)}</span>
    </span>
  );
}
