//! crest-notify: sends a notice to the running Crest over its per-user named pipe.
//!
//!   crest-notify "Build finished" -b "Tests passed"
//!   crest-notify "Deploying" -r deploy -p 40
//!   crest-notify run -- cargo test
//!
//! Exit codes: 0 delivered, 1 usage error, 2 rejected (invalid or rate limited), 3 Crest not running, notices off,
//! or no answer in time. `run` returns the command's own exit code.

#[path = "../notify_wire.rs"]
mod notify_wire;

use std::io::{Read, Write};
use std::process::ExitCode;
use std::time::{Duration, Instant};

use notify_wire::{Reply, Request};

const USAGE: &str = "Usage:
  crest-notify <title> [-b|--body <text>] [-s|--source <name>] [-r|--replace <key>] [-p|--progress <0-100>]
  crest-notify run [-s <name>] [-r <key>] -- <command> [args...]

  -j, --json <text|->  take the body from an agent hook's JSON (\"message\" or
                       \"last-assistant-message\"); - reads it from standard input.
                       --body is used when the JSON has neither.
  -q, --quiet          print nothing and always exit 0 (for hooks); with run, the
                       command's exit code is still returned.

Sends a notice to Crest. The same --replace key updates the notice shown before.
Exit codes: 0 delivered, 1 usage error, 2 rejected, 3 Crest not running or notices off.
`run` returns the command's exit code. A command Windows cannot start directly (a .cmd
script such as npm) is run through cmd /d /c, which parses & | ^ < > in its arguments.";

static QUIET: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// eprintln unless --quiet.
macro_rules! say {
    ($($t:tt)*) => {
        if !QUIET.load(std::sync::atomic::Ordering::Relaxed) {
            eprintln!($($t)*);
        }
    };
}

/// --quiet among crest-notify's own options (a -q after `--` belongs to the command).
fn is_quiet(args: &[String]) -> bool {
    args.iter().take_while(|a| *a != "--").any(|a| a == "-q" || a == "--quiet")
}

#[derive(Debug, PartialEq)]
enum Command {
    Help,
    /// The request and a --json value ("-" = standard input) to take the body from.
    Send(Request, Option<String>),
    Run(Request, Vec<String>),
}

fn parse_args(args: &[String]) -> Result<Command, String> {
    let mut r = Request::default();
    let mut words: Vec<String> = Vec::new();
    let mut run = false;
    let mut json = None;
    let mut i = 0;
    let value = |i: usize, flag: &str| args.get(i + 1).cloned().ok_or_else(|| format!("{flag} needs a value"));
    while i < args.len() {
        let a = args[i].as_str();
        match a {
            "-h" | "--help" => return Ok(Command::Help),
            // Read by is_quiet.
            "-q" | "--quiet" => {}
            "run" if i == 0 => run = true,
            "--" if run => {
                let command: Vec<String> = args[i + 1..].to_vec();
                if command.is_empty() {
                    return Err("run needs a command after --".into());
                }
                return Ok(Command::Run(r, command));
            }
            "-b" | "--body" => {
                r.body = Some(value(i, a)?);
                i += 1;
            }
            "-j" | "--json" => {
                json = Some(value(i, a)?);
                i += 1;
            }
            "-s" | "--source" => {
                r.source = Some(value(i, a)?);
                i += 1;
            }
            "-r" | "--replace" => {
                r.replace = Some(value(i, a)?);
                i += 1;
            }
            "-p" | "--progress" => {
                let p: f64 = value(i, a)?.parse().map_err(|_| "progress must be a number from 0 to 100".to_string())?;
                if !p.is_finite() || !(0.0..=100.0).contains(&p) {
                    return Err("progress must be a number from 0 to 100".into());
                }
                r.progress = Some(p);
                i += 1;
            }
            _ if a.starts_with('-') && a.len() > 1 => return Err(format!("unknown option {a}")),
            _ => words.push(a.to_string()),
        }
        i += 1;
    }
    if run {
        return Err("run needs -- before the command".into());
    }
    if !words.is_empty() {
        r.title = Some(words.join(" "));
    }
    if r.title.is_none() && r.body.is_none() && json.is_none() {
        return Err("a title or --body is needed".into());
    }
    Ok(Command::Send(r, json))
}

