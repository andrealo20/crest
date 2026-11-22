//! The apps pinned on Windows' own taskbar, for the bar's pinned list (`taskbar_import_pins`). Two sources:
//!
//! - The `Favorites` value of `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Taskband`, where Windows keeps every app
//!   pinned on its taskbar, Store apps included, in their order. Its format is undocumented: Crest never parses it, it only
//!   searches it, read-only, for the ids of Start entries as whole strings (`find_whole`).
//! - The `User Pinned\TaskBar` folder (the documented known folder `FOLDERID_UserPinned`): each shortcut names its Start entry by
//!   its AppUserModelID or by the exe it starts, as an open window does (`launcher::entries_for`). A shortcut without an entry
//!   (a site pinned from Edge, a portable exe) is a pin of its own, by its path (ownpins.rs).
//!
//! The apps come in the value's order, then those only the folder has, by file name. Without the value (missing, or changed by a
//! Windows update) the folder alone remains.
//!
//! While the bar runs, the bar follows Windows' own pins too (`taskbar_windows_pins`): a thread watches the `Taskband` key
//! (`watch`) and tells the notch, which asks what changed since the list it remembers, and once at the bar's start for what
//! changed while Crest was closed. Only a read of both sources counts, a pin leaves the bar only when its app is surely
//! unpinned, and more than half of the list gone at once counts only when a second read drops the same pins (`follow`).

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::thread::JoinHandle;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use windows::core::{w, HSTRING, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows::Win32::System::Registry::{
    RegCloseKey, RegGetValueW, RegNotifyChangeKeyValue, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_NOTIFY, REG_NOTIFY_CHANGE_LAST_SET, RRF_RT_REG_BINARY,
};
use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForMultipleObjects, WaitForSingleObject, INFINITE};
use windows::Win32::UI::Shell::{FOLDERID_UserPinned, IShellItem2, SHCreateItemFromParsingName, SHGetKnownFolderPath, KF_FLAG_DEFAULT, SIGDN_NORMALDISPLAY};

use super::ownpins::{self, OwnPin, Target};
use super::tasks::APP_USER_MODEL_ID;
use crate::launcher::{self, App, LauncherState};

/// The first byte offset where `id` is a whole UTF-16LE string in `blob`, at either byte alignment, ASCII case-insensitive: the
/// code unit before it is a control character (or there is none) and the one after it is the terminator. So "Chrome" finds
/// Chrome's id, never the name inside "Google Chrome.lnk".
fn find_whole(blob: &[u8], id: &str) -> Option<usize> {
    let fold = |unit: u16| u8::try_from(unit).map_or(unit, |b| b.to_ascii_lowercase().into());
    let id: Vec<u16> = id.encode_utf16().map(fold).collect();
    (0..2)
        .filter_map(|align| {
            // A 0 before the first unit: a string at the very start counts as preceded by a control character.
            let units: Vec<u16> = std::iter::once(0).chain(blob.get(align..)?.chunks_exact(2).map(|b| fold(u16::from_le_bytes([b[0], b[1]])))).collect();
            units.windows(id.len() + 2).position(|w| w[0] < 0x20 && w[1..=id.len()] == id[..] && w[id.len() + 1] == 0).map(|at| align + 2 * at)
        })
        .min()
}

