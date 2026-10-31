//! The crest-notify protocol, shared by the app (notices.rs) and the crest-notify binary (src/bin/crest-notify.rs).
//! One JSON object per line, at most MAX_FRAME bytes; the server answers with one reply line.
//! Each side uses only part of this file.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

pub const MAX_FRAME: usize = 64 * 1024;
pub const MAX_TITLE: usize = 256;
pub const MAX_BODY: usize = 4000;
pub const MAX_FIELD: usize = 128;
pub const RATE_MAX: usize = 200;
pub const RATE_WINDOW_MS: u64 = 10_000;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// Who sent it ("Build", "Tests"); shown as the app name and used for the per-app rule.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// A later notice with the same source and key replaces the earlier one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replace: Option<String>,
    /// 0 to 100.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<f64>,
    /// `crest-notify run`: the frontend words the result itself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Reply {
    /// accepted | rejected | limited | off
    pub result: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl Reply {
    pub fn new(result: &str, reason: Option<&str>) -> Self {
        Reply { result: result.into(), reason: reason.map(Into::into) }
    }
}

/// The request as one line, or None when it would not fit in a frame.
pub fn encode<T: Serialize>(value: &T) -> Option<Vec<u8>> {
    let mut line = serde_json::to_vec(value).ok()?;
    line.push(b'\n');
    (line.len() <= MAX_FRAME).then_some(line)
}

#[derive(Debug, PartialEq)]
pub enum Frame {
    /// No newline yet and still within the bound: read more.
    Incomplete,
    /// The line without its newline.
    Line(Vec<u8>),
    /// Over MAX_FRAME without a newline: the connection is dropped.
    TooLong,
}

/// Takes the first line out of what was read so far.
pub fn take_line(buf: &[u8]) -> Frame {
    match buf.iter().position(|&b| b == b'\n') {
        Some(i) if i < MAX_FRAME => Frame::Line(buf[..i].to_vec()),
        Some(_) => Frame::TooLong,
        None if buf.len() >= MAX_FRAME => Frame::TooLong,
        None => Frame::Incomplete,
    }
}

/// Parses and checks one line. Texts are trimmed and cut to their limits; control characters other than newline and
/// tab are removed (they could reorder or hide text in the notch).
pub fn parse(line: &[u8]) -> Result<Request, &'static str> {
    let mut r: Request = serde_json::from_slice(line).map_err(|_| "invalid-json")?;
    r.title = clean(r.title, MAX_TITLE, false);
    r.body = clean(r.body, MAX_BODY, true);
    r.source = clean(r.source, MAX_FIELD, false);
    r.command = clean(r.command, MAX_FIELD, false);
    r.replace = clean(r.replace, MAX_FIELD, false);
    if r.title.is_none() && r.body.is_none() && r.command.is_none() {
        return Err("empty");
    }
    if let Some(p) = r.progress {
        if !p.is_finite() || !(0.0..=100.0).contains(&p) {
            return Err("progress");
        }
    }
    Ok(r)
}

pub fn clean(text: Option<String>, max: usize, multiline: bool) -> Option<String> {
    let kept: String = text?
        .chars()
        .map(|c| if c == '\t' || (c == '\n' && !multiline) { ' ' } else { c })
        .filter(|&c| c == '\n' || !c.is_control())
        .filter(|&c| !matches!(c, '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}'))
        .collect();
    let trimmed = kept.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(max).collect())
}

/// At most RATE_MAX notices in any RATE_WINDOW_MS, across all senders.
pub struct RateLimiter {
    times: std::collections::VecDeque<u64>,
}

impl RateLimiter {
    pub fn new() -> Self {
        RateLimiter { times: Default::default() }
    }

    /// Counts the notice when it may pass.
    pub fn allow(&mut self, now_ms: u64) -> bool {
        while self.times.front().is_some_and(|&t| now_ms.saturating_sub(t) >= RATE_WINDOW_MS) {
            self.times.pop_front();
        }
        if self.times.len() >= RATE_MAX {
            return false;
        }
        self.times.push_back(now_ms);
        true
    }
}

/// Per logon session and per user: another account's senders cannot reach this Crest, and two sessions do not collide.
pub fn pipe_name(session: u32, sid: &str) -> String {
    format!(r"\\.\pipe\crest-notify-{session}-{sid}")
}

