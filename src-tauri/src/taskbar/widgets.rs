//! The commands of the bar's widgets (Windows only): the page's hello, which has the notch send it the widgets' data, the
//! clock's click and the settings pages of the quick panel and its pages.

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

/// The settings pages the quick panel and its pages open, by name: the page never sends a URL.
fn settings_page(page: &str) -> Option<&'static str> {
    match page {
        "home" => Some("ms-settings:"),
        "saver" => Some("ms-settings:batterysaver"),
        "airplane" => Some("ms-settings:network-airplanemode"),
        "ethernet" => Some("ms-settings:network-ethernet"),
        "wifi" => Some("ms-settings:network-wifi"),
        "bluetooth" => Some("ms-settings:bluetooth"),
        "location" => Some("ms-settings:privacy-location"),
        "microphone" => Some("ms-settings:privacy-microphone"),
        "camera" => Some("ms-settings:privacy-webcam"),
        "mixer" => Some("ms-settings:apps-volume"),
        _ => None,
    }
}

/// Opens one of Windows' settings pages named by `settings_page`.
#[tauri::command]
pub fn taskbar_settings(page: String) -> Result<(), String> {
    crate::open_url(settings_page(&page).ok_or("unknown")?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_settings_pages_open() {
        assert_eq!(settings_page("home"), Some("ms-settings:"));
        assert_eq!(settings_page("microphone"), Some("ms-settings:privacy-microphone"));
        assert_eq!(settings_page("camera"), Some("ms-settings:privacy-webcam"));
        assert_eq!(settings_page("mixer"), Some("ms-settings:apps-volume"));
        assert_eq!(settings_page("saver"), Some("ms-settings:batterysaver"));
        assert_eq!(settings_page("airplane"), Some("ms-settings:network-airplanemode"));
        assert_eq!(settings_page("ethernet"), Some("ms-settings:network-ethernet"));
        assert_eq!(settings_page("wifi"), Some("ms-settings:network-wifi"));
        assert_eq!(settings_page("bluetooth"), Some("ms-settings:bluetooth"));
        assert_eq!(settings_page("location"), Some("ms-settings:privacy-location"));
        assert_eq!(settings_page("ms-availablenetworks:"), None);
        assert_eq!(settings_page("ms-settings:privacy"), None);
        assert_eq!(settings_page(""), None);
    }
}
