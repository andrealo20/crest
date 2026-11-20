//! Detached timer: a small always-on-top window (`timer` in tauri.conf.json, page timer.html)
//! that shows the running timer. The frontend saves its position; here it is checked against
//! the connected monitors, and the window is sized for Windows' Text size, which WebView2 draws
//! timer.html larger by (text_scale.rs): at the config's size alone its buttons were cut off.
//! The notch learns about open/closed via "timer-window://open".
//!
//! Async commands on purpose: creating a window from a sync command deadlocks on Windows.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, Monitor, PhysicalPosition, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const LABEL: &str = "timer";
const EVENT: &str = "timer-window://open";
/// Sent to the page before Crest moves the open window itself, so the page does not save that move (moves.ts).
const PLACING: &str = "timer-window://placed";

/// Where Crest last put the window and what from: a live Text size change works from there while the window has not been
/// dragged since, so a round trip brings it back to the user's spot.
static PLACED: Mutex<Option<Placed>> = Mutex::new(None);

/// What Crest put the window from, where it put it, and the monitor it measured that on.
type Placed = (Origin, (i32, i32), Screen);

#[tauri::command]
pub async fn timer_window_open(x: Option<i32>, y: Option<i32>, dpr: Option<f64>, app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        return window.show().map_err(|e| e.to_string());
    }
    let config = app.config().app.windows.iter().find(|w| w.label == LABEL).cloned().ok_or("Timer window missing in config")?;
    // A portable copy gives this window the notch's WebView2 folder too (portable.rs).
    let window = WebviewWindowBuilder::from_config(&app, &config)
        .map(|b| b.on_navigation(crate::own_page))
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

    // A saved spot on a connected monitor, with the size the timer had there; else the default spot on the primary monitor.
    // Off Windows the Text size is always 100 % and the displays' rects in physical px can overlap (each is its origin in points
    // times its own scale on a Mac), so the saved ratio is left out there: the timer opens where it was saved, as it always did.
    let dpr = if cfg!(windows) { dpr } else { None };
    let base = (config.width, config.height);
    let screens: Vec<Screen> = window.available_monitors().unwrap_or_default().iter().map(Screen::of).collect();
    let spot = x
        .zip(y)
        .and_then(|at| saved_origin(&screens, at, dpr, base))
        .or_else(|| window.primary_monitor().ok().flatten().map(|m| (Origin::Default, Screen::of(&m))));
    if let Some((from, s)) = spot {
        put_at(&window, base, from, grown(base, 1.0, s.scale), None, s);
    }
    window.show().map_err(|e| e.to_string())?;

    let handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            let _ = handle.emit(EVENT, false);
        }
    });
    let _ = app.emit(EVENT, true);
    Ok(())
}