/// The --json value: the text itself, or standard input for "-" (a hook writes its event there and closes it).
fn read_json(spec: &str) -> Option<String> {
    if spec != "-" {
        return Some(spec.to_string());
    }
    let mut text = String::new();
    std::io::stdin().take(notify_wire::MAX_FRAME as u64 * 16).read_to_string(&mut text).ok()?;
    Some(text)
}

/// The message in an agent hook's event: `message`, `last-assistant-message` or `last_assistant_message`. None when
/// there is none of them, so the --body given as a fallback stays.
fn body_from_json(text: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    ["message", "last-assistant-message", "last_assistant_message"]
        .iter()
        .find_map(|k| value.get(k).and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string))
}

/// Whether the process at the server end of the pipe runs as this user. Another account could create the pipe name
/// first (pipe names are shared by the whole machine); its notices would go to that account.
fn server_is_ours(pipe: &std::fs::File, sid: &str) -> bool {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::Pipes::GetNamedPipeServerProcessId;
    let mut pid = 0u32;
    if unsafe { GetNamedPipeServerProcessId(HANDLE(pipe.as_raw_handle()), &mut pid) }.is_err() {
        return false;
    }
    notify_wire::pid_sid(pid).as_deref() == Some(sid)
}

/// Sends one request and waits for the reply; the exit code for the outcome.
fn send(request: &Request) -> u8 {
    let Some(line) = notify_wire::encode(request) else {
        say!("crest-notify: the notice is larger than 64 KB");
        return 1;
    };
    let Some((session, sid)) = notify_wire::identity() else {
        say!("crest-notify: cannot read the current user");
        return 3;
    };
    let name = notify_wire::pipe_name(session, &sid);
    // The server opens the next instance right after taking a client; a busy pipe (error 231) only waits a moment.
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut pipe = loop {
        use std::os::windows::fs::OpenOptionsExt;
        // Identification only: a server that is not Crest cannot act as this user with our handle.
        let qos = windows::Win32::Storage::FileSystem::SECURITY_IDENTIFICATION.0;
        match std::fs::OpenOptions::new().read(true).write(true).security_qos_flags(qos).open(&name) {
            Ok(p) => break p,
            Err(e) if e.raw_os_error() == Some(231) && Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => {
                say!("crest-notify: Crest is not running, or live notices are off");
                return 3;
            }
        }
    };
    if !server_is_ours(&pipe, &sid) {
        say!("crest-notify: the notice channel belongs to another user; nothing was sent");
        return 3;
    }
    if pipe.write_all(&line).and_then(|_| pipe.flush()).is_err() {
        say!("crest-notify: Crest closed the connection");
        return 3;
    }
    // Read on a thread so a Crest that hangs cannot hold the caller (a hook, a build script) for long.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 512];
        while let Ok(n) = pipe.read(&mut chunk) {
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n]);
            if buf.contains(&b'\n') || buf.len() > 4096 {
                break;
            }
        }
        let _ = tx.send(buf);
    });
    let Ok(buf) = rx.recv_timeout(Duration::from_secs(3)) else {
        say!("crest-notify: Crest did not answer in time");
        return 3;
    };
    let reply = match notify_wire::take_line(&buf) {
        notify_wire::Frame::Line(l) => serde_json::from_slice::<Reply>(&l).ok(),
        _ => None,
    };
    match reply.as_ref().map(|r| r.result.as_str()) {
        Some("accepted") => 0,
        Some("limited") => {
            say!("crest-notify: too many notices, try again in a few seconds");
            2
        }
        Some("rejected") => {
            let why = reply.and_then(|r| r.reason).unwrap_or_default();
            say!("crest-notify: notice rejected ({why})");
            2
        }
        Some("off") => {
            say!("crest-notify: live notices are off in Crest");
            3
        }
        _ => {
            say!("crest-notify: unexpected answer from Crest");
            3
        }
    }
}

fn run(mut request: Request, command: Vec<String>) -> ExitCode {
    let started = Instant::now();
    let mut status = std::process::Command::new(&command[0]).args(&command[1..]).status();
    // Windows only finds .exe files this way; npm, yarn and other .cmd scripts need cmd.
    if matches!(&status, Err(e) if e.kind() == std::io::ErrorKind::NotFound) {
        status = std::process::Command::new("cmd").args(["/d", "/c"]).args(&command).status();
    }
    let (code, failed_to_start) = match status {
        Ok(s) => (s.code().unwrap_or(1), false),
        Err(e) => {
            say!("crest-notify: cannot start {}: {e}", command[0]);
            (127, true)
        }
    };
    request.command = Some(command.join(" "));
    request.exit_code = Some(code);
    request.duration_ms = Some(if failed_to_start { 0 } else { started.elapsed().as_millis() as u64 });
    // The command's result matters more than whether the notice arrived.
    let _ = send(&request);
    // The full 32-bit code (a crash's 0xC0000005 must not come back as 0).
    std::process::exit(code)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let quiet = is_quiet(&args);
    QUIET.store(quiet, std::sync::atomic::Ordering::Relaxed);
    // A hook that fails can stop or warn its agent; --quiet never does.
    let code = outcome(&args);
    if quiet {
        ExitCode::SUCCESS
    } else {
        code
    }
}

