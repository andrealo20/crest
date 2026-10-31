//! Portable copy: a `Crest.portable` file next to the executable keeps every file the app writes
//! (the WebView2 profile with settings and notes, the vault, caches) in a `data` folder beside it.
//! Secrets stay in Windows Credential Manager on purpose. The installer never ships the marker, so
//! an installed copy or a build output is never portable.
//!
//! Updating in place: the release's latest.json has a `windows-x86_64-portable` entry for the
//! portable zip with its minisign signature. The updater plugin checks that entry and verifies the
//! download; the new executable is written as `Crest.exe.new`, the running one is renamed to
//! `Crest.exe.old` (Windows allows renaming a running executable), the new one takes its name and is
//! started with `--after-update <pid>`, which waits for this process to exit before it runs (the
//! single-instance lock) and removes the old file. A folder the user cannot write to (checked once
//! at start) keeps its data in the installed location and gets the download page instead.

use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use serde::Serialize;
use tauri::{App, AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_updater::UpdaterExt;

pub const MARKER: &str = "Crest.portable";
pub const DATA: &str = "data";
/// The latest.json platform key of the portable zip (release.yml).
const TARGET: &str = "windows-x86_64-portable";
const DOWNLOAD_PAGE: &str = "https://github.com/andrealo20/crest/releases/latest";
const AFTER_UPDATE: &str = "--after-update";

static EXE: OnceLock<Option<PathBuf>> = OnceLock::new();

/// The running executable, read once at start, before an update renames it.
fn exe() -> Option<&'static Path> {
    EXE.get_or_init(|| std::env::current_exe().ok()).as_deref()
}

/// This copy, worked out once at start: its folder, whether the marker is there, and whether that folder can be written.
struct Copy {
    dir: PathBuf,
    portable: bool,
    writable: bool,
}

static COPY: OnceLock<Option<Copy>> = OnceLock::new();

fn copy() -> Option<&'static Copy> {
    COPY.get_or_init(|| {
        let dir = exe()?.parent()?.to_path_buf();
        let portable = dir.join(MARKER).is_file();
        let writable = portable && can_write(&dir);
        Some(Copy { dir, portable, writable })
    })
    .as_ref()
}

/// Whether this copy is portable (the marker is next to the exe), writable or not.
pub fn is_portable() -> bool {
    copy().is_some_and(|c| c.portable)
}

/// The data folder of a copy in `dir`: next to the exe for a portable copy whose folder can be written. A read-only portable copy
/// (a CD, a locked share, Program Files) uses the installed data location instead, since WebView2 could not start there.
pub fn data_dir_for(dir: &Path, portable: bool, writable: bool) -> Option<PathBuf> {
    (portable && writable).then(|| dir.join(DATA))
}

/// The portable data folder of this copy, None when installed or read-only.
pub fn data_dir() -> Option<PathBuf> {
    let c = copy()?;
    data_dir_for(&c.dir, c.portable, c.writable)
}

/// Where the app keeps its own files: the portable data folder or the usual app data folder.
pub fn app_data_dir(app: &AppHandle) -> tauri::Result<PathBuf> {
    match data_dir() {
        Some(dir) => Ok(dir),
        None => app.path().app_data_dir(),
    }
}

/// `Crest.exe` → `Crest.exe.<suffix>`.
pub fn sibling(exe: &Path, suffix: &str) -> PathBuf {
    let mut name = exe.as_os_str().to_owned();
    name.push(".");
    name.push(suffix);
    name.into()
}

/// Creates the notch window from tauri.conf.json ("create": false there), with the portable data folder for WebView2 when there is one.
pub fn create_window(app: &App) -> tauri::Result<WebviewWindow> {
    let config = app.config().app.windows.iter().find(|w| w.label == "notch").cloned().expect("window 'notch' missing");
    let mut builder = WebviewWindowBuilder::from_config(app.handle(), &config)?;
    if let Some(dir) = data_dir() {
        builder = builder.data_directory(dir);
    }
    builder.build()
}

/// For main.rs, before the app starts: after an update, wait for the old process to exit and remove its file; at any start, remove what an update left behind.
pub fn after_update(args: &[String]) {
    if let [_, flag, pid] = args {
        if flag == AFTER_UPDATE {
            if let Ok(pid) = pid.parse::<u32>() {
                wait_for_exit(pid);
            }
        }
    }
    if let Some(exe) = exe() {
        let _ = fs::remove_file(sibling(exe, "old"));
        let _ = fs::remove_file(sibling(exe, "new"));
    }
}

fn wait_for_exit(pid: u32) {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE};
    unsafe {
        if let Ok(process) = OpenProcess(PROCESS_SYNCHRONIZE, false, pid) {
            // As long as it takes: the new version must not start beside the old one.
            WaitForSingleObject(process, INFINITE);
            let _ = CloseHandle(process);
        }
    }
}

fn can_write(dir: &Path) -> bool {
    let probe = dir.join(".crest-write-test");
    let ok = fs::OpenOptions::new().write(true).create_new(true).open(&probe).is_ok();
    let _ = fs::remove_file(&probe);
    ok
}

