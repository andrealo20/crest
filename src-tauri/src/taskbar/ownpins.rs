//! The bar's own pins (Windows only): apps pinned on Crest's bar that have no Start entry, kept by Rust so a pin stays an id
//! the launcher knows and the page never names a path or a command line.
//!
//! - Saved pins, in `taskbar-pins.json` in Crest's data folder: an exe (its full path is the id), a window's relaunch command
//!   (`crest-pin:` and a hash) or a dropped shortcut (its path).
//! - Windows' pinned shortcuts in `User Pinned\TaskBar` without a Start entry, as pins.rs last read the folder (never saved).
//!
//! An own pin matches an open window as a Start entry does (`entries_for`), and `launcher::open` starts it (`launch_spec`).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::core::HSTRING;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Shell::SHLoadIndirectString;

use super::tasks;
use crate::launcher::{self, App, LauncherState};
use crate::{display, mixer};

/// What a pin starts, and how it is matched to a window.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum Target {
    /// `aumid`: the window's own AppUserModelID, which Windows stamps on its pin of that exe so the window groups with it.
    Exe { path: String, aumid: Option<String> },
    Command { file: String, params: String, aumid: String },
    Link { path: String, aumid: Option<String>, exe: Option<String> },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct OwnPin {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(flatten)]
    pub(super) target: Target,
}

const FILE: &str = "taskbar-pins.json";
/// The saved pins and where they are saved, loaded once at start (`load`).
static SAVED: Mutex<(Option<PathBuf>, Vec<OwnPin>)> = Mutex::new((None, Vec::new()));
/// The `User Pinned\TaskBar` shortcuts without a Start entry, as pins.rs last read the folder.
static LINKS: Mutex<Vec<OwnPin>> = Mutex::new(Vec::new());

/// The entries of the file that read as pins: one bad entry (a kind from a newer Crest) never empties the list. Anything
/// unreadable is no pins.
fn parse(json: &str) -> Vec<OwnPin> {
    serde_json::from_str::<Vec<serde_json::Value>>(json).map(|all| all.into_iter().filter_map(|pin| serde_json::from_value(pin).ok()).collect()).unwrap_or_default()
}

/// The id of a pin of a relaunch command: `crest-pin:` and 16 hex digits of its SHA-256, the same for any case of the command.
fn command_id(cmd: &str) -> String {
    format!("crest-pin:{}", &format!("{:x}", Sha256::digest(cmd.to_lowercase().as_bytes()))[..16])
}

/// Reads the saved pins. Once, from the setup in lib.rs, so the settings window's icons and a launch work while the bar is off.
pub(crate) fn load(app: &AppHandle) {
    let Ok(dir) = crate::portable::app_data_dir(app) else { return };
    let path = dir.join(FILE);
    let pins = std::fs::read_to_string(&path).map(|json| parse(&json)).unwrap_or_default();
    *SAVED.lock().unwrap_or_else(|e| e.into_inner()) = (Some(path), pins);
}

/// Writes the saved pins. An error leaves the file as it was, and the pins live in memory for this session.
fn save(path: Option<&Path>, pins: &[OwnPin]) {
    if let (Some(path), Ok(bytes)) = (path, serde_json::to_vec_pretty(pins)) {
        let _ = crate::write_atomic(path, &bytes);
    }
}

/// Saves `pin` in place of one of the same id; the windows are listed again so its app's buttons find it at once.
fn add(pin: OwnPin) {
    {
        let mut saved = SAVED.lock().unwrap_or_else(|e| e.into_inner());
        let (path, pins) = &mut *saved;
        pins.retain(|p| p.id != pin.id);
        pins.push(pin);
        save(path.as_deref(), pins);
    }
    super::relist();
}

/// The pins of `pins` whose id is in `ids`, in their order.
fn listed_only(pins: &[OwnPin], ids: &[String]) -> Vec<OwnPin> {
    pins.iter().filter(|p| ids.contains(&p.id)).cloned().collect()
}

/// Forgets the saved pins the bar no longer has. Only saved ones: the folder's shortcuts are Windows' to keep.
fn keep(ids: &[String]) {
    let changed = {
        let mut saved = SAVED.lock().unwrap_or_else(|e| e.into_inner());
        let (path, pins) = &mut *saved;
        let kept = listed_only(pins, ids);
        let changed = kept.len() != pins.len();
        if changed {
            *pins = kept;
            save(path.as_deref(), pins);
        }
        changed
    };
    if changed {
        super::relist();
    }
}

