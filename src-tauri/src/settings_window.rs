//! The settings window (`settings` in tauri.conf.json, page settings.html): Crest's settings in a window of their own,
//! apart from the notch. There is one at a time. Its page asks for the section to open on when it loads
//! (settings_window_section) and hears of later ones on "settings://section"; the other windows learn about open/closed
//! via "settings-window://open".
//!
//! Async on purpose: creating a window from a sync command deadlocks on Windows.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::window::Color;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindowBuilder, WindowEvent};

const LABEL: &str = "settings";
const EVENT: &str = "settings-window://open";
/// The window's size in tauri.conf.json, in logical pixels.
const SIZE: (f64, f64) = (820.0, 600.0);

/// Held while a window is being built, so a second click does not build a second one.
static OPENING: AtomicBool = AtomicBool::new(false);
/// The section the page opens on.
static PENDING: Mutex<Option<String>> = Mutex::new(None);
/// The window has the keyboard. Read by the hit-test poll (lib.rs), which must not ask the main thread.
static FOCUSED: AtomicBool = AtomicBool::new(false);
/// The theme's background, from the notch, so a new window opens in it instead of tauri.conf.json's black.
static BACKGROUND: Mutex<Option<[u8; 3]>> = Mutex::new(None);

#[tauri::command]
pub async fn settings_window_open(section: Option<String>, app: AppHandle) -> Result<(), String> {
    // The notch closing behind the window must not hand the keyboard to another app over it.
    crate::forget_focus(&app);
    let section = section.filter(|s| section_ok(s));
    if !begin_open(&OPENING) {
        // A build is running: its page takes the section when it loads.
        if section.is_some() {
            *PENDING.lock().unwrap() = section;
        }
        return Ok(());
    }
    let _opening = Opening;
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.unminimize();
        window.show().map_err(|e| e.to_string())?;
        let _ = window.set_focus();
        if let Some(section) = section {
            let _ = app.emit_to(LABEL, "settings://section", section);
        }
        return Ok(());
    }
    *PENDING.lock().unwrap() = section;
    let config = app.config().app.windows.iter().find(|w| w.label == LABEL).cloned().ok_or("Settings window missing in config")?;
    // A portable copy gives this window the notch's WebView2 folder too (portable.rs).
    let window = WebviewWindowBuilder::from_config(&app, &config)
        .map(|b| b.on_navigation(crate::own_page))
        .map(|builder| match *BACKGROUND.lock().unwrap() {
            Some([r, g, b]) => builder.background_color(Color(r, g, b, 255)),
            None => builder,
        })
        .map(|b| match crate::portable::data_dir() {
            Some(dir) => b.data_directory(dir),
            None => b,
        })
        .and_then(|b| b.build())
        .map_err(|e| e.to_string())?;
    // Opened during a recording or screenshot, or while Crest is hidden from screen sharing: left out of it like the notch.
    #[cfg(windows)]
    crate::capture::exclude_if_capturing(&app);
    #[cfg(not(windows))]
    crate::sharing::protect_new(&app);
    if let Some((x, y)) = spot(&app) {
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
    // Before the first show, so the focus it gets is already seen.
    let handle = app.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(on) => FOCUSED.store(*on, Ordering::Relaxed),
        WindowEvent::Destroyed => {
            FOCUSED.store(false, Ordering::Relaxed);
            let _ = handle.emit(EVENT, false);
        }
        _ => {}
    });
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    let _ = app.emit(EVENT, true);
    Ok(())
}

/// The section the page opens on, asked once when it loads.
#[tauri::command]
pub fn settings_window_section() -> Option<String> {
    PENDING.lock().unwrap().take()
}

/// The theme's background (`--color-notch`), sent by the notch when it changes. Only the next window takes it: a page already
/// open draws its own.
#[tauri::command]
pub fn settings_window_background(color: String) {
    *BACKGROUND.lock().unwrap() = parse_hex(&color);
}

/// "#rrggbb", the form the theme writes its colours in; anything else leaves the window black.
fn parse_hex(s: &str) -> Option<[u8; 3]> {
    let hex = s.strip_prefix('#').filter(|h| h.len() == 6 && h.bytes().all(|b| b.is_ascii_hexdigit()))?;
    let byte = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    Some([byte(0)?, byte(2)?, byte(4)?])
}

/// Tray "Settings …" and a second launch.
pub(crate) fn open_settings(app: &AppHandle, section: Option<String>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = settings_window_open(section, app).await;
    });
}

/// Has the settings window the keyboard?
pub(crate) fn focused() -> bool {
    FOCUSED.load(Ordering::Relaxed)
}

/// Centred in the work area of the monitor under the pointer (the primary one if that fails) and kept inside it, for a
/// window of SIZE at that monitor's scale. Set before the first show: `center()` and `outer_size()` measure a new window
/// at the scale of the monitor it was created on.
fn spot(app: &AppHandle) -> Option<(i32, i32)> {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let (area, scale) = (monitor.work_area(), monitor.scale_factor());
    let mid = |start: i32, room: u32, len: f64| start + ((room as i32 - (len * scale) as i32) / 2).max(0);
    Some((mid(area.position.x, area.size.width, SIZE.0), mid(area.position.y, area.size.height, SIZE.1)))
}

/// A section id as the settings name them: 1 to 40 of a-z, 0-9 and '-'. It ends up in a selector on the page.
fn section_ok(s: &str) -> bool {
    (1..=40).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Takes the flag; false while another open holds it.
fn begin_open(flag: &AtomicBool) -> bool {
    !flag.swap(true, Ordering::AcqRel)
}

fn end_open(flag: &AtomicBool) {
    flag.store(false, Ordering::Release);
}

/// Gives OPENING back on every way out of an open, a failed build included.
struct Opening;

impl Drop for Opening {
    fn drop(&mut self) {
        end_open(&OPENING);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_section_ids_pass() {
        assert!(section_ok("updates") && section_ok("ai-usage") && section_ok("a1"));
        assert!(!section_ok("") && !section_ok("Updates") && !section_ok("x\"]") && !section_ok("a b"));
        assert!(!section_ok(&"a".repeat(41)));
    }

    #[test]
    fn only_six_digit_hex_colours_parse() {
        assert_eq!(parse_hex("#111318"), Some([0x11, 0x13, 0x18]));
        assert_eq!(parse_hex("#F9F9FF"), Some([0xf9, 0xf9, 0xff]));
        assert_eq!(parse_hex("rgb(0 0 0)"), None);
        assert_eq!(parse_hex("#fff"), None);
        assert_eq!(parse_hex(""), None);
    }

    #[test]
    fn opening_twice_builds_once() {
        let flag = std::sync::atomic::AtomicBool::new(false);
        assert!(begin_open(&flag));
        assert!(!begin_open(&flag)); // a second click while the first build runs
        end_open(&flag);
        assert!(begin_open(&flag));
    }
}
