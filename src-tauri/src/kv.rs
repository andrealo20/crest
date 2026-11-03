//! The frontend's saved state (settings, notes, to-dos, timer...) in a file of Crest's own. WebView2 has opened an empty
//! localStorage beside the real one more than once, after a Windows restart and after a normal quit, so localStorage is
//! only a cache: the notch fills it from this file before the app starts (src/main.tsx, src/platform/kv.ts).

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, State};

const FILE: &str = "storage.json";
/// Keys are the stores' own (`notch:<name>`); a value is one store as JSON, a long note or scratchpad at most.
const MAX_KEY: usize = 64;
const MAX_VALUE: usize = 4 << 20;

type Map = BTreeMap<String, String>;

/// Read from disk on first use, then kept here; every change writes the whole file.
#[derive(Default)]
pub struct KvState(Mutex<Option<Map>>);

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    crate::portable::app_data_dir(app).map(|dir| dir.join(FILE)).map_err(|e| e.to_string())
}

fn read(path: &PathBuf) -> Map {
    let Ok(bytes) = std::fs::read(path) else { return Map::new() };
    serde_json::from_slice(&bytes).unwrap_or_else(|_| {
        // Kept aside rather than overwritten by the next save; localStorage still fills the new file.
        let _ = std::fs::rename(path, path.with_extension("json.bad"));
        Map::new()
    })
}

fn valid(key: &str, value: &str) -> bool {
    key.starts_with("notch:") && key.len() <= MAX_KEY && value.len() <= MAX_VALUE
}

#[tauri::command]
pub fn kv_load(app: AppHandle, state: State<'_, KvState>) -> Result<Map, String> {
    let path = path(&app)?;
    let mut map = state.0.lock().unwrap();
    Ok(map.get_or_insert_with(|| read(&path)).clone())
}

#[tauri::command]
pub fn kv_set(app: AppHandle, state: State<'_, KvState>, key: String, value: String) -> Result<(), String> {
    if !valid(&key, &value) {
        return Err("kv-invalid".into());
    }
    let path = path(&app)?;
    let mut guard = state.0.lock().unwrap();
    let map = guard.get_or_insert_with(|| read(&path));
    if map.get(&key) == Some(&value) {
        return Ok(());
    }
    map.insert(key, value);
    let bytes = serde_json::to_vec(map).map_err(|e| e.to_string())?;
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    crate::write_atomic(&path, &bytes).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_store_keys_of_sane_size() {
        assert!(valid("notch:settings", "{}"));
        assert!(!valid("crest:lyrics:x", "{}"));
        assert!(!valid(&format!("notch:{}", "k".repeat(MAX_KEY)), "{}"));
        assert!(!valid("notch:note", &"x".repeat(MAX_VALUE + 1)));
    }

    #[test]
    fn a_broken_file_is_kept_aside_and_reads_empty() {
        let dir = std::env::temp_dir().join(format!("crest-kv-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE);
        std::fs::write(&path, b"{not json").unwrap();
        assert!(read(&path).is_empty());
        assert!(path.with_extension("json.bad").exists() && !path.exists());
        std::fs::write(&path, br#"{"notch:note":"\"hi\""}"#).unwrap();
        assert_eq!(read(&path).get("notch:note").map(String::as_str), Some("\"hi\""));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
