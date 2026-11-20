//! Now Playing on Linux over MPRIS.
//!
//! Every desktop player (Spotify, Firefox, Chrome, VLC, Rhythmbox, a YouTube Music app ...) publishes itself on the session
//! bus as `org.mpris.MediaPlayer2.<name>`. A thread asks the running ones once a second and emits `media://update` like
//! media.rs does on Windows. The shape of the state and the loop are the Mac's (macos/media.rs); only the players differ.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use zbus::blocking::fdo::DBusProxy;
use zbus::blocking::{Connection, MessageIterator, Proxy};
use zbus::message::Type as MessageType;
use zbus::MatchRule;
use zbus::zvariant::{OwnedObjectPath, OwnedValue};

const PREFIX: &str = "org.mpris.MediaPlayer2.";
const PATH: &str = "/org/mpris/MediaPlayer2";
const PLAYER: &str = "org.mpris.MediaPlayer2.Player";
const ROOT: &str = "org.mpris.MediaPlayer2";

const POLL: Duration = Duration::from_secs(1);
/// The poll while nothing plays; a command from the page wakes it at once.
const IDLE_POLL: Duration = Duration::from_secs(3);
/// A failed cover load is tried again after this long.
const COVER_RETRY: Duration = Duration::from_secs(30);
const COVER_TIMEOUT: Duration = Duration::from_secs(5);
/// Drift beyond which a position counts as a seek and is sent again (as on Windows).
const SEEK_THRESHOLD: f64 = 1.5;
const LYRICS_RESYNC: Duration = Duration::from_secs(5);
/// A player that is switching track says "stopped" with no title for a moment: the last track stays on screen that long.
const GAP_GRACE: Duration = Duration::from_secs(2);
/// The poll while waiting out such a gap.
const GAP_POLL: Duration = Duration::from_millis(250);

#[derive(Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    app_id: String,
    is_playing: bool,
}

/// The same shape as media.rs, so the frontend reads both alike.
#[derive(Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    title: String,
    artist: String,
    artwork: Option<String>,
    is_playing: bool,
    position: f64,
    duration: f64,
    can_seek: bool,
    app_id: String,
    shuffle: Option<bool>,
    repeat: Option<&'static str>,
    sources: Vec<Source>,
    /// Only in the event: the cover is the one of the previous event, so it is left out (see `lean`).
    artwork_same: bool,
}

/// Last emitted state and when; the pinned app; lyrics on screen; the polling thread; the shown player's bus name.
#[derive(Default)]
pub struct MediaState {
    last: Mutex<Option<(NowPlaying, SystemTime)>>,
    pinned: Mutex<Option<String>>,
    lyrics: AtomicBool,
    poller: Mutex<Option<thread::Thread>>,
    bus: Mutex<Option<String>>,
}

impl MediaState {
    /// Name and title of the shown player (the mixer).
    pub fn shown(&self) -> Option<(String, String)> {
        self.last.lock().unwrap().as_ref().map(|(np, _)| (np.app_id.clone(), np.title.clone()))
    }
}

/// Polls now instead of after the idle wait.
fn wake(state: &MediaState) {
    if let Some(poller) = state.poller.lock().unwrap().as_ref() {
        poller.unpark();
    }
}

#[tauri::command]
pub fn media_get(state: State<'_, MediaState>) -> Option<NowPlaying> {
    let (mut np, at) = state.last.lock().unwrap().clone()?;
    if np.is_playing {
        np.position += at.elapsed().map(|d| d.as_secs_f64()).unwrap_or(0.0);
        if np.duration > 0.0 {
            np.position = np.position.min(np.duration);
        }
    }
    Some(np)
}

#[tauri::command]
pub async fn media_control(state: State<'_, MediaState>, action: String, position: Option<f64>, on: Option<bool>) -> Result<(), String> {
    let Some(bus) = state.bus.lock().unwrap().clone() else { return Ok(()) };
    let done = tauri::async_runtime::spawn_blocking(move || control(&bus, &action, position, on)).await.map_err(|e| e.to_string())?;
    wake(&state);
    done
}

