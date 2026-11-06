import { invoke } from "@tauri-apps/api/core";
import { isNative } from "../../platform/native";

/**
 * The text `claude agents --json` printed (src-tauri/src/agents.rs). Rejects with a code: not-found, too-old, timeout,
 * too-big, busy or failed. In the browser the fake desktop answers (src/dev/agents-sample.ts).
 */
export function fetchAgentsText(): Promise<string> {
  if (isNative) return invoke<string>("agents_list");
  return import("../../dev/agents-sample").then((m) => m.sampleAgentsText());
}
