//! Agents tool: the Claude Code sessions on this PC, read from the CLI's own `claude agents --json`, which Claude Code
//! documents as the way to read them from outside. Only that command's output is used: no hooks, nothing from
//! `~/.claude`, no sign-in.
//!
//! The CLI is found here, started with fixed arguments and no shell (so there is nothing to inject into), without a
//! console window, and ended after TIMEOUT. The page parses the text (src/features/agents/sessions.ts).
//! Errors are codes the page turns into text: not-found, too-old, timeout, too-big, busy, failed.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const ARGS: [&str; 2] = ["agents", "--json"];
const TIMEOUT: Duration = Duration::from_secs(5);
/// A list of hundreds of sessions is a few hundred KB; more than this is not that.
const MAX_OUTPUT: usize = 1024 * 1024;
/// Enough of stderr to tell an old CLI from a failing one.
const MAX_ERR: usize = 4096;
/// Once the process has ended, how long its pipes may still hand over the last bytes.
const GRACE: Duration = Duration::from_millis(300);

/// One run at a time; the page asks again only after an answer, this keeps a bug there from piling up processes.
static RUNNING: AtomicBool = AtomicBool::new(false);

struct Busy;

impl Drop for Busy {
    fn drop(&mut self) {
        RUNNING.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
pub async fn agents_list() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(list).await.map_err(|_| "failed".to_string())?.map_err(String::from)
}

fn list() -> Result<String, &'static str> {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Err("busy");
    }
    let _busy = Busy;
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
    let found = candidates(std::env::var_os("PATH").as_deref(), home().as_deref(), appdata.as_deref());
    for exe in found.iter().filter(|p| p.is_file()) {
        match run(exe, &ARGS, TIMEOUT, MAX_OUTPUT) {
            // Listed but not startable (no right to run it): the next candidate may be the working one.
            Err("not-started") => continue,
            done => return done,
        }
    }
    Err("not-found")
}

/// The user's home folder, the same on Windows and a Mac.
fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// Where `claude` may be, in the order a shell finds it: PATH first, then the folders the installers use. Those cover a
/// PC whose PATH, as this process got it, is older than the install (Crest starts with Windows), and a Mac app opened
/// from the Finder, which has no shell PATH. Only absolute folders: a relative one would depend on the working folder.
fn candidates(path: Option<&std::ffi::OsStr>, home: Option<&Path>, appdata: Option<&Path>) -> Vec<PathBuf> {
    let names: &[&str] = if cfg!(windows) { &["claude.exe", "claude.cmd"] } else { &["claude"] };
    let mut dirs: Vec<PathBuf> = path.map(|p| std::env::split_paths(p).collect()).unwrap_or_default();
    if let Some(home) = home {
        dirs.push(home.join(".local").join("bin"));
        if !cfg!(windows) {
            dirs.push(PathBuf::from("/opt/homebrew/bin"));
            dirs.push(PathBuf::from("/usr/local/bin"));
            dirs.push(home.join(".claude").join("local"));
            dirs.push(home.join(".npm-global").join("bin"));
        }
    }
    if let Some(appdata) = appdata.filter(|_| cfg!(windows)) {
        dirs.push(appdata.join("npm"));
    }
    let mut out: Vec<PathBuf> = Vec::new();
    for dir in dirs.into_iter().filter(|d| d.is_absolute()) {
        for name in names {
            let exe = dir.join(name);
            if !out.contains(&exe) {
                out.push(exe);
            }
        }
    }
    out
}

/// A pipe read on its own thread, at most `cap` bytes of it kept.
struct Pipe {
    bytes: Mutex<Vec<u8>>,
    over: AtomicBool,
}

impl Pipe {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.bytes.lock().unwrap_or_else(|e| e.into_inner())).into_owned()
    }
}

/// Past the cap the read stops (`stop_when_over`: the caller ends the process) or the rest is dropped (stderr, which
/// must still be emptied so the process never blocks on it).
fn drain(mut src: impl Read + Send + 'static, cap: usize, stop_when_over: bool) -> (Arc<Pipe>, JoinHandle<()>) {
    let pipe = Arc::new(Pipe { bytes: Mutex::new(Vec::new()), over: AtomicBool::new(false) });
    let mine = pipe.clone();
    let reader = thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        while let Ok(n) = src.read(&mut chunk) {
            if n == 0 {
                break;
            }
            let mut bytes = mine.bytes.lock().unwrap_or_else(|e| e.into_inner());
            let room = cap.saturating_sub(bytes.len());
            bytes.extend_from_slice(&chunk[..n.min(room)]);
            if n > room {
                mine.over.store(true, Ordering::SeqCst);
                if stop_when_over {
                    break;
                }
            }
        }
    });
    (pipe, reader)
}

/// The process, and on Windows the job that holds it: an npm `.cmd` shim runs node as a child, which ending the shim
/// alone would leave running.
struct Running {
    child: Child,
    #[cfg(windows)]
    job: Option<job::Job>,
}

