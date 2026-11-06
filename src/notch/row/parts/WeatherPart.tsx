import { describe, useForecast, type Forecast } from "../../../features/weather/store";
import { isStale } from "../../../features/weather/stale";
import { useHue } from "../../../features/themes/hues";
import { formatTemp } from "../../../lib/format";
import { WIDEST } from "../../../features/system/format";
import { measureText } from "../measure";

/** The weather now while the part is on, read again every quarter of an hour (the row stays up for hours); none from a saved forecast hours old. */
export function useWeatherNow(on: boolean): Forecast["current"] | null {
  const f = useForecast(15 * 60_000, on);
  return on && f && f !== "error" && !isStale(f.savedAt, Date.now()) ? f.current : null;
}

const ICON = 15, GAP = 4;

/** The widest figure ("188°"), so a temperature gaining a digit or a sign moves no neighbour. */
export const weatherWidth = () => ICON + GAP + measureText(WIDEST.temp.replace(/[0-9]/g, "8"));

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