#[tauri::command]
pub fn media_lyrics(on: bool, state: State<'_, MediaState>) {
    state.lyrics.store(on, Ordering::Relaxed);
}

#[tauri::command]
pub fn media_pin(app_id: Option<String>, state: State<'_, MediaState>) {
    *state.pinned.lock().unwrap() = app_id.filter(|id| !id.is_empty());
    wake(&state);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    app_id: String,
    title: String,
    artist: String,
    is_playing: bool,
}

#[tauri::command]
pub async fn media_sources() -> Result<Vec<SourceInfo>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let conn = Connection::session().map_err(|e| e.to_string())?;
        let mut names = HashMap::new();
        Ok(read_all(&conn, &mut names)
            .into_iter()
            .map(|t| SourceInfo { app_id: t.app, title: t.title, artist: t.artist, is_playing: t.playing })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// One player's answer.
struct Track {
    /// The D-Bus name, which is how it is controlled.
    bus: String,
    /// What the page calls it: the player's own name ("Spotify", "Mozilla Firefox").
    app: String,
    playing: bool,
    title: String,
    artist: String,
    position: f64,
    duration: f64,
    can_seek: bool,
    artwork_url: String,
    shuffle: bool,
    repeat: &'static str,
}

/// A number as any of the integer or float types a player may send it in.
fn number(v: &OwnedValue) -> Option<f64> {
    i64::try_from(v).map(|n| n as f64).or_else(|_| u64::try_from(v).map(|n| n as f64)).or_else(|_| i32::try_from(v).map(f64::from)).or_else(|_| f64::try_from(v)).ok()
}

fn text(v: &OwnedValue) -> Option<String> {
    String::try_from(v.try_clone().ok()?).ok()
}

/// `xesam:artist` is a list of names; some players send one string.
fn artists(v: &OwnedValue) -> String {
    match Vec::<String>::try_from(v.try_clone().unwrap_or_else(|_| OwnedValue::from(0u8))) {
        Ok(list) => list.join(", "),
        Err(_) => text(v).unwrap_or_default(),
    }
}

fn object_path(v: &OwnedValue) -> Option<OwnedObjectPath> {
    OwnedObjectPath::try_from(v.try_clone().ok()?).ok()
}

fn repeat_of(loop_status: &str) -> &'static str {
    match loop_status {
        "Playlist" => "list",
        "Track" => "track",
        _ => "none",
    }
}

fn proxy<'a>(conn: &Connection, bus: &'a str, interface: &'a str) -> Option<Proxy<'a>> {
    Proxy::new(conn, bus, PATH, interface).ok()
}

/// The names of the players on the bus.
fn buses(conn: &Connection) -> Vec<String> {
    DBusProxy::new(conn)
        .ok()
        .and_then(|p| p.list_names().ok())
        .map(|names| names.into_iter().map(|n| n.to_string()).filter(|n| n.starts_with(PREFIX)).collect())
        .unwrap_or_default()
}

/// A player's name for the page, asked once per bus name.
fn identity(conn: &Connection, bus: &str, names: &mut HashMap<String, String>) -> String {
    names
        .entry(bus.to_string())
        .or_insert_with(|| proxy(conn, bus, ROOT).and_then(|p| p.get_property::<String>("Identity").ok()).filter(|n| !n.is_empty()).unwrap_or_else(|| bus.trim_start_matches(PREFIX).to_string()))
        .clone()
}

fn read(conn: &Connection, bus: &str, app: String) -> Option<Track> {
    let player = proxy(conn, bus, PLAYER)?;
    let status = player.get_property::<String>("PlaybackStatus").ok()?;
    // A player that was closed or has nothing loaded has no metadata.
    let meta = player.get_property::<HashMap<String, OwnedValue>>("Metadata").unwrap_or_default();
    let title = meta.get("xesam:title").and_then(text).unwrap_or_default();
    if status == "Stopped" && title.is_empty() {
        return None;
    }
    let micros = |v: Option<&OwnedValue>| v.and_then(number).unwrap_or(0.0) / 1_000_000.0;
    Some(Track {
        bus: bus.to_string(),
        app,
        playing: status == "Playing",
        title,
        artist: meta.get("xesam:artist").map(artists).unwrap_or_default(),
        position: player.get_property::<i64>("Position").map(|p| p as f64 / 1_000_000.0).unwrap_or(0.0),
        duration: micros(meta.get("mpris:length")),
        can_seek: player.get_property::<bool>("CanSeek").unwrap_or(false),
        artwork_url: meta.get("mpris:artUrl").and_then(text).unwrap_or_default(),
        shuffle: player.get_property::<bool>("Shuffle").unwrap_or(false),
        repeat: repeat_of(&player.get_property::<String>("LoopStatus").unwrap_or_default()),
    })
}

