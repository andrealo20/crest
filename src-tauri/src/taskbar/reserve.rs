//! When a docked bar reserves its strip at the bottom (or top) of its monitor, as Windows' taskbar does, and how big that strip is.
//!
//! A bar reserves only when its shape is docked, "hide automatically" is off, and its appbar calls reach Explorer: Explorer or
//! Crest's own tray spy is first. With another program's `Shell_TrayWnd` first (lumabar, say) the calls would reach that
//! program, so nothing is registered and nothing is removed. Each reserving bar asks Windows for its strip in physical px
//! (`strip_for`) and stands where Windows answers (`settle`); the notch then reads Windows' work area as it is.
//!
//! Every registration is recorded, one window handle per line, in `taskbar-appbars` beside the record of Windows' hidden
//! taskbar (`format_hwnds`, `parse_hwnds`), so the guard, the next start and the uninstaller remove them first.
//!
//! The appbar of each reserving bar is a hidden helper window on the taskbar thread (mod.rs), never the bar's own window.
//! `reconcile` runs there on a posted `REAPPBAR` only, under explorer's lock taken without waiting: it removes, registers and
//! places the helpers, and asks Windows for a strip only when one is new, Windows says the appbars moved, Explorer restarted,
//! or a bar's monitor, height or edge changed. An answer equal to the strip held is not set again, so maximized windows resize once.

use std::cell::RefCell;
use std::path::Path;
use std::sync::{Mutex, MutexGuard, Once};

use tauri::AppHandle;
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::HMONITOR;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Shell::{
    SHAppBarMessage, ABE_BOTTOM, ABE_TOP, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS, ABN_POSCHANGED, ABN_STATECHANGE, APPBARDATA,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, RegisterClassW, SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER, WM_APP, WNDCLASSW,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP,
};

use super::{bar, explorer, front, screens, tasks};
use crate::display;

/// `REAPPBAR`'s flags. `ASK`: look again; `RENEW`: Explorer restarted, every kept appbar registers again; `FORCE`: Windows
/// moved the appbars, every strip is asked for again.
pub(super) const ASK: usize = 1;
pub(super) const RENEW: usize = 2;
pub(super) const FORCE: usize = 4;
/// The helpers' callback message (`helper_proc`).
const CALLBACK: u32 = WM_APP + 1;
/// The helpers' window class, registered once.
static CLASS: Once = Once::new();
/// What the notch last applied: the bar is docked, its height in CSS px, and it stands on the top edge.
static WISH: Mutex<(bool, f64, bool)> = Mutex::new((false, 0.0, false));

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

/// No strip is reserved any more: the taskbar thread has ended (mod.rs `stop`), and its helpers with it.
pub(super) fn clear() {
    strips_lock().clear();
}

/// `label`'s strip, or none, published before the appbar call that moves the work area: a place or a notch refresh while
/// the call is in progress (its broadcast can come inside it) then reads the strip with the new work area, not the old one.
fn publish(label: &str, strip: Option<RECT>) {
    let mut strips = strips_lock();
    strips.retain(|(l, _)| l != label);
    strips.extend(strip.map(|s| (label.to_owned(), s)));
}

/// The notch applied the bar (bar.rs `taskbar_apply`): docked or not, its height in CSS px, and its edge. The appbars follow.
pub(crate) fn wish(docked: bool, band_css: f64, top: bool) {
    *WISH.lock().unwrap_or_else(|e| e.into_inner()) = (docked, band_css, top);
    refresh();
}

/// The appbars are brought in line on the taskbar thread, if it runs. Any thread: it only posts.
pub(crate) fn refresh() {
    super::post_to_thread(super::REAPPBAR, ASK);
}

thread_local! {
    /// The registered helpers, on the taskbar thread. Taken out while `reconcile` works, never borrowed across an appbar call.
    static REGS: RefCell<Vec<Reg>> = const { RefCell::new(Vec::new()) };
}

/// One bar's registration.
struct Reg {
    label: String,
    helper: HWND,
    /// The bar's monitor, height in px and edge when its strip was last asked for.
    monitor: RECT,
    band: i32,
    top: bool,
    /// What Windows set (`ABM_SETPOS`).
    strip: RECT,
}