/// The executable from a portable zip: its one `.exe` (the zip wraps the files in a folder; the copy may have been renamed).
pub fn exe_from_zip(zip: &[u8]) -> Result<Vec<u8>, String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(zip)).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let path = entry.enclosed_name().ok_or("unsafe path in the update")?;
        if entry.is_file() && path.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")) {
            let mut bytes = Vec::with_capacity(entry.size() as usize);
            entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
            return Ok(bytes);
        }
    }
    Err("no executable in the update".into())
}

/// Puts the new executable in place of the running one; on any error the old one stays where it was.
pub fn swap(exe: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let staged = sibling(exe, "new");
    let old = sibling(exe, "old");
    fs::write(&staged, bytes)?;
    let _ = fs::remove_file(&old);
    if let Err(e) = fs::rename(exe, &old) {
        let _ = fs::remove_file(&staged);
        return Err(e);
    }
    if let Err(e) = fs::rename(&staged, exe) {
        let _ = fs::rename(&old, exe);
        let _ = fs::remove_file(&staged);
        return Err(e);
    }
    Ok(())
}

#[derive(Serialize)]
pub struct PortableInfo {
    portable: bool,
    /// The folder can be written: the data stays next to the exe and the copy updates itself.
    writable: bool,
}

#[tauri::command]
pub fn portable_info() -> PortableInfo {
    PortableInfo { portable: is_portable(), writable: copy().is_some_and(|c| c.writable) }
}

/// The newer version of the portable package, None when up to date.
#[tauri::command]
pub async fn portable_check(app: AppHandle) -> Result<Option<String>, String> {
    let update = app.updater_builder().target(TARGET).build().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|u| u.version))
}

/// Downloads and verifies the portable package, puts its executable in place and starts it; `portable://progress` reports 0..1 in
/// whole percents. A folder that cannot be written opens the download page instead and returns true (the app keeps running).
#[tauri::command]
pub async fn portable_install(app: AppHandle) -> Result<bool, String> {
    let exe = exe().ok_or("no executable path")?;
    if !copy().is_some_and(|c| c.writable) {
        return Command::new("explorer").arg(DOWNLOAD_PAGE).spawn().map(|_| true).map_err(|e| e.to_string());
    }
    let update = app.updater_builder().target(TARGET).build().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let Some(update) = update else { return Err("no update".into()) };
    let (mut done, mut shown) = (0usize, 0u64);
    // download() checks the minisign signature against the key in tauri.conf.json before it returns.
    let zip = update
        .download(
            |chunk, total| {
                done += chunk;
                if let Some(total) = total.filter(|t| *t > 0) {
                    let percent = (done as u64 * 100 / total).min(100);
                    if percent != shown {
                        shown = percent;
                        let _ = app.emit("portable://progress", percent as f64 / 100.0);
                    }
                }
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    let bytes = exe_from_zip(&zip)?;
    swap(exe, &bytes).map_err(|e| e.to_string())?;
    Command::new(exe).arg(AFTER_UPDATE).arg(std::process::id().to_string()).spawn().map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_next_to_the_exe_only_when_portable_and_writable() {
        let dir = Path::new(r"D:\Tools\Crest");
        assert_eq!(data_dir_for(dir, true, true), Some(PathBuf::from(r"D:\Tools\Crest\data")));
        // Read-only portable copy: the installed data location.
        assert_eq!(data_dir_for(dir, true, false), None);
        assert_eq!(data_dir_for(dir, false, true), None);
    }

    #[test]
    fn write_probe_leaves_nothing_behind() {
        let dir = std::env::temp_dir().join(format!("crest-probe-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert!(can_write(&dir));
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        assert!(!can_write(&dir.join("missing")));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn siblings_keep_the_name() {
        let exe = Path::new(r"C:\a\Crest.exe");
        assert_eq!(sibling(exe, "new"), PathBuf::from(r"C:\a\Crest.exe.new"));
        assert_eq!(sibling(exe, "old"), PathBuf::from(r"C:\a\Crest.exe.old"));
    }

    #[test]
    fn swap_replaces_and_keeps_the_old_file_aside() {
        let dir = std::env::temp_dir().join(format!("crest-portable-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("Crest.exe");
        fs::write(&exe, b"old").unwrap();
        swap(&exe, b"new").unwrap();
        assert_eq!(fs::read(&exe).unwrap(), b"new");
        assert_eq!(fs::read(sibling(&exe, "old")).unwrap(), b"old");
        assert!(!sibling(&exe, "new").exists());
        // Nothing to replace: an error, and nothing left behind.
        assert!(swap(&dir.join("missing.exe"), b"x").is_err());
        assert!(!dir.join("missing.exe.new").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn exe_is_found_inside_the_folder_of_the_zip() {
        let mut buf = Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut buf);
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("Crest/README-portable.txt", options).unwrap();
            std::io::Write::write_all(&mut zip, b"note").unwrap();
            zip.start_file("Crest/Crest.exe", options).unwrap();
            std::io::Write::write_all(&mut zip, b"binary").unwrap();
            zip.finish().unwrap();
        }
        let bytes = buf.into_inner();
        assert_eq!(exe_from_zip(&bytes).unwrap(), b"binary");
        assert!(exe_from_zip(b"not a zip").is_err());
    }
}