/// Every player with something to show. Two players with the same name show once, as the page keys them by name.
fn read_all(conn: &Connection, names: &mut HashMap<String, String>) -> Vec<Track> {
    let mut tracks: Vec<Track> = Vec::new();
    for bus in buses(conn) {
        let app = identity(conn, &bus, names);
        if tracks.iter().any(|t| t.app == app) {
            continue;
        }
        tracks.extend(read(conn, &bus, app));
    }
    tracks
}

fn control(bus: &str, action: &str, position: Option<f64>, on: Option<bool>) -> Result<(), String> {
    let conn = Connection::session().map_err(|e| e.to_string())?;
    let player = Proxy::new(&conn, bus, PATH, PLAYER).map_err(|e| e.to_string())?;
    let call = |method: &str| player.call_method(method, &()).map(|_| ()).map_err(|e| e.to_string());
    match action {
        "toggle" => call("PlayPause"),
        "next" => call("Next"),
        "previous" => call("Previous"),
        "seek" => {
            // SetPosition wants the track it is meant for, so a seek that arrives after a track change is dropped by the player.
            let target = (position.unwrap_or(0.0).max(0.0) * 1_000_000.0) as i64;
            let meta = player.get_property::<HashMap<String, OwnedValue>>("Metadata").unwrap_or_default();
            match meta.get("mpris:trackid").and_then(object_path) {
                Some(id) => player.call_method("SetPosition", &(id, target)).map(|_| ()).map_err(|e| e.to_string()),
                None => {
                    let now = player.get_property::<i64>("Position").unwrap_or(0);
                    player.call_method("Seek", &(target - now)).map(|_| ()).map_err(|e| e.to_string())
                }
            }
        }
        "shuffle" => player.set_property("Shuffle", on.unwrap_or(false)).map_err(|e| e.to_string()),
        // Off, all, one, like the Windows players.
        "repeat" => {
            let next = match player.get_property::<String>("LoopStatus").unwrap_or_default().as_str() {
                "None" => "Playlist",
                "Playlist" => "Track",
                _ => "None",
            };
            player.set_property("LoopStatus", next).map_err(|e| e.to_string())
        }
        _ => Ok(()),
    }
}

/// Wakes the poll whenever a player says something changed (a track, play or pause, a seek) or one appears or goes: pressing Next
/// then shows at once instead of at the next poll. Polling stays as the fallback and for the moving position.
fn watch(poller: thread::Thread) {
    let rules = [
        MatchRule::builder().msg_type(MessageType::Signal).interface("org.freedesktop.DBus.Properties").and_then(|b| b.member("PropertiesChanged")).and_then(|b| b.path(PATH)).map(|b| b.build()),
        MatchRule::builder().msg_type(MessageType::Signal).interface(PLAYER).and_then(|b| b.member("Seeked")).map(|b| b.build()),
        MatchRule::builder().msg_type(MessageType::Signal).interface("org.freedesktop.DBus").and_then(|b| b.member("NameOwnerChanged")).and_then(|b| b.arg0ns(ROOT)).map(|b| b.build()),
    ];
    for rule in rules.into_iter().flatten() {
        let poller = poller.clone();
        thread::spawn(move || {
            let Ok(conn) = Connection::session() else { return };
            let Ok(messages) = MessageIterator::for_match_rule(rule, &conn, None) else { return };
            for message in messages {
                if message.is_ok() {
                    poller.unpark();
                }
            }
        });
    }
}