/// The saved pin or the folder's shortcut with this id.
fn find(id: &str) -> Option<OwnPin> {
    let saved = SAVED.lock().unwrap_or_else(|e| e.into_inner()).1.iter().find(|p| p.id == id).cloned();
    saved.or_else(|| LINKS.lock().unwrap_or_else(|e| e.into_inner()).iter().find(|p| p.id == id).cloned())
}

/// A shortcut directly in `folder`, ASCII case-insensitive. A path with `..` has another parent and is refused.
pub(super) fn in_folder(path: &Path, folder: &Path) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk")) && path.parent().is_some_and(|p| p.as_os_str().eq_ignore_ascii_case(folder.as_os_str()))
}

/// A shortcut in Windows' own `User Pinned\TaskBar` that still exists.
fn windows_link(id: &str) -> bool {
    let path = Path::new(id);
    super::pins::taskbar_folder().is_some_and(|folder| in_folder(path, &folder)) && path.is_file()
}

/// An own pin's id: a saved one, or a shortcut that still exists (a saved one, or one in Windows' folder).
pub(crate) fn known(id: &str) -> bool {
    match find(id).map(|p| p.target) {
        Some(Target::Link { .. }) => Path::new(id).is_file(),
        Some(_) => true,
        None => windows_link(id),
    }
}

/// What `launcher::open` runs for an own pin, file and parameters; None for any other id, or when the file is gone (the launch
/// then answers not-found).
pub(crate) fn launch_spec(id: &str) -> Option<(String, Option<String>)> {
    if !known(id) {
        return None;
    }
    let (file, params) = match find(id) {
        Some(pin) => start_of(&pin),
        // A shortcut in Windows' folder starts from the shortcut.
        None => (id.to_string(), None),
    };
    Path::new(&file).is_file().then_some((file, params))
}

/// The file and parameters a pin starts with: an exe as it is, a command split, a shortcut from the shortcut.
fn start_of(pin: &OwnPin) -> (String, Option<String>) {
    match &pin.target {
        Target::Exe { path, .. } => (path.clone(), None),
        Target::Command { file, params, .. } => (file.clone(), Some(params.clone()).filter(|p| !p.trim().is_empty())),
        Target::Link { .. } => (pin.id.clone(), None),
    }
}

/// What `launcher::icon_png` draws an own pin from. None for a shortcut to another machine: the shell would open a connection
/// there to draw it.
pub(crate) fn icon_source(id: &str) -> Option<String> {
    match find(id).map(|p| p.target) {
        Some(Target::Exe { path, .. }) => Some(path),
        Some(Target::Command { file, .. }) => Some(file),
        Some(Target::Link { exe, .. }) => (!exe.as_deref().is_some_and(super::pins::remote)).then(|| id.to_string()),
        // A shortcut in Windows' folder not read yet: Windows' own taskbar draws it the same way.
        None => windows_link(id).then(|| id.to_string()),
    }
}

/// The exe of an `Exe` pin. None for the other kinds: a shortcut may carry arguments Crest does not keep, and a command has its
/// own.
#[allow(dead_code)] // for files dropped on an app's button
pub(crate) fn exe_of(id: &str) -> Option<String> {
    match find(id)?.target {
        Target::Exe { path, .. } => Some(path),
        _ => None,
    }
}

/// Whether `pin` belongs to a window, by `launcher::entries_for`'s rule: with an AppUserModelID only a pin of that id, never one
/// by exe alone (a web app's window must not light up its browser); without one, an exe pin without an id or a shortcut that
/// starts this exe. ASCII case-insensitive, as Windows compares them.
fn matches(pin: &OwnPin, aumid: Option<&str>, exe: &str) -> bool {
    let same = |a: &str, b: &str| a.eq_ignore_ascii_case(b);
    match (&pin.target, aumid) {
        (Target::Command { aumid: id, .. }, Some(aumid)) => same(id, aumid),
        (Target::Link { aumid: Some(id), .. } | Target::Exe { aumid: Some(id), .. }, Some(aumid)) => same(id, aumid),
        (Target::Exe { path, aumid: None }, None) => same(path, exe),
        (Target::Link { aumid: None, exe: Some(e), .. }, None) => same(e, exe),
        _ => false,
    }
}