#[tauri::command]
pub async fn timer_window_close(app: AppHandle) -> Result<(), String> {
    match app.get_webview_window(LABEL) {
        Some(window) => window.destroy().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// Windows' Text size changed while Crest runs (display_rescale): the timer grows or shrinks with it, from where it was put.
pub fn follow_text_size(app: &AppHandle) {
    let Some(window) = app.get_webview_window(LABEL) else { return };
    let Some(config) = app.config().app.windows.iter().find(|w| w.label == LABEL) else { return };
    let (Ok(at), Ok(size)) = (window.outer_position(), window.outer_size()) else { return };
    let now = (size.width as i32, size.height as i32);
    let (from, put_on) = origin(*PLACED.lock().unwrap(), (at.x, at.y), now);
    // Measured on the monitor it was put from while it is still there, as a reopen would be; dragged since, on the one that holds
    // most of it now.
    let screens: Vec<Screen> = window.available_monitors().unwrap_or_default().iter().map(Screen::of).collect();
    let screen = put_on
        .and_then(|on| fresh(on, &screens))
        .or_else(|| window.current_monitor().ok().flatten().map(|m| Screen::of(&m)));
    if let Some(s) = screen {
        put_at(&window, (config.width, config.height), from, now, Some((at.x, at.y)), s);
    }
}

/// Sizes the window for the Text size on `s` and puts it where `from` says (`steps`); `now` is its size in physical px, and
/// `shown` where it is when it is already open. At the same size at opening only the position is set, as before the Text size
/// was followed.
fn put_at(window: &WebviewWindow, base: (f64, f64), from: Origin, now: (i32, i32), shown: Option<(i32, i32)>, s: Screen) {
    let text = crate::text_scale::get();
    let new = grown(base, text, s.scale);
    let at = spot_for(from, new, s);
    let plan = steps(now, new, shown, at);
    let size = || {
        if plan.resize {
            let _ = window.set_size(LogicalSize::new(base.0 * text, base.1 * text));
        }
    };
    let position = || {
        if plan.announce {
            let _ = window.emit(PLACING, at);
        }
        if plan.moves {
            let _ = window.set_position(PhysicalPosition::new(at.0, at.1));
        }
    };
    if plan.move_first {
        position();
        size();
    } else {
        size();
        position();
    }
    *PLACED.lock().unwrap() = Some((from, at, s));
}

/// What the timer was put from: the default spot, or a spot with the window's size there, both in physical px.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Origin {
    Default,
    Spot((i32, i32), (i32, i32)),
}

/// A monitor in physical px: its top-left, size and scale, and where its work area ends on the right and at the bottom.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Screen {
    pos: (i32, i32),
    size: (i32, i32),
    scale: f64,
    end: (i32, i32),
}

impl Screen {
    fn of(m: &Monitor) -> Screen {
        let (p, s, a) = (m.position(), m.size(), m.work_area());
        Screen {
            pos: (p.x, p.y),
            size: (s.width as i32, s.height as i32),
            scale: m.scale_factor(),
            end: (a.position.x + a.size.width as i32, a.position.y + a.size.height as i32),
        }
    }
}

/// The window's size in physical px for the config's logical `base` at Text size `text` on a monitor at `scale`.
fn grown((w, h): (f64, f64), text: f64, scale: f64) -> (i32, i32) {
    ((w * text * scale).round() as i32, (h * text * scale).round() as i32)
}

/// The size in physical px the window had at a saved spot: the page saves its pixel ratio with the spot (monitor scale times
/// Text size there), else, for a spot saved before it did or a ratio that cannot be one, a timer at 100 % on a monitor at `scale`.
fn saved_size(base: (f64, f64), dpr: Option<f64>, scale: f64) -> (i32, i32) {
    match dpr.filter(|d| (0.5..=10.0).contains(d)) {
        Some(d) => grown(base, d, 1.0),
        None => grown(base, 1.0, scale),
    }
}

/// Where a saved spot opens from, or None when no connected monitor holds its top-left 48 px (one unplugged since would leave
/// the timer out of reach). The monitor that held most of the window gave it its DPI (Windows' rule), so the size it had there
/// and the size it gets now are both worked out on that monitor: at an unchanged Text size they match and the spot stays.
fn saved_origin(screens: &[Screen], at: (i32, i32), dpr: Option<f64>, base: (f64, f64)) -> Option<(Origin, Screen)> {
    let corner = screens.iter().position(|s| grips(s.pos, s.size, at))?;
    let rough = saved_size(base, dpr, screens[corner].scale);
    let s = screens[most_of(screens, at, rough).unwrap_or(corner)];
    Some((Origin::Spot(at, saved_size(base, dpr, s.scale)), s))
}

/// The screen that holds the largest part of a window at `at`, `size` px.
fn most_of(screens: &[Screen], at: (i32, i32), size: (i32, i32)) -> Option<usize> {
    let part = |s: &Screen| {
        let w = (at.0 + size.0).min(s.pos.0 + s.size.0) - at.0.max(s.pos.0);
        let h = (at.1 + size.1).min(s.pos.1 + s.size.1) - at.1.max(s.pos.1);
        if w > 0 && h > 0 {
            w as i64 * h as i64
        } else {
            0
        }
    };
    screens.iter().enumerate().map(|(i, s)| (i, part(s))).filter(|&(_, a)| a > 0).max_by_key(|&(_, a)| a).map(|(i, _)| i)
}