/// The ids found in the value by offset, then the folder's ids not already there, in the folder's order; each id once.
fn order(mut found: Vec<(usize, String)>, folder: Vec<String>) -> Vec<String> {
    found.sort_by_key(|&(at, _)| at);
    let mut ids: Vec<String> = Vec::new();
    for id in found.into_iter().map(|(_, id)| id).chain(folder) {
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    ids
}

/// The `Favorites` value; None when it is missing or cannot be read (one that grew between the two reads is too big for its
/// buffer).
fn favorites() -> Option<Vec<u8>> {
    let read = |data: Option<*mut core::ffi::c_void>, size: &mut u32| {
        (unsafe { RegGetValueW(HKEY_CURRENT_USER, TASKBAND, w!("Favorites"), RRF_RT_REG_BINARY, None, data, Some(size)) }) == ERROR_SUCCESS
    };
    let mut size = 0;
    if !read(None, &mut size) {
        return None;
    }
    let mut value = vec![0u8; size as usize];
    if !read(Some(value.as_mut_ptr().cast()), &mut size) {
        return None;
    }
    value.truncate(size as usize);
    Some(value)
}

/// Windows' `User Pinned\TaskBar` folder, where its taskbar keeps a shortcut for each pinned app.
pub(super) fn taskbar_folder() -> Option<PathBuf> {
    let dir = unsafe { SHGetKnownFolderPath(&FOLDERID_UserPinned, KF_FLAG_DEFAULT, None) }.ok().and_then(|p| unsafe { crate::controls::take(p) })?;
    Some(Path::new(&dir).join("TaskBar"))
}

/// A shortcut's id on the bar: its Start entry's, by the shortcut's AppUserModelID, else by the exe it starts with no arguments
/// (`launcher::entries_for`). Without an entry, its own path, with the pin it stays as, started from the shortcut.
fn link_or_entry(apps: &[App], path: &str, aumid: Option<String>, exe: Option<String>) -> (String, Option<Target>) {
    let entry = (aumid.is_some() || exe.is_some()).then(|| launcher::entries_for(apps, aumid.as_deref(), exe.as_deref().unwrap_or_default())).and_then(|e| e.into_iter().next());
    match entry {
        Some(app) => (app.id, None),
        None => (path.to_string(), Some(Target::Link { path: path.to_string(), aumid, exe })),
    }
}

/// A shortcut as the bar takes it: its id (`link_or_entry`) and, without a Start entry, the pin it stays as, named as File Explorer
/// names it. None when the shell cannot read it. Needs COM.
pub(super) fn shortcut(apps: &[App], path: &Path) -> Option<(String, Option<OwnPin>)> {
    let text = path.to_str()?;
    let item = unsafe { SHCreateItemFromParsingName::<_, _, IShellItem2>(&HSTRING::from(path), None) }.ok()?;
    // An empty id is none, as on a window (tasks.rs).
    let aumid = unsafe { item.GetString(&APP_USER_MODEL_ID) }.ok().and_then(|p| unsafe { crate::controls::take(p) }).filter(|id| !id.is_empty());
    let exe = unsafe { launcher::shortcut_exe(&item) };
    // An internet shortcut's Start entry is listed by its URL (a Steam game's `steam://rungameid/...`).
    if aumid.is_none() && exe.is_none() {
        if let Some(app) = url_value(path, "URL").and_then(|url| launcher::entries_for(apps, Some(&url), "").into_iter().next()) {
            return Some((app.id, None));
        }
    }
    let (id, link) = link_or_entry(apps, text, aumid, exe);
    let pin = link.map(|target| {
        let name = unsafe { launcher::display_name(&item, SIGDN_NORMALDISPLAY) };
        let name = name.or_else(|| path.file_stem().map(|s| s.to_string_lossy().into_owned())).unwrap_or_default();
        OwnPin { id: id.clone(), name, target }
    });
    Some((id, pin))
}

/// The shortcuts in `User Pinned\TaskBar` by file name, as ids (`link_or_entry`), and those without a Start entry as pins, named
/// as File Explorer names them, which go to ownpins.rs at each read (`set_links`). None when the folder cannot be read.
fn folder(apps: &[App]) -> Option<(Vec<String>, Vec<OwnPin>)> {
    let Some(Ok(files)) = taskbar_folder().map(std::fs::read_dir) else { return None };
    let mut paths: Vec<PathBuf> = files.flatten().map(|f| f.path()).filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk"))).collect();
    paths.sort();
    let (mut ids, mut links) = (Vec::new(), Vec::new());
    for path in &paths {
        let Some((id, link)) = shortcut(apps, path) else { continue };
        links.extend(link);
        ids.push(id);
    }
    ownpins::set_links(links.clone());
    Some((ids, links))
}

/// The entry of a pinned id: the Start list's, else the folder's shortcut as one of the bar's own pins.
fn app_of(apps: &[App], links: &[OwnPin], id: &str) -> Option<App> {
    let link = || links.iter().find(|l| l.id == id).map(|l| launcher::pinned_app(l.id.clone(), l.name.clone()));
    apps.iter().find(|a| a.id == id).cloned().or_else(link)
}

/// The ids of the Start list's entries in the value and the folder, in Windows' order (`order`).
fn ids(apps: &[App], value: &[u8], folder: Vec<String>) -> Vec<String> {
    let found = apps.iter().filter_map(|a| Some((find_whole(value, a.id.strip_prefix(launcher::APPS_PREFIX)?)?, a.id.clone()))).collect();
    order(found, folder)
}

/// The apps pinned on Windows' taskbar (`app_of`), in Windows' order, from what of the two sources can be read. Needs COM: run
/// it through `launcher::on_sta`.
fn pinned(apps: &[App]) -> Vec<App> {
    let (folder, links) = folder(apps).unwrap_or_default();
    let ids = ids(apps, &favorites().unwrap_or_default(), folder);
    ids.into_iter().filter_map(|id| app_of(apps, &links, &id)).collect()
}

/// The ids pinned on Windows' taskbar now, in Windows' order, and the folder's shortcuts without an entry; None unless both
/// sources and the Start list are read, so a failed read never looks like apps unpinned. Needs COM: run it through
/// `launcher::on_sta`.
fn read(apps: &[App]) -> Option<(Vec<String>, Vec<OwnPin>)> {
    if apps.is_empty() {
        return None;
    }
    let (folder, links) = folder(apps)?;
    Some((ids(apps, &favorites()?, folder), links))
}

/// What changed on Windows' taskbar since `last`, the ids remembered the time before (`remembered`): the ids new in `now`, and
/// those gone from it that the Start list still knows or that are no longer installed (one the Start list missed but still
/// installed stays: a list read in part). The first read (`last` None) only remembers. More than half of a list of four or more
/// gone at once looks like a read that failed: refused (`Err`, with what it would take off), unless the read before was refused
/// for the same pins (`refused`); a second read agreeing that they are gone (a reset by a Windows update, a backup restored on
/// another PC) goes through, with the pins made meanwhile.
fn follow(last: Option<&[String]>, now: &[String], refused: &[String], known: impl Fn(&str) -> bool, installed: impl Fn(&str) -> bool) -> Result<(Vec<String>, Vec<String>), Vec<String>> {
    let Some(last) = last else { return Ok((Vec::new(), Vec::new())) };
    let added: Vec<String> = now.iter().filter(|id| !last.contains(id)).cloned().collect();
    let removed: Vec<String> = last.iter().filter(|id| !now.contains(id) && (known(id) || !installed(id))).cloned().collect();
    if last.len() >= 4 && removed.len() * 2 > last.len() && removed != refused {
        return Err(removed);
    }
    Ok((added, removed))
}

/// The ids to remember for the next ask: `now`, then those of `last` gone from it but kept (not in `removed`), in `last`'s order.
/// So a pin a read missed is not taken for a new one when it is read again, which would bring back one taken off Crest's bar.
fn remembered(last: Option<&[String]>, now: &[String], removed: &[String]) -> Vec<String> {
    let kept = last.unwrap_or_default().iter().filter(|id| !now.contains(id) && !removed.contains(id));
    now.iter().chain(kept).cloned().collect()
}

/// A path on another machine (`\\host\share\x.exe`, from a restored backup, say): probing it would open a connection there.
pub(super) fn remote(id: &str) -> bool {
    id.as_bytes().get(..2).is_some_and(|start| start.iter().all(|b| matches!(b, b'\\' | b'/')))
}

/// A value of an internet shortcut (a `.url`, an ini file) such as `URL` or `IconFile`; None for another file or without it.
fn url_value(path: &Path, key: &str) -> Option<String> {
    if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("url")) {
        return None;
    }
    let text = String::from_utf8_lossy(&std::fs::read(path).ok()?).into_owned();
    text.lines().find_map(|line| line.split_once('=').filter(|(k, _)| k.trim().eq_ignore_ascii_case(key)).map(|(_, v)| v.trim().to_string()))
}