/// A command line's file and parameters: the first token, quoted with `"` or up to the first space, and the rest trimmed. None
/// for a blank command or an unterminated quote. Not CommandLineToArgvW, which would lose the parameters' own quoting.
fn split_command(cmd: &str) -> Option<(String, String)> {
    let cmd = cmd.trim();
    let (file, rest) = match cmd.strip_prefix('"') {
        Some(quoted) => quoted.split_once('"')?,
        None => cmd.split_once(char::is_whitespace).unwrap_or((cmd, "")),
    };
    (!file.trim().is_empty()).then(|| (file.to_string(), rest.trim().to_string()))
}

/// The pin Windows would make of a window with AppUserModelID `aumid`: its relaunch command, given as (command, display name
/// resource) and used only with the id and both set, as Windows ignores it otherwise; else the exe of an unpackaged process on
/// this machine, with the window's id. None for a packaged app without a command, or a process whose exe is unknown.
pub(super) fn decide(aumid: Option<&str>, relaunch: Option<(&str, &str)>, packaged: bool, exe: &str) -> Option<Target> {
    let aumid = aumid.filter(|id| !id.is_empty());
    let command = aumid
        .zip(relaunch.filter(|(_, name)| !name.is_empty()))
        .and_then(|(aumid, (cmd, _))| split_command(cmd).map(|(file, params)| Target::Command { file, params, aumid: aumid.into() }));
    command.or_else(|| (!packaged && !exe.is_empty() && !super::pins::remote(exe)).then(|| Target::Exe { path: exe.into(), aumid: aumid.map(Into::into) }))
}

/// The pin of an open window (`decide`), named as Windows names it: a command by its display name resource (the text itself when
/// it reads as no resource), an exe by its version info. Errors: prevented (with `check_prevent`, a window that asks never to be
/// pinned), unknown (nothing to start it from). Needs COM: run it through `launcher::on_sta`.
fn from_window(hwnd: HWND, check_prevent: bool) -> Result<OwnPin, &'static str> {
    let props = tasks::window_props(hwnd);
    if check_prevent && props.prevent {
        return Err("prevented");
    }
    let pid = display::app_pid(hwnd);
    let exe = mixer::process_path(pid).unwrap_or_default();
    let relaunch = props.relaunch.as_ref().map(|(command, name)| (command.as_str(), name.as_str()));
    let target = decide(props.aumid.as_deref(), relaunch, tasks::package_app_id(pid).is_some(), &exe).ok_or("unknown")?;
    let (id, name) = match (&target, relaunch) {
        (Target::Command { file, .. }, Some((command, resource))) => {
            let name = indirect(resource).or_else(|| (!resource.starts_with('@')).then(|| resource.to_string()));
            (command_id(command), name.unwrap_or_else(|| mixer::display_name(file)))
        }
        (Target::Exe { path, .. }, _) => (path.clone(), mixer::display_name(path)),
        _ => return Err("unknown"),
    };
    Ok(OwnPin { id, name, target })
}

/// The text of an indirect string (`@file,-id`, `ms-resource:`); a plain one comes back as it is. None when it cannot be read.
fn indirect(source: &str) -> Option<String> {
    let mut buf = [0u16; 512];
    unsafe { SHLoadIndirectString(&HSTRING::from(source), &mut buf, None) }.ok()?;
    let text = String::from_utf16_lossy(&buf[..buf.iter().position(|&c| c == 0).unwrap_or(buf.len())]);
    (!text.trim().is_empty()).then_some(text)
}

/// Puts in place the folder's shortcuts without a Start entry, after each read of the folder (pins.rs `folder`). The windows are
/// listed again when they changed, so their buttons find these pins.
pub(super) fn set_links(links: Vec<OwnPin>) {
    let mut now = LINKS.lock().unwrap_or_else(|e| e.into_inner());
    if *now != links {
        *now = links;
        drop(now);
        super::relist();
    }
}

/// The own pins of an open window (`matches`), saved ones first, as launcher entries.
pub(crate) fn entries_for(aumid: Option<&str>, exe: &str) -> Vec<App> {
    let saved = SAVED.lock().unwrap_or_else(|e| e.into_inner()).1.clone();
    let links = LINKS.lock().unwrap_or_else(|e| e.into_inner()).clone();
    saved.into_iter().chain(links).filter(|p| matches(p, aumid, exe)).map(|p| launcher::pinned_app(p.id, p.name)).collect()
}