/// What putting the window takes, and in which order.
#[derive(Debug, PartialEq)]
struct Steps {
    resize: bool,
    moves: bool,
    /// The page saves every move it sees; announced, a move Crest makes to an open window is left out, so the saved spot stays
    /// the user's. At opening the page is not listening yet.
    announce: bool,
    /// Growing, the window is moved first, and shrinking, sized first, so it never spills past where it ends up (onto a
    /// neighbour monitor with another DPI, say).
    move_first: bool,
}

/// From the window's size `now`, its size `new` and where it goes, `at`; `shown` is where it is when it is already open, and a
/// move to there is not made.
fn steps(now: (i32, i32), new: (i32, i32), shown: Option<(i32, i32)>, at: (i32, i32)) -> Steps {
    let moves = shown != Some(at);
    Steps { resize: new != now, moves, announce: moves && shown.is_some(), move_first: new.0 > now.0 }
}

/// One axis: where a window starting at `at` starts when its length goes from `old` to `new` px on a work area that ends at
/// `end`. An end on or past the edge stays where it is; any other window keeps its start and moves back only as far as its new
/// end would cross the edge. The same length keeps the same spot.
fn keep_in(at: i32, old: i32, new: i32, end: i32) -> i32 {
    if at + old >= end {
        at + old - new
    } else {
        at.min(end - new)
    }
}

/// The window's top-left for `from` with the window `new` px on `s`: the default spot keeps its margin from the right edge at
/// any size, top right below the notch; a spot moves back only as far as the window would leave the work area.
fn spot_for(from: Origin, new: (i32, i32), s: Screen) -> (i32, i32) {
    match from {
        Origin::Default => (s.pos.0 + s.size.0 - new.0 - (24.0 * s.scale) as i32, s.pos.1 + (72.0 * s.scale) as i32),
        Origin::Spot(at, old) => (keep_in(at.0, old.0, new.0, s.end.0), keep_in(at.1, old.1, new.1, s.end.1)),
    }
}

/// The connected monitor at the remembered one's position, read again: its scale or work area may have changed since the
/// window was put (Display settings, the taskbar), as a reopen would see. None when it is gone.
fn fresh(on: Screen, screens: &[Screen]) -> Option<Screen> {
    screens.iter().copied().find(|s| s.pos == on.pos)
}

/// What a live change works from: while the window is still where Crest put it, the remembered origin and the monitor it was
/// measured on; else (dragged since, or moved by Windows) the spot and size it has now, and no monitor yet.
fn origin(placed: Option<Placed>, now: (i32, i32), size: (i32, i32)) -> (Origin, Option<Screen>) {
    match placed {
        Some((from, at, on)) if at == now => (from, Some(on)),
        _ => (Origin::Spot(now, size), None),
    }
}