/// Brings the appbars in line with the bars, their settings and Explorer, with `REAPPBAR`'s `flags`. The taskbar thread only;
/// false when explorer's lock is taken, and nothing was done.
pub(super) fn reconcile(app: &AppHandle, flags: usize) -> bool {
    explorer::try_locked(|hiding| reconcile_locked(app, flags, hiding)).is_some()
}

fn reconcile_locked(app: &AppHandle, flags: usize, hiding: bool) {
    let reachable = explorer::appbar_reachable();
    let (docked, band_css, top) = *WISH.lock().unwrap_or_else(|e| e.into_inner());
    let wanted = reserves(docked, front::auto_hide(), reachable) && hiding;
    let mut bars: Vec<(String, RECT, i32)> = screens::all()
        .into_iter()
        .filter_map(|(label, hwnd)| {
            let hwnd = HWND(hwnd as _);
            let (monitor, _) = display::monitor_rect(HMONITOR(tasks::monitor_of(hwnd) as _))?;
            Some((label, monitor, band_px(band_css, unsafe { GetDpiForWindow(hwnd) })))
        })
        .collect();
    one_per_monitor(&mut bars);
    let path = explorer::appbars_path();
    // A record gone while helpers are held was removed by a restore (another process's, or this one's Off), with them.
    let listed = path.as_deref().is_some_and(Path::exists);
    let before = strips_lock().clone();
    let mut regs = REGS.take();
    let held = regs.len();
    regs.retain(|reg| {
        let gone = !bars.iter().any(|(l, ..)| *l == reg.label);
        let remove = !listed || (gone && reachable) || step(wanted, true, reachable) == Step::Remove;
        if remove {
            // Never while another program's Shell_TrayWnd is first: the removal would reach it.
            if reachable {
                publish(&reg.label, None);
                call(reg.helper, ABM_REMOVE, RECT::default(), top);
            }
            let _ = unsafe { DestroyWindow(reg.helper) };
        }
        !remove
    });
    let mut dirty = regs.len() != held;
    let mut fresh: Vec<Reg> = Vec::new();
    for (label, monitor, band) in &bars {
        if regs.iter().any(|r| r.label == *label) || step(wanted, false, reachable) != Step::Register {
            continue;
        }
        if let Some(helper) = helper(strip_for(*monitor, *band, top)) {
            fresh.push(Reg { label: label.clone(), helper, monitor: *monitor, band: *band, top, strip: RECT::default() });
        }
    }
    // The record first, with every helper, so no registration is ever missing from it.
    if !fresh.is_empty() {
        let all: Vec<isize> = regs.iter().chain(&fresh).map(|r| r.helper.0 as isize).collect();
        let written = match path.as_deref() {
            Some(p) => crate::write_atomic(p, format_hwnds(&all).as_bytes()).map_err(|e| e.to_string()),
            None => Err("no folder for it".to_owned()),
        };
        if let Err(e) = written {
            eprintln!("taskbar: appbars record not written, no strip reserved: {e}");
            for reg in fresh.drain(..) {
                let _ = unsafe { DestroyWindow(reg.helper) };
            }
        }
    }
    fresh.retain(|reg| {
        let registered = call(reg.helper, ABM_NEW, RECT::default(), top).0 != 0;
        if !registered {
            let _ = unsafe { DestroyWindow(reg.helper) };
            dirty = true;
        }
        registered
    });
    let kept = regs.len();
    regs.extend(fresh);
    for (i, reg) in regs.iter_mut().enumerate() {
        let Some(&(_, monitor, band)) = bars.iter().find(|(l, ..)| *l == reg.label) else { continue };
        // A restarted Explorer registers a kept helper again; FALSE means it was still registered. TRUE: it has no strip
        // there yet, so it is set as a new one.
        let renewed = flags & RENEW != 0 && reachable && i < kept && call(reg.helper, ABM_NEW, RECT::default(), top).0 != 0;
        let new = i >= kept || renewed;
        // A new edge is asked for on the kept registration: Windows moves an appbar to the edge its ABM_SETPOS names.
        if !reachable || !(new || flags & (FORCE | RENEW) != 0 || reg.monitor != monitor || reg.band != band || reg.top != top) {
            continue;
        }
        let strip = settle(call(reg.helper, ABM_QUERYPOS, strip_for(monitor, band, top), top).1, band, top);
        if new || strip != reg.strip {
            publish(&reg.label, Some(strip));
            let s = call(reg.helper, ABM_SETPOS, strip, top).1;
            reg.strip = s;
            let _ = unsafe { SetWindowPos(reg.helper, None, s.left, s.top, s.right - s.left, s.bottom - s.top, SWP_NOZORDER | SWP_NOACTIVATE) };
        }
        reg.monitor = monitor;
        reg.band = band;
        reg.top = top;
    }
    // After removals the record holds the helpers left, or goes with the last.
    if let (true, Some(p)) = (dirty, path.as_deref()) {
        let left: Vec<isize> = regs.iter().map(|r| r.helper.0 as isize).collect();
        let _ = if left.is_empty() { std::fs::remove_file(p) } else { crate::write_atomic(p, format_hwnds(&left).as_bytes()) };
    }
    let now: Vec<(String, RECT)> = regs.iter().map(|r| (r.label.clone(), r.strip)).collect();
    REGS.set(regs);
    // Against the strips at the start, so the writes `publish` made above still count as a change.
    let changed = before != now;
    *strips_lock() = now;
    // The bars stand on their strips, and the notch reads the monitors again.
    if changed {
        bar::work_area_changed(app);
    }
}

