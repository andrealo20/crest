/** When the equalizer's loop (Equalizer.tsx) draws a frame, writes a bar and sleeps. Pure, tested in pacing.test.ts. */

/**
 * Least time between two drawn frames (ms), per look. Always whole frames, so the pacing stays even.
 * - The four bars run as long as music plays, in the closed row and on the bar, so they draw about 30 fps: 32 ms is below two 60 Hz
 *   frames with room for timer jitter, so 60 Hz draws every 2nd frame, 120 Hz every 4th, 144 Hz every 5th (29 fps), 165 Hz every 6th
 *   (28 fps), 240 Hz every 8th, and 75 or 100 Hz at 25 fps. The levels come about 30 times a second (audio.rs), so more frames add
 *   no motion.
 * - The Music tool's Spectrum and Wave, bigger and shown only while the tool is open, keep about 60 fps: 13 ms is below one 60 Hz frame,
 *   so 144 Hz draws every 2nd frame (72 fps), 165 Hz every 3rd (55 fps), 240 Hz every 4th.
 */
export const FRAME_MS = { bars: 32, spectrum: 13, wave: 13 } as const;

/** Whether the frame at `now` draws, the last one having drawn at `last`. */
export const due = (now: number, last: number, every: number) => now - last >= every;

/**
 * How long the loop sleeps on a timer after a drawn frame (ms, from that frame's time) before asking for frames again, so the
 * vsyncs in between do not wake the page for nothing (at 144 Hz, 2 of the 4 between two frames of the bars). 18 ms short of
 * `every`: room for a timer that waits for Windows' 15.6 ms tick, as on battery, and for the frame request. At or below 0 there
 * is no room, and the loop keeps requestAnimationFrame.
 */
export const napMs = (every: number) => every - 18;

/** A move smaller than this does not show (0.02 px on a 12 px bar): it is not written, and the loop may sleep there. */
export const EPSILON = 0.002;

/** Whether a bar drawn at `drawn` needs `value` written. */
export const moved = (value: number, drawn: number) => Math.abs(value - drawn) >= EPSILON;

/**
 * Whether the loop may stop scheduling frames: every bar within EPSILON of where it is heading, and nothing that moves it on its own.
 * While `playing`, the synthetic motion and the breathing on silence do; real levels that are `sounding` only change when the next
 * ones arrive, and those wake the loop.
 */
export function rests(values: readonly number[], targets: readonly number[], playing: boolean, sounding: boolean): boolean {
  return (!playing || sounding) && values.every((v, i) => Math.abs(targets[i] - v) < EPSILON);
}
