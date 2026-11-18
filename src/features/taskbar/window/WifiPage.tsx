import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowClockwise, LockSimple } from "@phosphor-icons/react";
import { t } from "../../../i18n";
import { taskbar } from "../../../platform/services";
import { NetGlyph } from "../../../ui/glyphs";
import { RadioSwitch, type SwitchJob } from "../../overview/QuickControls";
import { panelHeld, sizeQuickPage } from "../panel";
import { PAGE_ROW, PASSWORD_ROW } from "../panelModel";
import { afterConnect, wifiAction, wifiRows, wifiView, type WifiList, type WifiNetwork } from "../quickPages";
import { barsGlyph } from "../statusModel";
import { QuickPageFrame, away } from "./QuickPage";

const BUTTON = "pressable shrink-0 rounded-full px-2.5 py-1 text-footnote font-medium text-label-2 bg-fill-1 hover:bg-fill-2 hover:text-label disabled:opacity-40";

/** The quick panel's Wi-Fi page: the networks nearby once Windows' location consent is given, joined with a click or a password. */
export function WifiPage({ on, job }: { on: boolean; job: SwitchJob }) {
  const [list, setList] = useState<WifiList | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  // The network whose password row is open, and the one connecting or disconnecting.
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const view = wifiView(on, list, failed);

  const read = (scan: boolean) => {
    setScanning(scan);
    taskbar
      .wifiScan(scan)
      .then((l) => {
        setList(l);
        setFailed(null);
      })
      .catch((e) => setFailed(String(e)))
      .finally(() => setScanning(false));
  };

  // The first read scans; turning the radio on later reads the adapter's report, which Windows refreshes on its own.
  const scanned = useRef(false);
  useEffect(() => {
    if (!on) return;
    read(!scanned.current);
    scanned.current = true;
  }, [on]);

  useEffect(() => () => panelHeld.set(false), []);
  const allow = () => {
    panelHeld.set(true);
    setNote(null);
    taskbar
      .wifiAllow()
      .then((a) => (a === "allowed" ? read(true) : setList({ state: "denied", networks: [] })))
      // The "ask" list stays on screen, so the failure shows as the footer's note.
      .catch((e) => setNote(afterConnect(String(e)).note))
      .finally(() => panelHeld.set(false));
  };

  const settle = (n: WifiNetwork, call: Promise<void>) => {
    setBusy(n.ssid);
    setNote(null);
    setOpen(null);
    call
      .then(() => read(false))
      .catch((e) => {
        const a = afterConnect(String(e));
        setNote(a.note);
        if (a.password) setOpen(n.ssid);
        if (a.settings) away(() => taskbar.settings("wifi"));
      })
      .finally(() => setBusy(null));
  };
  const connect = (n: WifiNetwork, password: string | null) => settle(n, taskbar.wifiConnect(n.ssid, password));

  useLayoutEffect(() => sizeQuickPage("wifi", wifiRows(view, list?.networks.length ?? 0), open ? PASSWORD_ROW : 0), [view, list, open]);

  const line = (text: string) => <p className="px-1 text-footnote text-label-2">{text}</p>;
  return (
    <QuickPageFrame
      title={t("WLAN")}
      actions={
        <>
          <button
            aria-label={t("Aktualisieren")}
            title={t("Aktualisieren")}
            disabled={!on || scanning || (list !== null && list.state !== "allowed")}
            onClick={() => read(true)}
            className="pressable flex size-8 shrink-0 items-center justify-center rounded-full text-label-2 hover:bg-fill-2 hover:text-label disabled:opacity-40"
          >
            <ArrowClockwise size={15} weight="regular" />
          </button>
          <RadioSwitch kind="wifi" on={on} job={job} />
        </>
      }
      note={note ? t(note) : job.note}
      footer={{ label: t("Weitere WLAN-Einstellungen"), onClick: () => away(() => taskbar.settings("wifi")) }}
    >
      {view === "off" && line(t("WLAN ist ausgeschaltet"))}
      {view === "loading" && line(t("Netzwerke werden gesucht …"))}
      {view === "failed" && line(t("Das hat nicht geklappt"))}
      {view === "ask" && (
        <div className="flex flex-col items-start gap-2">
          {line(t("Windows fragt einmal nach dem Standortzugriff, bevor Crest Netzwerke in der Nähe zeigen kann."))}
          <button onClick={allow} className={BUTTON}>
            {t("Netzwerke in der Nähe anzeigen")}
          </button>
        </div>
      )}
      {view === "denied" && (
        <div className="flex flex-col items-start gap-2">
          {line(t("Der Standortzugriff ist für Crest aus, daher bleiben die Netzwerke verborgen."))}
          <button onClick={() => away(() => taskbar.settings("location"))} className={BUTTON}>
            {t("In den Einstellungen erlauben")}
          </button>
        </div>
      )}
      {view === "none" && line(t("Kein WLAN-Adapter"))}
      {view === "settings" && line(t("In den Windows-Einstellungen ändern"))}
      {view === "empty" && line(t("Keine Netzwerke gefunden"))}
      {view === "list" &&
        list?.networks.map((n) => (
          <div key={n.ssid}>
            <NetworkRow
              n={n}
              busy={busy}
              onClick={() => {
                const a = wifiAction(n);
                if (a === "connect") connect(n, null);
                else if (a === "password") setOpen(open === n.ssid ? null : n.ssid);
                else if (a === "settings") away(() => taskbar.settings("wifi"));
              }}
              onDisconnect={() => settle(n, taskbar.wifiDisconnect())}
            />
            {open === n.ssid && <PasswordRow onConnect={(p) => connect(n, p)} onCancel={() => setOpen(null)} />}
          </div>
        ))}
    </QuickPageFrame>
  );
}

