/*
 * The offline translator in the browser (the try-it demo, npm run dev): one model, Spanish to English, that knows only the sentences
 * below, each with its real translation. Any other text answers "app only", as without it, so the demo never makes up a translation.
 */
import type { OfflineStatus } from "../features/now-playing/offlineEngine";

export const SAMPLE_STATUS: OfflineStatus = { engine: true, pairs: [["es-en", 0, false]] };

const ES_EN: Record<string, string> = {
  "Mañana tengo una reunión a las diez. ¿Puedes enviarme el informe antes?": "I have a meeting at ten tomorrow. Can you send me the report before then?",
};

/** The lines in English when the way is Spanish to English and every line is a known sentence; otherwise the app's own error. */
export function translateSample(pairs: [string, string][], lines: string[]): string[] {
  const known = pairs.length === 1 && pairs[0][0] === "es" && pairs[0][1] === "en" && lines.every((l) => l in ES_EN);
  if (!known) throw new Error("app only");
  return lines.map((l) => ES_EN[l]);
}