fn outcome(args: &[String]) -> ExitCode {
    match parse_args(args) {
        Ok(Command::Help) => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        Ok(Command::Send(mut r, json)) => {
            if let Some(text) = json.and_then(|j| read_json(&j)).and_then(|t| body_from_json(&t)) {
                r.body = Some(text);
            }
            if r.title.is_none() && r.body.is_none() {
                say!("crest-notify: the JSON had no message and no title or --body was given");
                return ExitCode::from(1);
            }
            ExitCode::from(send(&r))
        }
        Ok(Command::Run(r, command)) => run(r, command),
        Err(e) => {
            say!("crest-notify: {e}\n\n{USAGE}");
            ExitCode::from(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn send_args() {
        let Ok(Command::Send(r, None)) = parse_args(&args(&["Build", "done", "-b", "ok", "-r", "b1", "-p", "40"])) else { panic!() };
        assert_eq!(r.title.as_deref(), Some("Build done"));
        assert_eq!(r.body.as_deref(), Some("ok"));
        assert_eq!(r.replace.as_deref(), Some("b1"));
        assert_eq!(r.progress, Some(40.0));
        assert!(matches!(parse_args(&args(&["--body", "only"])), Ok(Command::Send(_, None))));
        assert_eq!(parse_args(&args(&["-h"])), Ok(Command::Help));
    }

    #[test]
    fn errors() {
        assert!(parse_args(&args(&[])).is_err());
        assert!(parse_args(&args(&["t", "-b"])).is_err());
        assert!(parse_args(&args(&["t", "-p", "120"])).is_err());
        assert!(parse_args(&args(&["t", "-p", "NaN"])).is_err());
        assert!(parse_args(&args(&["t", "--nope"])).is_err());
        assert!(parse_args(&args(&["run", "cargo"])).is_err());
        assert!(parse_args(&args(&["run", "--"])).is_err());
    }

    #[test]
    fn run_args() {
        let Ok(Command::Run(r, cmd)) = parse_args(&args(&["run", "-s", "CI", "--", "cargo", "test", "-q"])) else { panic!() };
        assert_eq!(r.source.as_deref(), Some("CI"));
        assert_eq!(cmd, args(&["cargo", "test", "-q"]));
        // A word "run" later is part of the title.
        assert!(matches!(parse_args(&args(&["Tests", "run"])), Ok(Command::Send(_, None))));
    }

    #[test]
    fn agent_json() {
        // An agent that appends its event as the last argument fills --json.
        let Ok(Command::Send(r, Some(j))) = parse_args(&args(&["Agent", "-s", "Agent", "--json", r#"{"type":"turn-complete","last-assistant-message":"Done."}"#])) else { panic!() };
        assert_eq!(r.title.as_deref(), Some("Agent"));
        assert_eq!(body_from_json(&j).as_deref(), Some("Done."));
        assert!(matches!(parse_args(&args(&["--json", "-"])), Ok(Command::Send(_, Some(_)))));
        assert_eq!(body_from_json(r#"{"hook_event_name":"Notification","message":" Needs input "}"#).as_deref(), Some("Needs input"));
        assert_eq!(body_from_json(r#"{"hook_event_name":"Stop"}"#), None);
        assert_eq!(body_from_json("not json"), None);
    }

    #[test]
    fn quiet() {
        assert!(is_quiet(&args(&["t", "--quiet"])));
        assert!(is_quiet(&args(&["run", "-q", "--", "cargo", "test"])));
        // A -q after -- belongs to the command.
        assert!(!is_quiet(&args(&["run", "--", "cargo", "test", "-q"])));
        assert!(matches!(parse_args(&args(&["t", "-q"])), Ok(Command::Send(r, None)) if r.title.as_deref() == Some("t")));
    }
}
