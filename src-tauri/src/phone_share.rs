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

use serde::{Deserialize, Serialize};

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

/// The page's words, in the app's language: whoever scans the code is the one at the computer.
#[derive(Deserialize, Default)]
pub struct PageText {
    lang: String,
    title: String,
    /// "3 files", in front of the total size.
    count: String,
    hint: String,
    footer: String,
}

struct Share {
    token: String,
    files: Vec<PathBuf>,
    text: PageText,
    /// The computer's name, above the title, so the phone says where the files come from.
    from: Option<String>,
}

#[tauri::command]
pub fn phone_share_start(paths: Vec<String>, text: PageText) -> Result<ShareInfo, String> {
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
    let share = Share { token, files, text, from: std::env::var("COMPUTERNAME").ok().filter(|n| !n.is_empty()) };
    thread::spawn(move || serve(listener, share, stop, LIFETIME));
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

fn serve(listener: TcpListener, share: Share, stop: Arc<AtomicBool>, lifetime: Duration) {
    if listener.set_nonblocking(true).is_err() {
        return;
    }
    let share = Arc::new(share);
    let end = Instant::now() + lifetime;
    while !stop.load(Ordering::Relaxed) && Instant::now() < end {
        match listener.accept() {
            Ok((stream, _)) => {
                let share = share.clone();
                thread::spawn(move || {
                    let _ = handle(stream, &share);
                });
            }
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(100)),
            Err(_) => return,
        }
    }
}

