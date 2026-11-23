//! Screen Time (design G): which app is in front, per local hour and day, kept only on this PC while the user has turned it on.
//! Off until then; the notch turns it on and off (`screentime_set`), the tool and the bar's panel read the days (`screentime_days`),
//! the settings delete them (`screentime_clear`).
//!
//! The time in front counts between two inputs of the keyboard or the mouse: a gap of AWAY or more counts for nothing, a shorter one
//! counts whole, and the stretch after the last input counts only once input comes back within AWAY. A full-screen app counts without
//! input (a film, a game played with a controller); a locked session, a screen turned off and a sleeping PC never count. The desktop is
//! no app, and Start, Windows' flyouts and Crest's own windows keep the app before them (taskbar/front.rs `Fg`). No window title is
//! ever read: only the process's exe, its name as shown and its path.
//!
//! One file per local day in the `screentime` folder of the portable copy's data folder or, installed, of the local app data, never
//! the roaming profile. It is written every FLUSH while something changed, at a new day, when recording stops and as Crest quits,
//! under the lock that also guards a deletion, so a write never brings back what was just deleted. Days older than KEEP_DAYS go.

#![cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use jiff::civil::Date;
use jiff::tz::TimeZone;
use jiff::{Timestamp, ToSpan};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// A gap without input from this many seconds up counts for nothing.
const AWAY: i64 = 180;
/// Written to disk at most this often while something changed.
const FLUSH: i64 = 120;
/// Today and the 29 days before it.
const KEEP_DAYS: i64 = 30;
/// Apps per day; the ones after it go together under "" (the page's Other apps).
const MAX_APPS: usize = 300;
/// A day's file larger than this is not read.
const MAX_FILE: u64 = 1 << 20;
/// Days per `screentime_days`.
const MAX_RANGE: i32 = 31;
/// What a file read back may hold: a key, a name and a path this long, and an hour this many seconds (two hours on the day the clocks go back).
const MAX_KEY: usize = 260;
const MAX_NAME: usize = 200;
const MAX_PATH: usize = 1024;
const MAX_HOUR: u32 = 7200;

/// The app in front: its exe's file name in lower case (the key, the same across updates; a Mac's bundle id), its name as shown,
/// and its path (None on a Mac).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct App {
    key: String,
    name: String,
    path: Option<String>,
}

/// One app's day: its name, its path and its seconds in front per local hour.
#[derive(Clone, Debug, PartialEq, Default, Serialize)]
struct AppDay {
    name: String,
    path: Option<String>,
    h: [u32; 24],
}

/// A day's apps by key.
type Day = BTreeMap<String, AppDay>;

/// What is counted: the app in front, the time up to which everything is decided (`mark`, Unix seconds), the days in memory
/// (today, and an earlier day until it is written) and those not written yet. `dir` None keeps it all in memory (the tests).
struct Ledger {
    dir: Option<PathBuf>,
    current: Option<App>,
    mark: i64,
    days: BTreeMap<Date, Day>,
    dirty: BTreeSet<Date>,
    today: Date,
    warned: bool,
}

impl Ledger {
    fn new(dir: Option<PathBuf>, now: i64, tz: &TimeZone) -> Ledger {
        Ledger { dir, current: None, mark: now, days: BTreeMap::new(), dirty: BTreeSet::new(), today: day_of(now, tz), warned: false }
    }

    /// Decides the time up to the last input (`now` - `idle`, or `now` itself under a full-screen app): a stretch since `mark` shorter
    /// than AWAY goes to the app in front. `idle` None (locked, asleep) counts nothing and leaves `mark`. A clock turned back starts
    /// over from the last input; a jump forward (the clock, or waking up) is longer than AWAY and counts nothing.
    fn settle(&mut self, now: i64, idle: Option<u64>, full: bool, tz: &TimeZone) {
        let Some(idle) = idle else { return };
        let last = if full { now } else { now.saturating_sub(i64::try_from(idle).unwrap_or(i64::MAX)) };
        // `mark` never passes `now` while the clock runs on, so only a clock turned back puts `now` before it.
        if now < self.mark - 60 {
            self.mark = last;
            return;
        }
        if last > self.mark {
            if last - self.mark < AWAY {
                if let Some(app) = self.current.clone() {
                    self.credit(&app, self.mark, last, tz);
                }
            }
            self.mark = last;
        }
    }

