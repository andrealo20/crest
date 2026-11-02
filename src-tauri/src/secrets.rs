//! API keys in Windows Credential Manager (on a Mac in the login Keychain, service "Crest", account "Crest/<name>").
//!
//! The frontend can only set, delete and check whether a key exists. Only Rust can
//! read them (for HTTP calls), so no secret ever reaches the WebView.
//! Visible under Control Panel → Credential Manager → "Crest/…".
//!
//! Earlier versions used "Notch/…", the prefix L4-Notchbar uses too. Entries of the two
//! apps can't be told apart, so `migrate_legacy` copies them once and leaves the originals.

use std::path::Path;

#[cfg(windows)]
use windows::core::{HSTRING, PWSTR};
#[cfg(windows)]
use windows::Win32::Security::Credentials::{
    CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
};

/// Allowed names, so the frontend can't create arbitrary entries.
const ALLOWED: &[&str] = &["t212.key", "t212.secret", "ai.anthropic", "ai.openai", "ai.openrouter", "ai.custom", "discord.secret", "discord.token", "usage.deepseek", "usage.zai", "github.token", "kraken.key", "kraken.secret", "coinbase.key", "coinbase.secret", "binance.key", "binance.secret", "bitpanda.key", "etoro.key", "etoro.user", "ibkr.token", "ibkr.query"];

const PREFIX: &str = "Crest/";
/// Shared with L4-Notchbar, only ever read (and only by `migrate_legacy`).
const LEGACY_PREFIX: &str = "Notch/";
/// In the app data folder: the one-time copy from the legacy prefix has run.
const MIGRATED_MARKER: &str = "credentials-migrated";

/// Calendar sources keep their ICS link or CalDAV password as `calendar.<source id>` (src-tauri/src/calendar.rs).
fn calendar_name(name: &str) -> bool {
    name.strip_prefix("calendar.").is_some_and(|id| !id.is_empty() && id.len() <= 24 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()))
}

fn target_name(name: &str) -> Result<String, String> {
    if !ALLOWED.contains(&name) && !calendar_name(name) {
        return Err(format!("Unknown key: {name}"));
    }
    Ok(format!("{PREFIX}{name}"))
}

fn legacy_target_name(name: &str) -> Result<String, String> {
    target_name(name).map(|_| format!("{LEGACY_PREFIX}{name}"))
}

#[cfg(windows)]
fn read_target(target: &str) -> Option<String> {
    let target = HSTRING::from(target);
    unsafe {
        let mut cred: *mut CREDENTIALW = std::ptr::null_mut();
        CredReadW(&target, CRED_TYPE_GENERIC, None, &mut cred).ok()?;
        let blob = std::slice::from_raw_parts((*cred).CredentialBlob, (*cred).CredentialBlobSize as usize);
        let value = String::from_utf8(blob.to_vec()).ok();
        CredFree(cred as *const _);
        value
    }
}

#[cfg(windows)]
fn write_target(target: &str, value: &str) -> Result<(), String> {
    let mut blob = value.as_bytes().to_vec();
    let mut target_w: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
    let cred = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target_w.as_mut_ptr()),
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        ..Default::default()
    };
    unsafe { CredWriteW(&cred, 0) }.map_err(|e| e.message())
}

#[cfg(windows)]
fn delete_target(target: &str) {
    let target = HSTRING::from(target);
    // Not existing isn't an error.
    let _ = unsafe { CredDeleteW(&target, CRED_TYPE_GENERIC, None) };
}

#[cfg(target_os = "macos")]
const SERVICE: &str = "Crest";

#[cfg(target_os = "macos")]
fn read_target(target: &str) -> Option<String> {
    String::from_utf8(security_framework::passwords::get_generic_password(SERVICE, target).ok()?).ok()
}

#[cfg(target_os = "macos")]
fn write_target(target: &str, value: &str) -> Result<(), String> {
    security_framework::passwords::set_generic_password(SERVICE, target, value.as_bytes()).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn delete_target(target: &str) {
    let _ = security_framework::passwords::delete_generic_password(SERVICE, target);
}

pub fn read(name: &str) -> Option<String> {
    read_target(&target_name(name).ok()?)
}

/// Copies "Notch/<name>" to "Crest/<name>" where Crest has none yet, once per install
/// (the marker keeps a key deleted in Crest from coming back). The originals stay.
pub fn migrate_legacy(data_dir: &Path) {
    let marker = data_dir.join(MIGRATED_MARKER);
    if marker.exists() {
        return;
    }
    for name in ALLOWED {
        let (Ok(new), Ok(old)) = (target_name(name), legacy_target_name(name)) else { continue };
        if read_target(&new).is_some() {
            continue;
        }
        if let Some(value) = read_target(&old) {
            // A failed copy is retried on the next start.
            if write_target(&new, &value).is_err() {
                return;
            }
        }
    }
    let _ = std::fs::create_dir_all(data_dir);
    let _ = std::fs::write(marker, "");
}

#[tauri::command]
pub fn secret_set(name: String, value: String) -> Result<(), String> {
    let target = target_name(&name)?;
    let value = value.trim();
    if value.is_empty() {
        return secret_delete(name);
    }
    write_target(&target, value)
}

#[tauri::command]
pub fn secret_delete(name: String) -> Result<(), String> {
    delete_target(&target_name(&name)?);
    Ok(())
}

#[tauri::command]
pub fn secret_has(name: String) -> bool {
    read(&name).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_use_the_crest_prefix() {
        assert_eq!(target_name("ai.openai").unwrap(), "Crest/ai.openai");
        assert_eq!(target_name("discord.token").unwrap(), "Crest/discord.token");
    }

    #[test]
    fn legacy_targets_use_the_notch_prefix() {
        assert_eq!(legacy_target_name("t212.key").unwrap(), "Notch/t212.key");
    }

    #[test]
    fn unknown_names_are_rejected_for_both_prefixes() {
        assert!(target_name("ai.other").is_err());
        assert!(legacy_target_name("Notch/ai.openai").is_err());
        assert!(target_name("").is_err());
        assert_eq!(target_name("calendar.k3x9a").unwrap(), "Crest/calendar.k3x9a");
        assert!(target_name("calendar.").is_err());
        assert!(target_name("calendar.A/b").is_err());
    }

    #[test]
    fn every_allowed_name_maps_to_distinct_targets() {
        for name in ALLOWED {
            assert_ne!(target_name(name).unwrap(), legacy_target_name(name).unwrap());
        }
    }
}
