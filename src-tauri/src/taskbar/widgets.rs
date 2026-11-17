//! The commands of the bar's widgets (Windows only): the page's hello, which has the notch send it the widgets' data, and the
//! clock's click.

use tauri::{AppHandle, Emitter};

use super::bar;

/// The bar's page listens now: the notch sends it the widgets' data (`bar://hello`), through here since the bar may not emit.
/// Whether the bar shows, so the page starts with its widgets paused or not.
#[tauri::command]
pub fn taskbar_hello(app: AppHandle) -> bool {
    let _ = app.emit_to("notch", "bar://hello", ());
    bar::shown()
}

/// The clock's click opens Windows 11's notification centre, which holds the calendar, as a click on Windows' own clock does.
#[tauri::command]
pub fn taskbar_calendar() -> Result<(), String> {
    crate::open_url("ms-actioncenter:")
}
