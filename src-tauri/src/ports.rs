//! Listening TCP ports for the ports sheet of the Hardware tool (src/features/ports/). Reads raw facts only; grouping,
//! sorting by the user's choice and the wording are in the page.
//!
//! - Windows: `GetExtendedTcpTable` (TCP_TABLE_OWNER_PID_LISTENER, IPv4 and IPv6); the program from
//!   `QueryFullProcessImageNameW`, its owner from the process token.
//! - macOS: `lsof -nP -iTCP -sTCP:LISTEN` in field mode, with a time limit. The sheet is not shown on a Mac yet
//!   ("system" is Windows-only in src/notch/tabs.ts); the branch compiles and is tested through its parser.
//!
//! Ending a process is limited to the user's own. Never PID 0, 1 or 4, Crest itself, or anything under the Windows
//! folder. On Windows the checks and the kill act on one process handle, so a PID reused in between is never hit.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Listener {
    port: u16,
    /// "127.0.0.1", "::1", "0.0.0.0", "::" or the address of one interface.
    addr: String,
    pid: u32,
    /// Executable name ("node.exe"); empty when the system does not tell.
    name: String,
    path: Option<String>,
    /// "End process" is offered: the user's own program, not part of the system, not Crest.
    can_end: bool,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum End {
    Ended,
    /// Not allowed, or the system said no.
    Denied,
    /// No longer listening on that port.
    Gone,
}

/// PIDs that stand for the system, not for a program: Idle (0), launchd (1 on a Mac), System (4).
fn system_pid(pid: u32) -> bool {
    matches!(pid, 0 | 1 | 4)
}

/// Is `path` inside `dir` (case-insensitive, either slash)? An empty `dir` matches nothing.
fn inside(path: &str, dir: &str) -> bool {
    let dir = dir.trim_end_matches(['\\', '/']);
    !dir.is_empty() && path.get(..dir.len()).is_some_and(|head| head.eq_ignore_ascii_case(dir)) && path[dir.len()..].starts_with(['\\', '/'])
}

/// Whether the sheet may end this process: the user's own, not the system, not Crest, not a Windows component.
/// With a Windows folder to check against, a program whose path is unknown cannot be shown to be outside it: no.
fn may_end(pid: u32, own: u32, mine: bool, path: Option<&str>, windows_dir: &str) -> bool {
    mine && !system_pid(pid) && pid != own && !path.is_some_and(|p| inside(p, windows_dir)) && (path.is_some() || windows_dir.is_empty())
}

/// A page can open http://localhost:PORT for loopback and wildcard listeners only: those answer on localhost.
fn answers_on_localhost(addr: IpAddr) -> bool {
    let addr = addr.to_canonical();
    addr.is_loopback() || addr.is_unspecified()
}

/// By port, then PID, then address; the same listener twice is one.
fn finish(mut all: Vec<Listener>) -> Vec<Listener> {
    all.sort_by(|a, b| (a.port, a.pid, &a.addr).cmp(&(b.port, b.pid, &b.addr)));
    all.dedup();
    all
}

/// "[::1]:3000", "*:5173", "127.0.0.1:3000" as lsof prints them. `*` is every address of the kind in `v6`.
#[cfg(any(target_os = "macos", test))]
fn socket_name(text: &str, v6: bool) -> Option<(IpAddr, u16)> {
    if text.contains("->") {
        return None;
    }
    let (host, port) = text.rsplit_once(':')?;
    let port: u16 = port.parse().ok().filter(|p| *p != 0)?;
    let host = host.trim_start_matches('[').trim_end_matches(']');
    let addr = match host {
        "*" if v6 => IpAddr::V6(Ipv6Addr::UNSPECIFIED),
        "*" => IpAddr::V4(Ipv4Addr::UNSPECIFIED),
        // A zone ("fe80::1%lo0") is not part of the address.
        _ => host.split('%').next()?.parse().ok()?,
    };
    Some((addr, port))
}