    /// Another app in front (None: the desktop, or a process whose path cannot be read): the time so far goes to the one before.
    fn switch(&mut self, app: Option<App>, now: i64, idle: Option<u64>, full: bool, tz: &TimeZone) {
        self.settle(now, idle, full, tz);
        self.current = app;
    }

    /// `[from, to)` to `app`, cut at the local hours: each piece goes to its local day and hour. The next cut is the start of the
    /// local hour plus an hour of real time, so the half-hour and three-quarter zones stay right; on the day the clocks go back both
    /// hours 2 go to the same slot, and on the day they go forward slot 2 stays empty.
    fn credit(&mut self, app: &App, from: i64, to: i64, tz: &TimeZone) {
        let mut t = from;
        while t < to {
            let Ok(at) = Timestamp::from_second(t) else { return };
            let z = at.to_zoned(tz.clone());
            let next = (t - i64::from(z.minute()) * 60 - i64::from(z.second()) + 3600).min(to);
            let date = z.date();
            let dir = &self.dir;
            let day = self.days.entry(date).or_insert_with(|| dir.as_deref().map(|d| read_day(&day_path(d, date))).unwrap_or_default());
            let cell = &mut slot(day, app).h[z.hour() as usize];
            *cell = cell.saturating_add((next - t) as u32).min(MAX_HOUR);
            self.dirty.insert(date);
            t = next;
        }
    }

    /// Writes the days not written yet; a day that fails stays to be written at the next turn, said once on stderr. Then only today
    /// and the days still to write stay in memory.
    fn flush(&mut self, today: Date) {
        if let Some(dir) = &self.dir {
            if !self.dirty.is_empty() {
                let _ = std::fs::create_dir_all(dir);
            }
            for date in self.dirty.clone() {
                match write_day(dir, date, &self.days[&date]) {
                    Ok(()) => {
                        self.dirty.remove(&date);
                    }
                    Err(e) if !self.warned => {
                        self.warned = true;
                        eprintln!("screentime: {date} not written: {e}");
                    }
                    Err(_) => {}
                }
            }
        }
        let dirty = &self.dirty;
        self.days.retain(|d, _| *d == today || dirty.contains(d));
    }

    /// Forgets every day; the count goes on from `now`.
    fn clear(&mut self, now: i64) {
        self.days.clear();
        self.dirty.clear();
        self.mark = now;
    }
}

/// The app's entry in a day: past MAX_APPS apps a new one goes to "", the others together.
fn slot<'a>(day: &'a mut Day, app: &App) -> &'a mut AppDay {
    let named = day.len() - usize::from(day.contains_key(""));
    if day.contains_key(&app.key) || named < MAX_APPS {
        day.entry(app.key.clone()).or_insert_with(|| AppDay { name: app.name.clone(), path: app.path.clone(), h: [0; 24] })
    } else {
        day.entry(String::new()).or_default()
    }
}

fn total(app: &AppDay) -> u64 {
    app.h.iter().map(|&s| u64::from(s)).sum()
}

/// A day as a file holds it, read leniently: anything may have written it.
#[derive(Deserialize)]
struct RawFile {
    apps: BTreeMap<String, RawApp>,
}

#[derive(Deserialize)]
struct RawApp {
    #[serde(default)]
    name: String,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    h: Vec<u64>,
}

/// A day's file within its limits: a key past MAX_KEY left out, the name cut at MAX_NAME, a path past MAX_PATH gone, each hour at most
/// MAX_HOUR, the MAX_APPS apps with the most time (and "", the others). None when it is no such file.
fn parse_day(bytes: &[u8]) -> Option<Day> {
    let raw: RawFile = serde_json::from_slice(bytes).ok()?;
    let mut apps: Vec<(String, AppDay)> = raw
        .apps
        .into_iter()
        .filter(|(key, _)| key.chars().count() <= MAX_KEY)
        .map(|(key, a)| {
            let mut h = [0u32; 24];
            for (slot, s) in h.iter_mut().zip(a.h) {
                *slot = s.min(u64::from(MAX_HOUR)) as u32;
            }
            let path = a.path.filter(|p| p.chars().count() <= MAX_PATH);
            (key, AppDay { name: a.name.chars().take(MAX_NAME).collect(), path, h })
        })
        .collect();
    let others = apps.iter().position(|(key, _)| key.is_empty()).map(|i| apps.swap_remove(i));
    apps.sort_by_key(|(_, a)| std::cmp::Reverse(total(a)));
    apps.truncate(MAX_APPS);
    Some(apps.into_iter().chain(others).collect())
}

