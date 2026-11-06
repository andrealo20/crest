/** The value a slider takes for a key (arrows move by `step`, Home and End go to the ends); undefined for any other key. */
export function sliderKey(key: string, value: number, step: number, min: number, max: number): number | undefined {
  const to = key === "ArrowRight" || key === "ArrowUp" ? value + step : key === "ArrowLeft" || key === "ArrowDown" ? value - step : key === "Home" ? min : key === "End" ? max : undefined;
  return to === undefined ? undefined : Math.min(max, Math.max(min, to));
}
