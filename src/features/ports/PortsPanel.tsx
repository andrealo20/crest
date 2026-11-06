import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowSquareOut, CaretDown, CaretUp, Check, Copy, Globe, LockSimple, PlugsConnected, X } from "@phosphor-icons/react";
import { fade } from "../../design/motion";
import { t } from "../../i18n";
import { HeaderActions, HeaderButton } from "../../notch/header";
import { Empty } from "../../ui/controls";
import { endProcess, listPorts, openLocal } from "./api";
import { byPort, group, withEnded, type EndOutcome, type Outcome, type PortRow, type RawPort } from "./model";

const REFRESH_MS = 3000;
/** The first click on "End process" waits this long for the second. */
const CONFIRM_MS = 4000;
/** How long the result stays in the row. */
const RESULT_MS = 4000;

/**
 * Listening TCP ports, as a sheet over the Hardware tool: a button in the header opens it. It reads the ports every 3 s
 * and only while it is open; closing the sheet, or the notch, stops it.
 */
export function PortsEntry() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <HeaderActions>
        <HeaderButton label={t("Offene Ports")} active={open} onClick={() => setOpen((o) => !o)}>
          <PlugsConnected size={15} weight="bold" />
        </HeaderButton>
      </HeaderActions>
      <AnimatePresence>{open && <PortsSheet key="ports" onClose={() => setOpen(false)} />}</AnimatePresence>
    </>
  );
}

function usePorts() {
  const [rows, setRows] = useState<RawPort[] | null>(null);
  const [failed, setFailed] = useState(false);
  const read = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true, busy = false;
    read.current = () => {
      if (busy) return;
      busy = true;
      listPorts()
        .then((next) => alive && (setRows(next), setFailed(false)))
        .catch(() => alive && setFailed(true))
        .finally(() => (busy = false));
    };
    read.current();
    const timer = window.setInterval(() => read.current(), REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  return { rows, failed, refresh: () => read.current() };
}

const COLUMNS = { icon: "w-[14px]", port: "w-[52px]", addr: "w-[150px]", pid: "w-[52px]", actions: "w-[176px]" };

function PortsSheet({ onClose }: { onClose: () => void }) {
  const { rows, failed, refresh } = usePorts();
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [armed, setArmed] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const sheet = useRef<HTMLDivElement>(null);
  const armTimer = useRef(0);
  const timers = useRef(new Set<number>());
  const grouped = useMemo(() => group(rows ?? []), [rows]);
  const list = byPort(withEnded(grouped, outcomes), dir);

  // The dashboard underneath stays out of reach of Tab and screen readers while the sheet is up; focus goes back to the header button after.
  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const before = document.activeElement as HTMLElement | null;
    el.focus({ preventScroll: true });
    const others = [...(el.parentElement?.children ?? [])].filter((c) => c !== el);
    others.forEach((c) => c.setAttribute("inert", ""));
    return () => {
      others.forEach((c) => c.removeAttribute("inert"));
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => () => [...timers.current, armTimer.current].forEach((id) => window.clearTimeout(id)), []);

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => (timers.current.delete(id), fn()), ms);
    timers.current.add(id);
  };
  const arm = (row: PortRow) => {
    setArmed(row.key);
    window.clearTimeout(armTimer.current);
    armTimer.current = window.setTimeout(() => setArmed(null), CONFIRM_MS);
  };
  const end = async (row: PortRow) => {
    window.clearTimeout(armTimer.current);
    setArmed(null);
    const outcome = await endProcess(row.pid, row.port).catch((): EndOutcome => "denied");
    setOutcomes((o) => ({ ...o, [row.key]: { row, outcome } }));
    later(() => setOutcomes(({ [row.key]: _, ...rest }) => rest), RESULT_MS);
    // The system takes a moment to drop the socket of a process that was just ended.
    later(refresh, 400);
  };

  return (
    <motion.div
      ref={sheet}
      role="dialog"
      aria-label={t("Offene Ports")}
      tabIndex={-1}
      // Escape closes the sheet first and stops there, so it does not also close the notch; the next Escape does.
      onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())}
      className="absolute inset-x-4 top-1 bottom-2 z-20 flex flex-col overflow-hidden rounded-[14px] bg-elevated shadow-[0_6px_18px_rgb(0_0_0/0.45)] outline-none"
      initial={{ opacity: 0, transform: "translateY(6px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      exit={{ opacity: 0, transform: "translateY(4px)" }}
      transition={fade}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 pe-1.5 ps-3">
        <span className="text-caption font-medium tracking-wide text-label-3 uppercase">{t("Offene Ports")}</span>
        {list.length > 0 && <span className="tabular text-caption text-label-4">{list.length}</span>}
        <span className="flex-1" />
        <button onClick={onClose} aria-label={t("Schließen")} className="pressable pressable-fill flex size-6 items-center justify-center rounded-full text-label-3 hover:text-label">
          <X size={13} weight="bold" />
        </button>
      </div>

      {list.length > 0 ? (
        <div role="table" aria-label={t("Offene Ports")} className="flex min-h-0 flex-1 flex-col">
          <div role="row" className="flex h-6 shrink-0 items-center gap-2 border-b border-separator px-3 text-caption text-label-3">
            <span className={`${COLUMNS.icon} shrink-0`} />
            <span role="columnheader" aria-sort={dir === "asc" ? "ascending" : "descending"} className={`${COLUMNS.port} shrink-0`}>
              <button onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))} className="pressable flex items-center gap-0.5 hover:text-label-2">
                Port
                {dir === "asc" ? <CaretUp size={9} weight="bold" /> : <CaretDown size={9} weight="bold" />}
              </button>
            </span>
            <span role="columnheader" className={`${COLUMNS.addr} shrink-0`}>{t("Adresse")}</span>
            <span role="columnheader" className="min-w-0 flex-1">{t("Prozess")}</span>
            <span role="columnheader" className={`${COLUMNS.pid} shrink-0 text-end`}>PID</span>
            <span className={`${COLUMNS.actions} shrink-0`} />
          </div>
          <div role="rowgroup" className="min-h-0 flex-1 overflow-y-auto pb-1">
            {list.map((row) => (
              <PortLine key={row.key} row={row} armed={armed === row.key} outcome={outcomes[row.key]?.outcome ?? null} onArm={() => arm(row)} onEnd={() => void end(row)} />
            ))}
          </div>
        </div>
      ) : rows === null && !failed ? (
        <div className="px-3 py-2 text-caption text-label-3">{t("Wird gelesen …")}</div>
      ) : (
        <div className="min-h-0 flex-1">
          {failed && rows === null ? (
            <Empty icon={PlugsConnected} title={t("Ports konnten nicht gelesen werden")} />
          ) : (
            <Empty icon={PlugsConnected} title={t("Keine offenen Ports")} text={t("Gerade wartet kein Programm auf eingehende TCP-Verbindungen.")} />
          )}
        </div>
      )}
    </motion.div>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="pressable pressable-fill flex size-6 shrink-0 items-center justify-center rounded-full text-label-3 hover:text-label disabled:opacity-30"
    >
      {children}
    </button>
  );
}

