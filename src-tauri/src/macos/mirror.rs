//! "Follow the cursor" and "All monitors" (mirror.rs) are not on a Mac yet: the notch stays on its chosen monitor.
//! What a Mac does keep is noticing a change of monitors, as mirror.rs does on Windows.

use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::display::{self, DisplayState};

/// How often the monitors are read for a change.
const TICK: Duration = Duration::from_secs(1);

/// display.rs wakes the mirrors after every move; there are none.
pub fn wake(_: &AppHandle) {}

/// A monitor plugged or unplugged, a new resolution or a Dock moved: the notch is placed again and the page reads the monitors again.
pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        let mut last = signature(&app);
        loop {
            thread::sleep(TICK);
            // Asleep (standby.rs), the monitors are not read until it is back.
            if crate::standby::asleep() {
                continue;
            }
            let now = signature(&app);
            if now != last {
                last = now;
                if let Some(window) = app.get_webview_window("notch") {
                    let _ = display::place(&window, &app.state::<DisplayState>());
                }
                let _ = app.emit("notch://monitors", ());
            }
        }
    });
}

/// What a change of monitors shows in: names, places, sizes, scales and work areas.
fn signature(app: &AppHandle) -> String {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let (p, s, w) = (m.position(), m.size(), m.work_area());
            format!("{:?}@{},{} {}x{} {} {},{} {}x{}", m.name(), p.x, p.y, s.width, s.height, m.scale_factor(), w.position.x, w.position.y, w.size.width, w.size.height)
        })
        .collect::<Vec<_>>()
        .join("|")
}
