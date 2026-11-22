// The note's first line as the bar's Note preview shows it. Pure, so it is tested without the app around it.

/** The first line with text from the first 4000 characters, its spaces folded, at most 200 characters; "" for a note without text. */
export function noteLine(text: string): string {
  const line = text.slice(0, 4000).split(/[\r\n]/).find((l) => l.trim()) ?? "";
  // By code points, so an emoji at the cut stays whole.
  return Array.from(line.replace(/\s+/g, " ").trim()).slice(0, 200).join("");
}