const outcomeText = (o: EndOutcome) => (o === "ended" ? t("Beendet") : o === "denied" ? t("Verweigert") : t("Schon beendet"));
const OUTCOME_COLOR: Record<EndOutcome, string> = { ended: "var(--color-green)", denied: "var(--color-orange)", gone: "var(--color-label-3)" };

function PortLine({ row, armed, outcome, onArm, onEnd }: { row: PortRow; armed: boolean; outcome: EndOutcome | null; onArm: () => void; onEnd: () => void }) {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const reset = useRef(0);
  useEffect(() => () => window.clearTimeout(reset.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`localhost:${row.port}`);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    window.clearTimeout(reset.current);
    reset.current = window.setTimeout(() => setCopied(null), 1400);
  };
  const addrs = row.addrs.join(", ");
  const reach = row.exposed ? t("Im Netzwerk erreichbar") : t("Nur auf diesem PC");
  const action = armed ? t("Bestätigen") : t("Prozess beenden");
  return (
    <div role="row" className="flex h-8 items-center gap-2 px-3 hover:bg-fill-1">
      <span role="cell" className={`${COLUMNS.icon} flex shrink-0 justify-center`}>
        <span role="img" aria-label={reach} title={reach} className="flex">
          {row.exposed ? <Globe size={13} weight="bold" style={{ color: "var(--color-orange)" }} /> : <LockSimple size={13} weight="bold" className="text-label-4" />}
        </span>
      </span>
      <span role="cell" className={`tabular ${COLUMNS.port} shrink-0 text-footnote font-semibold text-label`}>{row.port}</span>
      <span role="cell" className={`tabular ${COLUMNS.addr} shrink-0 truncate text-caption text-label-3`} title={addrs}>{addrs}</span>
      <span role="cell" className="min-w-0 flex-1 truncate text-caption text-label-2" title={row.path ?? undefined}>{row.name || t("Unbekannt")}</span>
      <span role="cell" className={`tabular ${COLUMNS.pid} shrink-0 text-end text-caption text-label-3`}>{row.pid}</span>
      <span role="cell" className={`${COLUMNS.actions} flex shrink-0 items-center justify-end gap-1`}>
        <IconButton label={copied === "failed" ? t("Kopieren fehlgeschlagen") : copied === "ok" ? t("Kopiert") : t("localhost:{port} kopieren", { port: row.port })} onClick={() => void copy()}>
          {copied === "ok" ? <Check size={13} weight="bold" /> : copied === "failed" ? <X size={13} weight="bold" className="text-red" /> : <Copy size={13} weight="bold" />}
        </IconButton>
        <IconButton label={t("localhost:{port} im Browser öffnen", { port: row.port })} disabled={!row.openable} onClick={() => void openLocal(row.port).catch(() => {})}>
          <ArrowSquareOut size={13} weight="bold" className="rtl:-scale-x-100" />
        </IconButton>
        {outcome ? (
          <span role="status" className="w-[96px] shrink-0 truncate text-end text-caption font-medium" style={{ color: OUTCOME_COLOR[outcome] }}>
            {outcomeText(outcome)}
          </span>
        ) : (
          <button
            disabled={!row.canEnd}
            onClick={armed ? onEnd : onArm}
            aria-label={t("{action}, Port {port}", { action, port: row.port })}
            title={row.canEnd ? undefined : t("Nur eigene Programme lassen sich beenden")}
            className={`pressable h-6 w-[96px] shrink-0 truncate rounded-full px-2 text-caption font-medium disabled:opacity-35 ${armed ? "bg-red text-black" : "pressable-fill bg-fill-2 text-label-2 hover:text-label"}`}
          >
            {action}
          </button>
        )}
      </span>
    </div>
  );
}
