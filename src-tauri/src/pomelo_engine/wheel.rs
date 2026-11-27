//! The Pomelo wheel (the Pomelo scope of the settings window): `Pomelo.exe`, the whole Pomelo app from the same downloaded
//! package as the Files tool's engine, run by Crest as `Pomelo.exe --hosted --data <d> --parent <pid> --lang <code>`. Like the
//! engine it is a separate, closed program: Crest only starts it, keeps it running and reads its lines.
//!
//! - It runs only while the user's switch is on (the notch sends it, src/features/pomelo/store.ts), in a job that ends it with
//!   Crest, a crash of Crest included. A wheel that falls is started again, at most `RESTARTS` times in `WINDOW`.
//! - Its stdout carries JSON lines: `ready`, `conflict` (Pomelo from the Store already runs: two wheels would fight over the same
//!   drag), `locked` (a job refused for the licence) and `open-settings`. Their outcome goes to every window as `EVENT`.
//! - Its settings are read and written through the engine (`settings schema|get|set`), which checks every value.

use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use super::{command, data_dir, exit_error, id_ok, installed, lang_ok, lock, once, wheel_path, GRACE, MAX_ANSWER};
use crate::agents::job::Job;

const EVENT: &str = "pomelo-wheel://state";
/// `Pomelo.exe --hosted` exits with this when another Pomelo already runs.
const CONFLICT_EXIT: i32 = 5;
/// It exits with this for wrong arguments or a `--parent` already gone; 0 is an exit it chose.
const USAGE_EXIT: i32 = 2;
/// At most this many restarts within `WINDOW`; one more fall leaves it down.
const RESTARTS: usize = 3;
const WINDOW: Duration = Duration::from_secs(300);
/// Pomelo's package in the Microsoft Store.
const STORE_FAMILY: &str = "andrealo.Pomelo_1treqmb6a3p46";
/// A setting's value larger than this is refused before it reaches the engine.
const MAX_VALUE: usize = 16 * 1024;

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    Off,
    Starting,
    /// It listens for dragged files.
    Ready,
    Conflict,
    /// It fell more often than it may be restarted.
    Crashed,
    /// The package has no `Pomelo.exe`.
    Missing,
    /// It exited by itself (code 0): not restarted.
    Stopped,
    /// It refused to start (code 2): not restarted.
    Failed,
}

/// The other Pomelo a conflict names.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum With {
    /// Pomelo from the Microsoft Store.
    Store,
    /// A copy started from a folder.
    Copy,
    /// Another hosted wheel on the same data folder.
    Hosted,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct State {
    phase: Phase,
    /// A job was refused for the licence since it started.
    locked: bool,
    /// The free files left when it was refused.
    left: Option<u64>,
    /// Who the wheel conflicts with, when it said.
    with: Option<With>,
}

const OFF: State = State { phase: Phase::Off, locked: false, left: None, with: None };

struct Wheel {
    /// Bumped by every start and stop: a supervisor of an older generation leaves everything alone.
    generation: u64,
    state: State,
    /// Closing it is the wheel's own way to stop.
    stdin: Option<ChildStdin>,
    /// Tied: dropping it ends whatever still runs.
    job: Option<Job>,
    /// A `Pomelo.exe` of this wheel is running, until its exit is seen.
    alive: bool,
    /// The language it was started in, for a start after an update.
    lang: Option<String>,
}

static WHEEL: Mutex<Wheel> = Mutex::new(Wheel { generation: 0, state: OFF, stdin: None, job: None, alive: false, lang: None });

/// Whether the wheel runs (or is being started), which holds the package's files.
pub fn running() -> bool {
    matches!(lock(&WHEEL).state.phase, Phase::Starting | Phase::Ready)
}

/// A line of the wheel that Crest acts on.
#[derive(Debug, PartialEq)]
enum Line {
    Ready,
    Conflict(With),
    /// The free files left, when it says.
    Locked(Option<u64>),
    /// The settings page it asks for, None for the scope's first.
    OpenSettings(Option<String>),
}

fn parse_line(line: &str) -> Option<Line> {
    let v: Value = serde_json::from_str(line.trim().trim_start_matches('\u{feff}')).ok()?;
    match v.get("type")?.as_str()? {
        "ready" => Some(Line::Ready),
        "conflict" => Some(Line::Conflict(match v.get("with").and_then(Value::as_str) {
            Some("store") => With::Store,
            Some("hosted") => With::Hosted,
            // Any other Pomelo is a copy of its own.
            _ => With::Copy,
        })),
        "locked" => Some(Line::Locked(v.get("left").and_then(Value::as_u64))),
        "open-settings" => Some(Line::OpenSettings(v.get("page").and_then(Value::as_str).filter(|p| page_ok(p)).map(str::to_owned))),
        _ => None,
    }
}

