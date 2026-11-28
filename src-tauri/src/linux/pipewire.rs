//! What PipeWire's playback streams are doing, kept up to date from one long-running `pw-dump --monitor` instead of running
//! `pw-dump` again on every refresh of the mixer.
//!
//! `pw-dump --monitor` prints the whole graph once and then, each time an object changes, that whole object again (a removed one
//! with a null `info`). The streams are kept in a small model that the mixer reads from memory. The monitor runs only while the
//! mixer is asked for: it is ended a while after the last ask, and started again by the next one.

use std::collections::HashMap;
use std::io::BufReader;
use std::process::{Command, Stdio};
use std::sync::{Condvar, Mutex, MutexGuard, Once};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;

/// The monitor is ended this long after it was last wanted.
const LINGER: Duration = Duration::from_secs(20);
/// A monitor that cannot start or keeps ending is tried again after this long, and then later.
const RETRY: Duration = Duration::from_secs(5);
const RETRY_MAX: Duration = Duration::from_secs(120);
/// The longest the first answer waits for the first dump.
const FIRST_DUMP: Duration = Duration::from_secs(2);

/// One playback stream. A program may have several (a browser with a few tabs).
#[derive(Debug, Clone, PartialEq)]
pub struct Stream {
    pub node: u64,
    pub id: String,
    pub name: String,
    pub level: f32,
    pub muted: bool,
}

/// The playback stream a node object describes, None for any other object.
fn stream_of(o: &Value) -> Option<Stream> {
    if o["type"] != "PipeWire:Interface:Node" {
        return None;
    }
    let props = &o["info"]["props"];
    if props["media.class"] != "Stream/Output/Audio" {
        return None;
    }
    let name = props["application.name"].as_str().or_else(|| props["node.name"].as_str())?.to_string();
    let binary = props["application.process.binary"].as_str().unwrap_or(&name);
    // The level and mute are in the stream's Props parameter.
    let params = o["info"]["params"]["Props"].as_array()?.iter().find(|p| p.get("volume").is_some())?;
    Some(Stream {
        node: o["id"].as_u64()?,
        id: binary.rsplit('/').next().unwrap_or(binary).to_lowercase(),
        name,
        level: level_of(params),
        muted: params["mute"].as_bool().unwrap_or(false),
    })
}

/// The level as `wpctl` shows and sets it, which is not `Props.volume` (a multiplier of its own, 1.0 until some program sets it):
/// `wpctl set-volume` writes the channel volumes, on a cubic scale, so 50 % is stored as 0.125.
fn level_of(props: &Value) -> f32 {
    let channels: Vec<f64> = props["channelVolumes"].as_array().map(|c| c.iter().filter_map(Value::as_f64).collect()).unwrap_or_default();
    let linear = if channels.is_empty() { props["volume"].as_f64().unwrap_or(1.0) } else { channels.iter().sum::<f64>() / channels.len() as f64 };
    linear.max(0.0).cbrt() as f32
}

#[derive(Default)]
pub struct Model {
    streams: HashMap<u64, Stream>,
}

impl Model {
    /// Applies the objects of one array: the first holds everything, later ones the objects that changed.
    pub fn apply(&mut self, objects: &[Value]) {
        for o in objects {
            let Some(id) = o["id"].as_u64() else { continue };
            // A removed object has a null info and no type.
            if o["info"].is_null() {
                self.streams.remove(&id);
            } else if let Some(stream) = stream_of(o) {
                self.streams.insert(id, stream);
            }
        }
    }

    fn list(&self) -> Vec<Stream> {
        let mut streams: Vec<Stream> = self.streams.values().cloned().collect();
        streams.sort_by_key(|s| s.node);
        streams
    }
}

// ---- the monitor ----------------------------------------------------------------------------------------------------

struct Shared {
    streams: Vec<Stream>,
    /// The first dump has arrived: `streams` is the real list, empty or not.
    ready: bool,
    /// The monitor could not be started: PipeWire's tools are not installed.
    missing: bool,
    /// The last time something asked for the monitor.
    wanted: Option<Instant>,
    running: bool,
}

