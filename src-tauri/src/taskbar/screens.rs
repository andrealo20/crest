//! Crest's bar on the other monitors: every monitor but the primary gets a window of its own, `taskbar-1`, `taskbar-2` and so
//! on, from the primary's template with the same page (bar.rs `build`). They come and go with the monitors (`sync`: when the
//! bar turns on or off, and at the mirror's monitor check), stand along the bottom of their monitor's work area as the
//! primary's does (`bar::put`), and show and hide each on its own (`sync_shown`): all with the hide hotkey, each over a
//! full-screen app on its monitor. Their first draw never hides Windows' taskbar; the primary's does (bar.rs).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};

use tauri::{AppHandle, Manager, WebviewWindow};

use super::bar;
use crate::display;
use crate::hit_test::{self, HitState};

/// Held through each `sync`, so `taskbar_apply` and the mirror's check never build or take down bars at the same time. Never
/// taken on the main thread, which `sync` waits for.
static SYNC: Mutex<()> = Mutex::new(());
/// Whether the other monitors get a bar (Settings → Taskbar → Show on all displays); off, only the primary has one.
static ALL: AtomicBool = AtomicBool::new(true);
/// The bars on the other monitors. Held only to read or write the list, never across a window call.
static OTHERS: Mutex<Vec<Other>> = Mutex::new(Vec::new());

/// A bar on a monitor other than the primary.
struct Other {
    label: String,
    /// The monitor's name (`\\.\DISPLAY2`).
    monitor: String,
    hwnd: isize,
    /// What the last `sync_shown` did.
    shown: bool,
    /// An app covers its monitor in full screen (`set_fullscreen`).
    fullscreen: bool,
}

fn bars() -> MutexGuard<'static, Vec<Other>> {
    OTHERS.lock().unwrap_or_else(|e| e.into_inner())
}

/// A bar on every monitor but the primary while the primary's bar is there, none otherwise: the missing ones built and placed,
/// the extra ones taken down. Then each is shown or hidden, and the window lists are made again for the bars there are now.
/// Never on the main thread, which a build and `bar::take_down` wait for.
pub(crate) fn sync(app: &AppHandle) {
    let _sync = SYNC.lock().unwrap_or_else(|e| e.into_inner());
    let on = bar::hwnd() != 0;
    let (monitors, primary) = if on {
        (app.available_monitors().unwrap_or_default(), app.primary_monitor().ok().flatten().and_then(|m| m.name().cloned()))
    } else {
        (Vec::new(), None)
    };
    let names: Vec<String> = monitors.iter().filter_map(|m| m.name().cloned()).collect();
    // With the primary's bar there, no monitor or no primary is Windows not answering, not a change: the bars stay as they are.
    let Some(names) = wanted(on, ALL.load(Ordering::SeqCst), &names, primary.as_deref()) else { return };
    let wanted: Vec<(String, String)> =
        names.into_iter().enumerate().map(|(i, name)| (format!("{}-{}", bar::LABEL, i + 1), name)).collect();
    let extra: Vec<String> = bars().iter().map(|o| o.label.clone()).filter(|label| wanted.iter().all(|(l, _)| l != label)).collect();
    for label in extra {
        hit_test::untrack(&app.state::<HitState>(), &label);
        bar::take_down(app, &label);
    }
    for (label, name) in wanted {
        let Some(monitor) = monitors.iter().find(|m| m.name() == Some(&name)) else { continue };
        let window = match app.get_webview_window(&label) {
            Some(window) => window,
            None => match new_bar(app, &label) {
                Ok(window) => window,
                // The next `sync` tries again.
                Err(e) => {
                    eprintln!("taskbar: no bar on {name}: {e}");
                    continue;
                }
            },
        };
        if let Some(other) = bars().iter_mut().find(|o| o.label == label) {
            other.monitor = name;
        }
        bar::put(&window, monitor);
    }
    sync_shown(app);
    // Behind the moves, which `bar::put` only posted to the main thread: the lists read each bar's monitor from its window.
    let _ = app.run_on_main_thread(super::relist);
    // Monitors or scales changed, or a bar was taken down: the appbars follow.
    super::reserve::refresh();
}

/// A new bar under `label`, hidden until `sync_shown` shows it. It stays in `OTHERS` and tracked by the pointer poll until it
/// is gone.
fn new_bar(app: &AppHandle, label: &str) -> Result<WebviewWindow, String> {
    let (handle, gone) = (app.clone(), label.to_owned());
    let window = bar::build(app, label, move || {
        hit_test::untrack(&handle.state::<HitState>(), &gone);
        bars().retain(|o| o.label != gone);
    })?;
    let Ok(hwnd) = window.hwnd().map(|h| h.0 as isize) else {
        bar::take_down(app, label);
        return Err("no window handle".into());
    };
    // Taken once here: the poll must not ask the main thread for it.
    hit_test::track(&app.state::<HitState>(), label, hwnd);
    bars().push(Other { label: label.to_owned(), monitor: String::new(), hwnd, shown: false, fullscreen: false });
    Ok(window)
}

/// Each other bar on its monitor again, for a new work area or scale (`bar::place`). Any thread and without `SYNC`: the main
/// thread runs it for a new work area.
pub(crate) fn place(app: &AppHandle) {
    let placed: Vec<(String, String)> = bars().iter().map(|o| (o.label.clone(), o.monitor.clone())).collect();
    if placed.is_empty() {
        return;
    }
    let monitors = app.available_monitors().unwrap_or_default();
    for (label, name) in placed {
        if let (Some(window), Some(monitor)) = (app.get_webview_window(&label), monitors.iter().find(|m| m.name() == Some(&name))) {
            bar::put(&window, monitor);
        }
    }
}

