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
//! or a bar's monitor, height or edge changed. An answer equal to the one last set is not set again, whatever rect Windows set
//! for it, so maximized windows resize once, and a strip set too often in a short time is set no more for 60 s or until its bar
//! changes (`Held`).

use std::cell::RefCell;
use std::path::Path;
use std::sync::{Mutex, MutexGuard, Once};
use std::time::{Duration, Instant};

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
    CreateWindowExW, DefWindowProcW, DestroyWindow, KillTimer, RegisterClassW, SetTimer, SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER,
    WM_APP, WM_TIMER, WNDCLASSW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP,
};

use super::{bar, explorer, front, screens, tasks};
use crate::display;

/// `REAPPBAR`'s flags. `ASK`: look again; `RENEW`: Explorer restarted, every kept appbar registers again; `FORCE`: Windows
/// moved the appbars, every strip is asked for again.
pub(super) const ASK: usize = 1;
pub(super) const RENEW: usize = 2;
pub(super) const FORCE: usize = 4;
/// A bar's strip set this many times within `BURST` is set no more for `PAUSE` or until the bar changes (`Held`). Its
/// registration and each appbar coming or going on its edge set it once, seconds apart, and a new monitor, height or edge
/// counts from zero again; appbars answering each other set it many times a second, and the fifth is not set.
const BURST_SETS: usize = 4;
const BURST: Duration = Duration::from_secs(10);
/// A stopped bar is asked for its strip again this long after: what set it again and again may be gone, and an appbar that
/// came or went meanwhile is followed.
const PAUSE: Duration = Duration::from_secs(60);
/// The helper's timer that ends the pause (`helper_proc`).
const PAUSE_TIMER: usize = 1;
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
    held: Held,
}

/// A bar's strip as last asked of Windows and as Windows set it, and when it was set lately.
#[derive(Default)]
struct Held {
    /// The settled answer last passed to `ABM_SETPOS`; none on a new or renewed registration.
    asked: Option<RECT>,
    /// What Windows set (`ABM_SETPOS`): the strip published and stood on.
    strip: RECT,
    /// When the strip was set within the last `BURST`, since the bar last changed.
    sets: Vec<Instant>,
    /// When it was set `BURST_SETS` times within `BURST`: set no more for `PAUSE` or until the bar changes.
    stopped: Option<Instant>,
}

impl Held {
    /// Sets `settled`, Windows' answer settled to the bar's height, with `set` (`ABM_SETPOS`, which gives back what Windows
    /// set), unless it equals the answer last set. Never compared with what Windows set: when Windows sets another rect than the
    /// one it is given (Windows 10 may), every notification would set the strip again and move the work area. True when this
    /// call stopped the bar.
    fn place(&mut self, settled: RECT, now: Instant, set: impl FnOnce(RECT) -> RECT) -> bool {
        if self.asked == Some(settled) || self.stopped.is_some_and(|at| now.duration_since(at) < PAUSE) {
            return false;
        }
        self.stopped = None;
        self.sets.retain(|&t| now.duration_since(t) < BURST);
        if self.sets.len() >= BURST_SETS {
            self.stopped = Some(now);
            return true;
        }
        self.sets.push(now);
        self.asked = Some(settled);
        self.strip = set(settled);
        false
    }