impl Running {
    fn kill(&mut self) {
        #[cfg(windows)]
        if let Some(job) = &self.job {
            job.kill();
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(windows)]
mod job {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};

    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW, TerminateJobObject};

    /// Plain job, no limits: closing it ends nothing, so a finished run leaves no side effects. Only `kill` ends what it holds.
    pub struct Job(OwnedHandle);

    impl Job {
        /// None when Windows refuses (Crest itself sits in a job that forbids nesting); the process alone is ended then.
        pub fn hold(child: &std::process::Child) -> Option<Job> {
            unsafe {
                let job = OwnedHandle::from_raw_handle(CreateJobObjectW(None, None).ok()?.0);
                AssignProcessToJobObject(HANDLE(job.as_raw_handle()), HANDLE(child.as_raw_handle())).ok()?;
                Some(Job(job))
            }
        }

        pub fn kill(&self) {
            let _ = unsafe { TerminateJobObject(HANDLE(self.0.as_raw_handle()), 1) };
        }
    }
}

/// An old CLI has no `agents --json` and says so on stderr (Claude Code's own parser: "unknown option").
fn is_too_old(stderr: &str) -> bool {
    let s = stderr.to_ascii_lowercase();
    ["unknown option", "unknown command", "unknown argument", "unexpected argument"].iter().any(|p| s.contains(p))
}

