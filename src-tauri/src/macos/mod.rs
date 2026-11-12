//! macOS: what the Windows modules do with Win32, done with AppKit and CoreGraphics, plus stand-ins for the Windows-only
//! services the shared code calls into (audio levels, mirrors). Tools that need more are hidden on a Mac
//! (src/notch/tabs.ts).

pub mod audio;
pub mod brightness;
pub mod colour;
pub mod media;
pub mod mirror;
pub mod quick;

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};

use objc2_app_kit::{
    NSApplicationActivationOptions, NSPasteboard, NSRunningApplication, NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior, NSWorkspace,
};
use objc2_foundation::{NSDictionary, NSNumber, NSString};
use tauri::WebviewWindow;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
    fn CGEventCreateKeyboardEvent(source: *const c_void, key: u16, down: bool) -> *mut c_void;
    fn CGEventSetFlags(event: *mut c_void, flags: u64);
    fn CGEventPost(tap: u32, event: *mut c_void);
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(object: *const c_void);
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> u8;
}

/// The left mouse button is held (hit_test.rs). Combined session state (0), left button (0).
pub fn left_button_down() -> bool {
    unsafe { CGEventSourceButtonState(0, 0) }
}

/// Above the menu bar, on every Space and over full-screen apps. Tauri's "always on top" is the floating level, under the
/// menu bar, so this runs again after each `set_always_on_top`.
pub fn raise(window: &WebviewWindow) {
    let Ok(ptr) = window.ns_window() else { return };
    let ptr = ptr as usize;
    let _ = window.run_on_main_thread(move || {
        // SAFETY: Tauri's NSWindow for this window, used on the main thread, where the window lives.
        let ns = unsafe { &*(ptr as *const NSWindow) };
        ns.setLevel(NSStatusWindowLevel);
        ns.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
    });
}

/// The process id of the frontmost app (lib.rs keyboard_focus), 0 when there is none.
pub fn frontmost_pid() -> i32 {
    NSWorkspace::sharedWorkspace().frontmostApplication().map_or(0, |app| app.processIdentifier())
}

/// Gives the keyboard back to the app that had it before the notch opened; false when that app is gone.
pub fn activate_pid(pid: i32) -> bool {
    NSRunningApplication::runningApplicationWithProcessIdentifier(pid).is_some_and(|app| {
        // `activate()` is macOS 14 only; this one works from 10.6 on.
        #[allow(deprecated)]
        app.activateWithOptions(NSApplicationActivationOptions::empty())
    })
}

/// Whether Crest may press keys in other apps (Privacy & Security → Accessibility), as a paste from the history does.
/// The first call of a run shows the system's prompt when it may not, which also lists Crest there.
pub fn may_press_keys() -> bool {
    static ASKED: AtomicBool = AtomicBool::new(false);
    let prompt = NSNumber::new_bool(!ASKED.swap(true, Ordering::Relaxed));
    // The value of kAXTrustedCheckOptionPrompt.
    let options = NSDictionary::from_slices(&[&*NSString::from_str("AXTrustedCheckOptionPrompt")], &[&*prompt]);
    unsafe { AXIsProcessTrustedWithOptions(&*options as *const NSDictionary<NSString, NSNumber> as *const c_void) != 0 }
}

/// Cmd+V in the frontmost app.
/// shortcut: the key in the V place of a US layout (kVK_ANSI_V), so a Dvorak layout gets another letter; read the key from
/// the current layout if someone asks for it.
pub fn press_paste() {
    const V: u16 = 9;
    const COMMAND: u64 = 1 << 20; // kCGEventFlagMaskCommand
    for down in [true, false] {
        unsafe {
            let event = CGEventCreateKeyboardEvent(std::ptr::null(), V, down);
            if event.is_null() {
                return;
            }
            CGEventSetFlags(event, COMMAND);
            CGEventPost(0, event); // kCGHIDEventTap
            CFRelease(event);
        }
    }
}

/// Commands the shared interface sends without waiting for an answer or polls (memory.rs, sysevents.rs, privacy.rs on
/// Windows): answered here so a Mac doesn't log a missing command each time.
#[tauri::command]
pub fn memory_low() {}

#[tauri::command]
pub fn status_configure() {}

/// macOS shows its own dots for the microphone, camera and screen, and doesn't tell other apps.
#[tauri::command]
pub fn privacy_state() -> serde_json::Value {
    serde_json::json!({ "mic": false, "camera": false, "screen": false })
}

/// The live glass (capture/glass_live.rs on Windows) does not run on a Mac: the page asks, hides the switch, and the rest answers
/// as on a PC where it cannot run.
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

/// Counts every change of the general pasteboard, like GetClipboardSequenceNumber (clipboard.rs).
pub fn pasteboard_change_count() -> u32 {
    NSPasteboard::generalPasteboard().changeCount() as u32
}

/// Password managers mark what they copy with these types (nspasteboard.org): keep it out of the history.
pub fn pasteboard_is_private() -> bool {
    let Some(types) = NSPasteboard::generalPasteboard().types() else { return false };
    let private = [NSString::from_str("org.nspasteboard.ConcealedType"), NSString::from_str("org.nspasteboard.TransientType")];
    types.iter().any(|t| private.iter().any(|p| t.isEqualToString(p)))
}
