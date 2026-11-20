import { SquaresFour } from "../../ui/iconset";

/** An app's icon (a PNG data URL), or a plain tile while it has none. A module of its own, so the bar can draw it without the Launcher. */
export function AppIcon({ src, size }: { src: string | null | undefined; size: number }) {
  if (src) return <img src={src} alt="" draggable={false} className="shrink-0" style={{ width: size, height: size }} />;
  return (
    <span className="flex shrink-0 items-center justify-center rounded-[8px] bg-fill-2 text-label-3" style={{ width: size, height: size }}>
      <SquaresFour size={size / 2} weight="bold" />
    </span>
  );
}
