//! The Colour tool's pick from the screen on a Mac: AppKit's own colour sampler, the magnifier macOS shows in its colour
//! panel. It needs no screen recording permission; Esc cancels it.

use std::sync::Mutex;

use block2::RcBlock;
use objc2_app_kit::{NSColor, NSColorSampler, NSColorSpace};
use tauri::AppHandle;

/// The colour the user picks on screen as "#rrggbb"; None when cancelled.
#[tauri::command]
pub async fn colour_pick(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    // The handler runs once, on the main thread, with nil for a cancel; the sender goes with the first call.
    let tx = Mutex::new(Some(tx));
    app.run_on_main_thread(move || {
        let handler = RcBlock::new(move |color: *mut NSColor| {
            // SAFETY: AppKit passes a valid NSColor, alive for the call, or nil.
            let picked = unsafe { color.as_ref() }.and_then(srgb_hex);
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(picked);
            }
        });
        // SAFETY: on the main thread; the sampler keeps itself and the handler alive until the session ends.
        unsafe { NSColorSampler::new().showSamplerWithSelectionHandler(&handler) };
    })
    .map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "failed".to_string())
}

/// The colour in sRGB as "#rrggbb", like the Windows eyedropper and the browser's.
fn srgb_hex(color: &NSColor) -> Option<String> {
    let c = color.colorUsingColorSpace(&NSColorSpace::sRGBColorSpace())?;
    Some(format!("#{:02x}{:02x}{:02x}", byte(c.redComponent()), byte(c.greenComponent()), byte(c.blueComponent())))
}

fn byte(v: f64) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0).round() as u8
}