/// `SHAppBarMessage` for a helper on the bottom edge (the top one for `top`) with `rc`: the answer, and the rect Windows gives back.
fn call(helper: HWND, message: u32, rc: RECT, top: bool) -> (usize, RECT) {
    let mut data = APPBARDATA {
        cbSize: std::mem::size_of::<APPBARDATA>() as u32,
        hWnd: helper,
        uCallbackMessage: CALLBACK,
        uEdge: if top { ABE_TOP } else { ABE_BOTTOM },
        rc,
        ..Default::default()
    };
    let answer = unsafe { SHAppBarMessage(message, &mut data) };
    (answer, data.rc)
}

/// A helper window at `strip`: never shown, no taskbar button, never activated. A hidden window reserves (the C1 probe).
fn helper(strip: RECT) -> Option<HWND> {
    unsafe {
        let instance = GetModuleHandleW(None).ok()?;
        CLASS.call_once(|| {
            let class = WNDCLASSW { lpfnWndProc: Some(helper_proc), hInstance: instance.into(), lpszClassName: w!("CrestAppbar"), ..Default::default() };
            if RegisterClassW(&class) == 0 {
                eprintln!("taskbar: appbar class failed: {}", windows::core::Error::from_thread());
            }
        });
        let (width, height) = (strip.right - strip.left, strip.bottom - strip.top);
        let style = WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        CreateWindowExW(style, w!("CrestAppbar"), w!(""), WS_POPUP, strip.left, strip.top, width, height, None, None, Some(instance.into()), None)
            .inspect_err(|e| eprintln!("taskbar: appbar window failed: {e}"))
            .ok()
    }
}