/** A network: its signal, its name and how it is joined; the one in use with its Disconnect button, the others a button. */
function NetworkRow({ n, busy, onClick, onDisconnect }: { n: WifiNetwork; busy: string | null; onClick: () => void; onDisconnect: () => void }) {
  const caption =
    busy === n.ssid
      ? t("Verbindung wird hergestellt …")
      : n.connected
        ? t("Verbunden")
        : n.kind === "enterprise"
          ? t("In den Windows-Einstellungen verbinden")
          : n.kind === "personal"
            ? t("Gesichert")
            : t("Ungesichert");
  const body = (
    <>
      <NetGlyph glyph={barsGlyph(n.bars)} size={16} className="shrink-0 text-label" />
      <span className="flex min-w-0 flex-1 flex-col items-start">
        <span className="w-full truncate text-start text-footnote font-medium text-label">{n.ssid}</span>
        <span className="flex w-full items-center gap-1 text-caption text-label-3">
          {n.kind !== "open" && <LockSimple size={12} weight="regular" className="shrink-0" />}
          <span className="truncate">{caption}</span>
        </span>
      </span>
    </>
  );
  const row = "flex w-full items-center gap-2.5 rounded-[10px] px-2";
  if (n.connected)
    return (
      <div className={row} style={{ height: PAGE_ROW }}>
        {body}
        <button disabled={busy !== null} onClick={onDisconnect} className={BUTTON}>
          {t("Trennen")}
        </button>
      </div>
    );
  return (
    <button disabled={busy !== null} onClick={onClick} className={`${row} hover:bg-fill-1 disabled:hover:bg-transparent`} style={{ height: PAGE_ROW }}>
      {body}
    </button>
  );
}

/** The password of a new network, typed under its row. `value` is the only place it lives: gone once sent or when the row closes. */
function PasswordRow({ onConnect, onCancel }: { onConnect: (password: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState("");
  const submit = () => {
    const v = value;
    setValue("");
    onConnect(v);
  };
  return (
    <div className="flex items-center gap-2 ps-[34px] pe-2" style={{ height: PASSWORD_ROW }}>
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        autoFocus
        aria-label={t("Passwort")}
        placeholder={t("Passwort")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value) submit();
          if (e.key === "Escape") {
            // BarPanel's Esc closes the panel unless the key was taken: here it closes only the row.
            e.preventDefault();
            onCancel();
          }
        }}
        className="h-8 min-w-0 flex-1 rounded-[8px] bg-fill-1 px-2.5 text-footnote text-label outline-none focus:ring-1 focus:ring-separator"
      />
      <button disabled={!value} onClick={submit} className={BUTTON}>
        {t("Verbinden")}
      </button>
    </div>
  );
}
