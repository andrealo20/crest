import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { DEMO_FULL, DEMO_SRC } from "./demo";
import { TOOLS } from "./data";

/** The logical size of the demo's screen: the open panel is at most 740 x 540. */
const W = 800;
const H = 580;

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
  onLoad: () => void;
}

export function Stage({ frame, tool, open, onLoad }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.9);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const label = TOOLS[tool]?.label ?? (tool === "settings" ? "Settings" : tool === "setup" ? "Setup" : tool === "whatsnew" ? "What's new" : tool);

  return (
    <div className="stage">
      <div className="screen" ref={box} style={{ aspectRatio: `${W} / ${H}` }}>
        <div className="canvas" style={{ width: W, height: H, transform: `scale(${scale})` }}>
          <iframe
            ref={frame}
            src={DEMO_SRC}
            title="Crest, live demo: the real notch running on sample data"
            width={W}
            height={H}
            allow="clipboard-write; camera"
            onLoad={onLoad}
          />
        </div>
      </div>
      <div className="stage-bar">
        <p className="stage-now" aria-live="polite">
          <span className="dot" aria-hidden="true" />
          {open ? `Showing ${label}` : "Closed notch, hover or tap it to open"}
        </p>
        <a className="stage-full" href={DEMO_FULL}>
          Open the demo full screen <ArrowSquareOut size={18} weight="bold" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
