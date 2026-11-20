import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { CaretUpDown, Eye, EyeSlash, type Icon } from "@phosphor-icons/react";
import { design } from "../design/design";
import { popover, springs } from "../design/motion";
import { t } from "../i18n";
import { MENU_PANEL_CLASS, MENU_ROW_CLASS } from "./menu";
import { filledPress } from "./press";
import { arrowStep } from "./radioKeys";
import { sliderKey } from "./sliderKey";

/*
 * Shared controls. Every tool uses these instead of its own variants, so sizes,
 * radii and motion are identical everywhere.
 */

/** True inside the settings, whose wider rows Material sizes its controls for (the roomy: variant, with data-roomy on the same root). */
export const RoomyContext = createContext(false);

/** Segmented control with a sliding pill, as a radio group: Tab reaches the chosen segment, arrows move and pick. `id` must be unique per instance. */
export function Segmented<T extends string>(props: {
  id: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  label?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const h = props.size === "sm" ? "h-5 px-2" : "h-6 px-3";
  return (
    <div
      role="radiogroup"
      aria-label={props.label}
      className="flex shrink-0 rounded-full bg-fill-1 p-0.5 material:overflow-hidden material:bg-transparent material:shadow-[inset_0_0_0_1px_var(--color-label-3)]"
    >
      {props.options.map((o, i) => {
        const active = o.value === props.value;
        return (
          <button
            key={o.value}
            ref={(el) => void (refs.current[i] = el)}
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => props.onChange(o.value)}
            onKeyDown={(e) => {
              const step = arrowStep(e.key, getComputedStyle(e.currentTarget).direction === "rtl");
              if (!step) return;
              e.preventDefault();
              const j = (i + step + props.options.length) % props.options.length;
              props.onChange(props.options[j].value);
              refs.current[j]?.focus();
            }}
            className={`relative rounded-full text-caption font-medium transition-colors duration-150 ${h} roomy:h-7 roomy:px-3 roomy:text-footnote ${
              active ? "text-on-secondary-container" : "text-label-3 hover:text-label-2"
            }`}
          >
            {active && (
              <motion.span
                layoutId={`seg-${props.id}`}
                className="absolute inset-0 rounded-full bg-secondary-container"
                transition={springs.snappy}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Cards with a small drawing each, for choices that are easier seen than read. Radio group: Tab reaches the chosen card, arrows move and pick. */
export function StyleCards<T extends string>(props: {
  value: T;
  options: { value: T; label: ReactNode; preview: ReactNode; hint?: ReactNode }[];
  onChange: (v: T) => void;
  label?: string;
  /** Cards per row (default 3); with 2 each card lays its drawing beside its name and hint. */
  columns?: 2 | 3 | 4;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const wide = props.columns === 2;
  const pick = (i: number) => {
    const j = (i + props.options.length) % props.options.length;
    props.onChange(props.options[j].value);
    refs.current[j]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={props.label}
      className={`grid gap-2 ${
        wide ? "grid-cols-2" : `${props.columns === 4 ? "grid-cols-4" : "grid-cols-3"} roomy:grid-cols-[repeat(auto-fill,minmax(120px,1fr))]`
      }`}
    >
      {props.options.map((o, i) => {
        const active = o.value === props.value;
        return (
          <button
            key={o.value}
            ref={(el) => void (refs.current[i] = el)}
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => props.onChange(o.value)}
            onKeyDown={(e) => {
              const step = arrowStep(e.key, getComputedStyle(e.currentTarget).direction === "rtl");
              if (!step) return;
              e.preventDefault();
              pick(i + step);
            }}
            className={`pressable flex rounded-[10px] p-2 outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-label-3 material:rounded-[16px] ${
              wide ? "min-h-16 flex-row items-center gap-3 text-start" : "flex-col items-center gap-1.5"
            } ${active ? "bg-secondary-container text-on-secondary-container material:ring-2 material:ring-primary" : "bg-fill-2 text-label-3 hover:text-label-2"}`}
          >
            <span
              className={`flex items-start justify-center overflow-hidden rounded-[6px] bg-fill-1 material:rounded-[10px] ${
                wide ? "h-11 w-[72px] shrink-0" : "h-7 w-full"
              }`}
            >
              {o.preview}
            </span>
            {wide ? (
              <span className="flex min-w-0 flex-col">
                <span className="text-body font-semibold">{o.label}</span>
                {o.hint && <span className="text-caption text-label-2">{o.hint}</span>}
              </span>
            ) : (
              <span className="text-caption font-medium">{o.label}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The knob of the settings' switch under Material: 16 px off, 24 on, 28 while pressed, sliding 20 px. */
const KNOB = {
  off: { transform: "translateX(0px) scale(0.571)" },
  on: { transform: "translateX(20px) scale(0.857)" },
  pressed: (on: boolean) => ({ transform: `translateX(${on ? 20 : 0}px) scale(1)` }),
} satisfies Variants;

/** iOS switch. Green like Apple's; the knob slides with a spring. Under Material it takes the primary colour, and Material's own size in the settings. */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  // Motion's values cannot read the roomy: variant, so the size is chosen here.
  const style = design.use();
  const roomy = useContext(RoomyContext) && style === "material";
  if (roomy)
    return (
      <motion.button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        initial={false}
        animate={checked ? "on" : "off"}
        whileTap="pressed"
        className="relative h-8 w-[52px] shrink-0 rounded-full bg-fill-3 shadow-[inset_0_0_0_2px_var(--color-label-3)] rtl:-scale-x-100"
      >
        {/* Colours change as layers in opacity, so nothing repaints while they fade. */}
        <span className={`absolute inset-0 rounded-full bg-primary transition-opacity duration-200 ${checked ? "opacity-100" : "opacity-0"}`} />
        <motion.span className="absolute top-[2px] left-[2px] size-7 rounded-full" variants={KNOB} custom={checked} transition={springs.pop}>
          <span className={`absolute inset-0 rounded-full bg-label-3 transition-opacity duration-200 ${checked ? "opacity-0" : "opacity-100"}`} />
          <span className={`absolute inset-0 rounded-full bg-on-primary transition-opacity duration-200 ${checked ? "opacity-100" : "opacity-0"}`} />
        </motion.span>
      </motion.button>
    );
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`pressable relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors duration-200 rtl:-scale-x-100 ${checked ? "bg-green material:bg-primary" : "bg-fill-3"}`}
    >
      <motion.span
        className={`absolute top-[2px] left-[2px] size-[14px] rounded-full bg-white shadow-sm material:shadow-none ${checked ? "material:bg-on-primary" : "material:bg-label-3"}`}
        initial={false}
        animate={{
          transform: checked ? "translateX(12px)" : "translateX(0px)",
        }}
        transition={springs.snappy}
      />
    </button>
  );
}

/** Small labelled switch for an item's own options, inside its row (a closed part's, a bar widget's). */
export function SubSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <span className="flex items-center gap-1.5 text-caption text-label-3 select-none">
      {label}
      <Switch label={label} checked={checked} onChange={onChange} />
    </span>
  );
}

/** Row in settings lists: label on the left, control on the right. The data attributes feed the settings search. */
export function Row({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div data-row className="flex min-h-9 items-center justify-between gap-3 px-3 py-1.5">
      <div className="min-w-0">
        <div data-row-label className="truncate text-body text-label">{label}</div>
        {hint && <div data-row-hint className="text-caption text-label-3 [overflow-wrap:anywhere]">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/** Grouped list with fine separators (like iOS Settings). */
export function Group({
  title,
  children,
  id,
}: {
  title?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-2">
      {title && (
        <h3 className="mb-1 px-3 text-caption font-medium tracking-wide text-label-3 uppercase">
          {title}
        </h3>
      )}
      <div className="divide-y divide-separator overflow-hidden rounded-[12px] bg-fill-1">
        {children}
      </div>
    </section>
  );
}

/** Single-line field. `secret` masks it and offers show/hide. */
export function TextField(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secret?: boolean;
  onSubmit?: () => void;
  width?: string;
  /** Shows a secret from outside (e.g. right after generating a password). */
  revealed?: boolean;
  autoFocus?: boolean;
  /** Red outline, for a value that is not accepted. */
  invalid?: boolean;
  onBlur?: () => void;
}) {
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    if (props.revealed !== undefined) setReveal(props.revealed);
  }, [props.revealed]);
  return (
    <div
      className={`flex h-7 items-center gap-1 rounded-[8px] bg-fill-2 px-2 material:border material:border-label-3 material:bg-transparent material:focus-within:border-2 material:focus-within:px-[7px] roomy:h-8 ${props.width ?? "w-44"} ${props.invalid ? "ring-1 ring-red material:border-red material:ring-0" : "material:focus-within:border-primary"}`}
    >
      <input
        value={props.value}
        type={props.secret && !reveal ? "password" : "text"}
        spellCheck={false}
        autoComplete="off"
        placeholder={props.placeholder}
        ref={(el) => {
          if (props.autoFocus && el && !el.dataset.focused) {
            el.dataset.focused = "1";
            el.focus({ preventScroll: true });
          }
        }}
        onChange={(e) => props.onChange(e.target.value)}
        onBlur={props.onBlur}
        onKeyDown={(e) => e.key === "Enter" && props.onSubmit?.()}
        className="min-w-0 flex-1 bg-transparent text-footnote text-label outline-none placeholder:text-label-4"
      />
      {props.secret && props.value && (
        <button
          aria-label={reveal ? t("Verbergen") : t("Anzeigen")}
          onClick={() => setReveal((r) => !r)}
          className="text-label-3 hover:text-label-2"
        >
          {reveal ? (
            <EyeSlash size={13} weight="bold" />
          ) : (
            <Eye size={13} weight="bold" />
          )}
        </button>
      )}
    </div>
  );
}

/** Material's hover shadow and tone layer of a filled or tonal button (global.css .m3-lift). None in Crest, where they would not be absolute and the gap would count them. */
export function M3Layers() {
  if (design.use() !== "material") return null;
  return (
    <>
      <span aria-hidden className="m3-shadow" />
      <span aria-hidden className="m3-tone" />
    </>
  );
}

/** Small text button (secondary, tonal under Material) or filled (primary). */
export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  icon?: Icon;
}) {
  const I = props.icon;
  const tap = filledPress(design.use(), useReducedMotion() === true);
  const press = props.disabled ? {} : tap;
  return (
    <motion.button
      onClick={props.onClick}
      disabled={props.disabled}
      {...press}
      // Motion springs back to the transform it read at rest, and the computed "none" reads as scale(0).
      style={press.whileTap && { transform: "scale(1)" }}
      className={`pressable m3-morph m3-lift flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-footnote font-medium disabled:opacity-35 material:disabled:bg-fill-2 material:disabled:text-label-4 material:disabled:opacity-100 roomy:h-8 roomy:px-3 ${
        props.primary
          ? "m3-filled bg-primary text-on-primary"
          : "pressable-fill bg-fill-2 text-label material:bg-secondary-container material:text-on-secondary-container"
      }`}
    >
      <M3Layers />
      {I && <I size={13} weight="bold" />}
      {props.children}
    </motion.button>
  );
}

/** Fill level 0–100 with traffic-light color (green → orange → red). Only transform animates. */
export function Meter({
  percent,
  height = 6,
  color,
}: {
  percent: number;
  height?: number;
  color?: string;
}) {
  const p = Math.max(0, Math.min(100, percent));
  const tint =
    color ??
    (p >= 85
      ? "var(--color-red)"
      : p >= 60
        ? "var(--color-orange)"
        : "var(--color-green)");
  return (
    <div
      className="relative w-full overflow-hidden rounded-full bg-fill-2"
      style={{ height }}
    >
      <motion.div
        className="absolute inset-0 origin-left rounded-full rtl:origin-right"
        style={{ backgroundColor: tint }}
        initial={{ transform: "scaleX(0)" }}
        animate={{ transform: `scaleX(${p / 100})` }}
        transition={springs.morph}
      />
    </div>
  );
}

/** Empty state: calm, centered, one sentence, optionally an action. */
export function Empty(props: {
  icon?: Icon;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  const I = props.icon;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-6 pb-2 text-center">
      {I && <I size={22} weight="duotone" className="mb-1 text-label-3" />}
      <span className="text-body text-label-2">{props.title}</span>
      {props.text && (
        <span className="max-w-72 text-caption text-label-3">{props.text}</span>
      )}
      {props.action && <div className="mt-2">{props.action}</div>}
    </div>
  );
}

/** Hidden content (presentation mode): soft bars where the text would be. */
export function Redacted({ lines = 2, className = "" }: { lines?: number; className?: string }) {
  return (
    <div role="img" aria-label={t("Ausgeblendet")} className={`flex flex-col gap-1.5 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="h-2 rounded-full bg-fill-2" style={{ width: i === lines - 1 && lines > 1 ? "55%" : "100%" }} />
      ))}
    </div>
  );
}

/** Slider. Drags via pointer capture; arrow keys ±step, Home and End. */
export function Slider(props: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
  /** A tick on the track at this value (the glass's safe Transparency). */
  mark?: number;
  /** What a screen reader says for the value, when the number alone is not it. */
  valueText?: string;
  /** The drag let go, or a key that moved the value came up (once for a held key): for a setting written once instead of live. */
  onRelease?: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const step = props.step ?? 1;
  const ratio = (props.value - props.min) / (props.max - props.min);
  const set = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const raw =
      props.min +
      Math.min(1, Math.max(0, (clientX - r.left) / r.width)) *
        (props.max - props.min);
    props.onChange(Math.round(raw / step) * step);
  };
  return (
    <div
      ref={track}
      // Filled from the left in every language, like the music scrubber: the pointer math reads from the left too.
      dir="ltr"
      role="slider"
      tabIndex={0}
      aria-label={props.label}
      aria-valuenow={props.value}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuetext={props.valueText}
      className="relative flex h-5 w-full cursor-pointer touch-none items-center rounded-full outline-none focus-visible:ring-1 focus-visible:ring-label-3"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        set(e.clientX);
      }}
      onPointerMove={(e) =>
        e.currentTarget.hasPointerCapture(e.pointerId) && set(e.clientX)
      }
      onLostPointerCapture={props.onRelease}
      onKeyDown={(e) => {
        const to = sliderKey(e.key, props.value, step, props.min, props.max);
        if (to === undefined) return;
        e.preventDefault();
        props.onChange(to);
      }}
      // A held key repeats keydown only. Blur too, for a key held while the focus leaves.
      onKeyUp={props.onRelease}
      onBlur={props.onRelease}
    >
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-fill-2 material:bg-fill-3">
        <div
          className="absolute inset-0 origin-left rounded-full bg-label-2 material:bg-primary"
          style={{ transform: `scaleX(${ratio})` }}
        />
      </div>
      {/* Outside the track, which clips; taller than the knob, so it shows with the knob on it. */}
      {props.mark !== undefined && (
        <span
          aria-hidden
          className="absolute top-1/2 h-[18px] w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-label-3"
          style={{ left: `${((props.mark - props.min) / (props.max - props.min)) * 100}%` }}
        />
      )}
      <span
        className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.5)] material:bg-primary material:shadow-none roomy:size-5"
        style={{ left: `${ratio * 100}%` }}
      />
    </div>
  );
}

/** Compact select menu (instead of a native <select>, which looks foreign on Windows). */
/*
 * The menu is portaled into the body so overflow containers don't clip it, and so the
 * notch's frame on a bottom or side edge (edge.ts) neither turns it nor moves its fixed
 * position. `data-notch-menu` keeps a click in it inside the notch (Notch.tsx). It opens
 * toward the side with more room and stays inside the notch's hit zone.
 */
const MENU_ROW = 28;
const MENU_MAX = 160;
const MENU_GAP = 4;
const MENU_EDGE = 8;

type MenuPos = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  up: boolean;
  maxHeight: number;
  zoom: number;
};

export function Select<T extends string>(props: {
  value: T;
  /** `font`: the label drawn in that font family (a font picker shows each font as itself). */
  options: { value: T; label: string; font?: string }[];
  onChange: (v: T) => void;
  width?: string;
  /** Own trigger: its content, look and name, and a menu width of its own when the trigger is small. */
  trigger?: { content: ReactNode; className: string; label: string; menuWidth?: number };
  /** The menu's tallest height, CSS px, for a long list with room around it; still clamped to the room above or below. MENU_MAX without it. */
  menuMax?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const measure = () => {
    const trigger = ref.current?.getBoundingClientRect();
    if (!trigger) return;
    const bounds = ref.current
      ?.closest("[data-notch-hit]")
      ?.getBoundingClientRect();
    const minY = (bounds?.top ?? 0) + MENU_EDGE;
    const maxY =
      Math.min(bounds?.bottom ?? window.innerHeight, window.innerHeight) -
      MENU_EDGE;
    const wanted = Math.min(props.menuMax ?? MENU_MAX, props.options.length * MENU_ROW + 8);
    const below = maxY - trigger.bottom - MENU_GAP;
    const above = trigger.top - minY - MENU_GAP;
    const up = below < wanted && above > below;
    const room = up ? above : below;
    // The list is portaled out of the notch's layer, which the browser demo draws with CSS zoom (src/notch/viewZoom.ts):
    // it takes the trigger's zoom, and the measured px (unzoomed) are divided by it. Natively it is 1.
    const z = (ref.current as { currentCSSZoom?: number } | null)?.currentCSSZoom ?? 1;
    const width = props.trigger?.menuWidth ? props.trigger.menuWidth * z : trigger.width;
    setPos({
      left: Math.max(MENU_EDGE, Math.min(trigger.left, window.innerWidth - MENU_EDGE - width)) / z,
      width: width / z,
      up,
      zoom: z,
      maxHeight: Math.max(MENU_ROW + 8, Math.min(wanted, room)) / z,
      ...(up
        ? { bottom: (window.innerHeight - trigger.top + MENU_GAP) / z }
        : { top: (trigger.bottom + MENU_GAP) / z }),
    });
  };

  useLayoutEffect(() => {
    if (open) measure();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menu.current?.contains(t))
        setOpen(false);
    };
    const close = () => setOpen(false);
    // Scrolling the list behind moves the trigger → close; our own list doesn't.
    const onScroll = (e: Event) =>
      !menu.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const current = props.options.find((o) => o.value === props.value);
  const style = design.use();
  return (
    <div ref={ref} className={`relative ${props.width ?? "w-28"}`}>
      {props.trigger ? (
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={props.trigger.label}
          aria-expanded={open}
          title={props.trigger.label}
          className={props.trigger.className}
        >
          {props.trigger.content}
        </button>
      ) : (
        <button
          onClick={() => setOpen((o) => !o)}
          className="pressable pressable-fill flex h-7 w-full items-center justify-between gap-1 rounded-[8px] bg-fill-2 px-2 text-footnote text-label material:rounded-full roomy:h-8"
        >
          <span className="truncate" style={current?.font ? { fontFamily: current.font } : undefined}>
            {current?.label}
          </span>
          <CaretUpDown
            size={11}
            weight="bold"
            className="shrink-0 text-label-3"
          />
        </button>
      )}
      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              ref={menu}
              data-notch-menu
              className={MENU_PANEL_CLASS}
              style={{
                left: pos.left,
                width: pos.width,
                top: pos.top,
                bottom: pos.bottom,
                maxHeight: pos.maxHeight,
                zoom: pos.zoom !== 1 ? pos.zoom : undefined,
                transformOrigin: pos.up ? "50% 100%" : "50% 0",
              }}
              initial={{
                opacity: 0,
                transform: `scale(${style === "material" ? 0.8 : 0.96}) translateY(${pos.up ? 2 : -2}px)`,
              }}
              animate={{
                opacity: 1,
                transform: "scale(1) translateY(0px)",
                transition: popover.enter,
              }}
              exit={{
                opacity: 0,
                transform: "scale(0.98)",
                transition: popover.exit,
              }}
            >
              {props.options.map((o) => (
                <button
                  key={o.value}
                  onClick={() => {
                    props.onChange(o.value);
                    setOpen(false);
                  }}
                  // A row is one line: a long window title is cut, and shown whole on hover.
                  title={o.label}
                  className={`${MENU_ROW_CLASS} ${o.value === props.value ? "text-label material:bg-secondary-container material:text-on-secondary-container" : "text-label-2"}`}
                >
                  <span className="truncate" style={o.font ? { fontFamily: o.font } : undefined}>
                    {o.label}
                  </span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

/** Calm loading placeholder (pulsing area instead of a spinner). */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`motion-safe:animate-pulse rounded-[8px] bg-fill-1 ${className}`} />
  );
}
