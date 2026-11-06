import { windowShell } from "../../platform/services";
import { settings } from "../../settings/store";

/** Rust starts with Crest visible to other apps' captures, so only a change from that is sent. */
let sent = false;

/** Hide Crest from screen sharing and recordings: Rust gets the saved choice at start and every change after it. */
export function startMeeting() {
  const sync = () => {
    const on = settings.get().presentation.hideFromCapture === true;
    if (on === sent) return;
    sent = on;
    windowShell.hideFromCapture(on);
  };
  sync();
  settings.subscribe(sync);
}