/// A page id that also makes a settings section (`pomelo-<id>`, settings_window.rs).
fn page_ok(page: &str) -> bool {
    (1..=32).contains(&page.len()) && page.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// The section of the settings window for a page of the Pomelo scope.
fn section(page: Option<&str>) -> String {
    page.map_or_else(|| "pomelo".into(), |p| format!("pomelo-{p}"))
}

/// Whether a wheel that fell now may start again; `falls` keeps the falls of the last `WINDOW`, this one included.
fn may_restart(falls: &mut Vec<Instant>, now: Instant) -> bool {
    falls.retain(|t| now.duration_since(*t) < WINDOW);
    falls.push(now);
    falls.len() <= RESTARTS
}

/// What follows an exit Crest did not ask for: a conflict, an exit Pomelo chose (0) or a refused start (2) stay down; a fall (any
/// other code, or none) starts again while it may.
fn after_exit(code: i32, conflict: bool, falls: &mut Vec<Instant>, now: Instant) -> Phase {
    if conflict || code == CONFLICT_EXIT {
        Phase::Conflict
    } else if code == 0 {
        Phase::Stopped
    } else if code == USAGE_EXIT {
        Phase::Failed
    } else if may_restart(falls, now) {
        Phase::Starting
    } else {
        Phase::Crashed
    }
}

fn wheel_exe(app: &AppHandle) -> Option<PathBuf> {
    installed(app).ok().as_deref().and_then(wheel_path)
}

fn hosted_args(data: &Path, lang: Option<&str>) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec!["--hosted".into(), "--data".into(), data.into(), "--parent".into(), std::process::id().to_string().into()];
    if let Some(lang) = lang.filter(|l| lang_ok(l)) {
        args.extend(["--lang".into(), lang.into()]);
    }
    args
}

/// Changes the state if `generation` is still the current one, and tells every window.
fn update(app: &AppHandle, generation: u64, change: impl FnOnce(&mut State)) {
    let mut wheel = lock(&WHEEL);
    if wheel.generation != generation {
        return;
    }
    change(&mut wheel.state);
    let state = wheel.state;
    drop(wheel);
    let _ = app.emit(EVENT, state);
}

fn start(app: AppHandle, lang: Option<String>) {
    let mut wheel = lock(&WHEEL);
    if matches!(wheel.state.phase, Phase::Starting | Phase::Ready) {
        return;
    }
    wheel.generation += 1;
    wheel.state = State { phase: Phase::Starting, ..OFF };
    wheel.lang = lang.clone();
    let (generation, state) = (wheel.generation, wheel.state);
    drop(wheel);
    let _ = app.emit(EVENT, state);
    std::thread::spawn(move || supervise(&app, generation, lang.as_deref()));
}

/// Closes its stdin, after which it ends by itself; whatever still runs after `GRACE` goes with the job.
fn stop(app: &AppHandle) {
    if let Some(job) = begin_stop(app) {
        std::thread::spawn(move || {
            std::thread::sleep(GRACE);
            drop(job);
        });
    }
}

/// Turns the wheel off and closes its stdin; the job, to end what is left later.
fn begin_stop(app: &AppHandle) -> Option<Job> {
    let mut wheel = lock(&WHEEL);
    wheel.generation += 1;
    wheel.state = OFF;
    let (stdin, job, state) = (wheel.stdin.take(), wheel.job.take(), wheel.state);
    drop(wheel);
    let _ = app.emit(EVENT, state);
    drop(stdin);
    job
}