/// Whether an internet shortcut's icon or target is on another machine (`remote`, a `file://host/` URL too), which the shell
/// would connect to as it draws the file.
pub(super) fn url_remote(path: &Path) -> bool {
    ["IconFile", "URL"].iter().filter_map(|key| url_value(path, key)).any(|v| {
        let v = v.get(..5).filter(|s| s.eq_ignore_ascii_case("file:")).map_or(v.as_str(), |_| &v[5..]);
        remote(v) && !v.starts_with("///")
    })
}

/// The apps pinned on Windows' taskbar, in Windows' order, for the bar's pinned list. An error only when the Start list
/// cannot be read; an empty list when nothing is pinned or nothing can be read.
#[tauri::command]
pub async fn taskbar_import_pins(app: AppHandle) -> Result<Vec<App>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let apps = launcher::apps(&app.state::<LauncherState>(), false).map_err(|_| "failed")?;
        Ok(launcher::on_sta(move || pinned(&apps)).unwrap_or_default())
    })
    .await
    .map_err(|_| "failed".to_string())?
}

/// Windows' pins now, and what changed since the ids the notch remembered (`follow`). `ok` false, with nothing else, when they
/// cannot be read or the read looks failed: the notch then changes nothing and keeps what it remembered.
#[derive(Default, Serialize)]
pub struct WindowsPins {
    ok: bool,
    /// The ids for the notch to remember and send back as `last`: Windows' pins now, then those this read missed but kept
    /// (`remembered`).
    now: Vec<String>,
    added: Vec<App>,
    removed: Vec<String>,
}