    /// The bar's monitor, height or edge changed: its strip may be set again. Any other settings change removes the
    /// registration, and Explorer's restart renews it: both start afresh (`Held::default`).
    fn changed(&mut self) {
        self.sets.clear();
        self.stopped = None;
    }
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
            // The band as drawn: Windows' Text size makes the page's px bigger too (text_scale.rs).
            Some((label, monitor, band_px(band_css * crate::text_scale::get(), unsafe { GetDpiForWindow(hwnd) })))
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
            fresh.push(Reg { label: label.clone(), helper, monitor: *monitor, band: *band, top, held: Held::default() });
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
        let moved = reg.monitor != monitor || reg.band != band || reg.top != top;
        // Renewed, Explorer knows no strip for it: set as a new one's.
        if renewed {
            reg.held = Held::default();
        } else if moved {
            reg.held.changed();
        }
        // A new edge is asked for on the kept registration: Windows moves an appbar to the edge its ABM_SETPOS names.
        if !reachable || !(new || moved || flags & (FORCE | RENEW) != 0) {
            continue;
        }
        let answer = call(reg.helper, ABM_QUERYPOS, strip_for(monitor, band, top), top).1;
        let strip = settle(answer, band, top);
        let (label, helper) = (&reg.label, reg.helper);
        let stopped = reg.held.place(strip, Instant::now(), |strip| {
            publish(label, Some(strip));
            let s = call(helper, ABM_SETPOS, strip, top).1;
            let _ = unsafe { SetWindowPos(helper, None, s.left, s.top, s.right - s.left, s.bottom - s.top, SWP_NOZORDER | SWP_NOACTIVATE) };
            s
        });
        if stopped {
            // A second past the pause, so the timer never lands inside it. DestroyWindow on the helper kills it.
            let _ = unsafe { SetTimer(Some(reg.helper), PAUSE_TIMER, (PAUSE + Duration::from_secs(1)).as_millis() as u32, None) };
            let (secs, pause, asked, set) = (BURST.as_secs(), PAUSE.as_secs(), reg.held.asked.unwrap_or_default(), reg.held.strip);
            eprintln!(
                "taskbar: {label}'s strip set {BURST_SETS} times in {secs} s, no more for {pause} s or until the bar changes: \
                 ABM_QUERYPOS {answer:?}, settled {strip:?}, the last ABM_SETPOS of {asked:?} set {set:?}"
            );
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
    let now: Vec<(String, RECT)> = regs.iter().map(|r| (r.label.clone(), r.held.strip)).collect();
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

/// Windows moved the appbars or changed its taskbar's state, or a stopped bar's pause is over: every strip is asked for again,
/// posted. A full-screen app is ignored: front.rs already hides a bar over one.
unsafe extern "system" fn helper_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_TIMER && wparam.0 == PAUSE_TIMER {
        let _ = unsafe { KillTimer(Some(hwnd), PAUSE_TIMER) };
        super::post_to_thread(super::REAPPBAR, ASK | FORCE);
        return LRESULT(0);
    }
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

    /// `Held::place` with a Windows that sets `windows(asked)`: whether `ABM_SETPOS` was called, and whether the bar stopped.
    fn place(held: &mut Held, settled: RECT, at: Instant, windows: fn(RECT) -> RECT) -> (bool, bool) {
        let mut set = false;
        let stopped = held.place(settled, at, |s| {
            set = true;
            windows(s)
        });
        (set, stopped)
    }

    #[test]
    fn an_answer_equal_to_the_strip_last_asked_for_is_not_set_again_whatever_windows_set() {
        let r = |left, top, right, bottom| RECT { left, top, right, bottom };
        let t = Instant::now();
        let moved_down = |s: RECT| RECT { top: s.top + 1, ..s }; // a Windows that sets a rect other than the one it is given
        let mut held = Held::default();
        let answer = settle(r(0, 1036, 1920, 1080), 44, false);
        assert_eq!(place(&mut held, answer, t, moved_down), (true, false)); // a new registration is set
        assert_eq!(held.strip, r(0, 1037, 1920, 1080)); // what Windows set is the strip held
        // ABN_POSCHANGED, and ABM_QUERYPOS repeats its first answer: not set again, the work area stays
        assert_eq!(place(&mut held, answer, t + Duration::from_secs(1), moved_down), (false, false));
        assert_eq!(place(&mut held, answer, t + Duration::from_secs(2), moved_down), (false, false));
        assert_eq!(held.strip, r(0, 1037, 1920, 1080));
        // another appbar came on the bottom edge: the new answer is set
        assert_eq!(place(&mut held, r(0, 992, 1920, 1036), t + Duration::from_secs(3), moved_down), (true, false));
        assert_eq!(held.strip, r(0, 993, 1920, 1036));
    }

    #[test]
    fn a_strip_set_again_and_again_is_set_no_more_until_the_bar_changes() {
        let r = |left, top, right, bottom| RECT { left, top, right, bottom };
        let same = |s: RECT| s;
        let t = Instant::now();
        let ms = |n: u64| t + Duration::from_millis(n);
        let (a, b) = (r(0, 1036, 1920, 1080), r(0, 1035, 1920, 1079)); // two appbars answering each other
        let mut held = Held::default();
        for i in 0..BURST_SETS as u64 {
            assert_eq!(place(&mut held, if i % 2 == 0 { a } else { b }, ms(100 * i), same), (true, false));
        }
        assert_eq!(held.strip, b);
        assert_eq!(place(&mut held, a, ms(500), same), (false, true)); // one more within BURST: stopped, and told once
        assert_eq!(place(&mut held, b, ms(600), same), (false, false));
        assert_eq!(place(&mut held, a, ms(60_000), same), (false, false)); // 59.5 s after, still stopped
        assert_eq!(held.strip, b); // the bar stays on the last strip Windows set
        held.changed(); // its monitor, height or edge changed
        assert_eq!(place(&mut held, a, ms(61_000), same), (true, false));
        // A new or renewed registration starts afresh
        let mut held = Held::default();
        assert_eq!(place(&mut held, a, ms(61_000), same), (true, false));
    }

    #[test]
    fn a_stopped_strip_is_set_again_once_the_pause_is_over() {
        let r = |left, top, right, bottom| RECT { left, top, right, bottom };
        let same = |s: RECT| s;
        let t = Instant::now();
        let (a, b) = (r(0, 1036, 1920, 1080), r(0, 1035, 1920, 1079)); // two appbars answering each other
        let mut held = Held::default();
        for i in 0..BURST_SETS as u32 {
            assert_eq!(place(&mut held, if i % 2 == 0 { a } else { b }, t + Duration::from_millis(100) * i, same), (true, false));
        }
        let stop = t + Duration::from_millis(500);
        assert_eq!(place(&mut held, a, stop, same), (false, true));
        assert_eq!(place(&mut held, a, stop + PAUSE - Duration::from_millis(1), same), (false, false)); // still paused
        // the pause is over: what set it again and again may be gone, and the strip is asked for once more
        assert_eq!(place(&mut held, a, stop + PAUSE, same), (true, false));
        assert_eq!(held.strip, a);
    }

    #[test]
    fn strips_set_seconds_apart_are_never_stopped() {
        let r = |left, top, right, bottom| RECT { left, top, right, bottom };
        let same = |s: RECT| s;
        let t = Instant::now();
        let (a, b) = (r(0, 1036, 1920, 1080), r(0, 992, 1920, 1036)); // an appbar coming and going on the same edge
        let mut held = Held::default();
        for i in 0..12u64 {
            assert_eq!(place(&mut held, if i % 2 == 0 { a } else { b }, t + Duration::from_secs(3 * i), same), (true, false));
        }
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
