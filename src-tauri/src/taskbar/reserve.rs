//! When a docked bar reserves its strip at the bottom of its monitor, as Windows' taskbar does, and how big that strip is.
//!
//! A bar reserves only when its shape is docked, "hide automatically" is off, and its appbar calls reach Explorer: Explorer or
//! Crest's own tray spy is first. With another program's `Shell_TrayWnd` first (lumabar, say) the calls would reach that
//! program, so nothing is registered and nothing is removed. Each reserving bar asks Windows for its strip in physical px
//! (`strip_for`) and stands where Windows answers (`settle`); the notch then reads Windows' work area as it is.
//!
//! Every registration is recorded, one window handle per line, in `taskbar-appbars` beside the record of Windows' hidden
//! taskbar (`format_hwnds`, `parse_hwnds`), so the guard, the next start and the uninstaller remove them first.

// shortcut: these rules are wired one by one by the safety net, the bar's placement, the registration and the slide rule
// (`strips`, used by no test either); drop it when all are.
#![allow(dead_code)]

use std::sync::{Mutex, MutexGuard};

use windows::Win32::Foundation::RECT;

/// The strip each reserving bar stands on, by bar label, physical px. Held only to read or write.
static STRIPS: Mutex<Vec<(String, RECT)>> = Mutex::new(Vec::new());

fn strips_lock() -> MutexGuard<'static, Vec<(String, RECT)>> {
    STRIPS.lock().unwrap_or_else(|e| e.into_inner())
}

/// The strip `label`'s bar reserves, if it reserves one.
pub(crate) fn strip(label: &str) -> Option<RECT> {
    strips_lock().iter().find(|(l, _)| l == label).map(|&(_, r)| r)
}

/// Every reserved strip.
pub(crate) fn strips() -> Vec<RECT> {
    strips_lock().iter().map(|&(_, r)| r).collect()
}

/// Whether any bar reserves its strip.
pub(crate) fn active() -> bool {
    !strips_lock().is_empty()
}

/// Whether a bar with these settings reserves its strip. `reachable`: appbar calls reach Explorer.
pub(crate) fn reserves(docked: bool, auto_hide: bool, reachable: bool) -> bool {
    docked && !auto_hide && reachable
}

/// What to do with a bar's registration.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Step {
    Register,
    Remove,
    Keep,
    Leave,
}

/// The step from what is wanted to what is registered. While the calls would reach another program nothing changes: a
/// registration is kept (and stays in the record), and none is made.
pub(crate) fn step(wanted: bool, registered: bool, reachable: bool) -> Step {
    match (reachable, wanted, registered) {
        (false, _, true) | (true, true, true) => Step::Keep,
        (false, _, false) | (true, false, false) => Step::Leave,
        (true, true, false) => Step::Register,
        (true, false, true) => Step::Remove,
    }
}

/// The bar's height in physical px on a monitor of this dpi.
pub(crate) fn band_px(height_css: f64, dpi: u32) -> i32 {
    (height_css * dpi as f64 / 96.0).round() as i32
}

/// The strip asked of Windows: the monitor's bottom `band` px, edge to edge.
pub(crate) fn strip_for(monitor: RECT, band: i32) -> RECT {
    RECT { top: monitor.bottom - band, ..monitor }
}

/// The strip taken from Windows' answer: its left, right and bottom (narrowed by a side appbar, raised above another bottom
/// one), with the bar's own height.
pub(crate) fn settle(answer: RECT, band: i32) -> RECT {
    RECT { top: answer.bottom - band, ..answer }
}

/// The record's text: one decimal handle per line.
pub(crate) fn format_hwnds(hwnds: &[isize]) -> String {
    hwnds.iter().map(|h| format!("{h}\n")).collect()
}

/// The record's handles; blank, unreadable and null lines are skipped.
pub(crate) fn parse_hwnds(text: &str) -> Vec<isize> {
    text.lines().filter_map(|l| l.trim().parse::<isize>().ok()).filter(|&h| h != 0).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_docked_bar_without_auto_hide_reserves_and_only_through_explorer() {
        assert!(reserves(true, false, true));
        assert!(!reserves(true, true, true)); // an auto-hide bar reserves nothing, as in Windows
        assert!(!reserves(false, false, true)); // floating, capsule and tiles float over the windows
        assert!(!reserves(true, false, false)); // another program's Shell_TrayWnd first (lumabar)
    }

    #[test]
    fn a_registration_changes_only_while_explorer_hears_it() {
        assert_eq!(step(true, false, true), Step::Register);
        assert_eq!(step(true, true, true), Step::Keep);
        assert_eq!(step(false, true, true), Step::Remove);
        assert_eq!(step(false, false, true), Step::Leave);
        assert_eq!(step(false, true, false), Step::Keep); // a removal would reach another program: kept, and in the record
        assert_eq!(step(true, false, false), Step::Leave);
    }

    #[test]
    fn the_strip_is_the_bars_height_at_the_monitors_bottom_in_physical_px() {
        let r = |left, top, right, bottom| RECT { left, top, right, bottom };
        assert_eq!(band_px(44.0, 96), 44);
        assert_eq!(band_px(44.0, 192), 88);
        assert_eq!(band_px(44.0, 144), 66);
        assert_eq!(band_px(40.0, 120), 50);
        assert_eq!(strip_for(r(0, 0, 3840, 2160), 88), r(0, 2072, 3840, 2160));
        assert_eq!(strip_for(r(-1920, 0, 0, 1080), 44), r(-1920, 1036, 0, 1080)); // a monitor left of the primary
        assert_eq!(settle(r(64, 1036, 1920, 1080), 44), r(64, 1036, 1920, 1080)); // narrowed by a side appbar
        assert_eq!(settle(r(0, 900, 1920, 1036), 44), r(0, 992, 1920, 1036)); // above another bottom appbar: Windows' bottom, the bar's height
    }

    #[test]
    fn the_registrations_record_round_trips_and_skips_what_it_cannot_read() {
        assert_eq!(format_hwnds(&[4660, 22136]), "4660\n22136\n");
        assert_eq!(parse_hwnds(&format_hwnds(&[4660, 22136])), vec![4660, 22136]);
        assert_eq!(parse_hwnds("12\n\nx\n0\n 7 \n"), vec![12, 7]); // blank, text and null lines skipped
        assert!(parse_hwnds("").is_empty());
    }
}