/// Whether a monitor at `pos` and `size` holds the top-left 48 px of a window at `at`.
fn grips((x, y): (i32, i32), (w, h): (i32, i32), (ax, ay): (i32, i32)) -> bool {
    const GRIP: i32 = 48;
    ax >= x && ay >= y && ax + GRIP <= x + w && ay + GRIP <= y + h
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 1920 x 1080 at 100 % with a 48 px taskbar at the bottom.
    const FHD: Screen = Screen { pos: (0, 0), size: (1920, 1080), scale: 1.0, end: (1920, 1032) };

    #[test]
    fn the_timer_grows_with_the_text_size_on_its_monitor() {
        assert_eq!(grown((320.0, 84.0), 1.0, 1.0), (320, 84));
        assert_eq!(grown((320.0, 84.0), 2.25, 1.0), (720, 189));
        assert_eq!(grown((320.0, 84.0), 1.5, 1.25), (600, 158), "84 x 1.875 = 157.5, rounded");
    }

    #[test]
    fn the_same_size_keeps_the_same_spot_wherever_it_is() {
        assert_eq!(keep_in(1500, 320, 320, 1920), 1500);
        assert_eq!(keep_in(1600, 320, 320, 1920), 1600, "on the edge");
        assert_eq!(keep_in(1700, 320, 320, 1920), 1700, "already past it");
        assert_eq!(keep_in(-1000, 480, 480, 0), -1000, "a monitor left of the primary");
    }

    #[test]
    fn growth_moves_the_timer_back_only_as_far_as_it_would_cross_the_edge() {
        assert_eq!(keep_in(600, 320, 480, 1920), 600);
        assert_eq!(keep_in(1500, 320, 480, 1920), 1440);
        // Above a bottom taskbar: 84 to 126 px tall from y 940 would end at 1066, past the work area's 1032.
        assert_eq!(keep_in(940, 84, 126, 1032), 906);
    }

    #[test]
    fn a_timer_on_the_edge_keeps_its_end_there_both_ways() {
        assert_eq!(keep_in(1600, 320, 480, 1920), 1440);
        assert_eq!(keep_in(1440, 480, 320, 1920), 1600);
    }

    #[test]
    fn the_default_spot_keeps_its_margin_at_every_text_size() {
        assert_eq!(spot_for(Origin::Default, (320, 84), FHD), (1576, 72));
        assert_eq!(spot_for(Origin::Default, (480, 126), FHD), (1416, 72));
        let at_125 = Screen { pos: (0, 0), size: (2400, 1350), scale: 1.25, end: (2400, 1290) };
        assert_eq!(spot_for(Origin::Default, (400, 105), at_125), (1970, 90));
    }

    #[test]
    fn a_spot_saved_at_100_moves_back_only_as_far_as_the_grown_timer_needs() {
        // Near the right edge, opened at 150 %: back by the 60 px it would stick out.
        assert_eq!(spot_for(Origin::Spot((1500, 300), (320, 84)), (480, 126), FHD), (1440, 300));
        // One where the grown timer still fits stays.
        assert_eq!(spot_for(Origin::Spot((1440, 300), (320, 84)), (480, 126), FHD), (1440, 300));
    }

    /// 150 % monitors left and right of the 1920 x 1080 primary.
    const LEFT_150: Screen = Screen { pos: (-2880, 0), size: (2880, 1620), scale: 1.5, end: (0, 1548) };
    const RIGHT_150: Screen = Screen { pos: (1920, 0), size: (2880, 1620), scale: 1.5, end: (4800, 1548) };

    #[test]
    fn a_spot_across_two_monitors_opens_from_the_one_that_held_most_of_it() {
        let base = (320.0, 84.0);
        let reopened = |screens: &[Screen], at, dpr| {
            let (from, s) = saved_origin(screens, at, dpr, base).unwrap();
            spot_for(from, grown(base, 1.0, s.scale), s)
        };
        // At Text size 100 % a spot never moves, whichever monitor has its corner and whichever has the rest (and its DPI).
        assert_eq!(reopened(&[LEFT_150, FHD], (-100, 300), Some(1.0)), (-100, 300), "corner on the left, most on the primary");
        assert_eq!(reopened(&[FHD, RIGHT_150], (1800, 300), Some(1.5)), (1800, 300), "corner on the primary, most on the right");
        assert_eq!(reopened(&[LEFT_150, FHD], (-100, 300), None), (-100, 300), "saved before the ratio was");
        assert_eq!(saved_origin(&[FHD], (2000, 300), Some(1.0), base), None, "no monitor under its corner any more");
    }

    #[test]
    fn a_live_change_works_from_where_the_timer_was_put_unless_it_was_dragged_since() {
        let from = Origin::Spot((1500, 300), (320, 84));
        assert_eq!(origin(Some((from, (1440, 300), FHD)), (1440, 300), (480, 126)), (from, Some(FHD)));
        assert_eq!(origin(Some((Origin::Default, (1576, 72), FHD)), (800, 500), (480, 126)), (Origin::Spot((800, 500), (480, 126)), None));
        assert_eq!(origin(None, (800, 500), (320, 84)), (Origin::Spot((800, 500), (320, 84)), None));
    }

    #[test]
    fn a_round_trip_through_150_brings_the_timer_back_to_the_users_spot() {
        let from = Origin::Spot((1500, 300), (320, 84));
        let at_150 = spot_for(from, (480, 126), FHD);
        assert_eq!(at_150, (1440, 300));
        let (back, _) = origin(Some((from, at_150, FHD)), at_150, (480, 126));
        assert_eq!(spot_for(back, (320, 84), FHD), (1500, 300));
    }

    #[test]
    fn a_remembered_monitor_is_read_again_for_its_scale_and_work_area() {
        // The primary went from 100 to 150 % while the timer was open: the same monitor, with its new scale and work area.
        let now_150 = Screen { scale: 1.5, end: (1920, 1008), ..FHD };
        assert_eq!(fresh(FHD, &[LEFT_150, now_150]), Some(now_150));
        assert_eq!(fresh(FHD, &[LEFT_150]), None, "unplugged since");
    }

    #[test]
    fn a_timer_across_two_monitors_keeps_its_spot_through_a_reopen_and_a_live_change() {
        let base = (320.0, 84.0);
        // Left at 150 % with its corner on the primary and most of it on the 150 % monitor to the right.
        let (from, s) = saved_origin(&[FHD, RIGHT_150], (1700, 300), Some(2.25), base).unwrap();
        let at = spot_for(from, grown(base, 1.0, s.scale), s);
        assert_eq!(at, (1700, 300), "reopened at 100 %");
        // Back to 150 % while it is open: measured on the monitor it was put from, as a reopen at 150 % would be.
        let (live, on) = origin(Some((from, at, s)), at, (320, 84));
        let on = on.expect("the monitor it was put from");
        assert_eq!(on, RIGHT_150);
        assert_eq!(spot_for(live, grown(base, 1.5, on.scale), on), (1700, 300));
    }

    #[test]
    fn a_saved_spot_carries_the_size_the_timer_had_there() {
        let base = (320.0, 84.0);
        assert_eq!(saved_size(base, Some(1.5), 1.0), (480, 126), "dragged at Text size 150 %");
        assert_eq!(saved_size(base, Some(1.875), 1.25), (600, 158), "150 % on a 125 % monitor");
        assert_eq!(saved_size(base, None, 1.25), (400, 105), "saved before the ratio was: a timer at 100 %");
        for broken in [0.0, -1.0, f64::NAN, f64::INFINITY, 1e9] {
            assert_eq!(saved_size(base, Some(broken), 1.25), (400, 105), "{broken} is not a pixel ratio");
        }
    }

    #[test]
    fn a_timer_saved_on_the_edge_while_grown_reopens_on_it() {
        // Dragged flush right at 150 % and reopened at 100 %: it stays on the edge, as a live change would keep it.
        let at_150 = Origin::Spot((1440, 300), saved_size((320.0, 84.0), Some(1.5), 1.0));
        assert_eq!(spot_for(at_150, (320, 84), FHD), (1600, 300));
    }

    #[test]
    fn putting_the_window_moves_before_growing_and_sizes_before_shrinking() {
        let plan = |resize, moves, announce, move_first| Steps { resize, moves, announce, move_first };
        assert_eq!(steps((320, 84), (320, 84), None, (1576, 72)), plan(false, true, false, false), "opening at 100 %: a move only");
        assert_eq!(steps((320, 84), (480, 126), Some((1576, 72)), (1416, 72)), plan(true, true, true, true), "growing while open");
        assert_eq!(steps((480, 126), (320, 84), Some((1416, 72)), (1576, 72)), plan(true, true, true, false), "shrinking while open");
        assert_eq!(steps((320, 84), (480, 126), Some((600, 300)), (600, 300)), plan(true, false, false, true), "growing in place: no move to announce");
    }

    #[test]
    fn a_saved_spot_needs_its_grip_on_a_connected_monitor() {
        assert!(grips((0, 0), (1920, 1080), (1500, 300)));
        assert!(grips((-1920, 0), (1920, 1080), (-500, 100)), "a monitor left of the primary");
        assert!(!grips((0, 0), (1920, 1080), (2000, 100)), "left on a monitor since unplugged");
        assert!(!grips((0, 0), (1920, 1080), (1900, 100)), "48 px of grip would cross the edge");
    }
}