/// A day from its file; empty without one, past MAX_FILE or when it cannot be read (only an edit by hand breaks one written atomically).
fn read_day(path: &Path) -> Day {
    match std::fs::metadata(path) {
        Ok(meta) if meta.len() <= MAX_FILE => std::fs::read(path).ok().and_then(|b| parse_day(&b)).unwrap_or_default(),
        _ => Day::new(),
    }
}

#[derive(Serialize)]
struct FileOut<'a> {
    v: u32,
    apps: &'a Day,
}

fn write_day(dir: &Path, date: Date, day: &Day) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(&FileOut { v: 1, apps: day }).map_err(std::io::Error::other)?;
    crate::write_atomic(&day_path(dir, date), &bytes)
}

fn day_path(dir: &Path, date: Date) -> PathBuf {
    dir.join(format!("{date}.json"))
}

/// "YYYY-MM-DD" exactly, so "2026-1-5" is no day.
fn parse_date(s: &str) -> Option<Date> {
    let b = s.as_bytes();
    let shaped = b.len() == 10 && b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() });
    shaped.then(|| s.parse().ok()).flatten()
}

/// The day of a file of the record ("YYYY-MM-DD.json", or ".tmp" from a write cut short); None for any other name.
fn file_date(name: &str) -> Option<Date> {
    let (stem, ext) = name.split_once('.')?;
    matches!(ext, "json" | "tmp").then(|| parse_date(stem)).flatten()
}

/// The names among `names` to delete on `today`: the record's files older than KEEP_DAYS days, nothing else in the folder.
fn stale<'a>(names: impl IntoIterator<Item = &'a str>, today: Date) -> Vec<&'a str> {
    let Ok(keep) = today.checked_sub((KEEP_DAYS - 1).days()) else { return Vec::new() };
    names.into_iter().filter(|name| file_date(name).is_some_and(|d| d < keep)).collect()
}

/// The days from `from` to `to`, at most MAX_RANGE; "bad-range" for a date that is not one, `from` after `to` or more days.
fn range(from: &str, to: &str) -> Result<Vec<Date>, String> {
    let bad = || "bad-range".to_string();
    let (from, to) = (parse_date(from).ok_or_else(bad)?, parse_date(to).ok_or_else(bad)?);
    let days = from.until(to).map_err(|_| bad())?.get_days();
    if !(0..MAX_RANGE).contains(&days) {
        return Err(bad());
    }
    Ok(from.series(1.day()).take(days as usize + 1).collect())
}

fn now() -> i64 {
    Timestamp::now().as_second()
}

fn day_of(now: i64, tz: &TimeZone) -> Date {
    Timestamp::from_second(now).unwrap_or(Timestamp::UNIX_EPOCH).to_zoned(tz.clone()).date()
}

/// The record's names in `dir` that `pick` keeps, deleted.
fn remove(dir: &Path, pick: impl Fn(&str) -> bool) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if entry.file_name().to_str().is_some_and(&pick) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Deletes the days past KEEP_DAYS.
fn prune(dir: &Path, today: Date) {
    remove(dir, |name| !stale([name], today).is_empty());
}

/// Where the days are: the portable copy's data folder, otherwise the local app data, never the roaming profile.
fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    let base = match crate::portable::data_dir() {
        Some(dir) => dir,
        None => app.path().app_local_data_dir().map_err(|_| "app-data".to_string())?,
    };
    Ok(base.join("screentime"))
}

/// Counting, while recording.
static LEDGER: Mutex<Option<Ledger>> = Mutex::new(None);
/// The thread that watches the app in front, while recording.
static RUN: Mutex<Option<platform::Run>> = Mutex::new(None);

fn ledger() -> MutexGuard<'static, Option<Ledger>> {
    LEDGER.lock().unwrap_or_else(|e| e.into_inner())
}

