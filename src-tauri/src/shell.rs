//! Shell: the global shortcuts, a second launch, and the crash log.
//!
//! Shortcuts arrive from the settings as "Ctrl+Alt+Shift+Win+<KeyboardEvent.code>"; the resize
//! shortcut as "<modifiers>+Arrows", registered as four shortcuts. The frontend checks the
//! combinations and duplicates (src/features/window/hotkeys.ts); here a failed registration
//! means another program holds the combination.
//!
//! Crash log: panics and uncaught frontend errors are appended to crash.log in the app's log folder
//! (%LOCALAPPDATA%\io.github.andrealo20.crest\logs), rolled to crash.old.log past 512 KB.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::menu::MenuItem;
use tauri::{App, AppHandle, Emitter, Manager, State, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};
use windows::Win32::System::SystemInformation::GetLocalTime;

use crate::display;

/// Until the frontend sends the saved shortcuts.
const DEFAULT_OPEN: &str = "Ctrl+Alt+Space";
const ARROWS: [(&str, &str); 4] = [("ArrowLeft", "left"), ("ArrowRight", "right"), ("ArrowUp", "up"), ("ArrowDown", "down")];

#[derive(Default)]
pub struct Hotkeys(Mutex<Bound>);

#[derive(Default)]
struct Bound {
    open: Option<Shortcut>,
    hide: Option<Shortcut>,
    resize: Vec<(Shortcut, &'static str)>,
    /// The tray's "Open Crest" item, which shows the open shortcut.
    tray_open: Option<MenuItem<Wry>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyConfig {
    open: String,
    hide: String,
    resize: String,
    /// The open shortcut as the tray shows it ("Ctrl+Alt+Space").
    open_label: String,
}

#[derive(Serialize)]
pub struct HotkeyStatus {
    open: &'static str,
    hide: &'static str,
    resize: &'static str,
}

/// The saved text in the plugin's spelling ("Win" is "Super" there); None for an unknown key.
fn parse(text: &str) -> Option<Shortcut> {
    let spelled: Vec<&str> = text.split('+').map(|p| if p.eq_ignore_ascii_case("win") { "Super" } else { p }).collect();
    Shortcut::from_str(&spelled.join("+")).ok()
}

fn label_text(label: &str) -> String {
    if label.is_empty() { "Open Crest".into() } else { format!("Open Crest\t{label}") }
}

/// Registers one shortcut: "unset", "active", "in-use" (another program holds it) or "invalid".
fn bind(app: &AppHandle, text: &str, slot: &mut Option<Shortcut>) -> &'static str {
    if text.is_empty() {
        return "unset";
    }
    let Some(shortcut) = parse(text) else { return "invalid" };
    if app.global_shortcut().register(shortcut).is_err() {
        return "in-use";
    }
    *slot = Some(shortcut);
    "active"
}

/// All four arrows or none: a resize shortcut with a missing direction would be confusing.
fn bind_arrows(app: &AppHandle, text: &str, slots: &mut Vec<(Shortcut, &'static str)>) -> &'static str {
    let Some(mods) = text.strip_suffix("+Arrows") else { return if text.is_empty() { "unset" } else { "invalid" } };
    for (code, dir) in ARROWS {
        let Some(shortcut) = parse(&format!("{mods}+{code}")) else { return "invalid" };
        if app.global_shortcut().register(shortcut).is_err() {
            for (s, _) in slots.drain(..) {
                let _ = app.global_shortcut().unregister(s);
            }
            return "in-use";
        }
        slots.push((shortcut, dir));
    }
    "active"
}

/// Replaces Crest's shortcuts with the saved ones. Async: registration waits for the main thread.
#[tauri::command]
pub async fn hotkeys_apply(config: HotkeyConfig, app: AppHandle, state: State<'_, Hotkeys>) -> Result<HotkeyStatus, String> {
    // Not locked while registering: that waits for the main thread, where the shortcut handler locks too.
    let old = std::mem::take(&mut *state.0.lock().unwrap());
    for s in old.open.into_iter().chain(old.hide).chain(old.resize.into_iter().map(|(s, _)| s)) {
        let _ = app.global_shortcut().unregister(s);
    }
    let mut bound = Bound { tray_open: old.tray_open, ..Default::default() };
    let status = HotkeyStatus {
        open: bind(&app, &config.open, &mut bound.open),
        hide: bind(&app, &config.hide, &mut bound.hide),
        resize: bind_arrows(&app, &config.resize, &mut bound.resize),
    };
    if let Some(item) = &bound.tray_open {
        let _ = item.set_text(label_text(if bound.open.is_some() { &config.open_label } else { "" }));
    }
    *state.0.lock().unwrap() = bound;
    Ok(status)
}

/// For the global-shortcut plugin's handler.
pub fn on_shortcut(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state() != ShortcutState::Pressed {
        return;
    }
    let id = shortcut.id();
    let (open, hide, resize) = {
        let b = app.state::<Hotkeys>();
        let b = b.0.lock().unwrap();
        (
            b.open.is_some_and(|s| s.id() == id),
            b.hide.is_some_and(|s| s.id() == id),
            b.resize.iter().find(|(s, _)| s.id() == id).map(|(_, d)| *d),
        )
    };
    if open {
        display::unhide(app);
        let _ = app.emit("notch://shortcut", ());
    } else if hide {
        display::toggle_user_hidden(app);
    } else if let Some(dir) = resize {
        display::unhide(app);
        let _ = app.emit("notch://resize", dir);
    }
}

/// Tray "Open"/"Settings" and a second launch: bring Crest back if hidden, then open (on `tab`).
pub fn open(app: &AppHandle, tab: Option<&str>) {
    display::unhide(app);
    let _ = app.emit("notch://open", tab);
}

/// A second launch of Crest opens the settings of the running one.
pub fn second_launch(app: &AppHandle) {
    open(app, Some("settings"));
}

/// Remembers the tray item that shows the open shortcut.
pub fn set_tray_open(app: &App, item: MenuItem<Wry>) {
    app.state::<Hotkeys>().0.lock().unwrap().tray_open = Some(item);
}

/// At start: credentials copied from the old prefix, crash log, the default open shortcut.
pub fn init(app: &App) {
    if let Ok(dir) = app.path().app_data_dir() {
        crate::secrets::migrate_legacy(&dir);
    }
    if let Ok(dir) = app.path().app_log_dir() {
        install_crash_log(dir);
    }
    // If another app owns the shortcut, Crest still runs, just without it.
    let mut open = None;
    let _ = bind(app.handle(), DEFAULT_OPEN, &mut open);
    app.state::<Hotkeys>().0.lock().unwrap().open = open;
}

/// The tray's "Open Crest" text before the frontend has sent the saved shortcut.
pub fn default_open_label() -> String {
    label_text(DEFAULT_OPEN)
}

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
const LOG_MAX: u64 = 512 * 1024;

fn install_crash_log(dir: PathBuf) {
    let _ = LOG_DIR.set(dir);
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current().name().unwrap_or("unnamed").to_string();
        append(&format!("panic in thread '{thread}': {info}\n{}", std::backtrace::Backtrace::force_capture()));
        previous(info);
    }));
}

/// Uncaught frontend errors (the page can't write files itself). Capped so a runaway message can't fill the disk.
#[tauri::command]
pub fn crash_log(text: String) {
    let text: String = text.chars().take(4000).collect();
    append(&format!("frontend: {text}"));
}

fn append(text: &str) {
    let Some(dir) = LOG_DIR.get() else { return };
    let _ = write_entry(dir, text);
}

fn write_entry(dir: &Path, text: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join("crash.log");
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > LOG_MAX) {
        std::fs::rename(&path, dir.join("crash.old.log"))?;
    }
    let t = unsafe { GetLocalTime() };
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(
        file,
        "[{:04}-{:02}-{:02} {:02}:{:02}:{:02}] Crest {} {}",
        t.wYear,
        t.wMonth,
        t.wDay,
        t.wHour,
        t.wMinute,
        t.wSecond,
        env!("CARGO_PKG_VERSION"),
        text.trim_end()
    )
}