/// lsof writes a character it cannot show as \xHH.
#[cfg(any(target_os = "macos", test))]
fn unescape(text: &str) -> String {
    let mut bytes = Vec::with_capacity(text.len());
    let raw = text.as_bytes();
    let mut i = 0;
    while i < raw.len() {
        let hex = (raw[i] == b'\\' && raw.get(i + 1) == Some(&b'x')).then(|| text.get(i + 2..i + 4).and_then(|h| u8::from_str_radix(h, 16).ok())).flatten();
        match hex {
            Some(b) => {
                bytes.push(b);
                i += 4;
            }
            None => {
                bytes.push(raw[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Output of `lsof -F pcutn`: one field per line, the first character names it (p PID, c command, u user id,
/// t IPv4/IPv6, n address). A `p` line starts a process; every `n` line after it is one listening socket.
/// A line it does not understand is skipped, so a different lsof build costs rows, not the list.
#[cfg(any(target_os = "macos", test))]
fn parse_lsof(text: &str, my_uid: Option<u32>, own: u32) -> Vec<Listener> {
    let (mut pid, mut name, mut uid, mut v6) = (None::<u32>, String::new(), None::<u32>, false);
    let mut out = Vec::new();
    for line in text.lines() {
        let mut chars = line.chars();
        let Some(tag) = chars.next() else { continue };
        let value = chars.as_str();
        match tag {
            'p' => (pid, name, uid, v6) = (value.parse().ok(), String::new(), None, false),
            'c' => name = unescape(value),
            'u' => uid = value.parse().ok(),
            't' => v6 = value == "IPv6",
            'n' => {
                if let (Some(pid), Some((addr, port))) = (pid, socket_name(value, v6)) {
                    let mine = my_uid.is_some() && uid == my_uid;
                    out.push(Listener { port, addr: addr.to_string(), pid, name: name.clone(), path: None, can_end: may_end(pid, own, mine, None, "") });
                }
                v6 = false;
            }
            _ => {}
        }
    }
    finish(out)
}

/// A Mac program that is part of macOS (ControlCenter for AirPlay, rapportd, sharingd): ending one drops AirPlay or
/// Handoff until launchd starts it again. `/usr/local` is the user's own.
#[cfg(any(target_os = "macos", test))]
fn mac_system(path: &str) -> bool {
    ["/System/", "/bin/", "/sbin/", "/Library/Apple/"].iter().any(|d| path.starts_with(d)) || (path.starts_with("/usr/") && !path.starts_with("/usr/local/"))
}

/// Output of `ps -o pid=,comm=`: "  512 /System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter" per line.
#[cfg(any(target_os = "macos", test))]
fn parse_ps(text: &str) -> std::collections::HashMap<u32, String> {
    text.lines()
        .filter_map(|line| {
            let (pid, path) = line.trim().split_once(char::is_whitespace)?;
            Some((pid.parse().ok()?, path.trim().to_string()))
        })
        .filter(|(_, path): &(u32, String)| path.starts_with('/'))
        .collect()
}

#[cfg(windows)]
mod win {
    use std::collections::HashMap;
    use std::sync::OnceLock;

    use windows::core::{HRESULT, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCP6TABLE_OWNER_PID, MIB_TCPROW_OWNER_PID, MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
    };
    use windows::Win32::Networking::WinSock::{AF_INET, AF_INET6};
    use windows::Win32::Security::{GetLengthSid, GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
    use windows::Win32::System::Threading::{
        GetCurrentProcess, GetCurrentProcessId, OpenProcess, OpenProcessToken, QueryFullProcessImageNameW, TerminateProcess, PROCESS_ACCESS_RIGHTS,
        PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };

    use super::*;

    /// ERROR_INSUFFICIENT_BUFFER and ERROR_INVALID_PARAMETER (OpenProcess on a PID that does not exist).
    const TOO_SMALL: u32 = 122;
    const NO_SUCH_PID: u32 = 87;

    /// A process or token handle, closed on drop.
    struct Handle(HANDLE);

    impl Drop for Handle {
        fn drop(&mut self) {
            let _ = unsafe { CloseHandle(self.0) };
        }
    }

    impl Handle {
        fn open(pid: u32, access: PROCESS_ACCESS_RIGHTS) -> windows::core::Result<Self> {
            unsafe { OpenProcess(access, false, pid) }.map(Self)
        }

        fn image_path(&self) -> Option<String> {
            let mut buf = [0u16; 2048];
            let mut len = buf.len() as u32;
            unsafe { QueryFullProcessImageNameW(self.0, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len) }.ok()?;
            Some(String::from_utf16_lossy(&buf[..len as usize]))
        }

        fn is_mine(&self) -> bool {
            static MINE: OnceLock<Option<Vec<u8>>> = OnceLock::new();
            let mine = MINE.get_or_init(|| user_sid(unsafe { GetCurrentProcess() }));
            mine.is_some() && *mine == user_sid(self.0)
        }
    }

    /// The SID of the user a process runs as, as bytes (two SIDs are equal when their bytes are). None when the token
    /// cannot be read, as for an elevated process of this user: it then counts as not ours.
    fn user_sid(process: HANDLE) -> Option<Vec<u8>> {
        unsafe {
            let mut token = HANDLE::default();
            OpenProcessToken(process, TOKEN_QUERY, &mut token).ok()?;
            let token = Handle(token);
            let mut size = 0u32;
            let _ = GetTokenInformation(token.0, TokenUser, None, 0, &mut size);
            // u64 keeps the buffer aligned for TOKEN_USER.
            let mut buf = vec![0u64; (size as usize).div_ceil(8)];
            GetTokenInformation(token.0, TokenUser, Some(buf.as_mut_ptr().cast()), size, &mut size).ok()?;
            let sid = (*(buf.as_ptr() as *const TOKEN_USER)).User.Sid;
            Some(std::slice::from_raw_parts(sid.0 as *const u8, GetLengthSid(sid) as usize).to_vec())
        }
    }

    fn windows_dir() -> String {
        std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into())
    }

    /// The raw table of one address family; the buffer can grow between the size query and the read.
    fn table(family: u32) -> Option<Vec<u32>> {
        let (mut buf, mut size) = (Vec::<u32>::new(), 0u32);
        for _ in 0..5 {
            let at = (!buf.is_empty()).then(|| buf.as_mut_ptr().cast());
            match unsafe { GetExtendedTcpTable(at, &mut size, false, family, TCP_TABLE_OWNER_PID_LISTENER, 0) } {
                0 => return Some(buf),
                TOO_SMALL => {
                    buf = vec![0; (size as usize).div_ceil(4) + 64];
                    size = (buf.len() * 4) as u32;
                }
                _ => return None,
            }
        }
        None
    }

    /// (address, port, PID) of every listening socket. The port sits in the low 16 bits, in network order.
    fn sockets() -> Vec<(IpAddr, u16, u32)> {
        let mut out = Vec::new();
        if let Some(buf) = table(AF_INET.0 as u32) {
            let t = buf.as_ptr() as *const MIB_TCPTABLE_OWNER_PID;
            let room = (buf.len() * 4).saturating_sub(4) / size_of::<MIB_TCPROW_OWNER_PID>();
            let rows = unsafe { std::slice::from_raw_parts(std::ptr::addr_of!((*t).table).cast::<MIB_TCPROW_OWNER_PID>(), ((*t).dwNumEntries as usize).min(room)) };
            out.extend(rows.iter().map(|r| (IpAddr::V4(Ipv4Addr::from(r.dwLocalAddr.to_ne_bytes())), u16::from_be(r.dwLocalPort as u16), r.dwOwningPid)));
        }
        if let Some(buf) = table(AF_INET6.0 as u32) {
            let t = buf.as_ptr() as *const MIB_TCP6TABLE_OWNER_PID;
            let room = (buf.len() * 4).saturating_sub(4) / size_of::<MIB_TCP6ROW_OWNER_PID>();
            let rows = unsafe { std::slice::from_raw_parts(std::ptr::addr_of!((*t).table).cast::<MIB_TCP6ROW_OWNER_PID>(), ((*t).dwNumEntries as usize).min(room)) };
            out.extend(rows.iter().map(|r| (IpAddr::V6(Ipv6Addr::from(r.ucLocalAddr)), u16::from_be(r.dwLocalPort as u16), r.dwOwningPid)));
        }
        out
    }

    struct Details {
        name: String,
        path: Option<String>,
        mine: bool,
    }

    fn details(pid: u32) -> Details {
        if pid == 4 {
            return Details { name: "System".into(), path: None, mine: false };
        }
        let Ok(process) = Handle::open(pid, PROCESS_QUERY_LIMITED_INFORMATION) else { return Details { name: String::new(), path: None, mine: false } };
        let path = process.image_path();
        let name = path.as_deref().and_then(|p| p.rsplit(['\\', '/']).next()).unwrap_or_default().to_string();
        Details { name, path, mine: process.is_mine() }
    }

    pub fn read() -> Result<Vec<Listener>, String> {
        let (own, dir) = (unsafe { GetCurrentProcessId() }, windows_dir());
        let mut known: HashMap<u32, Details> = HashMap::new();
        let all = sockets()
            .into_iter()
            .map(|(addr, port, pid)| {
                let d = known.entry(pid).or_insert_with(|| details(pid));
                Listener { port, addr: addr.to_string(), pid, name: d.name.clone(), path: d.path.clone(), can_end: may_end(pid, own, d.mine, d.path.as_deref(), &dir) }
            })
            .collect();
        Ok(finish(all))
    }

    pub fn end(pid: u32, port: u16) -> Result<End, String> {
        let own = unsafe { GetCurrentProcessId() };
        if system_pid(pid) || pid == own {
            return Ok(End::Denied);
        }
        let process = match Handle::open(pid, PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION) {
            Ok(p) => p,
            Err(e) if e.code() == HRESULT::from_win32(NO_SUCH_PID) => return Ok(End::Gone),
            Err(_) => return Ok(End::Denied),
        };
        // From here the handle holds this PID: what is checked below is the process that gets ended.
        if !sockets().iter().any(|&(_, p, owner)| p == port && owner == pid) {
            return Ok(End::Gone);
        }
        if !may_end(pid, own, process.is_mine(), process.image_path().as_deref(), &windows_dir()) {
            return Ok(End::Denied);
        }
        // A server in a console has no window to ask politely (WM_CLOSE would go nowhere), so this is the only way.
        Ok(if unsafe { TerminateProcess(process.0, 1) }.is_ok() { End::Ended } else { End::Denied })
    }

    pub fn reachable_on_localhost(port: u16) -> bool {
        sockets().iter().any(|&(addr, p, _)| p == port && answers_on_localhost(addr))
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::sync::OnceLock;
    use std::time::{Duration, Instant};

    use super::*;

    const LSOF_LIMIT: Duration = Duration::from_secs(4);

    /// Output of a program, or None when it cannot start or runs past `limit`. The exit status is not looked at:
    /// lsof exits 1 when nothing listens.
    fn run(program: &str, args: &[&str], limit: Duration) -> Option<String> {
        let mut child = Command::new(program).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
        let mut stdout = child.stdout.take()?;
        let reader = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = stdout.read_to_end(&mut bytes);
            bytes
        });
        let started = Instant::now();
        loop {
            if child.try_wait().ok()?.is_some() {
                return Some(String::from_utf8_lossy(&reader.join().ok()?).into_owned());
            }
            if started.elapsed() > limit {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn my_uid() -> Option<u32> {
        static UID: OnceLock<Option<u32>> = OnceLock::new();
        *UID.get_or_init(|| run("/usr/bin/id", &["-u"], Duration::from_secs(2))?.trim().parse().ok())
    }

    pub fn read() -> Result<Vec<Listener>, String> {
        // +c 0: the whole command name instead of the first nine characters.
        let text = run("/usr/sbin/lsof", &["+c", "0", "-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcutn"], LSOF_LIMIT).ok_or("lsof-failed")?;
        let mut all = parse_lsof(&text, my_uid(), std::process::id());
        // The paths, so a part of macOS is never offered for ending; a program whose path is unknown is not either.
        let pids: Vec<String> = all.iter().filter(|l| l.can_end).map(|l| l.pid.to_string()).collect();
        let paths = if pids.is_empty() { Default::default() } else { run("/bin/ps", &["-o", "pid=,comm=", "-p", &pids.join(",")], Duration::from_secs(2)).map(|t| parse_ps(&t)).unwrap_or_default() };
        for l in &mut all {
            l.path = paths.get(&l.pid).cloned();
            l.can_end = l.can_end && l.path.as_deref().is_some_and(|p| !mac_system(p));
        }
        Ok(all)
    }

    pub fn end(pid: u32, port: u16) -> Result<End, String> {
        if system_pid(pid) || pid == std::process::id() {
            return Ok(End::Denied);
        }
        let Some(found) = read()?.into_iter().find(|l| l.pid == pid && l.port == port) else { return Ok(End::Gone) };
        if !found.can_end {
            return Ok(End::Denied);
        }
        // SIGTERM lets a server close its connections; one that ignores it is still listed on the next read.
        let sent = Command::new("/bin/kill").args(["-TERM", &pid.to_string()]).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success());
        Ok(if sent { End::Ended } else { End::Denied })
    }

    pub fn reachable_on_localhost(port: u16) -> bool {
        read().is_ok_and(|all| all.iter().any(|l| l.port == port && l.addr.parse().is_ok_and(answers_on_localhost)))
    }
}

#[cfg(windows)]
use win as platform;
#[cfg(target_os = "macos")]
use mac as platform;

/// Neither Windows nor a Mac: nothing to read, nothing to end.
#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use super::*;

    pub fn read() -> Result<Vec<Listener>, String> {
        Ok(Vec::new())
    }

    pub fn end(_pid: u32, _port: u16) -> Result<End, String> {
        Ok(End::Denied)
    }

    pub fn reachable_on_localhost(_port: u16) -> bool {
        false
    }
}

/// Blocking reads belong off the async workers (a Mac's lsof takes a moment).
async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ports_list() -> Result<Vec<Listener>, String> {
    blocking(platform::read).await
}

/// Ends the process listening on `port` with that PID, if it is still the same listener and may be ended.
#[tauri::command]
pub async fn ports_end(pid: u32, port: u16) -> Result<End, String> {
    blocking(move || platform::end(pid, port)).await
}

/// Opens http://localhost:PORT in the default browser. The address is built here and only for a port that listens on
/// loopback or on every address, so the page cannot open anything else.
#[tauri::command]
pub async fn ports_open(port: u16) -> Result<(), String> {
    blocking(move || {
        if port == 0 || !platform::reachable_on_localhost(port) {
            return Err("not-local".into());
        }
        crate::open_url(&format!("http://localhost:{port}"))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn listener(port: u16, pid: u32, addr: &str) -> Listener {
        Listener { port, addr: addr.into(), pid, name: "node".into(), path: None, can_end: true }
    }

    #[test]
    fn lsof_fields_become_listeners() {
        let text = "p512\ncControlCenter\nu501\ntIPv4\nn*:7000\ntIPv6\nn*:7000\n\
                    p1234\ncnode\nu501\ntIPv6\nn[::1]:3000\ntIPv4\nn127.0.0.1:5173\n\
                    p77\ncpostgres\nu0\ntIPv4\nn127.0.0.1:5432\n\
                    p4242\ncMy\\x20Server\nu501\ntIPv4\nn192.168.1.20:8080\n";
        let all = parse_lsof(text, Some(501), 999);
        let at = |port, addr: &str| all.iter().find(|l| l.port == port && l.addr == addr).unwrap_or_else(|| panic!("{port} {addr} in {all:?}"));
        // `*` is the wildcard of the kind the socket has.
        assert_eq!(at(7000, "0.0.0.0").pid, 512);
        assert_eq!(at(7000, "::").pid, 512);
        assert_eq!(at(3000, "::1").name, "node");
        assert_eq!(at(5173, "127.0.0.1").pid, 1234);
        assert_eq!(at(8080, "192.168.1.20").name, "My Server");
        assert_eq!(all.len(), 6);
        // Sorted by port, then PID.
        assert!(all.windows(2).all(|w| (w[0].port, w[0].pid) <= (w[1].port, w[1].pid)));
        // postgres belongs to root, node to the user.
        assert!(!at(5432, "127.0.0.1").can_end && at(3000, "::1").can_end);
    }

    #[test]
    fn lsof_text_that_is_not_a_listener_is_skipped() {
        // An established connection, a port that is no number, a name without a port, a stray line and an empty one.
        let text = "p10\ncssh\nu501\nn10.0.0.2:5000->10.0.0.9:22\nn*:http\nnnonsense\nzz\n\np11\ncok\nu501\nn[fe80::1%lo0]:80\n";
        let all = parse_lsof(text, Some(501), 999);
        assert_eq!(all.len(), 1);
        assert_eq!((all[0].port, all[0].addr.as_str(), all[0].pid), (80, "fe80::1", 11));
        // No pid line before an address: nothing to attach it to.
        assert!(parse_lsof("n*:80\n", Some(501), 999).is_empty());
        assert!(parse_lsof("", None, 999).is_empty());
        // Without a known user id nothing counts as the user's own.
        assert!(!parse_lsof("p1234\ncnode\nu501\nn*:3000\n", None, 999)[0].can_end);
    }

    #[test]
    fn socket_names() {
        assert_eq!(socket_name("[::1]:3000", false), Some((IpAddr::V6(Ipv6Addr::LOCALHOST), 3000)));
        assert_eq!(socket_name("*:5173", false), Some((IpAddr::V4(Ipv4Addr::UNSPECIFIED), 5173)));
        assert_eq!(socket_name("*:5173", true), Some((IpAddr::V6(Ipv6Addr::UNSPECIFIED), 5173)));
        assert_eq!(socket_name("127.0.0.1:0", false), None);
        assert_eq!(socket_name("127.0.0.1:99999", false), None);
        assert_eq!(socket_name("localhost:3000", false), None);
    }

    #[test]
    fn protected_processes_are_never_endable() {
        let dir = r"C:\Windows";
        // The idle process, System, launchd and Crest itself, even when everything else says yes.
        assert!(!may_end(0, 100, true, None, dir) && !may_end(4, 100, true, None, dir) && !may_end(1, 100, true, None, dir));
        assert!(!may_end(100, 100, true, None, dir));
        // Somebody else's, or unreadable (elevated).
        assert!(!may_end(200, 100, false, Some(r"C:\tools\node.exe"), dir));
        // A Windows component that runs as the user, whatever the case or slash.
        assert!(!may_end(200, 100, true, Some(r"C:\Windows\System32\svchost.exe"), dir));
        assert!(!may_end(200, 100, true, Some(r"c:\windows/system32/svchost.exe"), dir));
        // The user's own program, also one whose folder only starts like the Windows folder.
        assert!(may_end(200, 100, true, Some(r"C:\Users\me\node.exe"), dir));
        assert!(may_end(200, 100, true, Some(r"C:\Windows.old\tool.exe"), dir));
        // A path that cannot be read cannot be shown to be outside the Windows folder: not endable there. A Mac has no
        // such folder (empty) and never has a path.
        assert!(!may_end(200, 100, true, None, dir));
        assert!(may_end(200, 100, true, None, ""));
    }

    #[test]
    fn only_loopback_and_wildcard_open_in_the_browser() {
        let ok = |a: &str| answers_on_localhost(a.parse().unwrap());
        assert!(ok("127.0.0.1") && ok("127.0.0.2") && ok("::1") && ok("0.0.0.0") && ok("::") && ok("::ffff:127.0.0.1"));
        assert!(!ok("192.168.1.20") && !ok("fe80::1") && !ok("10.0.0.5"));
    }

    #[test]
    fn listeners_sort_by_port_and_lose_duplicates() {
        let all = finish(vec![listener(8080, 5, "0.0.0.0"), listener(3000, 9, "::1"), listener(3000, 2, "127.0.0.1"), listener(8080, 5, "0.0.0.0")]);
        let order: Vec<_> = all.iter().map(|l| (l.port, l.pid)).collect();
        assert_eq!(order, [(3000, 2), (3000, 9), (8080, 5)]);
    }

    /// With the env var set this test is the child of `ends_a_listening_process`: it listens and waits to be ended.
    #[cfg(windows)]
    #[test]
    fn listen_as_child() {
        if std::env::var_os("CREST_PORTS_CHILD").is_none() {
            return;
        }
        let socket = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        println!("PORT={}", socket.local_addr().unwrap().port());
        std::thread::sleep(std::time::Duration::from_secs(60));
    }

    #[cfg(windows)]
    #[test]
    fn sees_own_listener_but_will_not_end_it() {
        let socket = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = socket.local_addr().unwrap().port();
        let found = platform::read().unwrap().into_iter().find(|l| l.port == port).expect("own listener in the table");
        assert_eq!((found.addr.as_str(), found.pid), ("127.0.0.1", std::process::id()));
        assert!(found.name.to_lowercase().ends_with(".exe") && found.path.is_some());
        assert!(!found.can_end, "Crest never offers to end itself");
        assert_eq!(platform::end(std::process::id(), port).unwrap(), End::Denied);
        assert!(platform::reachable_on_localhost(port));
    }

    #[cfg(windows)]
    #[test]
    fn ends_a_listening_process() {
        use std::io::{BufRead, BufReader};
        use std::process::{Command, Stdio};
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args(["listen_as_child", "--nocapture", "--test-threads=1"])
            .env("CREST_PORTS_CHILD", "1")
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let lines = BufReader::new(child.stdout.take().unwrap()).lines();
        // libtest has printed "test ... " on the same line by then, so the marker is not at the start.
        let port: u16 = lines.map_while(Result::ok).find_map(|l| l.split_once("PORT=").and_then(|(_, p)| p.trim().parse().ok())).unwrap_or_else(|| {
            let _ = child.kill();
            panic!("the child reports its port")
        });
        let pid = child.id();

        let found = platform::read().unwrap().into_iter().find(|l| l.port == port && l.pid == pid).expect("the child's listener");
        assert!(found.can_end, "{found:?}");
        assert_eq!(platform::end(pid, port).unwrap(), End::Ended);
        child.wait().unwrap();
        // Same listener again: it is gone.
        assert_eq!(platform::end(pid, port).unwrap(), End::Gone);
    }

    #[test]
    fn mac_system_programs_are_not_offered() {
        let paths = parse_ps("  512 /System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter\n 9001 /usr/local/bin/node\n 77 /usr/libexec/rapportd\n 88 node\n");
        assert_eq!(paths.len(), 3);
        assert!(mac_system(&paths[&512]));
        assert!(mac_system(&paths[&77]));
        assert!(!mac_system(&paths[&9001]));
        assert!(!mac_system("/Applications/Docker.app/Contents/MacOS/com.docker.backend"));
        assert!(!mac_system("/Users/me/.cargo/bin/server"));
    }
}
