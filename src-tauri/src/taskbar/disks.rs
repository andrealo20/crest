//! The bar's disk space widget (Windows only): the lettered drives with their free space, read by system/hw.rs, and opening one
//! in File Explorer by a letter this module listed, never a path from the page. Read on a call only: the notch asks every few
//! minutes for the widget and a bar as its panel opens; Crest hears no device change, so a drive plugged in shows on the next.

use std::sync::Mutex;

use tauri::WebviewWindow;

use super::bar;
use crate::system::{bar_drives, BarDrive};

/// The letters of the last listing: the only drives a bar may open.
static LISTED: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// The drives now, read off the calling thread.
#[tauri::command]
pub async fn taskbar_disks() -> Vec<BarDrive> {
    let list = tauri::async_runtime::spawn_blocking(bar_drives).await.unwrap_or_default();
    *LISTED.lock().unwrap_or_else(|e| e.into_inner()) = list.iter().map(|d| d.letter.clone()).collect();
    list
}

/// A letter the last listing had.
fn listed(letters: &[String], letter: &str) -> bool {
    letters.iter().any(|l| l == letter)
}

/// Opens a listed drive in File Explorer, by Explorer's full path: never the shell's open verb, which an autorun.inf could take
/// over. The bar only.
#[tauri::command]
pub fn taskbar_disk_open(window: WebviewWindow, letter: String) -> Result<(), String> {
    bar::from_bar(&window)?;
    if !listed(&LISTED.lock().unwrap_or_else(|e| e.into_inner()), &letter) {
        return Err("unknown".into());
    }
    crate::opener().arg(format!("{letter}\\")).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_listed_letters_open() {
        let letters = vec!["C:".to_string(), "E:".to_string()];
        assert!(listed(&letters, "C:") && listed(&letters, "E:"));
        assert!(!listed(&letters, "D:") && !listed(&letters, r"C:\Windows") && !listed(&letters, "") && !listed(&[], "C:"));
    }
}
