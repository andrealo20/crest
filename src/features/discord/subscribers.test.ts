import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Checkouts on Windows have CRLF line ends.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the notch reads from a call only whether there is one and whether you can be heard, so a speaking change leaves it alone", () => {
  // Rust sends the whole state with every SPEAKING_START and SPEAKING_STOP; the notch called both hooks at its top.
  const live = read("../../notch/live.tsx");
  const dots = read("../privacy/PrivacyDots.tsx");
  for (const [name, src] of [["live.tsx", live], ["PrivacyDots.tsx", dots]]) assert.doesNotMatch(src, /discordState\.use\(\)|useDiscordCall\(\)/, name);
  assert.ok(live.includes("useDiscord((s) => !!s.call) && discordOn"));
  assert.ok(dots.includes("useDiscord((s) => !!s.call && !s.call.mute)"));
  assert.ok(dots.includes("useDiscord((s) => s.call?.speaking === true)"));
  // Plain values only: an object picked anew on each read would draw the caller again every time, or never settle.
  assert.match(read("./store.ts"), /export const useDiscord = <T extends string \| number \| boolean \| null>/);
});