/// Shows each other bar unless the hide hotkey or a full-screen app on its monitor hides it, or the primary's bar is gone;
/// only acts on a change (`bar::sync`). Any thread.
pub(crate) fn sync_shown(app: &AppHandle) {
    let on = bar::hwnd() != 0 && !display::user_hidden(app);
    let changed: Vec<(String, bool)> = bars()
        .iter_mut()
        .filter_map(|o| {
            let show = on && !o.fullscreen;
            (std::mem::replace(&mut o.shown, show) != show).then(|| (o.label.clone(), show))
        })
        .collect();
    for (label, show) in changed {
        // To that bar alone, unless its page has slid it off the screen (bar.rs `showed`): its panel closes as it hides.
        bar::showed(app, &label, show);
        let Some(window) = app.get_webview_window(&label) else { continue };
        if show {
            bar::reveal(app, window);
        } else {
            let _ = window.hide();
        }
    }
}

/// Whether the last `sync_shown` showed `label`'s bar; false for a label with no bar here.
pub(super) fn shown(label: &str) -> bool {
    bars().iter().any(|o| o.label == label && o.shown)
}

/// A full-screen app came to or left the front of a bar's monitor (front.rs).
pub(crate) fn set_fullscreen(app: &AppHandle, label: &str, on: bool) {
    if label == bar::LABEL {
        bar::set_fullscreen(app, on);
        return;
    }
    let changed = bars().iter_mut().find(|o| o.label == label).is_some_and(|o| std::mem::replace(&mut o.fullscreen, on) != on);
    if changed {
        sync_shown(app);
    }
}

/// Puts the shown other bars back on top of the other topmost windows (`bar::raise`).
pub(crate) fn raise(app: &AppHandle) {
    let shown: Vec<String> = bars().iter().filter(|o| o.shown).map(|o| o.label.clone()).collect();
    for window in shown.iter().filter_map(|label| app.get_webview_window(label)) {
        display::raise_topmost(&window);
    }
}

/// Every bar there is, by label and window, the primary's first.
pub(crate) fn all() -> Vec<(String, isize)> {
    let primary = Some(bar::hwnd()).filter(|&hwnd| hwnd != 0).map(|hwnd| (bar::LABEL.to_owned(), hwnd));
    primary.into_iter().chain(bars().iter().map(|o| (o.label.clone(), o.hwnd))).collect()
}

/// The window is one of Crest's bars; a null handle never is, though the primary's reads 0 while it is off. Called on every
/// foreground change and display poll, so it copies nothing.
pub(crate) fn is_bar(hwnd: isize) -> bool {
    hwnd != 0 && (bar::hwnd() == hwnd || bars().iter().any(|o| o.hwnd == hwnd))
}

/// Whether the other monitors get a bar, and which windows each bar lists (tasks.rs `set_apps_on`: "own", "main" or "all").
/// The notch only; the bars and their lists follow at once, off the main thread (`sync` waits for it).
#[tauri::command]
pub async fn taskbar_spread(all: bool, apps: String, app: AppHandle) {
    ALL.store(all, Ordering::SeqCst);
    super::tasks::set_apps_on(&apps);
    sync(&app);
}

/// The monitors that get a bar of their own, in the order given: every one but the primary. None while the primary is not
/// known, so its monitor never gets a second bar.
fn others(names: &[String], primary: Option<&str>) -> Vec<String> {
    let Some(primary) = primary else { return Vec::new() };
    names.iter().filter(|name| name.as_str() != primary).cloned().collect()
}

/// The monitors that get a bar of their own (`others`) while the primary's bar is there and `all` is on, none otherwise. None
/// for a read that failed with the primary's bar there (no monitor or no primary listed): the bars stay as they are.
fn wanted(on: bool, all: bool, names: &[String], primary: Option<&str>) -> Option<Vec<String>> {
    if !on || !all {
        return Some(Vec::new());
    }
    (!names.is_empty() && primary.is_some()).then(|| others(names, primary))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_monitor_but_the_primary_gets_a_bar_of_its_own() {
        let n = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let three = n(&[r"\\.\DISPLAY1", r"\\.\DISPLAY2", r"\\.\DISPLAY3"]);
        assert_eq!(others(&three, Some(r"\\.\DISPLAY2")), n(&[r"\\.\DISPLAY1", r"\\.\DISPLAY3"]));
        assert!(others(&n(&[r"\\.\DISPLAY1"]), Some(r"\\.\DISPLAY1")).is_empty());
        assert!(others(&three, None).is_empty()); // no primary known: never a second bar on the primary's monitor
    }

    #[test]
    fn a_monitor_read_that_fails_leaves_the_bars_as_they_are() {
        let n = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let two = n(&[r"\\.\DISPLAY1", r"\\.\DISPLAY2"]);
        assert_eq!(wanted(true, true, &two, Some(r"\\.\DISPLAY1")), Some(n(&[r"\\.\DISPLAY2"]))); // a good read
        assert_eq!(wanted(true, true, &[], Some(r"\\.\DISPLAY1")), None); // no monitor listed: Windows not answering
        assert_eq!(wanted(true, true, &two, None), None); // no primary named: the same
        assert_eq!(wanted(false, true, &[], None), Some(Vec::new())); // the bar off, nothing read: every other bar goes
        assert_eq!(wanted(true, false, &two, Some(r"\\.\DISPLAY1")), Some(Vec::new())); // Show on all displays off: the same
    }

    #[test]
    fn a_null_handle_is_never_a_bar() {
        assert!(!is_bar(0)); // the primary's handle reads 0 here, as while the bar is off
    }
}