/// A turn of the watching thread: another app in front (`app` Some) or the time so far; written when `flush` or at a new day,
/// which also deletes the days past KEEP_DAYS.
fn tick(app: Option<Option<App>>, idle: Option<u64>, full: bool, flush: bool) {
    let (now, tz) = (now(), TimeZone::system());
    let mut guard = ledger();
    let Some(l) = guard.as_mut() else { return };
    match app {
        Some(app) => l.switch(app, now, idle, full, &tz),
        None => l.settle(now, idle, full, &tz),
    }
    let today = day_of(now, &tz);
    let new_day = today != l.today;
    l.today = today;
    if flush || new_day {
        l.flush(today);
    }
    if let (true, Some(dir)) = (new_day, &l.dir) {
        prune(dir, today);
    }
}

/// Stops recording and writes what it counted: from the notch's switch, and as Crest quits (lib.rs). A second call finds nothing.
pub(crate) fn stop() {
    let run = RUN.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(run) = run {
        run.end();
    }
    if let Some(mut l) = ledger().take() {
        let (now, tz) = (now(), TimeZone::system());
        l.settle(now, platform::idle(), platform::full(), &tz);
        l.flush(day_of(now, &tz));
    }
}

/// Starts or stops recording, and deletes the days past the 30 kept. The notch only, which calls it at start with the switch's state.
#[tauri::command]
pub fn screentime_set(app: AppHandle, on: bool) -> Result<(), String> {
    let dir = folder(&app)?;
    prune(&dir, day_of(now(), &TimeZone::system()));
    if !on {
        stop();
        return Ok(());
    }
    let mut run = RUN.lock().unwrap_or_else(|e| e.into_inner());
    if run.is_none() {
        *ledger() = Some(Ledger::new(Some(dir), now(), &TimeZone::system()));
        match platform::spawn() {
            Ok(r) => *run = Some(r),
            Err(e) => {
                *ledger() = None;
                return Err(e);
            }
        }
    }
    Ok(())
}

/// A day as the page reads it.
#[derive(Serialize)]
pub struct DayOut {
    date: String,
    apps: Day,
}

/// The days from `from` to `to` ("YYYY-MM-DD", 31 at most), those without a record left out; while recording, the days in memory
/// from there, the others from their files.
#[tauri::command]
pub fn screentime_days(app: AppHandle, from: String, to: String) -> Result<Vec<DayOut>, String> {
    let dates = range(&from, &to)?;
    let dir = folder(&app)?;
    let held: BTreeMap<Date, Day> = match ledger().as_ref() {
        Some(l) => dates.iter().filter_map(|d| l.days.get(d).map(|day| (*d, day.clone()))).collect(),
        None => BTreeMap::new(),
    };
    Ok(dates
        .into_iter()
        .map(|date| (date, held.get(&date).cloned().unwrap_or_else(|| read_day(&day_path(&dir, date)))))
        .filter(|(_, day)| !day.is_empty())
        .map(|(date, apps)| DayOut { date: date.to_string(), apps })
        .collect())
}

/// Deletes every day kept; while recording the count goes on from now.
#[tauri::command]
pub fn screentime_clear(app: AppHandle) -> Result<(), String> {
    let dir = folder(&app)?;
    let mut guard = ledger();
    remove(&dir, |name| file_date(name).is_some());
    if let Some(l) = guard.as_mut() {
        l.clear(now());
    }
    Ok(())
}

