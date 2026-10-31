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

Sends a notice to Crest. The same --replace key updates the notice shown before.
Exit codes: 0 delivered, 1 usage error, 2 rejected, 3 Crest not running or notices off.
`run` returns the command's exit code.";

#[derive(Debug, PartialEq)]
enum Command {
    Help,
    Send(Request),
    Run(Request, Vec<String>),
}

fn parse_args(args: &[String]) -> Result<Command, String> {
    let mut r = Request::default();
    let mut words: Vec<String> = Vec::new();
    let mut run = false;
    let mut i = 0;
    let value = |i: usize, flag: &str| args.get(i + 1).cloned().ok_or_else(|| format!("{flag} needs a value"));
    while i < args.len() {
        let a = args[i].as_str();
        match a {
            "-h" | "--help" => return Ok(Command::Help),
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
    if r.title.is_none() && r.body.is_none() {
        return Err("a title or --body is needed".into());
    }
    Ok(Command::Send(r))
}

/// Sends one request and waits for the reply; the exit code for the outcome.
fn send(request: &Request) -> u8 {
    let Some(line) = notify_wire::encode(request) else {
        eprintln!("crest-notify: the notice is larger than 64 KB");
        return 1;
    };
    let Some((session, sid)) = notify_wire::identity() else {
        eprintln!("crest-notify: cannot read the current user");
        return 3;
    };
    let name = notify_wire::pipe_name(session, &sid);
    // The server opens the next instance right after taking a client; a busy pipe (error 231) only waits a moment.
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut pipe = loop {
        match std::fs::OpenOptions::new().read(true).write(true).open(&name) {
            Ok(p) => break p,
            Err(e) if e.raw_os_error() == Some(231) && Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => {
                eprintln!("crest-notify: Crest is not running, or live notices are off");
                return 3;
            }
        }
    };
    if pipe.write_all(&line).and_then(|_| pipe.flush()).is_err() {
        eprintln!("crest-notify: Crest closed the connection");
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
        eprintln!("crest-notify: Crest did not answer in time");
        return 3;
    };
    let reply = match notify_wire::take_line(&buf) {
        notify_wire::Frame::Line(l) => serde_json::from_slice::<Reply>(&l).ok(),
        _ => None,
    };
    match reply.as_ref().map(|r| r.result.as_str()) {
        Some("accepted") => 0,
        Some("limited") => {
            eprintln!("crest-notify: too many notices, try again in a few seconds");
            2
        }
        Some("rejected") => {
            let why = reply.and_then(|r| r.reason).unwrap_or_default();
            eprintln!("crest-notify: notice rejected ({why})");
            2
        }
        Some("off") => {
            eprintln!("crest-notify: live notices are off in Crest");
            3
        }
        _ => {
            eprintln!("crest-notify: unexpected answer from Crest");
            3
        }
    }
}

fn run(mut request: Request, command: Vec<String>) -> ExitCode {
    let started = Instant::now();
    let status = std::process::Command::new(&command[0]).args(&command[1..]).status();
    let (code, failed_to_start) = match status {
        Ok(s) => (s.code().unwrap_or(1), false),
        Err(e) => {
            eprintln!("crest-notify: cannot start {}: {e}", command[0]);
            (127, true)
        }
    };
    request.command = Some(command.join(" "));
    request.exit_code = Some(code);
    request.duration_ms = Some(if failed_to_start { 0 } else { started.elapsed().as_millis() as u64 });
    // The command's result matters more than whether the notice arrived.
    let _ = send(&request);
    ExitCode::from(code.clamp(0, 255) as u8)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match parse_args(&args) {
        Ok(Command::Help) => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        Ok(Command::Send(r)) => ExitCode::from(send(&r)),
        Ok(Command::Run(r, command)) => run(r, command),
        Err(e) => {
            eprintln!("crest-notify: {e}\n\n{USAGE}");
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
        let Ok(Command::Send(r)) = parse_args(&args(&["Build", "done", "-b", "ok", "-r", "b1", "-p", "40"])) else { panic!() };
        assert_eq!(r.title.as_deref(), Some("Build done"));
        assert_eq!(r.body.as_deref(), Some("ok"));
        assert_eq!(r.replace.as_deref(), Some("b1"));
        assert_eq!(r.progress, Some(40.0));
        assert!(matches!(parse_args(&args(&["--body", "only"])), Ok(Command::Send(_))));
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
        assert!(matches!(parse_args(&args(&["Tests", "run"])), Ok(Command::Send(_))));
    }
}
