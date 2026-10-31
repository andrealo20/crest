import { useNowPlaying } from "../platform/media";
import { useDiscordCall } from "../features/discord/store";
import { useGamingLive } from "../features/system/gaming";
import { timer } from "../features/timer/store";

/**
 * Which tool opening the notch jumps to, by priority: gaming mode (turned on deliberately)
 * before time-critical (timer, call) before background (music). The closed row shows them all side by side.
 */
export function useLiveActivity(): { id: string | null } {
  const gaming = useGamingLive();
  const t = timer.use();
  const call = useDiscordCall();
  const np = useNowPlaying();
  if (gaming) return { id: "system" };
  if (t.endsAt !== null || t.finished) return { id: "timer" };
  if (call) return { id: "discord" };
  if (np?.isPlaying) return { id: "media" };
  return { id: null };
}