/// A dropped file the bar may pin: an exe or a shortcut, ASCII case-insensitive, on this machine (the shell would open a
/// connection to another one to read it).
fn accept_drop(path: &str) -> bool {
    Path::new(path).extension().is_some_and(|e| e.eq_ignore_ascii_case("exe") || e.eq_ignore_ascii_case("lnk")) && !super::pins::remote(path)
}

/// What a dropped file pins: the entry the bar puts in its list and, without a Start or App Paths entry, the own pin saved for it.
/// None for a file that is no app on this machine. Needs COM.
fn pin_of(apps: &[App], path: &str) -> Option<(App, Option<OwnPin>)> {
    if !accept_drop(path) || !Path::new(path).is_file() {
        return None;
    }
    // A shortcut is read as Windows' pinned ones are (pins.rs), an exe matched as a window without AppUserModelID.
    let (id, own) = if path.to_ascii_lowercase().ends_with(".lnk") {
        super::pins::shortcut(apps, Path::new(path))?
    } else if let Some(app) = launcher::entries_for(apps, None, path).into_iter().next() {
        return Some((app, None));
    } else {
        (path.to_string(), Some(OwnPin { id: path.to_string(), name: mixer::display_name(path), target: Target::Exe { path: path.to_string(), aumid: None } }))
    };
    match own {
        Some(pin) => Some((launcher::pinned_app(pin.id.clone(), pin.name.clone()), Some(pin))),
        None => apps.iter().find(|a| a.id == id).cloned().map(|app| (app, None)),
    }
}

/// Pins the apps among the files dropped on a bar's apps (drop.rs `install_bar`), on the thread drop.rs starts (`pin_of`). The bar
/// hears the accepted ones as `taskbar://pinned`, in drop order, and nothing when none was.
pub(crate) fn dropped(window: &WebviewWindow, paths: Vec<String>) {
    let apps = launcher::cached(&window.state::<LauncherState>(), |apps| apps.to_vec());
    let made = launcher::on_sta(move || paths.iter().filter_map(|p| pin_of(&apps, p)).collect::<Vec<_>>()).unwrap_or_default();
    if made.is_empty() {
        return;
    }
    let mut pinned = Vec::new();
    for (app, own) in made {
        if let Some(pin) = own {
            add(pin);
        }
        pinned.push(serde_json::json!({ "id": app.id, "name": app.name }));
    }
    let _ = window.emit_to(window.label(), "taskbar://pinned", pinned);
}

/// Pins listed window `id`: its app's Start entry (or an own pin made of it before) if it has one, else the pin Rust makes of the
/// window, saved. Errors: not-found, prevented, unknown.
#[tauri::command]
pub async fn taskbar_pin_window(id: isize) -> Result<App, String> {
    tasks::listed_pid(id).ok_or("not-found")?;
    if let Some((id, name)) = tasks::first_pin(id) {
        return Ok(launcher::pinned_app(id, name));
    }
    let made = tauri::async_runtime::spawn_blocking(move || launcher::on_sta(move || from_window(tasks::source(id), true))).await;
    let pin = made.ok().flatten().ok_or("unknown")??;
    let app = launcher::pinned_app(pin.id.clone(), pin.name.clone());
    add(pin);
    Ok(app)
}

/// Starts a new instance from listed window `id`, as administrator with `admin`, on the calling bar's monitor; nothing is saved.
/// PreventPinning does not stop it: Windows' own taskbar starts such an app too. Errors: not-found, unknown, cancelled, failed.
#[tauri::command]
pub async fn taskbar_launch_window(id: isize, admin: bool, window: WebviewWindow) -> Result<(), String> {
    tasks::listed_pid(id).ok_or("not-found")?;
    let monitor = launcher::launch_monitor(&window);
    let source = tasks::source(id).0 as isize;
    tauri::async_runtime::spawn_blocking(move || {
        let pin = launcher::on_sta(move || from_window(HWND(source as _), false)).ok_or("unknown")??;
        let (file, params) = start_of(&pin);
        launcher::execute(&file, params.as_deref(), admin.then_some("runas"), monitor)
    })
    .await
    .map_err(|_| "failed".to_string())?
}

