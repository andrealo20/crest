import { createStore } from "../../lib/store";

/** Whether the closed row is on screen (notch closed or peeking, not the line, not focus, not hidden for fullscreen). CompactRow sets it while mounted; the usage and system polling read it. */
export const rowVisible = createStore(false);
