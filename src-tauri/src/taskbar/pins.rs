//! The apps pinned on Windows' own taskbar, for the bar's pinned list (`taskbar_import_pins`). Two sources:
//!
//! - The `Favorites` value of `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Taskband`, where Windows keeps every app
//!   pinned on its taskbar, Store apps included, in their order. Its format is undocumented: Crest never parses it, it only
//!   searches it, read-only, for the ids of Start entries as whole strings (`find_whole`).
//! - The `User Pinned\TaskBar` folder (the documented known folder `FOLDERID_UserPinned`): each shortcut names its Start entry by
//!   its AppUserModelID or by the exe it starts, as an open window does (`launcher::entries_for`).
//!
//! The apps come in the value's order, then those only the folder has, by file name. Without the value (missing, or changed by a
//! Windows update) the folder alone remains.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};
use windows::core::{w, HSTRING};
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_BINARY};
use windows::Win32::UI::Shell::{FOLDERID_UserPinned, IShellItem2, SHCreateItemFromParsingName, SHGetKnownFolderPath, KF_FLAG_DEFAULT};

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

/// The `Favorites` value, empty when it is missing or cannot be read (one that grew between the two reads is too big for its
/// buffer).
fn favorites() -> Vec<u8> {
    let read = |data: Option<*mut core::ffi::c_void>, size: &mut u32| {
        let key = w!(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Taskband");
        (unsafe { RegGetValueW(HKEY_CURRENT_USER, key, w!("Favorites"), RRF_RT_REG_BINARY, None, data, Some(size)) }) == ERROR_SUCCESS
    };
    let mut size = 0;
    if !read(None, &mut size) {
        return Vec::new();
    }
    let mut value = vec![0u8; size as usize];
    if !read(Some(value.as_mut_ptr().cast()), &mut size) {
        return Vec::new();
    }
    value.truncate(size as usize);
    value
}

/// The shortcuts in `User Pinned\TaskBar` by file name, as the ids of their entries in the Start list: by the shortcut's
/// AppUserModelID, else by the exe it starts with no arguments. A shortcut without an entry (a portable exe) is left out.
fn folder(apps: &[App]) -> Vec<String> {
    let dir = unsafe { SHGetKnownFolderPath(&FOLDERID_UserPinned, KF_FLAG_DEFAULT, None) }.ok().and_then(|p| unsafe { crate::controls::take(p) });
    let Some(Ok(files)) = dir.map(|dir| std::fs::read_dir(Path::new(&dir).join("TaskBar"))) else { return Vec::new() };
    let mut links: Vec<PathBuf> = files.flatten().map(|f| f.path()).filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk"))).collect();
    links.sort();
    links
        .iter()
        .filter_map(|link| unsafe {
            let item: IShellItem2 = SHCreateItemFromParsingName(&HSTRING::from(link.as_path()), None).ok()?;
            // An empty id is none, as on a window (tasks.rs).
            let aumid = item.GetString(&APP_USER_MODEL_ID).ok().and_then(|p| crate::controls::take(p)).filter(|id| !id.is_empty());
            let exe = if aumid.is_some() { String::new() } else { launcher::shortcut_exe(&item)? };
            launcher::entries_for(apps, aumid.as_deref(), &exe).into_iter().next().map(|a| a.id)
        })
        .collect()
}

/// The Start list's entries pinned on Windows' taskbar, in Windows' order (`order`). Needs COM: run it through `launcher::on_sta`.
fn pinned(apps: &[App]) -> Vec<App> {
    let value = favorites();
    let found = apps.iter().filter_map(|a| Some((find_whole(&value, a.id.strip_prefix(launcher::APPS_PREFIX)?)?, a.id.clone()))).collect();
    order(found, folder(apps)).into_iter().filter_map(|id| apps.iter().find(|a| a.id == id).cloned()).collect()
}

/// The Start entries pinned on Windows' taskbar, in Windows' order, for the bar's pinned list. An error only when the Start list
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
}
