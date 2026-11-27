//! The volume mixer of the Now Playing tool on Linux (the Windows one is mixer.rs): one row per program that is playing sound,
//! with its level and mute. PipeWire's own tools do the work: one `pw-dump --monitor` keeps the list of playback streams
//! (pipewire.rs) and `wpctl` sets them, so it follows whatever the desktop uses (speakers, headphones, Bluetooth) and needs
//! nothing installed beyond PipeWire.

use std::process::Command;

use serde::Serialize;
use tauri::State;

use super::media::MediaState;
use super::pipewire::{self, Stream};

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

/// Letters and digits only, lowercase: "Mozilla Firefox" and "firefox" compare.
fn squash(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase()
}

/// Does the media player's name belong to this program? "Chrome" is `chrome`, "Mozilla Firefox" contains `firefox`.
fn matches(player: &str, id: &str) -> bool {
    let (player, id) = (squash(player), squash(id));
    !player.is_empty() && !id.is_empty() && (player == id || (id.len() >= 4 && player.contains(&id)) || (player.len() >= 4 && id.contains(&player)))
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
    tauri::async_runtime::spawn_blocking(move || pipewire::streams().map(|s| rows(s, &playing))).await.map_err(|e| e.to_string())?
}

fn wpctl(args: &[&str]) -> Result<(), String> {
    let status = Command::new("wpctl").args(args).status().map_err(|_| "wpctl (WirePlumber) is not installed".to_string())?;
    status.success().then_some(()).ok_or_else(|| format!("wpctl {} failed", args.join(" ")))
}

/// Sets level (0..1) and/or mute for every stream of the program `id`.
#[tauri::command]
pub async fn mixer_set(id: String, level: Option<f32>, muted: Option<bool>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        for s in pipewire::streams()?.into_iter().filter(|s| s.id == id) {
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

    fn stream(node: u64, id: &str, level: f32, muted: bool) -> Stream {
        Stream { node, id: id.into(), name: "Google Chrome".into(), level, muted }
    }

    #[test]
    fn a_program_with_several_streams_is_one_row_with_the_audible_level() {
        let rows = rows(vec![stream(142, "chrome", 0.5, true), stream(150, "chrome", 0.8, false)], "Chrome");
        assert_eq!(rows.len(), 1);
        // The muted stream (0.5) gives way to the audible one (0.8); not all are muted.
        assert_eq!((rows[0].level, rows[0].muted, rows[0].media), (0.8, false, true));
    }

    #[test]
    fn a_row_is_muted_only_when_all_its_streams_are() {
        let rows = rows(vec![stream(1, "chrome", 0.5, true), stream(2, "chrome", 0.9, true), stream(3, "firefox", 0.2, false)], "");
        assert_eq!(rows.iter().map(|r| (r.id.as_str(), r.level, r.muted)).collect::<Vec<_>>(), [("chrome", 0.9, true), ("firefox", 0.2, false)]);
    }

    #[test]
    fn a_player_name_matches_its_program() {
        assert!(matches("Chrome", "chrome"));
        assert!(matches("Mozilla Firefox", "firefox"));
        assert!(!matches("Spotify", "chrome"));
        assert!(!matches("", "chrome"));
    }
}
