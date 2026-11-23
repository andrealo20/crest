//! The desktop's wallpaper (design H): Crest's collection or a folder the user picks, set per screen with the system's own way
//! (IDesktopWallpaper on Windows, NSWorkspace on a Mac), and the collection's full pictures downloaded once on request.

/// The screens' wallpapers and the main screen's as a small picture.
#[tauri::command]
pub fn wallpaper_current() -> Result<(), String> {
    Err("unsupported".into())
}

/// The collection's ids present on the PC (`source` "crest"), or a folder's pictures by path.
#[tauri::command]
pub fn wallpaper_list(source: String, folder: String) -> Result<Vec<String>, String> {
    let _ = (source, folder);
    Err("unsupported".into())
}

/// A picture of the collection or a file on one screen, or on every screen without `screen`.
#[tauri::command]
pub fn wallpaper_set(crest: Option<String>, path: Option<String>, screen: Option<String>, fit: String) -> Result<(), String> {
    let _ = (crest, path, screen, fit);
    Err("unsupported".into())
}

/// The next or the previous picture of the source on every screen.
#[tauri::command]
pub fn wallpaper_step(by: i32, source: String, folder: String, fit: String) -> Result<(), String> {
    let _ = (by, source, folder, fit);
    Err("unsupported".into())
}

/// How a picture fills the screens.
#[tauri::command]
pub fn wallpaper_fit(fit: String) -> Result<(), String> {
    let _ = fit;
    Err("unsupported".into())
}

/// A folder the user picks over the calling window; None when cancelled.
#[tauri::command]
pub fn wallpaper_folder() -> Option<String> {
    None
}

/// Downloads the collection's full pictures once; their size in bytes.
#[tauri::command]
pub fn wallpaper_pack_download() -> Result<u64, String> {
    Err("unsupported".into())
}

/// Deletes the downloaded pictures.
#[tauri::command]
pub fn wallpaper_pack_remove() -> Result<(), String> {
    Err("unsupported".into())
}