static SHARED: Mutex<Shared> = Mutex::new(Shared { streams: Vec::new(), ready: false, missing: false, wanted: None, running: false });
/// Wakes the thread that runs the monitor (it was wanted) and the callers waiting for the first dump (it arrived).
static CHANGED: Condvar = Condvar::new();
static STARTED: Once = Once::new();

fn shared() -> MutexGuard<'static, Shared> {
    SHARED.lock().unwrap_or_else(|e| e.into_inner())
}

/// The playback streams now. It is read from memory: the monitor is started if it is not running, and the first call waits for its
/// first dump. Err when PipeWire's `pw-dump` is not installed.
pub fn streams() -> Result<Vec<Stream>, String> {
    let mut guard = shared();
    guard.wanted = Some(Instant::now());
    STARTED.call_once(|| {
        thread::spawn(run);
    });
    CHANGED.notify_all();
    let deadline = Instant::now() + FIRST_DUMP;
    while !guard.ready && !guard.missing {
        let Some(left) = deadline.checked_duration_since(Instant::now()) else { break };
        guard = CHANGED.wait_timeout(guard, left).unwrap_or_else(|e| e.into_inner()).0;
    }
    if guard.missing {
        return Err("pw-dump (PipeWire) is not installed".into());
    }
    Ok(guard.streams.clone())
}

fn still_wanted() -> bool {
    shared().wanted.is_some_and(|at| at.elapsed() < LINGER)
}

/// The thread of the monitor: waits to be wanted, runs `pw-dump --monitor` while it is, ends it when it is not.
fn run() {
    let mut retry = RETRY;
    loop {
        let mut guard = shared();
        while !guard.wanted.is_some_and(|at| at.elapsed() < LINGER) {
            guard = CHANGED.wait_timeout(guard, LINGER).unwrap_or_else(|e| e.into_inner()).0;
        }
        drop(guard);
        let started = Instant::now();
        let ok = follow();
        // One that ran for a while was fine; one that fails at once is tried again later and later.
        if ok && started.elapsed() > RETRY {
            retry = RETRY;
        } else {
            thread::sleep(retry);
            retry = (retry * 2).min(RETRY_MAX);
        }
    }
}