/// File Explorer with the exe of listed window `id`'s process selected. Not for a packaged app, whose folder (WindowsApps) does
/// not open. Errors: not-found, unknown, and those of `convert::reveal_file`.
#[tauri::command(async)]
pub fn taskbar_reveal(id: isize) -> Result<(), String> {
    tasks::listed_pid(id).ok_or("not-found")?;
    let pid = display::app_pid(tasks::source(id));
    let exe = mixer::process_path(pid).filter(|p| !p.is_empty() && tasks::package_app_id(pid).is_none()).ok_or("unknown")?;
    crate::convert::reveal_file(exe)
}

/// The notch, once per start: the saved pins no longer in the bar's pinned list are forgotten. Once only, as a later call could
/// come between a pin just saved and the settings change that names it.
#[tauri::command]
pub fn taskbar_own_pins_keep(ids: Vec<String>) {
    keep(&ids);
}

/// Puts fixture pins in place of the saved ones.
#[cfg(test)]
pub(crate) fn set_saved(json: &str) {
    SAVED.lock().unwrap_or_else(|e| e.into_inner()).1 = parse(json);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_exes_and_shortcuts_on_this_machine_are_taken_from_a_drop() {
        assert!(accept_drop(r"C:\Tools\APP.EXE"));
        assert!(accept_drop(r"C:\Users\a\Desktop\App.lnk"));
        assert!(!accept_drop(r"C:\Users\a\notes.txt"));
        assert!(!accept_drop(r"C:\Users\a\Folder"));
        assert!(!accept_drop(r"\\host\share\x.exe"));
    }

    #[test]
    fn a_bad_entry_never_empties_the_file() {
        assert!(parse("not json").is_empty());
        assert!(parse(r#"{"id":"x"}"#).is_empty());
        let pins = parse(
            r#"[{"id":"C:\\a.exe","name":"A","kind":"exe","path":"C:\\a.exe"},
                {"id":"crest-pin:1","name":"B","kind":"future","url":"x"},
                {"id":"C:\\b.lnk","name":"C","kind":"link","path":"C:\\b.lnk"}]"#,
        );
        assert_eq!(pins.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), [r"C:\a.exe", r"C:\b.lnk"]);
        assert_eq!(pins[1].target, Target::Link { path: r"C:\b.lnk".into(), aumid: None, exe: None });
    }

    #[test]
    fn own_pins_match_windows_as_start_entries_do() {
        let pin = |target: Target| OwnPin { id: "x".into(), name: "x".into(), target };
        let exe = pin(Target::Exe { path: r"C:\Tools\Tool.exe".into(), aumid: None });
        let stamped = pin(Target::Exe { path: r"C:\Tools\Tool.exe".into(), aumid: Some("Tool".into()) });
        let command = pin(Target::Command { file: r"C:\Chrome\chrome.exe".into(), params: "--profile-directory=Work".into(), aumid: "Chrome.Work".into() });
        let site = pin(Target::Link { path: r"C:\p\Site.lnk".into(), aumid: Some("MSEdge._crx_site".into()), exe: None });
        let portable = pin(Target::Link { path: r"C:\p\Tool.lnk".into(), aumid: None, exe: Some(r"C:\Tools\Tool.exe".into()) });
        // An AppUserModelID never matches by exe.
        assert!(!matches(&exe, Some("Tool"), r"C:\Tools\Tool.exe"));
        assert!(!matches(&portable, Some("Tool"), r"C:\Tools\Tool.exe"));
        assert!(matches(&exe, None, r"c:\tools\tool.exe"));
        assert!(matches(&portable, None, r"C:\TOOLS\TOOL.EXE"));
        assert!(matches(&command, Some("chrome.work"), r"C:\Chrome\chrome.exe"));
        assert!(!matches(&command, None, r"C:\Chrome\chrome.exe"));
        assert!(matches(&site, Some("MSEdge._crx_site"), ""));
        assert!(!matches(&site, None, ""));
        assert!(!matches(&exe, None, r"C:\Tools\Other.exe"));
        // An exe pin made of a window with an id matches by that id only.
        assert!(matches(&stamped, Some("TOOL"), r"C:\Tools\Tool.exe"));
        assert!(!matches(&stamped, None, r"C:\Tools\Tool.exe"));
        assert!(!matches(&stamped, Some("Other"), r"C:\Tools\Tool.exe"));
    }

    #[test]
    fn a_command_splits_into_its_file_and_parameters() {
        assert_eq!(
            split_command(r#""C:\Program Files\Chrome\chrome.exe" --profile-directory="Profile 1" --x"#),
            Some((r"C:\Program Files\Chrome\chrome.exe".into(), r#"--profile-directory="Profile 1" --x"#.into()))
        );
        assert_eq!(split_command(r"C:\Tools\tool.exe  -a b "), Some((r"C:\Tools\tool.exe".into(), "-a b".into())));
        assert_eq!(split_command(r"C:\Tools\tool.exe"), Some((r"C:\Tools\tool.exe".into(), String::new())));
        assert_eq!(split_command("   "), None);
        assert_eq!(split_command(r#""C:\Program Files\x.exe --a"#), None); // unterminated quote
    }

    #[test]
    fn a_window_pins_its_relaunch_command_else_its_exe() {
        let exe = r"C:\Chrome\chrome.exe";
        assert_eq!(
            decide(Some("Chrome.Work"), Some((r#""C:\Chrome\chrome.exe" --profile-directory=Work"#, "Work")), false, exe),
            Some(Target::Command { file: exe.into(), params: "--profile-directory=Work".into(), aumid: "Chrome.Work".into() })
        );
        // Without a display name Windows ignores the command, and so does Crest: the exe pin keeps the window's id.
        let stamped = Some(Target::Exe { path: exe.into(), aumid: Some("Chrome.Work".into()) });
        assert_eq!(decide(Some("Chrome.Work"), Some(("chrome.exe --x", "")), false, exe), stamped);
        assert_eq!(decide(Some("Chrome.Work"), None, false, exe), stamped);
        assert_eq!(decide(None, Some(("chrome.exe --x", "Work")), false, exe), Some(Target::Exe { path: exe.into(), aumid: None }));
        assert_eq!(decide(None, None, true, r"C:\Program Files\WindowsApps\a\a.exe"), None); // packaged without a command
        assert_eq!(decide(None, None, false, ""), None);
        assert_eq!(decide(None, None, false, r"\\host\share\tool.exe"), None);
    }

    #[test]
    fn a_command_id_is_the_same_for_any_case() {
        let id = command_id(r#""C:\Chrome\chrome.exe" --profile-directory=Work"#);
        let hex = id.strip_prefix("crest-pin:").unwrap();
        assert!(hex.len() == 16 && hex.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(id, command_id(r#""c:\chrome\CHROME.EXE" --PROFILE-DIRECTORY=work"#));
        assert_ne!(id, command_id(r#""C:\Chrome\chrome.exe" --profile-directory=Home"#));
    }

    #[test]
    fn keep_forgets_the_saved_pins_no_longer_listed() {
        let pins = parse(
            r#"[{"id":"C:\\a.exe","name":"A","kind":"exe","path":"C:\\a.exe"},
                {"id":"crest-pin:1","name":"B","kind":"command","file":"C:\\b.exe","params":"","aumid":"B"},
                {"id":"C:\\c.lnk","name":"C","kind":"link","path":"C:\\c.lnk"}]"#,
        );
        let ids = |pins: &[OwnPin]| pins.iter().map(|p| p.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(&listed_only(&pins, &[r"C:\c.lnk".into(), r"C:\a.exe".into()])), [r"C:\a.exe", r"C:\c.lnk"]);
        assert!(listed_only(&pins, &[]).is_empty());
        assert_eq!(listed_only(&pins, &ids(&pins)), pins);
    }

    #[test]
    fn only_a_shortcut_directly_in_the_folder_counts() {
        let folder = Path::new(r"C:\Users\u\AppData\Roaming\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar");
        assert!(in_folder(&folder.join("Tool.lnk"), folder));
        assert!(in_folder(Path::new(r"c:\users\U\appdata\roaming\microsoft\internet explorer\quick launch\user pinned\taskbar\Tool.LNK"), folder));
        assert!(!in_folder(&folder.join(r"sub\Tool.lnk"), folder));
        assert!(!in_folder(&folder.join(r"..\Tool.lnk"), folder));
        assert!(!in_folder(&folder.join("Tool.exe"), folder));
    }
}
