//! Backups of Crest's saved data. The frontend collects the data (every `notch:` entry of the web view's storage) and checks
//! a file before it restores it (src/features/settings/backup.ts); this side writes the file into Documents\Crest\Backups
//! and reads the one the user picks. API keys and passwords are never in it: they stay in the system's credential store.
//! Errors are short codes the settings translate.

use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, WebviewWindow};

use crate::picker::{self, Pick};

/// A backup takes a few hundred KB; a file far past that is not one.
const MAX_BYTES: u64 = 32 * 1024 * 1024;

/// Documents/Crest/Backups, which may not exist yet.
fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().document_dir().map_err(|_| "no-folder")?.join("Crest").join("Backups"))
}

/// Writes `text` as a new file, "Crest backup 2026-11-10 140501.json" ("Crest before restore …" for the copy of the data
/// a restore replaces), next to the earlier ones; its path.
#[tauri::command]
pub async fn backup_save(text: String, before_restore: bool, app: AppHandle) -> Result<String, String> {
    if text.len() as u64 > MAX_BYTES {
        return Err("too-big".into());
    }
    let dir = folder(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        fs::create_dir_all(&dir).map_err(|_| "no-folder")?;
        let prefix = if before_restore { "Crest before restore" } else { "Crest backup" };
        let base = format!("{prefix} {}", jiff::Zoned::now().strftime("%Y-%m-%d %H%M%S"));
        let (path, mut file) = create(&dir, &base).map_err(|_| "write")?;
        if file.write_all(text.as_bytes()).and_then(|_| file.sync_all()).is_err() {
            drop(file);
            let _ = fs::remove_file(&path);
            return Err("write".to_string());
        }
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|_| "write".to_string())?
}

/// A new file `<base>.json` in `dir`, or `<base> (2).json` and on while the name is taken; never one that exists.
fn create(dir: &Path, base: &str) -> std::io::Result<(PathBuf, File)> {
    let mut n = 1;
    loop {
        let path = dir.join(if n == 1 { format!("{base}.json") } else { format!("{base} ({n}).json") });
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(e) if e.kind() == ErrorKind::AlreadyExists && n < 1000 => n += 1,
            Err(e) => return Err(e),
        }
    }
}

/// Asks for a backup file, starting in the backups folder, and returns its text; None when the picker was cancelled.
#[tauri::command]
pub async fn backup_open(app: AppHandle, window: WebviewWindow) -> Result<Option<String>, String> {
    let dir = folder(&app).ok().filter(|d| d.is_dir());
    let Some(path) = picker::pick(Pick::File { name: "Crest backup", exts: &["json"], dir }, &window).await else { return Ok(None) };
    tauri::async_runtime::spawn_blocking(move || read(Path::new(&path)).map(Some)).await.map_err(|_| "unreadable".to_string())?
}

/// The file's text, at most `MAX_BYTES` read: anything larger, or not UTF-8, is no backup.
fn read(path: &Path) -> Result<String, String> {
    let mut text = String::new();
    File::open(path).and_then(|f| f.take(MAX_BYTES + 1).read_to_string(&mut text)).map_err(|_| "unreadable")?;
    if text.len() as u64 > MAX_BYTES {
        return Err("too-big".into());
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_name_never_replaces_an_earlier_backup() {
        let dir = std::env::temp_dir().join(format!("crest-backup-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let (first, _) = create(&dir, "Crest backup 2026-11-10 140501").unwrap();
        let (second, _) = create(&dir, "Crest backup 2026-11-10 140501").unwrap();
        assert_eq!(first.file_name().unwrap(), "Crest backup 2026-11-10 140501.json");
        assert_eq!(second.file_name().unwrap(), "Crest backup 2026-11-10 140501 (2).json");
        fs::write(&first, "x".repeat(10)).unwrap();
        assert_eq!(read(&first).unwrap().len(), 10);
        assert_eq!(read(&dir.join("missing.json")), Err("unreadable".to_string()));
        fs::remove_dir_all(&dir).unwrap();
    }
}