/// What the last read was refused for (`follow`): the pins it would have taken off. Cleared by a read that goes through.
static REFUSED: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// The bar's pins follow Windows' (store.ts `startTaskbar`): the notch asks at the bar's start, for what changed while Crest was
/// closed, and on each `taskbar://windows-pins`, with the ids of its last answer (None the first time). The Start list is read
/// again when its last read is older than the launcher's gap (`launcher::read_lately`), so an app installed since and pinned
/// from Windows' Start is found, and one not read yet at the bar's start is read now. The notch only.
#[tauri::command]
pub async fn taskbar_windows_pins(app: AppHandle, last: Option<Vec<String>>) -> WindowsPins {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LauncherState>();
        // A failed refresh falls back to the list as last read, or the notch would drop this change until the next one. Never read
        // yet, there is none, and the read that just failed is not tried again (`apps` would read once more on an empty cache).
        let apps = launcher::apps(&state, !launcher::read_lately(&state))
            .ok()
            .or_else(|| launcher::cached(&state, |apps| (!apps.is_empty()).then(|| apps.to_vec())))?;
        launcher::on_sta(move || {
            let (now, links) = read(&apps)?;
            // A shortcut of Windows' folder gone from the read left Windows' taskbar, or has a Start entry of its own by now.
            let folder = taskbar_folder();
            let known = |id: &str| apps.iter().any(|a| a.id == id) || folder.as_deref().is_some_and(|f| ownpins::in_folder(Path::new(id), f));
            // A remote path counts as installed and is never probed.
            let installed = |id: &str| match id.strip_prefix(launcher::APPS_PREFIX) {
                Some(aumid) => launcher::in_apps_folder(aumid),
                None => remote(id) || Path::new(id).is_file(),
            };
            let mut refused = REFUSED.lock().unwrap_or_else(|e| e.into_inner());
            let (added, removed) = match follow(last.as_deref(), &now, &refused, known, installed) {
                Ok(change) => change,
                Err(dropped) => {
                    *refused = dropped;
                    return None;
                }
            };
            refused.clear();
            let added = added.iter().filter_map(|id| app_of(&apps, &links, id)).collect();
            let now = remembered(last.as_deref(), &now, &removed);
            Some(WindowsPins { ok: true, now, added, removed })
        })?
    })
    .await
    .ok()
    .flatten()
    .unwrap_or_default()
}

/// Windows writes this key when an app is pinned or unpinned on its taskbar.
const TASKBAND: PCWSTR = w!(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Taskband");
/// Writes this close together are one change: a pin writes more than one value.
const GATHER_MS: u32 = 500;
/// A key that cannot be opened or watched is tried again this often.
const RETRY_MS: u32 = 30_000;

/// The watch thread's stop event and the thread, while it runs.
static WATCH: Mutex<Option<(isize, JoinHandle<()>)>> = Mutex::new(None);

/// Tells the notch Windows' pins may have changed: it asks what did (`taskbar_windows_pins`).
pub(crate) fn tell(app: &AppHandle) {
    let _ = app.emit_to("notch", "taskbar://windows-pins", ());
}

/// Starts watching Windows' pins unless the thread runs (mod.rs `start`).
pub(crate) fn watch(app: &AppHandle) {
    let mut watch = WATCH.lock().unwrap_or_else(|e| e.into_inner());
    if watch.is_some() {
        return;
    }
    let Ok(stop) = (unsafe { CreateEventW(None, true, false, None) }) else { return };
    // As a number: a HANDLE does not cross threads.
    let stop = stop.0 as isize;
    let app = app.clone();
    *watch = Some((stop, std::thread::spawn(move || run(&app, HANDLE(stop as _)))));
}

/// Stops watching (mod.rs `stop`): returns once the thread has ended, which it does at once, whatever it waits for.
pub(crate) fn unwatch() {
    let Some((stop, thread)) = WATCH.lock().unwrap_or_else(|e| e.into_inner()).take() else { return };
    let stop = HANDLE(stop as _);
    let _ = unsafe { SetEvent(stop) };
    let _ = thread.join();
    let _ = unsafe { CloseHandle(stop) };
}

/// The watch thread: the key, watched until the stop event is set, and opened again `RETRY_MS` after it could not be.
fn run(app: &AppHandle, stop: HANDLE) {
    loop {
        let mut key = HKEY::default();
        if unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, TASKBAND, Some(0), KEY_NOTIFY, &mut key) } == ERROR_SUCCESS {
            let stopped = changes(app, key, stop);
            let _ = unsafe { RegCloseKey(key) };
            if stopped {
                return;
            }
        }
        // The stop event, or a failed wait, which would fail again at once.
        if unsafe { WaitForSingleObject(stop, RETRY_MS) } != WAIT_TIMEOUT {
            return;
        }
    }
}

