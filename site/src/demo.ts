import { useCallback, useEffect, useRef, useState } from "react";

/** Where the embedded app lives: the app's own dev server while developing, the built copy in ./demo/ otherwise. */
export const DEMO_ORIGIN = import.meta.env.DEV ? "http://localhost:1420/" : "/demo/";
export const DEMO_SRC = `${DEMO_ORIGIN}?demo&bare&open&tool=overview`;
export const DEMO_FULL = `${DEMO_ORIGIN}?demo`;
const DEMO_HOST = new URL(DEMO_ORIGIN, location.href).origin;

export type DemoMessage =
  | { cmd: "navigate"; tool: string }
  | { cmd: "open" }
  | { cmd: "close" }
  | { cmd: "notice"; kind: string }
  | { cmd: "play" }
  | { cmd: "pause" }
  | { cmd: "lang"; code: string }
  | { cmd: "style"; style: string }
  | { cmd: "edge"; edge: string }
  | { cmd: "theme"; id: string }
  | { cmd: "pet"; on: boolean; kind?: string }
  | { cmd: "scale"; value: number }
  | { cmd: "cover"; on: boolean }
  | { cmd: "search"; engine: string };

/** What the demo reports about itself (event "state"), however it changed: a page command or the visitor in Settings. */
export interface DemoState { lang: string; theme: string; style: string; edge: string; pet: string | null; scale: number; cover: boolean; search: string }
const START: DemoState = { lang: "en", theme: "dark", style: "notch", edge: "top", pet: null, scale: 100, cover: false, search: "off" };

/** The postMessage contract with the demo (see the notes of the demo mode in src/dev/demo.ts). */
export function useDemo() {
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const queue = useRef<DemoMessage[]>([]);
  const [tool, setTool] = useState("overview");
  const [open, setOpen] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [state, setState] = useState<DemoState>(START);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const post = (m: DemoMessage) => frame.current?.contentWindow?.postMessage({ crest: "demo", ...m }, DEMO_HOST);

  const send = useCallback((m: DemoMessage) => {
    if (ready.current) post(m);
    else queue.current.push(m);
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.origin !== DEMO_HOST) return;
      const d = e.data as Partial<DemoState> & { crest?: string; event?: string; tool?: string; open?: boolean; w?: number; h?: number };
      if (d?.crest !== "demo") return;
      if (d.event === "ready") {
        ready.current = true;
        setIsReady(true);
        for (const m of queue.current) post(m);
        queue.current = [];
      } else if (d.event === "tool" && d.tool) setTool(d.tool);
      else if (d.event === "open") setOpen(!!d.open);
      else if (d.event === "size" && d.w && d.h) setSize({ w: d.w, h: d.h });
      else if (d.event === "state") {
        setState((s) => ({
          lang: d.lang ?? s.lang,
          theme: d.theme ?? s.theme,
          style: d.style ?? s.style,
          edge: d.edge ?? s.edge,
          pet: d.pet === undefined ? s.pet : d.pet,
          scale: d.scale ?? s.scale,
          cover: d.cover ?? s.cover,
          search: d.search ?? s.search,
        }));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // If the demo never says "ready" (an older build), flush the queue once the frame has loaded.
  const onLoad = useCallback(() => {
    window.setTimeout(() => {
      if (ready.current) return;
      ready.current = true;
      for (const m of queue.current) post(m);
      queue.current = [];
    }, 2500);
  }, []);

  /** The chips show a press at once; the demo's "state" event then confirms it, or corrects it. */
  const patch = useCallback((p: Partial<DemoState>) => setState((s) => ({ ...s, ...p })), []);

  return { frame, send, tool, open, ready: isReady, setTool, onLoad, state, patch, size };
}