/// Runs one `pw-dump --monitor` until it ends or is no longer wanted. False if it could not be started.
fn follow() -> bool {
    let Ok(mut child) = Command::new("pw-dump").arg("--monitor").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn() else {
        shared().missing = true;
        CHANGED.notify_all();
        return false;
    };
    let Some(stdout) = child.stdout.take() else { return false };
    {
        let mut guard = shared();
        guard.running = true;
        guard.missing = false;
    }
    let pid = child.id();
    // A watchdog ends the process when nothing wants it any more: the reader below only wakes when the graph changes.
    let watchdog = thread::spawn(move || {
        while still_wanted() {
            thread::sleep(Duration::from_secs(5));
            if !shared().running {
                return;
            }
        }
        let _ = Command::new("kill").arg(pid.to_string()).status();
    });
    let mut model = Model::default();
    for array in serde_json::Deserializer::from_reader(BufReader::new(stdout)).into_iter::<Value>().flatten() {
        let Some(objects) = array.as_array() else { continue };
        model.apply(objects);
        let mut guard = shared();
        guard.streams = model.list();
        guard.ready = true;
        drop(guard);
        CHANGED.notify_all();
    }
    let _ = child.wait();
    {
        let mut guard = shared();
        guard.running = false;
        // Not known any more: the next ask waits for a new first dump.
        guard.ready = false;
        guard.streams.clear();
    }
    let _ = watchdog.join();
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A playback stream as `pw-dump` shows it. `volume` and `channels` differ on purpose: they are different things.
    fn stream(id: u64, name: &str, volume: f64, channels: [f64; 2], mute: bool) -> Value {
        serde_json::json!({
            "id": id, "type": "PipeWire:Interface:Node",
            "info": { "state": "running", "props": { "media.class": "Stream/Output/Audio", "application.name": name, "application.process.binary": name.to_lowercase() },
                "params": { "Props": [{ "mute": false }, { "volume": volume, "mute": mute, "channelVolumes": channels }] } }
        })
    }

    fn all(model: &Model) -> Vec<(u64, String, f32, bool)> {
        model.list().into_iter().map(|s| (s.node, s.id, s.level, s.muted)).collect()
    }

    #[test]
    fn the_level_is_what_wpctl_shows_not_the_streams_own_volume() {
        // `wpctl set-volume 109 0.5` stores 0.125 in the channel volumes and leaves Props.volume (here 0.05) alone.
        let mut model = Model::default();
        model.apply(&[stream(109, "Player", 0.05, [0.125, 0.125], false)]);
        let level = model.list()[0].level;
        assert!((level - 0.5).abs() < 1e-6, "{level}");
        // A fresh stream: channels at 1.0 is 100 %, whatever Props.volume says.
        model.apply(&[stream(109, "Player", 0.05, [1.0, 1.0], false)]);
        assert!((model.list()[0].level - 1.0).abs() < 1e-6);
        // Muted and silent are different: the level stays, the mute is its own.
        model.apply(&[stream(109, "Player", 1.0, [0.125, 0.125], true)]);
        assert_eq!((model.list()[0].muted, (model.list()[0].level * 100.0).round()), (true, 50.0));
    }

    #[test]
    fn a_stream_without_channel_volumes_falls_back_to_its_volume() {
        let mut o = stream(1, "Player", 0.125, [0.0, 0.0], false);
        o["info"]["params"]["Props"][1].as_object_mut().unwrap().remove("channelVolumes");
        let mut model = Model::default();
        model.apply(&[o]);
        assert!((model.list()[0].level - 0.5).abs() < 1e-6);
    }

    #[test]
    fn later_arrays_update_and_remove_what_the_first_one_held() {
        let mut model = Model::default();
        let sink = serde_json::json!({ "id": 63, "type": "PipeWire:Interface:Node", "info": { "props": { "media.class": "Audio/Sink", "node.name": "alsa_output" } } });
        let client = serde_json::json!({ "id": 7, "type": "PipeWire:Interface:Client", "info": { "props": {} } });
        model.apply(&[stream(142, "Chrome", 1.0, [1.0, 1.0], false), stream(150, "Firefox", 1.0, [0.125, 0.125], false), sink, client]);
        assert_eq!(all(&model).iter().map(|s| s.0).collect::<Vec<_>>(), [142, 150], "only playback streams are kept");
        // One object again, with its new state: the whole thing replaces the old.
        model.apply(&[stream(142, "Chrome", 1.0, [0.027, 0.027], true)]);
        assert_eq!(all(&model)[0], (142, "chrome".to_string(), 0.3, true));
        // It is removed: a null info and nothing else.
        model.apply(&[serde_json::json!({ "id": 142, "info": null })]);
        assert_eq!(all(&model).iter().map(|s| s.0).collect::<Vec<_>>(), [150]);
        // A full path is cut to the program name.
        let mut o = stream(151, "Opera", 1.0, [1.0, 1.0], false);
        o["info"]["props"]["application.process.binary"] = "/opt/google/chrome/chrome".into();
        model.apply(&[o]);
        assert_eq!(model.list()[1].id, "chrome");
    }

    /// The monitor on this machine's PipeWire: one dump, then the mixer's list from memory. Needs PipeWire running.
    #[test]
    #[ignore = "needs a running PipeWire"]
    fn the_live_monitor_answers_from_memory() {
        let first = streams().expect("pw-dump");
        let again = std::time::Instant::now();
        streams().unwrap();
        assert!(again.elapsed() < Duration::from_millis(50), "a second ask must not start a program");
        println!("{} streams", first.len());
    }
}