fn handle(mut stream: TcpStream, share: &Share) -> io::Result<()> {
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
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let rest = path.strip_prefix('/').and_then(|p| p.strip_prefix(share.token.as_str()));
    match rest {
        Some("") | Some("/") => {
            let page = page(share);
            respond(&mut stream, "200 OK", "text/html; charset=utf-8", page.as_bytes(), head)
        }
        Some(index) => {
            let file = index.strip_prefix('/').and_then(|i| i.parse::<usize>().ok()).and_then(|i| share.files.get(i));
            match file.and_then(|p| std::fs::File::open(p).ok().map(|f| (p, f))) {
                Some((path, mut file)) => {
                    let len = file.metadata()?.len();
                    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                    // `?view`: the page's own thumbnail of an image, shown in place instead of saved.
                    let image = image_type(path).filter(|_| query == "view");
                    let disposition = format!("{}; filename=\"{}\"; filename*=UTF-8''{}", if image.is_some() { "inline" } else { "attachment" }, ascii_name(&name), percent(&name));
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {len}\r\nContent-Disposition: {disposition}\r\nX-Content-Type-Options: nosniff\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n",
                        image.unwrap_or("application/octet-stream")
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
        "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(out.as_bytes())?;
    if !head {
        stream.write_all(body)?;
    }
    stream.flush()
}

const LOGO: &str = include_str!("../../assets/logo/crest-icon.svg");
/// Images the page shows as a thumbnail, up to this size (the phone loads the whole file for it).
const THUMB_MAX: u64 = 20 << 20;

const STYLE: &str = r#"
:root{color-scheme:dark light;--bg:#0b0b0e;--card:#15161b;--line:rgba(255,255,255,.07);--text:#f5f5f7;--dim:#8d8f99;--amber:#ffc75f;--on:#1d1406}
@media (prefers-color-scheme:light){:root{--bg:#f3f3f6;--card:#fff;--line:rgba(0,0,0,.07);--text:#111216;--dim:#6b6e78;--amber:#f5b73f}.tile{color:color-mix(in srgb,var(--k) 72%,#000)}}
*{box-sizing:border-box;margin:0}
html{background:var(--bg)}
body{min-height:100vh;color:var(--text);font:16px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;-webkit-font-smoothing:antialiased;
padding:calc(32px + env(safe-area-inset-top)) calc(18px + env(safe-area-inset-right)) calc(28px + env(safe-area-inset-bottom)) calc(18px + env(safe-area-inset-left))}
body::before{content:"";position:fixed;left:50%;top:-38vh;width:150vw;height:70vh;transform:translateX(-50%);pointer-events:none;z-index:-1;
background:radial-gradient(closest-side,rgba(255,199,95,.20),rgba(224,85,158,.08) 62%,transparent)}
main{max-width:520px;margin:0 auto}
header{display:flex;align-items:center;gap:14px;margin-bottom:24px;animation:in .5s cubic-bezier(.22,1,.36,1) both}
header svg{width:52px;height:52px;flex:none;border-radius:13px;box-shadow:0 8px 24px rgba(0,0,0,.3)}
.from{font-size:13px;font-weight:600;color:var(--dim);letter-spacing:.06em;text-transform:uppercase}
h1{font-size:26px;font-weight:700;letter-spacing:-.02em;line-height:1.15}
.total{font-size:14px;color:var(--dim);margin-top:2px}
.list{display:flex;flex-direction:column;gap:10px}
.row{display:flex;align-items:center;gap:14px;padding:12px;border-radius:20px;background:var(--card);border:1px solid var(--line);color:inherit;text-decoration:none;
-webkit-tap-highlight-color:transparent;transition:transform .15s cubic-bezier(.22,1,.36,1);animation:in .5s cubic-bezier(.22,1,.36,1) both;animation-delay:calc(var(--i)*40ms + 60ms)}
.row:active{transform:scale(.98)}
.tile{width:56px;height:56px;flex:none;border-radius:14px;display:grid;place-items:center;overflow:hidden;font-size:12px;font-weight:800;letter-spacing:.05em;color:var(--k);background:var(--kb)}
.tile img{width:100%;height:100%;object-fit:cover}
.tile svg{width:24px;height:24px}
.info{flex:1;min-width:0}
.name{font-size:15px;font-weight:600;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.size{font-size:13px;color:var(--dim);margin-top:3px}
.get{width:40px;height:40px;flex:none;border-radius:50%;display:grid;place-items:center;background:var(--amber);color:var(--on)}
.get svg{width:19px;height:19px}
.hint{font-size:13px;color:var(--dim);text-align:center;margin-top:16px}
footer{display:flex;align-items:center;justify-content:center;gap:7px;margin-top:32px;font-size:12px;color:var(--dim);text-align:center}
footer svg{width:14px;height:14px;flex:none}
@keyframes in{from{opacity:0;transform:translateY(10px)}}
@media (prefers-reduced-motion:reduce){header,.row{animation:none}}
"#;

const DOWN: &str = r#"<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5.5 20h13"/></svg>"#;
const LOCK: &str = r#"<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9.5" rx="2.5"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/></svg>"#;
const FILE: &str = r#"<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>"#;

/// The MIME type of an image the phone's browser can show, by extension.
fn image_type(path: &std::path::Path) -> Option<&'static str> {
    Some(match extension(path).as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        _ => return None,
    })
}

fn extension(path: &std::path::Path) -> String {
    path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// A file's tile colour by kind, from Crest's logo: (text, background).
fn tint(ext: &str) -> (&'static str, &'static str) {
    match ext {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "avif" | "heic" | "heif" | "bmp" | "svg" | "tif" | "tiff" => ("#ffc75f", "rgba(255,199,95,.14)"),
        "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" => ("#e0559e", "rgba(224,85,158,.15)"),
        "mp3" | "m4a" | "wav" | "flac" | "aac" | "ogg" | "opus" => ("#ff9a4d", "rgba(255,154,77,.15)"),
        "pdf" | "doc" | "docx" | "txt" | "md" | "rtf" | "xls" | "xlsx" | "csv" | "ppt" | "pptx" | "odt" => ("#ff6b6b", "rgba(255,107,107,.14)"),
        _ => ("#9a9ca6", "rgba(154,156,166,.14)"),
    }
}

/// The page the QR opens: one card per file, a tap downloads it. No script; every name is escaped.
fn page(share: &Share) -> String {
    let mut total = 0;
    let rows: String = share
        .files
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let len = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
            total += len;
            let ext = extension(p);
            let (k, kb) = tint(&ext);
            let label: String = ext.chars().filter(|c| c.is_ascii_alphanumeric()).take(4).collect::<String>().to_uppercase();
            let tile = if image_type(p).is_some() && len <= THUMB_MAX {
                format!("<img src=\"/{}/{i}?view\" alt=\"\" loading=\"lazy\">", share.token)
            } else if label.is_empty() {
                FILE.to_string()
            } else {
                label
            };
            format!(
                "<a class=\"row\" href=\"/{token}/{i}\" download style=\"--i:{d};--k:{k};--kb:{kb}\"><span class=\"tile\">{tile}</span><span class=\"info\"><span class=\"name\">{name}</span><span class=\"size\">{size}</span></span><span class=\"get\">{DOWN}</span></a>",
                token = share.token,
                d = i.min(8),
                name = escape(&name),
                size = bytes(len),
            )
        })
        .collect();
    let text = &share.text;
    let from = share.from.as_deref().map(|f| format!("<p class=\"from\">{}</p>", escape(f))).unwrap_or_default();
    format!(
        "<!doctype html><html lang=\"{lang}\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\
<meta name=\"theme-color\" content=\"#0b0b0e\" media=\"(prefers-color-scheme: dark)\"><meta name=\"theme-color\" content=\"#f3f3f6\" media=\"(prefers-color-scheme: light)\">\
<link rel=\"icon\" href=\"data:image/svg+xml,{icon}\"><title>{title} · Crest</title><style>{STYLE}</style></head><body><main>\
<header>{LOGO}<div>{from}<h1>{title}</h1><p class=\"total\">{count} · {total}</p></div></header>\
<div class=\"list\">{rows}</div><p class=\"hint\">{hint}</p><footer>{LOCK}<span>{footer}</span></footer></main></body></html>",
        lang = escape(&text.lang),
        icon = percent(LOGO),
        title = escape(&text.title),
        count = escape(&text.count),
        total = bytes(total),
        hint = escape(&text.hint),
        footer = escape(&text.footer),
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
        let text = PageText { lang: "it".into(), title: "1 <file>".into(), ..Default::default() };
        let share = Share { token: "abc".into(), files: vec![file], text, from: Some("PC".into()) };
        thread::spawn(move || serve(listener, share, s, LIFETIME));

        let page = get(port, "/abc");
        assert!(page.starts_with("HTTP/1.1 200"));
        assert!(page.contains("nota &amp; 1 è.txt") && page.contains("href=\"/abc/0\""));
        assert!(page.contains("<h1>1 &lt;file&gt;</h1>") && page.contains("lang=\"it\"") && page.contains(">TXT</span>"));
        // Not an image: `?view` still downloads it.
        assert!(get(port, "/abc/0?view").contains("Content-Disposition: attachment"));
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