/// Before an update replaces the package: stops a running wheel and waits for its exit (ending it after `GRACE`), so no file of
/// the package is in use. Returns the language to start it again in, None when it was not running; Err when it would not end.
pub fn stop_for_update(app: &AppHandle) -> Result<Option<Option<String>>, String> {
    if !lock(&WHEEL).alive {
        return Ok(None);
    }
    let lang = lock(&WHEEL).lang.clone();
    let job = begin_stop(app);
    let ended = |limit: Duration| {
        let start = Instant::now();
        while lock(&WHEEL).alive {
            if start.elapsed() > limit {
                return false;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        true
    };
    if !ended(GRACE) {
        drop(job);
        if !ended(Duration::from_secs(5)) {
            return Err("busy".into());
        }
    }
    Ok(Some(lang))
}

/// After an update: the wheel starts again if `stop_for_update` stopped it.
pub fn resume_after_update(app: &AppHandle, stopped: Option<Option<String>>) {
    if let Some(lang) = stopped {
        start(app.clone(), lang);
    }
}

fn supervise(app: &AppHandle, generation: u64, lang: Option<&str>) {
    let mut falls = Vec::new();
    loop {
        let (Some(exe), Ok(data)) = (wheel_exe(app), data_dir(app)) else {
            return update(app, generation, |s| s.phase = Phase::Missing);
        };
        let Some((code, conflict)) = run(app, generation, command(&exe, &hosted_args(&data, lang))) else { return };
        let phase = after_exit(code, conflict, &mut falls, Instant::now());
        update(app, generation, |s| s.phase = phase);
        if phase != Phase::Starting {
            return;
        }
        // A wheel that falls as it starts does not spin.
        std::thread::sleep(Duration::from_secs(1));
        if lock(&WHEEL).generation != generation {
            return;
        }
    }
}

/// Runs the wheel until it exits: its exit code and whether it said `conflict`, None once a stop took over.
fn run(app: &AppHandle, generation: u64, mut cmd: Command) -> Option<(i32, bool)> {
    let Ok(mut child) = cmd.spawn() else { return Some((-1, false)) };
    let job = Job::tied(&child);
    let stdout = child.stdout.take();
    {
        let mut wheel = lock(&WHEEL);
        if wheel.generation != generation {
            drop(job);
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        wheel.stdin = child.stdin.take();
        wheel.job = job;
        wheel.alive = true;
    }
    let mut conflict = false;
    for line in stdout.into_iter().flat_map(|out| BufReader::new(out.take(MAX_ANSWER)).lines()) {
        let Ok(line) = line else { break };
        match parse_line(&line) {
            Some(Line::Ready) => update(app, generation, |s| s.phase = Phase::Ready),
            Some(Line::Conflict(with)) => {
                conflict = true;
                update(app, generation, |s| s.with = Some(with));
            }
            // Crest shows the licence, with the key's field, on the scope's first page.
            Some(Line::Locked(left)) => {
                update(app, generation, |s| {
                    s.locked = true;
                    s.left = left;
                });
                crate::settings_window::open_settings(app, Some(section(None)));
            }
            Some(Line::OpenSettings(page)) => crate::settings_window::open_settings(app, Some(section(page.as_deref()))),
            None => {}
        }
    }
    let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);
    let mut wheel = lock(&WHEEL);
    wheel.alive = false;
    if wheel.generation != generation {
        return None;
    }
    wheel.stdin = None;
    wheel.job = None;
    Some((code, conflict))
}

/// The switch: on starts the wheel unless it runs (again after a conflict or a crash), off stops it.
#[tauri::command]
pub fn pomelo_wheel_set(app: AppHandle, on: bool, lang: Option<String>) {
    if on {
        start(app, lang.filter(|l| lang_ok(l)));
    } else {
        stop(&app);
    }
}

#[tauri::command]
pub fn pomelo_wheel_state() -> State {
    lock(&WHEEL).state
}

/// Opens one of Pomelo's own settings windows (a `custom` row of the schema), handed to the running wheel.
#[tauri::command(async)]
pub fn pomelo_wheel_open(app: AppHandle, page: String, lang: Option<String>) -> Result<(), String> {
    if !id_ok(&page) {
        return Err("page".into());
    }
    if lock(&WHEEL).state.phase != Phase::Ready {
        return Err("off".into());
    }
    let exe = wheel_exe(&app).ok_or("not-installed")?;
    let mut args = hosted_args(&data_dir(&app)?, lang.as_deref());
    args.extend(["--open-settings".into(), page.into()]);
    once(command(&exe, &args), Duration::from_secs(15)).map(|_| ())
}

/// Whether Pomelo from the Microsoft Store is installed for this user (it then takes the drag while it runs).
#[tauri::command]
pub fn pomelo_store_installed() -> bool {
    use windows::core::HSTRING;
    use windows::Win32::Storage::Packaging::Appx::GetPackagesByPackageFamily;
    let (mut count, mut length) = (0u32, 0u32);
    // With no buffer it only counts: ERROR_INSUFFICIENT_BUFFER and a count when there are some.
    let _ = unsafe { GetPackagesByPackageFamily(&HSTRING::from(STORE_FAMILY), &mut count, None, &mut length, None) };
    count > 0
}

/// The engine's arguments for `settings schema|get|set`, after checking the key and the value.
fn settings_args(data: &Path, action: &str, key: Option<&str>, value: Option<&Value>, lang: Option<&str>) -> Result<Vec<OsString>, String> {
    let mut args: Vec<OsString> = vec!["settings".into(), action.into(), "--data".into(), data.into()];
    match action {
        "schema" => {
            if let Some(lang) = lang.filter(|l| lang_ok(l)) {
                args.extend(["--lang".into(), lang.into()]);
            }
        }
        "get" => {}
        "set" => {
            let key = key.filter(|k| id_ok(k)).ok_or("key")?;
            // serde_json escapes every control character, so the value is one line.
            let value = serde_json::to_string(value.ok_or("value")?).map_err(|_| "value")?;
            if value.len() > MAX_VALUE {
                return Err("value".into());
            }
            args.extend(["--key".into(), key.into(), "--value".into(), value.into()]);
        }
        _ => return Err("action".into()),
    }
    Ok(args)
}

/// `settings schema|get|set` of the engine: its answer as it gives it.
#[tauri::command(async)]
pub fn pomelo_settings(app: AppHandle, action: String, key: Option<String>, value: Option<Value>, lang: Option<String>) -> Result<Value, String> {
    let exe = installed(&app)?;
    let args = settings_args(&data_dir(&app)?, &action, key.as_deref(), value.as_ref(), lang.as_deref())?;
    match once(command(&exe, &args), Duration::from_secs(30))? {
        (Some(v), _) => Ok(v),
        (None, code) => Err(exit_error(code).unwrap_or("broken").into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The test wheel: a batch file that prints the wheel's lines (fake-wheel.cmd beside this file, not part of the app).
    fn fake() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join("pomelo_engine").join("fake-wheel.cmd")
    }

    #[test]
    fn reads_the_lines_crest_acts_on() {
        assert_eq!(parse_line(r#"{"type":"ready"}"#), Some(Line::Ready));
        assert_eq!(parse_line("\u{feff}{\"type\":\"conflict\",\"with\":\"store\"}\r"), Some(Line::Conflict(With::Store)));
        assert_eq!(parse_line(r#"{"type":"conflict","with":"hosted"}"#), Some(Line::Conflict(With::Hosted)));
        assert_eq!(parse_line(r#"{"type":"conflict","with":"copy"}"#), Some(Line::Conflict(With::Copy)));
        assert_eq!(parse_line(r#"{"type":"conflict"}"#), Some(Line::Conflict(With::Copy)));
        assert_eq!(parse_line(r#"{"type":"locked","left":3}"#), Some(Line::Locked(Some(3))));
        assert_eq!(parse_line(r#"{"type":"locked"}"#), Some(Line::Locked(None)));
        assert_eq!(parse_line(r#"{"type":"open-settings","page":"general"}"#), Some(Line::OpenSettings(Some("general".into()))));
        // A page that would not make a section opens the scope's first page.
        assert_eq!(parse_line(r#"{"type":"open-settings","page":"../Wheel"}"#), Some(Line::OpenSettings(None)));
        assert_eq!(parse_line(r#"{"type":"open-settings"}"#), Some(Line::OpenSettings(None)));
        for line in ["", "ready", r#"{"type":"log","text":"x"}"#, r#"{"type":5}"#, "[1]", r#"{"type":"ready""#] {
            assert_eq!(parse_line(line), None, "{line}");
        }
        assert_eq!(section(None), "pomelo");
        assert_eq!(section(Some("wheel")), "pomelo-wheel");
    }

    #[test]
    fn restarts_at_most_three_times_in_five_minutes() {
        let t0 = Instant::now();
        let at = |s: u64| t0 + Duration::from_secs(s);
        let mut falls = Vec::new();
        assert_eq!(after_exit(1, false, &mut falls, at(0)), Phase::Starting);
        // Dead without a code.
        assert_eq!(after_exit(-1, false, &mut falls, at(10)), Phase::Starting);
        assert_eq!(after_exit(0xC000_0005_u32 as i32, false, &mut falls, at(20)), Phase::Starting);
        assert_eq!(after_exit(1, false, &mut falls, at(30)), Phase::Crashed);
        // Falls older than five minutes no longer count.
        let mut falls = vec![at(0), at(10), at(20)];
        assert_eq!(after_exit(1, false, &mut falls, at(305)), Phase::Starting);
        assert_eq!(falls.len(), 3);
        // A conflict, an exit Pomelo chose and a refused start never restart, and use up no restart.
        let mut falls = Vec::new();
        assert_eq!(after_exit(CONFLICT_EXIT, false, &mut falls, at(0)), Phase::Conflict);
        assert_eq!(after_exit(0, true, &mut falls, at(0)), Phase::Conflict);
        assert_eq!(after_exit(0, false, &mut falls, at(0)), Phase::Stopped);
        assert_eq!(after_exit(USAGE_EXIT, false, &mut falls, at(0)), Phase::Failed);
        assert!(falls.is_empty());
    }

    #[test]
    fn settings_arguments_from_checked_inputs_only() {
        let data = Path::new(r"C:\data\pomelo");
        let strings = |a: Vec<OsString>| a.into_iter().map(|s| s.into_string().unwrap()).collect::<Vec<_>>();
        assert_eq!(strings(settings_args(data, "schema", None, None, Some("it")).unwrap()), ["settings", "schema", "--data", r"C:\data\pomelo", "--lang", "it"]);
        assert_eq!(strings(settings_args(data, "schema", None, None, Some("--x")).unwrap()).len(), 4);
        assert_eq!(strings(settings_args(data, "get", None, None, None).unwrap()), ["settings", "get", "--data", r"C:\data\pomelo"]);
        let set = |key: &str, v: Value| settings_args(data, "set", Some(key), Some(&v), None);
        assert_eq!(strings(set("wheel.size", serde_json::json!(120)).unwrap())[4..], ["--key", "wheel.size", "--value", "120"]);
        assert_eq!(strings(set("a", serde_json::json!("x\ny \"z\"")).unwrap())[7], r#""x\ny \"z\"""#);
        assert_eq!(strings(set("list", serde_json::json!(["a", "b"])).unwrap())[7], r#"["a","b"]"#);
        assert_eq!(set("--key", serde_json::json!(1)).unwrap_err(), "key");
        assert_eq!(set("bad key", serde_json::json!(1)).unwrap_err(), "key");
        assert_eq!(set("big", serde_json::json!("x".repeat(MAX_VALUE))).unwrap_err(), "value");
        assert_eq!(settings_args(data, "set", Some("a"), None, None).unwrap_err(), "value");
        assert_eq!(settings_args(data, "reset", None, None, None).unwrap_err(), "action");
    }

    #[test]
    fn hosted_arguments() {
        let args = hosted_args(Path::new(r"C:\d"), Some("pt-BR"));
        let pid = std::process::id().to_string();
        assert_eq!(args, ["--hosted", "--data", r"C:\d", "--parent", pid.as_str(), "--lang", "pt-BR"].map(OsString::from));
        assert_eq!(hosted_args(Path::new(r"C:\d"), Some("x y")).len(), 5);
    }

    /// The fake wheel's lines, read the way `run` reads them, and its exit code.
    fn fake_run(mode: &str) -> (Vec<Line>, i32) {
        let mut child = command(&fake(), &[mode.into()]).spawn().unwrap();
        let job = Job::tied(&child);
        let out = child.stdout.take().unwrap();
        let lines = BufReader::new(out).lines().map_while(Result::ok).filter_map(|l| parse_line(&l)).collect();
        let code = child.wait().unwrap().code().unwrap();
        drop(job);
        (lines, code)
    }

    #[test]
    fn reads_the_fake_wheel() {
        let (lines, code) = fake_run("ready");
        assert_eq!(lines, [Line::Ready, Line::Locked(Some(4)), Line::OpenSettings(Some("general".into()))]);
        assert_eq!(after_exit(code, false, &mut Vec::new(), Instant::now()), Phase::Starting);
        let (lines, code) = fake_run("conflict");
        assert_eq!((lines.as_slice(), code), ([Line::Conflict(With::Store)].as_slice(), CONFLICT_EXIT));
        let (lines, code) = fake_run("quit");
        assert_eq!((lines.as_slice(), after_exit(code, false, &mut Vec::new(), Instant::now())), ([Line::Ready].as_slice(), Phase::Stopped));
    }

    #[test]
    fn a_tied_job_ends_the_wheel_when_dropped() {
        let mut child = command(&fake(), &["hang".into()]).spawn().unwrap();
        let job = Job::tied(&child).expect("a job");
        let start = Instant::now();
        drop(job);
        child.wait().unwrap();
        assert!(start.elapsed() < Duration::from_secs(10), "{:?}", start.elapsed());
    }
}