/// Tells the notch of each change to `key`, once its writes have stopped for `GATHER_MS`. True when the stop event is set (or a
/// wait failed); false when the key cannot be watched (deleted, say), for `run` to open it again.
fn changes(app: &AppHandle, key: HKEY, stop: HANDLE) -> bool {
    let Ok(changed) = (unsafe { CreateEventW(None, false, false, None) }) else { return false };
    let (mut armed, mut gathering) = (false, false);
    let stopped = loop {
        // One-shot: armed again after each signal, never twice for one.
        if !armed {
            if unsafe { RegNotifyChangeKeyValue(key, false, REG_NOTIFY_CHANGE_LAST_SET, Some(changed), true) } != ERROR_SUCCESS {
                // A change gathered so far is told before the key is opened again.
                if gathering {
                    tell(app);
                }
                break false;
            }
            armed = true;
        }
        let woke = unsafe { WaitForMultipleObjects(&[changed, stop], false, if gathering { GATHER_MS } else { INFINITE }) };
        if woke == WAIT_OBJECT_0 {
            (armed, gathering) = (false, true);
        } else if woke == WAIT_TIMEOUT {
            gathering = false;
            tell(app);
        } else {
            break true;
        }
    };
    let _ = unsafe { CloseHandle(changed) };
    stopped
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16(s: &str) -> Vec<u8> {
        s.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<u8>>()
    }

    #[test]
    fn a_pinned_id_counts_only_as_a_whole_string() {
        let mut blob = vec![0x14]; // one stray byte: the strings below sit on odd offsets
        blob.extend(utf16("\u{2}Microsoft.Windows.Explorer\0 Google Chrome.lnk\0\u{2}Chrome\0"));
        blob.push(0); // and these on even ones
        blob.extend(utf16("\0Contoso.Notes_8wekyb3d8bbwe!Notes\0"));
        assert_eq!(find_whole(&blob, "Microsoft.Windows.Explorer"), Some(3));
        assert_eq!(find_whole(&blob, "microsoft.windows.explorer"), Some(3)); // ASCII case does not matter
        let chrome = find_whole(&blob, "Chrome").unwrap();
        assert_eq!(&blob[chrome - 2..chrome], &[2, 0]); // the id after its marker, not the name inside "Google Chrome.lnk"
        assert!(find_whole(&blob, "Contoso.Notes_8wekyb3d8bbwe!Notes").is_some());
        assert_eq!(find_whole(&blob, "Notes"), None); // only the tail of another string
        assert_eq!(find_whole(&blob, "Google"), None);
        assert_eq!(find_whole(&utf16("\u{2}Chrome.Beta\0"), "Chrome"), None); // only the front of a longer id
        assert_eq!(find_whole(&utf16("Chrome\0"), "Chrome"), Some(0)); // at the very start of the data
        assert_eq!(find_whole(&[], "Chrome"), None);
    }

    #[test]
    fn the_import_keeps_windows_order_then_adds_the_folder() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        let found = vec![(900, "Notes".to_string()), (10, "Explorer".to_string()), (400, "Chrome".to_string())];
        assert_eq!(order(found, s(&["Chrome", "Notepad++"])), s(&["Explorer", "Chrome", "Notes", "Notepad++"]));
        assert_eq!(order(vec![], s(&["B", "A", "B"])), s(&["B", "A"])); // no value: the folder alone, each once
    }

    #[test]
    fn windows_pin_changes_follow_only_a_healthy_read() {
        let ids = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let all = |_: &str| true;
        // First time: remember, change nothing.
        assert_eq!(follow(None, &ids(&["a"]), &[], all, all), Ok((vec![], vec![])));
        // New in Windows: added. Gone and still known: removed.
        assert_eq!(follow(Some(&ids(&["a", "b"])[..]), &ids(&["a", "c"]), &[], all, all), Ok((ids(&["c"]), ids(&["b"]))));
        // Gone, unknown to the Start list but still installed: kept (a partial Start list).
        assert_eq!(follow(Some(&ids(&["a", "b"])[..]), &ids(&["a"]), &[], |id| id != "b", all), Ok((vec![], vec![])));
        // Gone and uninstalled: removed.
        assert_eq!(follow(Some(&ids(&["a", "b"])[..]), &ids(&["a"]), &[], |id| id != "b", |id| id != "b"), Ok((vec![], ids(&["b"]))));
        // More than half of a list of four or more gone at once: a failed read.
        assert_eq!(follow(Some(&ids(&["a", "b", "c", "d", "e", "f"])[..]), &ids(&["a", "b"]), &[], all, all), Err(ids(&["c", "d", "e", "f"])));
        // A small list may empty out.
        assert_eq!(follow(Some(&ids(&["a", "b"])[..]), &ids(&[]), &[], all, all), Ok((vec![], ids(&["a", "b"]))));
    }

    #[test]
    fn a_mass_unpin_goes_through_once_a_second_read_drops_the_same_pins() {
        let ids = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let all = |_: &str| true;
        let six = ids(&["a", "b", "c", "d", "e", "f"]);
        // The first read that drops four of six is refused, with what it would drop.
        assert_eq!(follow(Some(&six[..]), &ids(&["a", "b"]), &[], all, all), Err(ids(&["c", "d", "e", "f"])));
        // The next one dropping the same four goes through, with a pin made meanwhile (an update's reset, then a new pin).
        assert_eq!(follow(Some(&six[..]), &ids(&["a", "b", "x"]), &ids(&["c", "d", "e", "f"]), all, all), Ok((ids(&["x"]), ids(&["c", "d", "e", "f"]))));
        // One that drops others is refused again, with its own.
        assert_eq!(follow(Some(&six[..]), &ids(&["a"]), &ids(&["c", "d", "e", "f"]), all, all), Err(ids(&["b", "c", "d", "e", "f"])));
    }

    #[test]
    fn a_pin_the_read_missed_is_still_remembered() {
        let ids = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        // First time: what was read.
        assert_eq!(remembered(None, &ids(&["a", "b"]), &[]), ids(&["a", "b"]));
        // Now's order, then the kept ones in last's order; the removed one is forgotten.
        assert_eq!(remembered(Some(&ids(&["x", "a", "y", "z"])[..]), &ids(&["b", "a"]), &ids(&["y"])), ids(&["b", "a", "x", "z"]));
    }

    #[test]
    fn a_shortcut_without_an_entry_is_kept_by_its_path() {
        let notepad = r"shell:AppsFolder\Notepad";
        let apps = [launcher::fixture(notepad, Some(r"C:\Windows\notepad.exe"))];
        let link = r"C:\p\TaskBar\Tool.lnk";
        // An entry by the exe it starts: the entry's id, no pin of its own.
        assert_eq!(link_or_entry(&apps, link, None, Some(r"c:\windows\NOTEPAD.EXE".into())), (notepad.to_string(), None));
        // No entry: the shortcut's own path, started from the shortcut.
        let tool = Some(r"C:\Tools\tool.exe".to_string());
        assert_eq!(link_or_entry(&apps, link, None, tool.clone()), (link.to_string(), Some(Target::Link { path: link.into(), aumid: None, exe: tool })));
        // A site pinned from Edge: an AppUserModelID no entry has, never matched by its exe.
        let (site, edge) = (Some("MSEdge._crx_site".to_string()), Some(r"C:\Windows\notepad.exe".to_string()));
        assert_eq!(link_or_entry(&apps, link, site.clone(), edge.clone()).1, Some(Target::Link { path: link.into(), aumid: site, exe: edge }));
        // A shortcut with arguments and no AppUserModelID still starts from itself.
        assert_eq!(link_or_entry(&apps, link, None, None).0, link);
    }

    #[test]
    fn a_path_on_another_machine_is_never_probed() {
        assert!(remote(r"\\host\share\x.exe") && remote("//host/share/x.exe") && remote(r"\/host\x.exe"));
        assert!(!remote(r"C:\Apps\x.exe") && !remote(r"\x.exe") && !remote(""));
    }
}
