import { useEffect, useState } from "react";

/** A desktop: room for the side by side layouts, and a mouse, which the demo's taskbar needs (src/dev/demo.ts). */
const QUERY = "(min-width: 1000px) and (pointer: fine)";

export function useWide() {
  const [wide, setWide] = useState(() => matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = matchMedia(QUERY);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}
