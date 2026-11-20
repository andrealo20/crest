//! Linux: what the Windows modules do with Win32, as far as every desktop allows. For now these are stand-ins so the shared
//! code builds and runs; each tool that needs more is hidden (src/notch/tabs.ts) until its real version lands here.
//! The audio and monitor watchers are the Mac's, which only use Tauri.

pub mod audio;
pub mod clipboard;
pub mod input;
pub mod media;
pub mod mixer;
pub mod secrets;
#[path = "../macos/mirror.rs"]
pub mod mirror;

use tauri::WebviewWindow;

/// Run through XWayland on a Wayland session. A native Wayland window can't choose its place, stay on top or hide from
/// Alt+Tab (and GNOME has no layer-shell), while an X11 window can; the pointer is not needed for hover (input.rs).
/// `CREST_WAYLAND=1` keeps native Wayland, and so does a GDK_BACKEND already set. Must run before GTK starts, from main.
pub fn prefer_x11() {
    let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some() || std::env::var("XDG_SESSION_TYPE").is_ok_and(|t| t == "wayland");
    if wayland && std::env::var_os("DISPLAY").is_some() && std::env::var_os("GDK_BACKEND").is_none() && std::env::var_os("CREST_WAYLAND").is_none() {
        std::env::set_var("GDK_BACKEND", "x11");
    }
}

/// The left mouse button is held (hit_test.rs). Linux does not poll the pointer (input.rs), so this is only here for the shared
/// code to build; nothing calls it.
#[allow(dead_code)]
pub fn left_button_down() -> bool {
    false
}

/// Above other windows. Wayland lets a client ask but not insist, so the real fix is a shell extension on GNOME.
pub fn raise(window: &WebviewWindow) {
    let _ = window.set_always_on_top(true);
}

/// The app that has the keyboard (lib.rs keyboard_focus): no compositor-neutral way to read it, so none is remembered.
pub fn frontmost_pid() -> i32 {
    0
}

/// Gives the keyboard back to that app; false means there is no app to give it to.
pub fn activate_pid(_: i32) -> bool {
    false
}

/// Whether Crest may press keys in other apps (a paste from the history). Not on Linux yet.
pub fn may_press_keys() -> bool {
    false
}

pub fn press_paste() {}

/// Counts every change of the clipboard (clipboard.rs, which calls it by the Mac's name).
pub fn pasteboard_change_count() -> u32 {
    clipboard::change_count()
}

/// Password managers' copies are kept out of the history.
pub fn pasteboard_is_private() -> bool {
    clipboard::is_private()
}

/// Commands the shared interface sends or polls (memory.rs, sysevents.rs, privacy.rs on Windows): answered so the log stays clean.
#[tauri::command]
pub fn memory_low() {}

#[tauri::command]
pub fn status_configure() {}

#[tauri::command]
pub fn privacy_state() -> serde_json::Value {
    serde_json::json!({ "mic": false, "camera": false, "screen": false })
}

#[tauri::command]
pub fn glass_live_supported() -> serde_json::Value {
    serde_json::json!({ "supported": false, "reason": "unsupported" })
}

#[tauri::command]
pub fn glass_live_exclude(on: bool) -> Result<(), String> {
    if on {
        Err("unsupported".into())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn glass_live_start() -> Result<(), String> {
    Err("unsupported".into())
}

#[tauri::command]
pub fn glass_live_stop() {}
