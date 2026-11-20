//! The volume mixer of the Now Playing tool on Linux (the Windows one is mixer.rs): one row per program that is playing sound,
//! with its level and mute. PipeWire's own tools do the work: `pw-dump` lists the playback streams and `wpctl` sets them, so
//! it follows whatever the desktop uses (speakers, headphones, Bluetooth) and needs nothing installed beyond PipeWire.

use std::process::Command;

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use super::media::MediaState;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppVolume {
    /// The program's lowercase name; identifies the row when setting the volume.
    id: String,
    name: String,
    /// The program's icon as a data URL; none here yet.
    icon: Option<String>,
    level: f32,
    muted: bool,
    /// This program is the source of what is playing.
    media: bool,
}

/// One playback stream. A program may have several (a browser with a few tabs).
#[derive(Debug, PartialEq)]
struct Stream {
    node: u64,
    id: String,
    name: String,
    level: f32,
    muted: bool,
}

/// Letters and digits only, lowercase: "Mozilla Firefox" and "firefox" compare.
fn squash(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase()
}

/// Does the media player's name belong to this program? "Chrome" is `chrome`, "Mozilla Firefox" contains `firefox`.
fn matches(player: &str, id: &str) -> bool {
    let (player, id) = (squash(player), squash(id));
    !player.is_empty() && !id.is_empty() && (player == id || (id.len() >= 4 && player.contains(&id)) || (player.len() >= 4 && id.contains(&player)))
}

/// The playback streams in `pw-dump`'s output.
fn parse(json: &[u8]) -> Vec<Stream> {
    let Ok(Value::Array(objects)) = serde_json::from_slice::<Value>(json) else { return Vec::new() };
    objects
        .iter()
        .filter(|o| o["type"] == "PipeWire:Interface:Node")
        .filter_map(|o| {
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
                level: params["volume"].as_f64().unwrap_or(1.0) as f32,
                muted: params["mute"].as_bool().unwrap_or(false),
            })
        })
        .collect()
}

fn streams() -> Result<Vec<Stream>, String> {
    let out = Command::new("pw-dump").output().map_err(|_| "pw-dump (PipeWire) is not installed".to_string())?;
    Ok(parse(&out.stdout))
}

/// One row per program: the loudest unmuted level wins, and a row is muted only when all its streams are.
fn rows(streams: Vec<Stream>, playing: &str) -> Vec<AppVolume> {
    let mut rows: Vec<AppVolume> = Vec::new();
    for s in streams {
        if let Some(row) = rows.iter_mut().find(|r| r.id == s.id) {
            if !s.muted && row.muted {
                row.level = s.level;
            } else if s.muted == row.muted {
                row.level = row.level.max(s.level);
            }
            row.muted &= s.muted;
            continue;
        }
        rows.push(AppVolume { media: matches(playing, &s.id), id: s.id, name: s.name, icon: None, level: s.level, muted: s.muted });
    }
    rows
}

#[tauri::command]
pub async fn mixer_list(media: State<'_, MediaState>) -> Result<Vec<AppVolume>, String> {
    let playing = media.shown().map(|(id, _)| id).unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || streams().map(|s| rows(s, &playing))).await.map_err(|e| e.to_string())?
}

fn wpctl(args: &[&str]) -> Result<(), String> {
    let status = Command::new("wpctl").args(args).status().map_err(|_| "wpctl (WirePlumber) is not installed".to_string())?;
    status.success().then_some(()).ok_or_else(|| format!("wpctl {} failed", args.join(" ")))
}

/// Sets level (0..1) and/or mute for every stream of the program `id`.
#[tauri::command]
pub async fn mixer_set(id: String, level: Option<f32>, muted: Option<bool>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        for s in streams()?.into_iter().filter(|s| s.id == id) {
            let node = s.node.to_string();
            if let Some(l) = level {
                wpctl(&["set-volume", &node, &format!("{:.3}", l.clamp(0.0, 1.0))])?;
                // Raising the level of a muted program unmutes it, as on Windows.
                if l > 0.0 && muted.is_none() {
                    let _ = wpctl(&["set-mute", &node, "0"]);
                }
            }
            if let Some(m) = muted {
                wpctl(&["set-mute", &node, if m { "1" } else { "0" }])?;
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const DUMP: &str = r#"[
      {"id": 142, "type": "PipeWire:Interface:Node", "info": {"props": {"media.class": "Stream/Output/Audio", "application.name": "Google Chrome", "application.process.binary": "chrome"},
        "params": {"Props": [{"mute": false}, {"volume": 0.5, "mute": true, "channelVolumes": [0.5, 0.5]}]}}},
      {"id": 150, "type": "PipeWire:Interface:Node", "info": {"props": {"media.class": "Stream/Output/Audio", "application.name": "Google Chrome", "application.process.binary": "/opt/google/chrome/chrome"},
        "params": {"Props": [{"volume": 0.8, "mute": false}]}}},
      {"id": 63, "type": "PipeWire:Interface:Node", "info": {"props": {"media.class": "Audio/Sink", "node.name": "alsa_output"}, "params": {"Props": [{"volume": 1.0}]}}},
      {"id": 7, "type": "PipeWire:Interface:Client", "info": {"props": {}}}
    ]"#;

    #[test]
    fn only_playback_streams_are_read_with_their_level_and_mute() {
        let streams = parse(DUMP.as_bytes());
        assert_eq!(streams.len(), 2);
        assert_eq!(streams[0], Stream { node: 142, id: "chrome".into(), name: "Google Chrome".into(), level: 0.5, muted: true });
        assert_eq!(streams[1].id, "chrome", "a full path is cut to the program name");
        assert!(parse(b"not json").is_empty());
    }

    #[test]
    fn a_program_with_several_streams_is_one_row_with_the_audible_level() {
        let rows = rows(parse(DUMP.as_bytes()), "Chrome");
        assert_eq!(rows.len(), 1);
        // The muted stream (0.5) gives way to the audible one (0.8); not all are muted.
        assert_eq!((rows[0].level, rows[0].muted, rows[0].media), (0.8, false, true));
    }

    #[test]
    fn a_player_name_matches_its_program() {
        assert!(matches("Chrome", "chrome"));
        assert!(matches("Mozilla Firefox", "firefox"));
        assert!(!matches("Spotify", "chrome"));
        assert!(!matches("", "chrome"));
    }
}
