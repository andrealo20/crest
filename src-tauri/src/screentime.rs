//! Screen Time (design G): which app is in front, per local hour and day, kept only on this PC while the user has turned it on.
//! Off until then; the notch turns it on and off (`screentime_set`), the tool and the bar's panel read the days (`screentime_days`),
//! the settings delete them (`screentime_clear`).

/// Starts or stops recording, and deletes the days past the 30 kept.
#[tauri::command]
pub fn screentime_set(on: bool) -> Result<(), String> {
    let _ = on;
    Err("unsupported".into())
}

/// The days from `from` to `to` ("YYYY-MM-DD", 31 at most), those without a record left out.
#[tauri::command]
pub fn screentime_days(from: String, to: String) -> Result<Vec<()>, String> {
    let _ = (from, to);
    Err("unsupported".into())
}

/// Deletes every day kept.
#[tauri::command]
pub fn screentime_clear() -> Result<(), String> {
    Err("unsupported".into())
}
