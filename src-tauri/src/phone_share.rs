//! Shelf files to a phone on the same network: a small HTTP server on the computer's LAN address, with a
//! random token in the path, shown as a QR code. The phone's browser opens a page listing the files and
//! downloads them straight from the computer; nothing goes through a server of anyone else.
//!
//! One share at a time. It stops accepting after LIFETIME, when another one starts, or on phone_share_stop;
//! a download already running finishes. Only the files handed in are served, by their index, so no path
//! from the request ever reaches the file system. Plain HTTP: the token keeps others on the network from
//! guessing the address, but the bytes travel unencrypted over the Wi-Fi.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{IpAddr, TcpListener, TcpStream, UdpSocket};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

const LIFETIME: Duration = Duration::from_secs(10 * 60);
/// Request line and headers; anything longer is not a phone browser asking for a file.
const MAX_HEAD: u64 = 16 * 1024;

/// The running share: its url (its identity for phone_share_stop) and its stop flag.
static CURRENT: Mutex<Option<(String, Arc<AtomicBool>)>> = Mutex::new(None);

#[derive(Serialize)]
pub struct ShareInfo {
    url: String,
    /// SVG path of the dark modules, in a `size` x `size` box that includes the quiet zone.
    qr: String,
    size: i32,
    ttl: u64,
}

#[tauri::command]
pub fn phone_share_start(paths: Vec<String>) -> Result<ShareInfo, String> {
    let files: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).filter(|p| p.is_file()).collect();
    if files.is_empty() {
        return Err("Files no longer exist".into());
    }
    let ip = lan_ip().ok_or("No network")?;
    // Bound to the LAN address only, not every interface.
    let listener = TcpListener::bind((ip, 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = crate::trading::sign::random_hex(16)?;
    let url = format!("http://{ip}:{port}/{token}");
    let (qr, size) = qr_path(&url)?;
    let stop = Arc::new(AtomicBool::new(false));
    if let Some((_, old)) = CURRENT.lock().unwrap().replace((url.clone(), stop.clone())) {
        old.store(true, Ordering::Relaxed);
    }
    thread::spawn(move || serve(listener, token, files, stop, LIFETIME));
    Ok(ShareInfo { url, qr, size, ttl: LIFETIME.as_secs() })
}

/// Stops the share at `url`; a newer one keeps running.
#[tauri::command]
pub fn phone_share_stop(url: String) {
    let mut current = CURRENT.lock().unwrap();
    if current.as_ref().is_some_and(|(u, _)| *u == url) {
        if let Some((_, stop)) = current.take() {
            stop.store(true, Ordering::Relaxed);
        }
    }
}

/// The address other devices reach this computer on: the source address of the default route. Connecting a
/// UDP socket sends nothing.
/// shortcut: with a VPN as the default route this is the VPN's address; pick the interface by hand if users hit it.
fn lan_ip() -> Option<IpAddr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:9").ok()?;
    let ip = socket.local_addr().ok()?.ip();
    (!ip.is_loopback() && !ip.is_unspecified()).then_some(ip)
}

fn qr_path(text: &str) -> Result<(String, i32), String> {
    use qrcodegen::{QrCode, QrCodeEcc};
    let qr = QrCode::encode_text(text, QrCodeEcc::Medium).map_err(|e| format!("{e:?}"))?;
    const QUIET: i32 = 4;
    let mut path = String::new();
    for y in 0..qr.size() {
        for x in 0..qr.size() {
            if qr.get_module(x, y) {
                path.push_str(&format!("M{},{}h1v1h-1z", x + QUIET, y + QUIET));
            }
        }
    }
    Ok((path, qr.size() + 2 * QUIET))
}

fn serve(listener: TcpListener, token: String, files: Vec<PathBuf>, stop: Arc<AtomicBool>, lifetime: Duration) {
    if listener.set_nonblocking(true).is_err() {
        return;
    }
    let (token, files) = (Arc::new(token), Arc::new(files));
    let end = Instant::now() + lifetime;
    while !stop.load(Ordering::Relaxed) && Instant::now() < end {
        match listener.accept() {
            Ok((stream, _)) => {
                let (token, files) = (token.clone(), files.clone());
                thread::spawn(move || {
                    let _ = handle(stream, &token, &files);
                });
            }
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(100)),
            Err(_) => return,
        }
    }
}

