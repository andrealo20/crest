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
use tauri::AppHandle;

use crate::launcher::{self, App};

/// What a pin starts, and how it is matched to a window.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum Target {
    Exe { path: String },
    Command { file: String, params: String, aumid: String },
    Link { path: String, aumid: Option<String>, exe: Option<String> },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct OwnPin {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(flatten)]
    target: Target,
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

/// Reads the saved pins. Once, from the setup in lib.rs, so the settings window's icons and a launch work while the bar is off.
pub(crate) fn load(app: &AppHandle) {
    let Ok(dir) = crate::portable::app_data_dir(app) else { return };
    let path = dir.join(FILE);
    let pins = std::fs::read_to_string(&path).map(|json| parse(&json)).unwrap_or_default();
    *SAVED.lock().unwrap_or_else(|e| e.into_inner()) = (Some(path), pins);
}

/// The saved pin or the folder's shortcut with this id.
fn find(id: &str) -> Option<OwnPin> {
    let saved = SAVED.lock().unwrap_or_else(|e| e.into_inner()).1.iter().find(|p| p.id == id).cloned();
    saved.or_else(|| LINKS.lock().unwrap_or_else(|e| e.into_inner()).iter().find(|p| p.id == id).cloned())
}

/// A shortcut directly in `folder`, ASCII case-insensitive. A path with `..` has another parent and is refused.
fn in_folder(path: &Path, folder: &Path) -> bool {
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
    let (file, params) = match find(id).map(|p| p.target) {
        Some(Target::Exe { path }) => (path, None),
        Some(Target::Command { file, params, .. }) => (file, Some(params).filter(|p| !p.trim().is_empty())),
        // A shortcut, saved or in Windows' folder, starts from the shortcut.
        Some(Target::Link { .. }) | None => (id.to_string(), None),
    };
    Path::new(&file).is_file().then_some((file, params))
}

/// What `launcher::icon_png` draws an own pin from. None for a shortcut to another machine: the shell would open a connection
/// there to draw it.
pub(crate) fn icon_source(id: &str) -> Option<String> {
    match find(id).map(|p| p.target) {
        Some(Target::Exe { path }) => Some(path),
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
        Target::Exe { path } => Some(path),
        _ => None,
    }
}

/// Whether `pin` belongs to a window, by `launcher::entries_for`'s rule: with an AppUserModelID only a command or a shortcut
/// of that id, never a pin by exe (a web app's window must not light up its browser); without one, an exe pin or a shortcut
/// that starts this exe. ASCII case-insensitive, as Windows compares them.
fn matches(pin: &OwnPin, aumid: Option<&str>, exe: &str) -> bool {
    let same = |a: &str, b: &str| a.eq_ignore_ascii_case(b);
    match (&pin.target, aumid) {
        (Target::Command { aumid: id, .. }, Some(aumid)) => same(id, aumid),
        (Target::Link { aumid: Some(id), .. }, Some(aumid)) => same(id, aumid),
        (Target::Exe { path }, None) => same(path, exe),
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

/// The pin Windows would make of a window: its relaunch command, given as (AppUserModelID, command, display name resource) and
/// used only with all three set, as Windows ignores it otherwise; else the exe of an unpackaged process on this machine. None
/// for a packaged app without a command, or a process whose exe is unknown.
pub(super) fn decide(relaunch: Option<(&str, &str, &str)>, packaged: bool, exe: &str) -> Option<Target> {
    let command = relaunch
        .filter(|(aumid, _, name)| !aumid.is_empty() && !name.is_empty())
        .and_then(|(aumid, cmd, _)| split_command(cmd).map(|(file, params)| Target::Command { file, params, aumid: aumid.into() }));
    command.or_else(|| (!packaged && !exe.is_empty() && !super::pins::remote(exe)).then(|| Target::Exe { path: exe.into() }))
}

/// The own pins of an open window (`matches`), saved ones first, as launcher entries.
pub(crate) fn entries_for(aumid: Option<&str>, exe: &str) -> Vec<App> {
    let saved = SAVED.lock().unwrap_or_else(|e| e.into_inner()).1.clone();
    let links = LINKS.lock().unwrap_or_else(|e| e.into_inner()).clone();
    saved.into_iter().chain(links).filter(|p| matches(p, aumid, exe)).map(|p| launcher::pinned_app(p.id, p.name)).collect()
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
        let exe = pin(Target::Exe { path: r"C:\Tools\Tool.exe".into() });
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
            decide(Some(("Chrome.Work", r#""C:\Chrome\chrome.exe" --profile-directory=Work"#, "Work")), false, exe),
            Some(Target::Command { file: exe.into(), params: "--profile-directory=Work".into(), aumid: "Chrome.Work".into() })
        );
        // Without a display name Windows ignores the command, and so does Crest.
        assert_eq!(decide(Some(("Chrome.Work", "chrome.exe --x", "")), false, exe), Some(Target::Exe { path: exe.into() }));
        assert_eq!(decide(None, true, r"C:\Program Files\WindowsApps\a\a.exe"), None); // packaged without a command
        assert_eq!(decide(None, false, ""), None);
        assert_eq!(decide(None, false, r"\\host\share\tool.exe"), None);
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