/// The current user's SID ("S-1-5-21-…") and logon session id.
#[cfg(windows)]
pub fn identity() -> Option<(u32, String)> {
    use windows::Win32::System::RemoteDesktop::ProcessIdToSessionId;
    use windows::Win32::System::Threading::{GetCurrentProcess, GetCurrentProcessId};
    unsafe {
        let mut session = 0u32;
        ProcessIdToSessionId(GetCurrentProcessId(), &mut session).ok()?;
        Some((session, process_sid(GetCurrentProcess())?))
    }
}

/// The user SID of another process, or None when it cannot be opened (another user's process usually cannot).
#[cfg(windows)]
pub fn pid_sid(pid: u32) -> Option<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let sid = process_sid(process);
        let _ = CloseHandle(process);
        sid
    }
}

#[cfg(windows)]
unsafe fn process_sid(process: windows::Win32::Foundation::HANDLE) -> Option<String> {
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HLOCAL, LocalFree};
    use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
    use windows::Win32::System::Threading::OpenProcessToken;
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(process, TOKEN_QUERY, &mut token).ok()?;
        let mut size = 0u32;
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut size);
        let mut buf = vec![0u8; size as usize];
        let ok = GetTokenInformation(token, TokenUser, Some(buf.as_mut_ptr().cast()), size, &mut size);
        let _ = CloseHandle(token);
        ok.ok()?;
        let user = &*(buf.as_ptr() as *const TOKEN_USER);
        let mut text = windows::core::PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut text).ok()?;
        let sid = text.to_string().ok();
        let _ = LocalFree(Some(HLOCAL(text.0.cast())));
        sid
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn framing() {
        assert_eq!(take_line(b"{\"a\":1}"), Frame::Incomplete);
        assert_eq!(take_line(b"{}\nrest"), Frame::Line(b"{}".to_vec()));
        assert_eq!(take_line(&vec![b'x'; MAX_FRAME]), Frame::TooLong);
        let mut long = vec![b'x'; MAX_FRAME];
        long.push(b'\n');
        assert_eq!(take_line(&long), Frame::TooLong);
        let mut fits = vec![b'x'; MAX_FRAME - 1];
        fits.push(b'\n');
        assert!(matches!(take_line(&fits), Frame::Line(l) if l.len() == MAX_FRAME - 1));
    }

    #[test]
    fn round_trip() {
        let r = Request { title: Some("Build".into()), progress: Some(40.0), replace: Some("b".into()), ..Default::default() };
        let line = encode(&r).unwrap();
        assert_eq!(*line.last().unwrap(), b'\n');
        assert_eq!(parse(&line[..line.len() - 1]).unwrap(), r);
        let huge = Request { body: Some("x".repeat(MAX_FRAME)), ..Default::default() };
        assert!(encode(&huge).is_none());
    }

    #[test]
    fn validation() {
        assert_eq!(parse(b"nope"), Err("invalid-json"));
        assert_eq!(parse(b"{}"), Err("empty"));
        assert_eq!(parse(br#"{"title":"   "}"#), Err("empty"));
        assert_eq!(parse(br#"{"title":"a","progress":101}"#), Err("progress"));
        assert_eq!(parse(br#"{"title":"a","progress":-1}"#), Err("progress"));
        assert!(parse(br#"{"command":"cargo test","exitCode":0,"durationMs":5}"#).is_ok());
        // Unknown fields are ignored, so a newer crest-notify still talks to an older Crest.
        assert!(parse(br#"{"title":"a","later":true}"#).is_ok());
        let r = parse(format!(r#"{{"title":" {} ","body":"a\u0007b\nc\u202e"}}"#, "t".repeat(300)).as_bytes()).unwrap();
        assert_eq!(r.title.unwrap().chars().count(), MAX_TITLE);
        assert_eq!(r.body.unwrap(), "ab\nc");
        assert_eq!(parse(br#"{"title":"a\nb"}"#).unwrap().title.unwrap(), "a b");
    }

    #[test]
    fn rate_limit() {
        let mut r = RateLimiter::new();
        for i in 0..RATE_MAX as u64 {
            assert!(r.allow(i));
        }
        assert!(!r.allow(500));
        assert!(!r.allow(RATE_WINDOW_MS - 1));
        // The first one leaves the window: one more fits.
        assert!(r.allow(RATE_WINDOW_MS));
        assert!(!r.allow(RATE_WINDOW_MS));
        assert!(r.allow(RATE_WINDOW_MS * 3));
    }

    #[test]
    fn pipe() {
        assert_eq!(pipe_name(1, "S-1-5-21-1"), r"\\.\pipe\crest-notify-1-S-1-5-21-1");
    }
}