/// Windows: a thread of its own with a hook on the window in front and a 30 s timer, from the switch on to the switch off.
#[cfg(windows)]
mod platform {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::sync::mpsc::{channel, Sender};
    use std::thread::JoinHandle;

    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::System::Threading::{GetCurrentProcessId, GetCurrentThreadId};
    use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
    use windows::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN};
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetForegroundWindow, GetMessageW, KillTimer, PeekMessageW, PostThreadMessageW, SetTimer, EVENT_SYSTEM_FOREGROUND, MSG,
        PM_NOREMOVE, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WM_QUIT, WM_TIMER,
    };

    use super::{App, FLUSH};
    use crate::taskbar::front::Fg;

    const TICK: i64 = 30;

    thread_local! {
        /// Names as shown by exe path, read once each on the thread.
        static NAMES: RefCell<HashMap<String, String>> = RefCell::new(HashMap::new());
    }

    pub(crate) struct Run {
        thread: JoinHandle<()>,
        id: u32,
    }

    impl Run {
        pub(crate) fn end(self) {
            // SAFETY: plain values; the thread made its queue before it sent its id.
            let _ = unsafe { PostThreadMessageW(self.id, WM_QUIT, WPARAM(0), LPARAM(0)) };
            let _ = self.thread.join();
        }
    }

    /// Locked, the screen off or asleep: None, which counts nothing. Otherwise the seconds since the last input.
    pub(crate) fn idle() -> Option<u64> {
        if crate::sysevents::locked() || crate::standby::asleep() {
            return None;
        }
        crate::idle::read().ok()
    }

    /// A full-screen app, a presentation or a busy full screen in front, as Windows tells it for its own notifications.
    pub(crate) fn full() -> bool {
        // SAFETY: no arguments, no state.
        unsafe { SHQueryUserNotificationState() }.is_ok_and(|s| s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE)
    }

    /// What the window in front stands for: the desktop, or an app whose path cannot be read (a protected process), is no app;
    /// None keeps the app before (Start, a flyout, a Crest window).
    fn app_of(hwnd: HWND) -> Option<Option<App>> {
        // SAFETY: no arguments.
        match Fg::of(hwnd, unsafe { GetCurrentProcessId() }) {
            Fg::Desktop => Some(None),
            Fg::Other => None,
            Fg::Listed(id) => Some(app_at(HWND(id as _))),
        }
    }

    /// A Store app's frame stands for the process behind it (display.rs `app_pid`); the key is its exe's file name in lower case.
    fn app_at(hwnd: HWND) -> Option<App> {
        let path = crate::mixer::process_path(crate::display::app_pid(hwnd))?;
        let name = NAMES.with_borrow_mut(|names| names.entry(path.clone()).or_insert_with(|| crate::mixer::display_name(&path)).clone());
        Some(App { key: crate::mixer::file_name(&path), name, path: Some(path) })
    }

    unsafe extern "system" fn on_event(_: HWINEVENTHOOK, _: u32, hwnd: HWND, _: i32, _: i32, _: u32, _: u32) {
        if let Some(app) = app_of(hwnd) {
            super::tick(Some(app), idle(), full(), false);
        }
    }

    pub(crate) fn spawn() -> Result<Run, String> {
        let (ready, id) = channel();
        let thread = std::thread::Builder::new().name("screentime".into()).spawn(move || unsafe { run(ready) }).map_err(|_| "failed".to_string())?;
        let id = id.recv().map_err(|_| "failed".to_string())?;
        Ok(Run { thread, id })
    }

    unsafe fn run(ready: Sender<u32>) {
        unsafe {
            let mut msg = MSG::default();
            // The thread's queue, before its id goes out: a quit posted to a thread without one would be lost.
            let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
            let hook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, None, Some(on_event), 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
            if hook.is_invalid() {
                eprintln!("screentime: the foreground hook failed, only the timer counts");
            }
            let timer = SetTimer(None, 0, (TICK * 1000) as u32, None);
            let _ = ready.send(GetCurrentThreadId());
            if let Some(app) = app_of(GetForegroundWindow()) {
                super::tick(Some(app), idle(), full(), false);
            }
            let mut ticks = 0i64;
            while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                // The thread's own timer, read here: it has no window to go to.
                if msg.message == WM_TIMER && msg.hwnd.is_invalid() {
                    ticks += 1;
                    super::tick(None, idle(), full(), ticks % (FLUSH / TICK) == 0);
                }
                DispatchMessageW(&msg);
            }
            let _ = KillTimer(None, timer);
            let _ = UnhookWinEvent(hook);
        }
    }
}

/// macOS: a thread that asks for the app in front and the idle time every 5 s. No icons (no path) and no full-screen exception.
#[cfg(target_os = "macos")]
mod platform {
    use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
    use std::thread::JoinHandle;
    use std::time::Duration;

    use super::{App, FLUSH};

    const TICK: i64 = 5;

    pub(crate) struct Run {
        thread: JoinHandle<()>,
        stop: Sender<()>,
    }

    impl Run {
        pub(crate) fn end(self) {
            drop(self.stop);
            let _ = self.thread.join();
        }
    }

    pub(crate) fn idle() -> Option<u64> {
        crate::idle::read().ok()
    }

