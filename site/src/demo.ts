import { useCallback, useEffect, useRef, useState } from "react";

/** Where the embedded app lives: the app's own dev server while developing, the built copy in ./demo/ otherwise. */
export const DEMO_ORIGIN = import.meta.env.DEV ? "http://localhost:1430/" : "./demo/";
export const DEMO_SRC = `${DEMO_ORIGIN}?demo&bare&open&tool=overview`;
export const DEMO_FULL = `${DEMO_ORIGIN}?demo`;

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
  | { cmd: "pet"; on: boolean };

/** The postMessage contract with the demo (see the notes of the demo mode in src/dev/demo.ts). */
export function useDemo() {
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const queue = useRef<DemoMessage[]>([]);
  const [tool, setTool] = useState("overview");
  const [open, setOpen] = useState(true);
  const [isReady, setIsReady] = useState(false);

  const post = (m: DemoMessage) => frame.current?.contentWindow?.postMessage({ crest: "demo", ...m }, "*");

  const send = useCallback((m: DemoMessage) => {
    if (ready.current) post(m);
    else queue.current.push(m);
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data as { crest?: string; event?: string; tool?: string; open?: boolean };
      if (d?.crest !== "demo") return;
      if (d.event === "ready") {
        ready.current = true;
        setIsReady(true);
        for (const m of queue.current) post(m);
        queue.current = [];
      } else if (d.event === "tool" && d.tool) setTool(d.tool);
      else if (d.event === "open") setOpen(!!d.open);
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

  return { frame, send, tool, open, ready: isReady, setTool, onLoad };
}
