/**
 * When a forecast hour starts. Open-Meteo gives the place's clock time ("2026-11-04T15:00") and its UTC offset in seconds;
 * without the offset (forecasts saved before it was kept) the time is read in the PC's zone.
 */
export function hourStart(time: string, offset?: number): number {
  return offset === undefined ? new Date(time).getTime() : Date.parse(`${time}Z`) - offset * 1000;
}
