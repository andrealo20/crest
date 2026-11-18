//! The commands of the bar's widgets (Windows only): the page's hello, which has the notch send it the widgets' data, and the
//! clock's click.

use tauri::{AppHandle, Emitter, WebviewWindow};

use super::bar;

/// A bar's page listens now. The primary's has the notch send it the widgets' data (`bar://hello`), through here since the bar
/// may not emit; the notch feeds no other bar, and another's hello would only have it send everything to the primary again.
/// Whether the calling bar shows and is not slid off the screen, so the page starts with its widgets and its glass paused or not.
#[tauri::command]
pub fn taskbar_hello(app: AppHandle, window: WebviewWindow) -> bool {
    if window.label() == bar::LABEL {
        let _ = app.emit_to("notch", "bar://hello", ());
    }
    bar::shown(window.label())
}

/// The clock's click opens Windows 11's notification centre, which holds the calendar, as a click on Windows' own clock does.
#[tauri::command]
pub fn taskbar_calendar() -> Result<(), String> {
    crate::open_url("ms-actioncenter:")
}
