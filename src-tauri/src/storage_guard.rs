//! WebView2 once opened an empty localStorage next to the real one right after a Windows restart: Crest started on its
//! defaults although every setting was still on disk, and the next launch found them again. A marker in the app data
//! folder tells that apart from a first run, and one restart lets WebView2 open the real database.

use std::fs;
use tauri::AppHandle;

/// Written once the frontend has seen saved settings (or on the first run, which saves its defaults right away).
const SEEN: &str = "webview-storage-seen";
/// Written before the one restart, so a storage that stays empty cannot restart Crest in a loop.
const RETRIED: &str = "webview-storage-retried";

#[derive(Debug, PartialEq)]
enum Action {
    /// Storage looks right: remember that settings exist and forget any retry.
    Ok,
    /// Settings existed before but the storage is empty: restart once.
    Restart,
    /// Still empty after the restart: tell the user, and allow a retry again next launch.
    Lost,
}

/// `empty`: localStorage had no settings at startup; `seen`: settings were saved on an earlier launch; `retried`: this
/// launch is the restart Crest asked for.
fn action(empty: bool, seen: bool, retried: bool) -> Action {
    // Only "empty but seen before" is suspect; a leftover retry marker without saved settings is a fresh install.
    match (empty, seen, retried) {
        (true, true, false) => Action::Restart,
        (true, true, true) => Action::Lost,
        _ => Action::Ok,
    }
}

/// Called once by the frontend at startup, with the warning already in the user's language.
#[tauri::command]
pub fn storage_check(app: AppHandle, empty: bool, message: String) {
    let Ok(dir) = crate::portable::app_data_dir(&app) else { return };
    let (seen, retried) = (dir.join(SEEN), dir.join(RETRIED));
    match action(empty, seen.exists(), retried.exists()) {
        Action::Ok => {
            let _ = fs::create_dir_all(&dir);
            let _ = fs::write(&seen, "");
            let _ = fs::remove_file(&retried);
        }
        // No marker, no restart: without it the next launch could not tell it already tried.
        Action::Restart => {
            if fs::write(&retried, "").is_ok() {
                app.restart();
            }
        }
        Action::Lost => {
            let _ = fs::remove_file(&retried);
            warn(message);
        }
    }
}

#[cfg(windows)]
fn warn(message: String) {
    use windows::core::{HSTRING, w};
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONWARNING, MB_OK, MB_TOPMOST};
    // Its own thread: the box waits for a click and must not hold up the command.
    std::thread::spawn(move || unsafe {
        MessageBoxW(None, &HSTRING::from(message), w!("Crest"), MB_OK | MB_ICONWARNING | MB_TOPMOST);
    });
}

#[cfg(not(windows))]
fn warn(message: String) {
    eprintln!("{message}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_run_and_normal_launches_are_ok() {
        assert_eq!(action(true, false, false), Action::Ok);
        assert_eq!(action(false, true, false), Action::Ok);
        assert_eq!(action(false, false, false), Action::Ok);
    }

    #[test]
    fn empty_storage_after_saved_settings_restarts_once() {
        assert_eq!(action(true, true, false), Action::Restart);
        assert_eq!(action(true, true, true), Action::Lost);
    }

    #[test]
    fn settings_back_after_the_restart_clear_the_retry() {
        assert_eq!(action(false, true, true), Action::Ok);
    }
}