    pub(crate) fn full() -> bool {
        false
    }

    pub(crate) fn spawn() -> Result<Run, String> {
        let (stop, stopped) = channel::<()>();
        let thread = std::thread::Builder::new()
            .name("screentime".into())
            .spawn(move || {
                let own = std::process::id() as i32;
                let mut ticks = 0i64;
                // Dropping the sender ends the wait at once.
                while let Err(RecvTimeoutError::Timeout) = stopped.recv_timeout(Duration::from_secs(TICK as u64)) {
                    // Crest itself keeps the app before it.
                    let app = match crate::macos::frontmost_app() {
                        Some((_, _, pid)) if pid == own => None,
                        Some((key, name, _)) if !key.is_empty() => Some(Some(App { key, name, path: None })),
                        _ => Some(None),
                    };
                    ticks += 1;
                    super::tick(app, idle(), false, ticks % (FLUSH / TICK) == 0);
                }
            })
            .map_err(|_| "failed".to_string())?;
        Ok(Run { thread, stop })
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    pub(crate) struct Run;

    impl Run {
        pub(crate) fn end(self) {}
    }

    pub(crate) fn idle() -> Option<u64> {
        None
    }

    pub(crate) fn full() -> bool {
        false
    }

    pub(crate) fn spawn() -> Result<Run, String> {
        Err("unsupported".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jiff::civil::date;
    use jiff::tz::{offset, Offset};

    fn app(key: &str) -> App {
        App { key: key.into(), name: key.into(), path: None }
    }

    fn at(tz: &TimeZone, d: Date, h: i8, m: i8, s: i8) -> i64 {
        d.at(h, m, s, 0).to_zoned(tz.clone()).unwrap().timestamp().as_second()
    }

    fn hours(l: &Ledger, d: Date, key: &str) -> [u32; 24] {
        l.days.get(&d).and_then(|day| day.get(key)).map_or([0; 24], |a| a.h)
    }

    fn sum(l: &Ledger, key: &str) -> u64 {
        l.days.values().filter_map(|day| day.get(key)).map(total).sum()
    }

    /// A ledger in memory at `t0` with `a` in front.
    fn running(t0: i64, tz: &TimeZone) -> Ledger {
        let mut l = Ledger::new(None, t0, tz);
        l.current = Some(app("a"));
        l
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("crest-screentime-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_stretch_is_cut_at_the_local_hours_and_days() {
        let tz = TimeZone::fixed(offset(1));
        let d = date(2026, 11, 23);
        let mut l = Ledger::new(None, 0, &tz);
        l.credit(&app("a"), at(&tz, d, 10, 59, 30), at(&tz, d, 11, 0, 30), &tz);
        let h = hours(&l, d, "a");
        assert_eq!((h[10], h[11]), (30, 30));

        let mut l = Ledger::new(None, 0, &tz);
        l.credit(&app("a"), at(&tz, d, 23, 59, 0), at(&tz, d, 23, 59, 0) + 120, &tz);
        assert_eq!(hours(&l, d, "a")[23], 60);
        assert_eq!(hours(&l, date(2026, 11, 24), "a")[0], 60);
    }

    #[test]
    fn a_half_hour_zone_keeps_its_local_hour_whole() {
        let tz = TimeZone::fixed(Offset::from_seconds(5 * 3600 + 1800).unwrap());
        let d = date(2026, 11, 23);
        let mut l = Ledger::new(None, 0, &tz);
        l.credit(&app("a"), at(&tz, d, 10, 15, 0), at(&tz, d, 10, 45, 0), &tz);
        let h = hours(&l, d, "a");
        assert_eq!(h[10], 1800);
        assert_eq!(h.iter().sum::<u32>(), 1800);
    }

    #[test]
    fn the_hour_the_clocks_skip_stays_empty() {
        let tz = TimeZone::get("Europe/Rome").unwrap();
        let d = date(2026, 3, 29);
        let mut l = Ledger::new(None, 0, &tz);
        l.credit(&app("a"), at(&tz, d, 1, 50, 0), at(&tz, d, 3, 10, 0), &tz);
        let h = hours(&l, d, "a");
        assert_eq!((h[1], h[2], h[3]), (600, 0, 600));
    }

    #[test]
    fn input_every_30_s_counts_all_of_it() {
        let tz = TimeZone::UTC;
        let mut l = running(1_000_000, &tz);
        for i in 1..=10 {
            l.settle(1_000_000 + 30 * i, Some(0), false, &tz);
        }
        assert_eq!(sum(&l, "a"), 300);
    }

    #[test]
    fn a_gap_under_three_minutes_counts_and_one_over_does_not() {
        let tz = TimeZone::UTC;
        let t0 = 1_000_000;
        let mut l = running(t0, &tz);
        // No input since t0: nothing decided yet.
        l.settle(t0 + 120, Some(120), false, &tz);
        assert_eq!(sum(&l, "a"), 0);
        l.settle(t0 + 150, Some(0), false, &tz);
        assert_eq!(sum(&l, "a"), 150);
        l.settle(t0 + 350, Some(0), false, &tz);
        assert_eq!(sum(&l, "a"), 150);
        assert_eq!(l.mark, t0 + 350);
    }

    #[test]
    fn a_full_screen_app_counts_without_input() {
        let tz = TimeZone::UTC;
        let t0 = 1_000_000;
        let mut l = running(t0, &tz);
        l.settle(t0 + 30, Some(30), true, &tz);
        l.settle(t0 + 600, Some(600), true, &tz);
        assert_eq!(sum(&l, "a"), 30);
        // Every 30 s, as the timer turns.
        for i in 1..=20 {
            l.settle(t0 + 600 + 30 * i, Some(600 + 30 * i as u64), true, &tz);
        }
        assert_eq!(sum(&l, "a"), 630);
        // Leaving the full screen with no input since is no clock turned back: nothing counts twice.
        l.settle(t0 + 1260, Some(1260), false, &tz);
        l.settle(t0 + 1290, Some(0), false, &tz);
        assert_eq!(sum(&l, "a"), 630 + 90);
    }

    #[test]
    fn locked_or_asleep_counts_nothing_and_keeps_the_mark() {
        let tz = TimeZone::UTC;
        let t0 = 1_000_000;
        let mut l = running(t0, &tz);
        l.settle(t0 + 60, None, false, &tz);
        assert_eq!((sum(&l, "a"), l.mark), (0, t0));
    }

    #[test]
    fn a_clock_turned_back_or_forward_counts_nothing() {
        let tz = TimeZone::UTC;
        let t0 = 1_000_000;
        let mut l = running(t0, &tz);
        l.settle(t0 - 7200, Some(5), false, &tz);
        assert_eq!((sum(&l, "a"), l.mark), (0, t0 - 7205));
        l.settle(t0 - 7200 + 30, Some(0), false, &tz);
        assert_eq!(sum(&l, "a"), 35);

        let mut l = running(t0, &tz);
        l.settle(t0 + 86_400, Some(5), false, &tz);
        assert_eq!((sum(&l, "a"), l.mark), (0, t0 + 86_395));
    }

    #[test]
    fn a_switch_gives_the_time_before_it_to_the_app_before() {
        let tz = TimeZone::UTC;
        let t0 = 1_000_000;
        let mut l = running(t0, &tz);
        l.switch(Some(app("b")), t0 + 60, Some(0), false, &tz);
        l.settle(t0 + 90, Some(0), false, &tz);
        assert_eq!((sum(&l, "a"), sum(&l, "b")), (60, 30));
        // The desktop stops the count.
        l.switch(None, t0 + 120, Some(0), false, &tz);
        l.settle(t0 + 150, Some(0), false, &tz);
        assert_eq!((sum(&l, "a"), sum(&l, "b")), (60, 60));
    }

    #[test]
    fn a_file_is_read_within_its_limits() {
        assert_eq!(parse_day(b"{not json"), None);
        let day = parse_day(br#"{"v":1,"apps":{"a.exe":{"name":"A","path":null,"h":[99999,5]}}}"#).unwrap();
        assert_eq!(day["a.exe"].h[..3], [7200, 5, 0]);

        let long = "x".repeat(500);
        let json = format!(r#"{{"apps":{{"b.exe":{{"name":"{long}","path":"{}","h":[1]}},"{}":{{"name":"C","h":[1]}}}}}}"#, "p".repeat(1025), "k".repeat(261));
        let day = parse_day(json.as_bytes()).unwrap();
        assert_eq!(day.len(), 1);
        assert_eq!((day["b.exe"].name.chars().count(), day["b.exe"].path.clone()), (200, None));

        // 301 apps: the one with the least time goes, the others together under "" stay.
        let apps: Vec<String> = (0..301).map(|i| format!(r#""a{i}":{{"name":"A","h":[{}]}}"#, i + 1)).collect();
        let day = parse_day(format!(r#"{{"apps":{{{},"":{{"name":"","h":[1]}}}}}}"#, apps.join(",")).as_bytes()).unwrap();
        assert_eq!(day.len(), 301);
        assert!(!day.contains_key("a0") && day.contains_key("a300") && day.contains_key(""));
    }

    #[test]
    fn a_broken_or_huge_file_reads_as_an_empty_day() {
        let dir = temp("read");
        std::fs::write(dir.join("broken.json"), "{").unwrap();
        assert!(read_day(&dir.join("broken.json")).is_empty());
        let big = format!(r#"{{"apps":{{"a.exe":{{"name":"A","h":[1]}}}}}}{}"#, " ".repeat(1 << 20));
        std::fs::write(dir.join("big.json"), big).unwrap();
        assert!(read_day(&dir.join("big.json")).is_empty());
        assert!(read_day(&dir.join("missing.json")).is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn past_300_apps_a_new_one_goes_with_the_others() {
        let tz = TimeZone::UTC;
        let d = date(2026, 11, 23);
        let mut l = Ledger::new(None, 0, &tz);
        l.days.insert(d, (0..300).map(|i| (format!("a{i}"), AppDay::default())).collect());
        let t = at(&tz, d, 9, 0, 0);
        l.credit(&app("new"), t, t + 10, &tz);
        l.credit(&app("a7"), t, t + 10, &tz);
        assert_eq!((hours(&l, d, "")[9], hours(&l, d, "new")[9], hours(&l, d, "a7")[9]), (10, 0, 10));
    }

    #[test]
    fn a_day_is_written_and_read_back_and_only_today_stays_in_memory() {
        let dir = temp("write");
        let tz = TimeZone::UTC;
        let (d, next) = (date(2026, 11, 23), date(2026, 11, 24));
        let mut l = Ledger::new(Some(dir.clone()), 0, &tz);
        l.credit(&App { key: "a.exe".into(), name: "A".into(), path: Some("C:\\A\\a.exe".into()) }, at(&tz, d, 23, 0, 0), at(&tz, next, 1, 0, 0), &tz);
        l.flush(next);
        assert!(l.dirty.is_empty());
        assert_eq!(l.days.keys().copied().collect::<Vec<_>>(), vec![next]);
        let text = std::fs::read_to_string(day_path(&dir, d)).unwrap();
        assert!(text.starts_with(r#"{"v":1,"apps":{"a.exe":{"name":"A","path":"C:\\A\\a.exe","h":["#), "{text}");
        assert_eq!(read_day(&day_path(&dir, d))["a.exe"].h[23], 3600);
        // A new count of the same day adds to its file.
        let mut l = Ledger::new(Some(dir.clone()), 0, &tz);
        l.credit(&app("a.exe"), at(&tz, d, 23, 0, 0), at(&tz, d, 23, 0, 10), &tz);
        assert_eq!(hours(&l, d, "a.exe")[23], 3610);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn only_the_records_files_past_30_days_go() {
        let names = ["2026-10-24.json", "2026-10-24.tmp", "2026-10-25.json", "note.txt", "2026-1-5.json", "2026-10-01.json.bak"];
        assert_eq!(stale(names, date(2026, 11, 23)), vec!["2026-10-24.json", "2026-10-24.tmp"]);
    }

    #[test]
    fn a_range_is_31_days_at_most_of_real_dates_in_order() {
        assert_eq!(range("2026-11-23", "2026-11-23").unwrap(), vec![date(2026, 11, 23)]);
        assert_eq!(range("2026-11-01", "2026-12-01").unwrap().len(), 31);
        for (from, to) in [("2026-11-24", "2026-11-23"), ("2026-11-01", "2026-12-02"), ("2026-1-5", "2026-01-05"), ("2026-02-30", "2026-03-01")] {
            assert_eq!(range(from, to), Err("bad-range".to_string()), "{from} {to}");
        }
    }
}
