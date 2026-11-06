import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowSquareOut } from "./icons";
import { DEMO_FULL, DEMO_SRC } from "./demo";
import { TOOLS } from "./data";

/**
 * The embedded app lives in a frame of its own logical size, wider than the open panel (at most 740 x 540) so the pet's
 * nest beside a closed notch fits. The stage shows a window onto that frame:
 * - wide: nearly all of it;
 * - narrow (a phone): only as much as the notch needs, from the size the demo reports, so the panel fills the width.
 */
const IW = 900;
const IH = 580;
const WIDE_FROM = 640;
const PAD = 24;
const NEST = 64;
/** The shortest and the tallest the narrow window gets, as a share of the stage's width. */
const NARROW_RATIO = 0.74;

/** A coloured field that crossfades (opacity only) when its colour changes. */
export function Wash({ color }: { color: string }) {
  const [layers, setLayers] = useState([{ color, key: 0 }]);
  useEffect(() => {
    setLayers((l) => (l[l.length - 1].color === color ? l : [l[l.length - 1], { color, key: l[l.length - 1].key + 1 }]));
  }, [color]);
  return (
    <div className="wash" aria-hidden="true">
      {layers.map((l) => (
        <div key={l.key} className={l.key > 0 ? "wash-layer wash-in" : "wash-layer"} style={{ background: l.color }} />
      ))}
    </div>
  );
}

interface Props {
  frame: React.RefObject<HTMLIFrameElement | null>;
  tool: string;
  open: boolean;
  size: { w: number; h: number } | null;
  edge: string;
  pet: boolean;
  onLoad: () => void;
  onOpen: () => void;
}

/** Which part of the frame the stage shows, and how large. Pure, so it is easy to check. */
export function fit(stageW: number, size: Props["size"], edge: string, pet: boolean) {
  if (stageW >= WIDE_FROM) {
    const w = 850;
    return { scale: stageW / w, x: edge === "left" ? 0 : IW - w, y: 0, h: Math.round((stageW * IH) / w) };
  }
  const nw = size?.w ?? 520;
  const nh = size?.h ?? 360;
  const h = Math.round(stageW * NARROW_RATIO);
  const left = edge === "left" ? 0 : PAD;
  const right = edge === "right" ? 0 : pet && edge !== "left" ? NEST : PAD;
  // On a side edge the nest stands below the column (the default side runs down the edge).
  const below = pet && (edge === "left" || edge === "right") ? NEST : 0;
  const scale = Math.min(stageW / (nw + left + right), h / (nh + below + 2 * PAD), 1.2);
  const notchX = edge === "left" ? 0 : edge === "right" ? IW - nw : (IW - nw) / 2;
  const view = h / scale;
  const y = edge === "bottom" ? IH - view : edge === "top" ? 0 : (IH + below - view) / 2;
  return { scale, x: Math.max(0, Math.min(IW - stageW / scale, notchX - left)), y: Math.max(0, Math.min(IH - view, y)), h };
}

export function Stage({ frame, tool, open, size, edge, pet, onLoad, onOpen }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [settled, setSettled] = useState(false);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // No glide on the very first fit.
  useEffect(() => {
    const id = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const f = fit(width, size, edge, pet);
  const label = TOOLS[tool]?.label ?? (tool === "settings" ? "Settings" : tool === "setup" ? "Setup" : tool === "whatsnew" ? "What's new" : tool === "plugin:hello-crest" ? "Hello Crest" : tool);

  return (
    <div className="stage">
      <div className="screen" ref={box} style={{ height: f.h }}>
        <div
          className={`canvas${settled ? " glide" : ""}`}
          style={{ width: IW, height: IH, transform: `translate(${-f.x * f.scale}px, ${-f.y * f.scale}px) scale(${f.scale})` }}
        >
          <iframe
            ref={frame}
            src={DEMO_SRC}
            title="Crest, live demo: the real notch running on sample data"
            width={IW}
            height={IH}
            allow="clipboard-write; camera"
            loading="lazy"
            onLoad={onLoad}
          />
        </div>
        {!open && (
          <button type="button" className="stage-hint" onClick={onOpen}>
            The notch is closed. Click here to open it.
          </button>
        )}
      </div>
      <div className="stage-bar">
        <p className="stage-now">
          <span className="dot" aria-hidden="true" />
          {open ? `Showing ${label}` : "Closed notch"}
        </p>
        <a className="stage-full" href={DEMO_FULL}>
          Open the demo full screen <ArrowSquareOut size={18} weight="bold" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
