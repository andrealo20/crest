/** What a click on a card in the clipboard history does. */
export type ClickAction = "preview" | "paste" | "copy";

/**
 * `paste`: Settings → Tools → Clipboard → Paste directly is on. `hidden`: presentation mode, which redacts the cards and
 * hides the images (ClipboardView): a click there only copies, since a paste would show the entry in the app on screen.
 */
export function clickAction(item: { thumbnail: string | null }, { paste, hidden }: { paste: boolean; hidden: boolean }): ClickAction {
  if (hidden) return "copy";
  if (item.thumbnail) return "preview";
  return paste ? "paste" : "copy";
}