/// The pinned player when it has a track, else a playing one (the shown one first), else the shown one, else the first.
fn pick(tracks: &[Track], shown: Option<&str>, pinned: Option<&str>) -> Option<usize> {
    let find = |app: Option<&str>| app.and_then(|a| tracks.iter().position(|t| t.app == a));
    find(pinned)
        .or_else(|| find(shown).filter(|&i| tracks[i].playing))
        .or_else(|| tracks.iter().position(|t| t.playing))
        .or_else(|| find(shown))
        .or(if tracks.is_empty() { None } else { Some(0) })
}

/// The cover of the shown track: its link, the data URL once loaded, and when a try failed.
#[derive(Default)]
struct Cover {
    url: String,
    data: Option<String>,
    failed: Option<Instant>,
}

fn mime_of(path: &str) -> &'static str {
    match path.rsplit('.').next().map(str::to_ascii_lowercase).as_deref() {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => "image/jpeg",
    }
}

/// The cover as a data URL, which is all the page may show: players give a file (Firefox, Chrome, VLC) or an https link
/// (Spotify). It is loaded once per link; a failed try is repeated only after COVER_RETRY, and never waits longer than
/// COVER_TIMEOUT. Plain http is left out, as on the Mac.
fn artwork(url: &str, cover: &mut Cover) -> Option<String> {
    if !url.starts_with("https://") && !url.starts_with("file://") {
        return None;
    }
    if cover.url == url && (cover.data.is_some() || cover.failed.is_some_and(|at| at.elapsed() < COVER_RETRY)) {
        return cover.data.clone();
    }
    let fetched = if let Some(path) = url.strip_prefix("file://") {
        // Paths come percent-encoded; the few that matter in file names are decoded.
        let path = path.replace("%20", " ");
        std::fs::read(&path).ok().map(|bytes| format!("data:{};base64,{}", mime_of(&path), base64::engine::general_purpose::STANDARD.encode(bytes)))
    } else {
        tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder().timeout(COVER_TIMEOUT).build().ok()?;
            let bytes = client.get(url).send().await.ok()?.error_for_status().ok()?.bytes().await.ok()?;
            Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
        })
    };
    // One cover is enough to keep: a new track replaces it.
    *cover = Cover { url: url.to_string(), failed: fetched.is_none().then(Instant::now), data: fetched };
    cover.data.clone()
}

/// The state as the page gets it: a cover equal to the last sent one stays out of the event, it can be megabytes.
fn lean(last: &Option<NowPlaying>, current: &Option<NowPlaying>) -> Option<NowPlaying> {
    current.clone().map(|np| match last {
        Some(l) if l.artwork == np.artwork => NowPlaying { artwork: None, artwork_same: true, ..np },
        _ => np,
    })
}

fn changed(last: &Option<NowPlaying>, current: &Option<NowPlaying>, last_sent_at: SystemTime) -> bool {
    match (last, current) {
        (None, None) => false,
        (Some(a), Some(b)) => {
            if (NowPlaying { position: b.position, ..a.clone() }) != *b {
                return true;
            }
            let elapsed = last_sent_at.elapsed().map(|d| d.as_secs_f64()).unwrap_or(0.0);
            let expected = if a.is_playing { a.position + elapsed } else { a.position };
            (expected - b.position).abs() > SEEK_THRESHOLD
        }
        _ => true,
    }
}