fn run(exe: &Path, args: &[&str], timeout: Duration, cap: usize) -> Result<String, &'static str> {
    let mut cmd = Command::new(exe);
    // On Windows std starts a .cmd shim through cmd.exe and escapes its arguments itself; ours are fixed.
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // Claude Code treats the working folder as a project, and cmd.exe looks there first for a bare command (the `node` of
    // an npm shim): the user's home, which other users cannot write to, not Temp. Without a home the folder is Crest's own.
    if let Some(home) = home() {
        cmd.current_dir(home);
    }
    #[cfg(windows)]
    crate::convert::hide_console(&mut cmd);
    // A Mac app opened from the Finder has no shell PATH, which a node script's `env node` needs.
    #[cfg(target_os = "macos")]
    {
        let mut dirs: Vec<PathBuf> = exe.parent().map(Path::to_path_buf).into_iter().collect();
        dirs.extend(std::env::var_os("PATH").iter().flat_map(std::env::split_paths));
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
        if let Ok(path) = std::env::join_paths(dirs) {
            cmd.env("PATH", path);
        }
    }

    let mut child = cmd.spawn().map_err(|_| "not-started")?;
    let stdout = child.stdout.take().ok_or("failed")?;
    let stderr = child.stderr.take().ok_or("failed")?;
    #[cfg(windows)]
    let job = job::Job::hold(&child);
    let mut running = Running {
        child,
        #[cfg(windows)]
        job,
    };
    let (out, out_reader) = drain(stdout, cap, true);
    let (err, err_reader) = drain(stderr, MAX_ERR, false);

    let deadline = Instant::now() + timeout;
    let status = loop {
        if out.over.load(Ordering::SeqCst) {
            running.kill();
            return Err("too-big");
        }
        match running.child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(25)),
            Ok(None) => {
                running.kill();
                return Err("timeout");
            }
            Err(_) => {
                running.kill();
                return Err("failed");
            }
        }
    };
    // The readers end with the pipes. Something the CLI started and left running can hold a pipe open: wait a moment,
    // then take what arrived rather than waiting for it.
    let until = Instant::now() + GRACE;
    while !(out_reader.is_finished() && err_reader.is_finished()) && Instant::now() < until {
        thread::sleep(Duration::from_millis(10));
    }
    // A process that still holds this run's pipes after the CLI has exited is a leftover of the run; ending the job closes
    // the pipes, or both readers would wait for it, and a poll every few seconds would add two such threads each time.
    #[cfg(windows)]
    if !(out_reader.is_finished() && err_reader.is_finished()) {
        if let Some(job) = &running.job {
            job.kill();
        }
    }
    if out.over.load(Ordering::SeqCst) {
        return Err("too-big");
    }
    if !status.success() {
        return Err(if is_too_old(&err.text()) { "too-old" } else { "failed" });
    }
    Ok(out.text())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    #[test]
    fn candidates_follow_the_path_then_the_install_folders() {
        let sep = if cfg!(windows) { ";" } else { ":" };
        let (a, b, rel) = if cfg!(windows) { (r"C:\tools", r"D:\more", "bin") } else { ("/opt/tools", "/srv/more", "bin") };
        let path = OsString::from([a, rel, b, a, ""].join(sep));
        let home = if cfg!(windows) { PathBuf::from(r"C:\Users\me") } else { PathBuf::from("/Users/me") };
        let list = candidates(Some(&path), Some(&home), Some(Path::new(r"C:\Users\me\AppData\Roaming")));

        // Relative and empty entries are left out, a repeated folder counts once, the PATH keeps its order.
        assert!(list.iter().all(|p| p.is_absolute()));
        assert_eq!(list[0].parent().unwrap(), Path::new(a));
        let first_b = list.iter().position(|p| p.parent() == Some(Path::new(b))).unwrap();
        let first_home = list.iter().position(|p| p.starts_with(&home)).unwrap();
        assert!(first_b > 0 && first_b < first_home);
        assert_eq!(list.iter().filter(|p| p.parent() == Some(Path::new(a))).count(), if cfg!(windows) { 2 } else { 1 });
        assert!(list.iter().any(|p| p.starts_with(home.join(".local").join("bin"))));
        if cfg!(windows) {
            // .exe before .cmd in the same folder; the npm folder is only looked at on Windows.
            assert!(list[0].ends_with("claude.exe") && list[1].ends_with("claude.cmd"));
            assert!(list.iter().any(|p| p.ends_with(Path::new("npm").join("claude.cmd"))));
        } else {
            assert!(list.iter().any(|p| p.starts_with("/opt/homebrew/bin")));
            assert!(!list.iter().any(|p| p.ends_with(Path::new("npm").join("claude"))));
        }
        assert!(candidates(None, None, None).is_empty());
    }

    #[test]
    fn an_old_cli_is_told_from_a_failing_one() {
        assert!(is_too_old("error: unknown option '--json'\n"));
        assert!(is_too_old("Error: Unknown command 'agents'"));
        assert!(!is_too_old("Error: not logged in"));
        assert!(!is_too_old(""));
    }

    #[test]
    fn a_pipe_keeps_the_cap_and_says_when_it_was_passed() {
        let (pipe, reader) = drain(std::io::Cursor::new(vec![b'x'; 100]), 40, false);
        reader.join().unwrap();
        assert_eq!(pipe.text().len(), 40);
        assert!(pipe.over.load(Ordering::SeqCst));
        let (pipe, reader) = drain(std::io::Cursor::new(vec![b'x'; 40]), 40, true);
        reader.join().unwrap();
        assert_eq!(pipe.text().len(), 40);
        assert!(!pipe.over.load(Ordering::SeqCst));
    }

    /// Live, needs Claude Code on this PC: `cargo test --lib agents_live -- --ignored`
    #[test]
    #[ignore]
    fn agents_live() {
        let text = list().expect("claude agents --json");
        assert!(text.trim_start().starts_with('['), "not a JSON array");
    }

    /// A small .cmd shim in a folder of its own, the way npm installs the CLI.
    #[cfg(windows)]
    fn shim(name: &str, body: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("crest-agents-test-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("claude.cmd");
        std::fs::write(&file, format!("@echo off\r\n{body}\r\n")).unwrap();
        file
    }

    #[cfg(windows)]
    #[test]
    fn a_cmd_shim_answers_without_a_console_window() {
        let exe = shim("ok", r#"echo [{"cwd":"C:\\work","kind":"interactive","startedAt":1}]"#);
        let text = run(&exe, &ARGS, Duration::from_secs(5), MAX_OUTPUT).unwrap();
        assert!(text.trim().starts_with("[{") && text.contains("interactive"), "{text}");
    }

    #[cfg(windows)]
    #[test]
    fn a_failing_or_old_cli_gets_its_code() {
        let old = shim("old", "echo error: unknown option '--json' 1>&2\r\nexit /b 1");
        assert_eq!(run(&old, &ARGS, Duration::from_secs(5), MAX_OUTPUT), Err("too-old"));
        let broken = shim("broken", "echo not logged in 1>&2\r\nexit /b 3");
        assert_eq!(run(&broken, &ARGS, Duration::from_secs(5), MAX_OUTPUT), Err("failed"));
        assert_eq!(run(Path::new(r"C:\no\such\claude.exe"), &ARGS, Duration::from_secs(5), MAX_OUTPUT), Err("not-started"));
    }

    #[cfg(windows)]
    #[test]
    fn too_much_output_ends_the_process() {
        let exe = shim("big", "for /l %%i in (1,1,5000) do echo xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
        let started = Instant::now();
        assert_eq!(run(&exe, &ARGS, Duration::from_secs(5), 1000), Err("too-big"));
        assert!(started.elapsed() < Duration::from_secs(4));
    }

    /// The shim's child (ping, holding the output pipe) must end with it, or the call would hang past the timeout.
    #[cfg(windows)]
    #[test]
    fn a_hung_cli_is_ended_with_what_it_started() {
        let exe = shim("hung", "ping -n 30 127.0.0.1");
        let started = Instant::now();
        assert_eq!(run(&exe, &ARGS, Duration::from_millis(800), MAX_OUTPUT), Err("timeout"));
        assert!(started.elapsed() < Duration::from_secs(4), "{:?}", started.elapsed());
    }
}