/// Windows moved the appbars or changed its taskbar's state: every strip is asked for again, posted. A full-screen app is
/// ignored: front.rs already hides a bar over one.
unsafe extern "system" fn helper_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == CALLBACK {
        if matches!(wparam.0 as u32, ABN_POSCHANGED | ABN_STATECHANGE) {
            super::post_to_thread(super::REAPPBAR, ASK | FORCE);
        }
        return LRESULT(0);
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
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

/// Keeps the first bar of each monitor (`screens::all` lists the primary first). An unplugged monitor's bar sits on the monitor
/// Windows moved its window to until `screens` takes it down: it counts as gone, so it never stacks a second strip there.
pub(crate) fn one_per_monitor(bars: &mut Vec<(String, RECT, i32)>) {
    let mut seen = Vec::new();
    bars.retain(|(_, monitor, _)| {
        let first = !seen.contains(monitor);
        seen.push(*monitor);
        first
    });
}

/// The bar's height in physical px on a monitor of this dpi.
pub(crate) fn band_px(height_css: f64, dpi: u32) -> i32 {
    (height_css * dpi as f64 / 96.0).round() as i32
}

/// The strip asked of Windows: the monitor's bottom `band` px (its top ones for `top`), edge to edge.
pub(crate) fn strip_for(monitor: RECT, band: i32, top: bool) -> RECT {
    if top { RECT { bottom: monitor.top + band, ..monitor } } else { RECT { top: monitor.bottom - band, ..monitor } }
}

/// The strip taken from Windows' answer: its left, right and outer edge (narrowed by a side appbar, moved in past another one on
/// the same edge), with the bar's own height.
pub(crate) fn settle(answer: RECT, band: i32, top: bool) -> RECT {
    if top { RECT { bottom: answer.top + band, ..answer } } else { RECT { top: answer.bottom - band, ..answer } }
}

/// The record's text: one decimal handle per line.
pub(crate) fn format_hwnds(hwnds: &[isize]) -> String {
    hwnds.iter().map(|h| format!("{h}\n")).collect()
}

/// The record's handles; blank, unreadable and null lines are skipped.
pub(crate) fn parse_hwnds(text: &str) -> Vec<isize> {
    text.lines().filter_map(|l| l.trim().parse::<isize>().ok()).filter(|&h| h != 0).collect()
}

/// Whether a docked bar can reserve its strip now: another program's `Shell_TrayWnd` first keeps it floating. The settings only;
/// window lookups, never a wait.
#[tauri::command]
pub fn taskbar_reserve_reachable() -> bool {
    explorer::appbar_reachable()
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
        assert_eq!(strip_for(r(0, 0, 3840, 2160), 88, false), r(0, 2072, 3840, 2160));
        assert_eq!(strip_for(r(-1920, 0, 0, 1080), 44, false), r(-1920, 1036, 0, 1080)); // a monitor left of the primary
        assert_eq!(settle(r(64, 1036, 1920, 1080), 44, false), r(64, 1036, 1920, 1080)); // narrowed by a side appbar
        assert_eq!(settle(r(0, 900, 1920, 1036), 44, false), r(0, 992, 1920, 1036)); // above another bottom appbar: Windows' bottom, the bar's height
    }

    #[test]
    fn a_top_strip_is_the_bars_height_at_the_monitors_top() {
        let r = |left, top, right, bottom| RECT { left, top, right, bottom };
        assert_eq!(strip_for(r(0, 0, 1920, 1080), 44, true), r(0, 0, 1920, 44));
        assert_eq!(strip_for(r(0, -1080, 1920, 0), 44, true), r(0, -1080, 1920, -1036)); // a monitor above the primary
        assert_eq!(settle(r(64, 0, 1920, 44), 44, true), r(64, 0, 1920, 44)); // narrowed by a side appbar
        assert_eq!(settle(r(0, 48, 1920, 200), 44, true), r(0, 48, 1920, 92)); // under another top appbar: Windows' top, the bar's height
    }

    #[test]
    fn the_registrations_record_round_trips_and_skips_what_it_cannot_read() {
        assert_eq!(format_hwnds(&[4660, 22136]), "4660\n22136\n");
        assert_eq!(parse_hwnds(&format_hwnds(&[4660, 22136])), vec![4660, 22136]);
        assert_eq!(parse_hwnds("12\n\nx\n0\n 7 \n"), vec![12, 7]); // blank, text and null lines skipped
        assert!(parse_hwnds("").is_empty());
    }

    #[test]
    fn a_bar_on_a_monitor_already_listed_counts_as_gone() {
        let primary = RECT { left: 0, top: 0, right: 1920, bottom: 1080 };
        let right = RECT { left: 1920, top: 0, right: 3840, bottom: 1080 };
        let mut bars = vec![("taskbar".to_owned(), primary, 44), ("taskbar-1".to_owned(), right, 44)];
        one_per_monitor(&mut bars);
        assert_eq!(bars.len(), 2);
        bars[1].1 = primary; // its monitor unplugged: Windows moved the window onto the primary
        one_per_monitor(&mut bars);
        assert_eq!(bars, vec![("taskbar".to_owned(), primary, 44)]); // the primary's own bar, listed first, keeps the strip
    }
}