pub fn spawn(app: AppHandle) {
    let managed = app.clone();
    let poller = thread::spawn(move || {
        let mut last: Option<NowPlaying> = None;
        let mut last_sent_at = SystemTime::now();
        let mut cover = Cover::default();
        let mut names: HashMap<String, String> = HashMap::new();
        // Since when the shown player has had nothing to show.
        let mut gap_since: Option<Instant> = None;
        // No session bus (a bare container): nothing to show, and nothing to retry every second.
        let Ok(conn) = Connection::session() else { return };
        loop {
            // A bus name that went away is dropped, so a player that comes back under the same name is read again.
            let live = buses(&conn);
            names.retain(|bus, _| live.contains(bus));
            let tracks = read_all(&conn, &mut names);
            let state = app.state::<MediaState>();
            let pinned = state.pinned.lock().unwrap().clone();
            let shown = last.as_ref().map(|np| np.app_id.clone());
            let sources: Vec<Source> = tracks.iter().map(|t| Source { app_id: t.app.clone(), is_playing: t.playing }).collect();
            let chosen = pick(&tracks, shown.as_deref(), pinned.as_deref());
            // The shown player is still there but has nothing for a moment (a track change): keep what is shown, and look again soon.
            let shown_bus = state.bus.lock().unwrap().clone();
            if chosen.is_none() && last.is_some() && shown_bus.as_ref().is_some_and(|b| live.contains(b)) && gap_since.get_or_insert_with(Instant::now).elapsed() < GAP_GRACE {
                thread::park_timeout(GAP_POLL);
                continue;
            }
            gap_since = None;
            *state.bus.lock().unwrap() = chosen.map(|i| tracks[i].bus.clone());
            let current = chosen.map(|i| {
                let t = &tracks[i];
                NowPlaying {
                    title: t.title.clone(),
                    artist: t.artist.clone(),
                    artwork: artwork(&t.artwork_url, &mut cover),
                    is_playing: t.playing,
                    position: t.position,
                    duration: t.duration,
                    can_seek: t.can_seek && t.duration > 0.0,
                    app_id: t.app.clone(),
                    shuffle: Some(t.shuffle),
                    repeat: Some(t.repeat),
                    sources,
                    artwork_same: false,
                }
            });
            let resync = state.lyrics.load(Ordering::Relaxed) && current.as_ref().is_some_and(|np| np.is_playing) && last_sent_at.elapsed().is_ok_and(|d| d > LYRICS_RESYNC);
            if resync || changed(&last, &current, last_sent_at) {
                last_sent_at = SystemTime::now();
                *state.last.lock().unwrap() = current.clone().map(|np| (np, last_sent_at));
                let _ = app.emit("media://update", &lean(&last, &current));
                last = current;
            }
            thread::park_timeout(if last.as_ref().is_some_and(|np| np.is_playing) { POLL } else { IDLE_POLL });
        }
    });
    watch(poller.thread().clone());
    *managed.state::<MediaState>().poller.lock().unwrap() = Some(poller.thread().clone());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(app: &str, playing: bool) -> Track {
        Track { bus: format!("{PREFIX}{app}"), app: app.into(), playing, title: String::new(), artist: String::new(), position: 0.0, duration: 0.0, can_seek: false, artwork_url: String::new(), shuffle: false, repeat: "none" }
    }

    #[test]
    fn a_pinned_player_wins_then_a_playing_one() {
        let tracks = [track("Spotify", false), track("Firefox", true)];
        assert_eq!(pick(&tracks, Some("Spotify"), None), Some(1));
        assert_eq!(pick(&tracks, None, Some("Spotify")), Some(0));
        assert_eq!(pick(&[], None, None), None);
    }

    #[test]
    fn loop_status_maps_to_the_pages_repeat() {
        assert_eq!((repeat_of("None"), repeat_of("Playlist"), repeat_of("Track"), repeat_of("")), ("none", "list", "track", "none"));
    }

    #[test]
    fn numbers_and_artists_come_in_any_type() {
        assert_eq!(number(&OwnedValue::from(2_000_000i64)), Some(2_000_000.0));
        assert_eq!(number(&OwnedValue::from(7u64)), Some(7.0));
        assert_eq!(artists(&OwnedValue::try_from(zbus::zvariant::Value::from(vec!["A", "B"])).unwrap()), "A, B");
        assert_eq!(artists(&OwnedValue::try_from(zbus::zvariant::Value::from("Solo")).unwrap()), "Solo");
    }

    #[test]
    fn cover_links_the_page_cannot_use_are_left_out() {
        let mut cover = Cover::default();
        assert!(artwork("http://x/y.jpg", &mut cover).is_none());
        assert!(artwork("", &mut cover).is_none());
        assert_eq!(mime_of("/a/b.PNG"), "image/png");
    }
}
