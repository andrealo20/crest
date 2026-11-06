import { useEffect, useRef, useState } from "react";
import { isNative } from "../../platform/native";
import { settings } from "../../settings/store";
import { API, pageUrl, parseRequest, toolId, type PluginManifest } from "./model";
import { plugins, clearPluginPill } from "./store";
import { handler } from "./PluginView";

function HeadlessPluginFrame({ manifest }: { manifest: PluginManifest }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [page, setPage] = useState<string | null>(null);

  useEffect(() => {
    if (!isNative) {
      void import("../../dev/demo-plugin").then((m) => m.getPluginPage(manifest.id)).then(setPage);
    }
  }, [manifest.id]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const handle = handler(manifest);
    const post = (msg: unknown) => el.contentWindow?.postMessage(msg, "*");
    const onMessage = (e: MessageEvent) => {
      if (!el.contentWindow || e.source !== el.contentWindow) return;
      const parsed = parseRequest(e.data);
      if (parsed.kind === "ignore") return;
      if (parsed.kind === "error") return post({ crest: API, id: parsed.id, ok: false, error: parsed.error });
      handle(parsed.req).then(
        (result) => post({ crest: API, id: parsed.id, ok: true, result: result ?? null }),
        (error) => post({ crest: API, id: parsed.id, ok: false, error: String(error).slice(0, 64) }),
      );
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      clearPluginPill(manifest.id);
    };
  }, [manifest, page]);

  if (!isNative && page === null) return null;

  return (
    <iframe
      ref={frame}
      {...(!isNative ? { srcDoc: page ?? "" } : { src: pageUrl(manifest) })}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      title={`${manifest.name} (Background)`}
      tabIndex={-1}
      aria-hidden="true"
      className="w-0 h-0 border-0"
    />
  );
}

/**
 * Runs enabled plugins in the background so their pills (crest.pill.set) stay live
 * and active even when the notch is closed or another tool is on screen.
 */
export function BackgroundRunner() {
  const list = plugins.use();
  const tools = settings.use().tools;

  const enabled = list.filter((m) => tools.some((t) => t.id === toolId(m.id) && t.enabled));

  return (
    <div className="fixed -top-[9999px] -left-[9999px] h-0 w-0 overflow-hidden pointer-events-none opacity-0" aria-hidden="true">
      {enabled.map((m) => (
        <HeadlessPluginFrame key={m.id} manifest={m} />
      ))}
    </div>
  );
}