fn handle(mut stream: TcpStream, token: &str, files: &[PathBuf]) -> io::Result<()> {
    // Accepted sockets inherit non-blocking on Windows.
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    stream.set_write_timeout(Some(Duration::from_secs(60)))?;
    // Read the whole head: closing with unread bytes resets the connection and can cut the response short.
    let mut reader = BufReader::new((&stream).take(MAX_HEAD));
    let mut request = String::new();
    reader.read_line(&mut request)?;
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 || line == "\r\n" || line == "\n" {
            break;
        }
    }
    let mut parts = request.split_whitespace();
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let head = method == "HEAD";
    if method != "GET" && !head {
        return respond(&mut stream, "405 Method Not Allowed", "text/plain", b"", head);
    }
    let path = target.split('?').next().unwrap_or("");
    let rest = path.strip_prefix('/').and_then(|p| p.strip_prefix(token));
    match rest {
        Some("") | Some("/") => {
            let page = page(token, files);
            respond(&mut stream, "200 OK", "text/html; charset=utf-8", page.as_bytes(), head)
        }
        Some(index) => {
            let file = index.strip_prefix('/').and_then(|i| i.parse::<usize>().ok()).and_then(|i| files.get(i));
            match file.and_then(|p| std::fs::File::open(p).ok().map(|f| (p, f))) {
                Some((path, mut file)) => {
                    let len = file.metadata()?.len();
                    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                    let disposition = format!("attachment; filename=\"{}\"; filename*=UTF-8''{}", ascii_name(&name), percent(&name));
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {len}\r\nContent-Disposition: {disposition}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n"
                    )?;
                    if !head {
                        io::copy(&mut file, &mut stream)?;
                    }
                    stream.flush()
                }
                None => respond(&mut stream, "404 Not Found", "text/plain", b"Not found", head),
            }
        }
        None => respond(&mut stream, "404 Not Found", "text/plain", b"Not found", head),
    }
}

fn respond(stream: &mut TcpStream, status: &str, kind: &str, body: &[u8], head: bool) -> io::Result<()> {
    let out = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(out.as_bytes())?;
    if !head {
        stream.write_all(body)?;
    }
    stream.flush()
}

/// The page the QR opens: one row per file, a tap downloads it. No script; names are escaped.
fn page(token: &str, files: &[PathBuf]) -> String {
    let rows: String = files
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let size = std::fs::metadata(p).map(|m| bytes(m.len())).unwrap_or_default();
            format!("<a href=\"/{token}/{i}\" download><span>{}</span><small>{size}</small></a>", escape(&name))
        })
        .collect();
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Crest</title>\
<style>body{{margin:0;padding:24px 16px;background:#000;color:#fff;font:16px system-ui,sans-serif}}h1{{font-size:20px;margin:0 0 16px}}\
a{{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:16px;margin-bottom:8px;border-radius:14px;background:#1c1c1e;color:#fff;text-decoration:none}}\
span{{overflow-wrap:anywhere}}small{{color:#8e8e93;white-space:nowrap}}</style></head><body><h1>Crest</h1>{rows}</body></html>"
    )
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

/// The name for browsers that ignore filename*: ASCII only, no quotes or backslashes.
fn ascii_name(s: &str) -> String {
    s.chars().map(|c| if (c.is_ascii_graphic() && c != '"' && c != '\\') || c == ' ' { c } else { '_' }).collect()
}

fn percent(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

fn bytes(n: u64) -> String {
    match n {
        n if n >= 1 << 30 => format!("{:.1} GB", n as f64 / (1u64 << 30) as f64),
        n if n >= 1 << 20 => format!("{:.1} MB", n as f64 / (1u64 << 20) as f64),
        n if n >= 1 << 10 => format!("{} KB", n >> 10),
        n => format!("{n} B"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(port: u16, path: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "GET {path} HTTP/1.1\r\nHost: x\r\nUser-Agent: test\r\n\r\n").unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn serves_only_the_shared_files_behind_the_token() {
        let dir = std::env::temp_dir().join(format!("crest-share-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("nota & 1 è.txt");
        std::fs::write(&file, "ciao").unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let stop = Arc::new(AtomicBool::new(false));
        let s = stop.clone();
        thread::spawn(move || serve(listener, "abc".into(), vec![file], s, LIFETIME));

        let page = get(port, "/abc");
        assert!(page.starts_with("HTTP/1.1 200"));
        assert!(page.contains("nota &amp; 1 è.txt") && page.contains("href=\"/abc/0\""));
        let body = get(port, "/abc/0");
        assert!(body.contains("filename*=UTF-8''nota%20%26%201%20%C3%A8.txt") && body.ends_with("\r\n\r\nciao"));
        assert!(get(port, "/abc/1").starts_with("HTTP/1.1 404"));
        assert!(get(port, "/abd/0").starts_with("HTTP/1.1 404"));
        assert!(get(port, "/abc/../0").starts_with("HTTP/1.1 404"));

        stop.store(true, Ordering::Relaxed);
        thread::sleep(Duration::from_millis(300));
        assert!(TcpStream::connect(("127.0.0.1", port)).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn qr_has_modules_and_quiet_zone() {
        let (path, size) = qr_path("http://192.168.1.20:51234/0123456789abcdef0123456789abcdef").unwrap();
        assert!(size > 8 && path.starts_with("M4,4"));
    }
}
