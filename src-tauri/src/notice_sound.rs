//! The sound file Crest plays for notices when the user picks one of their own (issue #31). It is copied into Crest's
//! data folder, so the notice keeps its sound when the original is moved or deleted, and the page reads it back as
//! bytes to decode with Web Audio: no file URL, and nothing to open in the page's security rules.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, WebviewWindow};

use crate::picker::{self, Pick};

/// What the picker offers and the page can decode.
const EXTS: &[&str] = &["mp3", "wav", "ogg", "m4a", "flac"];
/// A notification sound is a few seconds; anything larger is not one and would only slow the first notice down.
const MAX_BYTES: u64 = 5 * 1024 * 1024;
const NAME: &str = "notice";

fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::portable::app_data_dir(app).map_err(|e| e.to_string())?.join("sounds"))
}

/// The file's extension when it is one of `EXTS`, in lower case.
fn sound_ext(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    EXTS.iter().copied().find(|e| *e == ext)
}

/// The copy in `dir`, if there is one.
fn stored(dir: &Path) -> Option<PathBuf> {
    EXTS.iter().map(|e| dir.join(format!("{NAME}.{e}"))).find(|p| p.is_file())
}

/// Copies `from` into `dir` as the notice sound, in place of the one before, and returns the file's own name.
/// Errors: "format" (not a sound the page can play), "size" (empty or over `MAX_BYTES`), or the file system's.
fn import(dir: &Path, from: &Path) -> Result<String, String> {
    let ext = sound_ext(from).ok_or("format")?;
    let len = fs::metadata(from).map_err(|e| e.to_string())?.len();
    if len == 0 || len > MAX_BYTES {
        return Err("size".into());
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    // Copied next to the old one first: a copy that fails half way leaves the old sound in place.
    let part = dir.join(format!("{NAME}.part"));
    fs::copy(from, &part).map_err(|e| e.to_string())?;
    for old in EXTS.iter().map(|e| dir.join(format!("{NAME}.{e}"))) {
        let _ = fs::remove_file(old);
    }
    fs::rename(&part, dir.join(format!("{NAME}.{ext}"))).map_err(|e| e.to_string())?;
    Ok(from.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())
}

/// Asks for a sound file and keeps a copy; the file's name, or None when the picker was cancelled.
#[tauri::command]
pub async fn notices_sound_pick(app: AppHandle, window: WebviewWindow) -> Result<Option<String>, String> {
    let dir = folder(&app)?;
    let Some(path) = picker::pick(Pick::File { name: "Audio", exts: EXTS, dir: None }, &window).await else { return Ok(None) };
    tauri::async_runtime::spawn_blocking(move || import(&dir, Path::new(&path)).map(Some)).await.map_err(|e| e.to_string())?
}

/// The kept sound's bytes for the page to decode; "none" when there is no copy (a fresh install, a restored backup).
#[tauri::command]
pub fn notices_sound_read(app: AppHandle) -> Result<tauri::ipc::Response, String> {
    let path = stored(&folder(&app)?).ok_or("none")?;
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > MAX_BYTES {
        return Err("size".into());
    }
    Ok(tauri::ipc::Response::new(fs::read(&path).map_err(|e| e.to_string())?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sound_files_only() {
        assert_eq!(sound_ext(Path::new(r"C:\a\Ping.MP3")), Some("mp3"));
        assert_eq!(sound_ext(Path::new("b.flac")), Some("flac"));
        assert_eq!(sound_ext(Path::new("c.mp3.exe")), None);
        assert_eq!(sound_ext(Path::new("noext")), None);
    }

    #[test]
    fn import_keeps_one_copy() {
        let base = std::env::temp_dir().join(format!("crest-sound-test-{}", std::process::id()));
        let (dir, src) = (base.join("sounds"), base.join("src"));
        fs::create_dir_all(&src).unwrap();
        let (mp3, wav, txt, big) = (src.join("a.mp3"), src.join("Ping.WAV"), src.join("b.txt"), src.join("big.ogg"));
        fs::write(&mp3, b"ID3").unwrap();
        fs::write(&wav, b"RIFF").unwrap();
        fs::write(&txt, b"text").unwrap();
        fs::File::create(&big).unwrap().set_len(MAX_BYTES + 1).unwrap();

        assert_eq!(import(&dir, &mp3).as_deref(), Ok("a.mp3"));
        assert_eq!(stored(&dir), Some(dir.join("notice.mp3")));
        // A new sound replaces the old one, whatever its format.
        assert_eq!(import(&dir, &wav).as_deref(), Ok("Ping.WAV"));
        assert_eq!(stored(&dir), Some(dir.join("notice.wav")));
        assert!(!dir.join("notice.mp3").exists() && !dir.join("notice.part").exists());
        assert_eq!(fs::read(dir.join("notice.wav")).unwrap(), b"RIFF");
        // Refused files leave the kept one alone.
        assert_eq!(import(&dir, &txt), Err("format".into()));
        assert_eq!(import(&dir, &big), Err("size".into()));
        assert_eq!(stored(&dir), Some(dir.join("notice.wav")));
        let _ = fs::remove_dir_all(&base);
    }
}
