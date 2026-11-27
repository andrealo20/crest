//! The saved keys on Linux, in the desktop's own secret store.
//!
//! The Secret Service is the freedesktop interface that GNOME Keyring, KWallet and KeePassXC all answer, so this is the
//! Keychain and the Credential Manager of the other platforms (secrets.rs). Each key is an item in the default collection,
//! found again by its attributes. Where nothing answers (a bare window manager) a key can't be saved, and the error says so.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use secret_service::blocking::SecretService;
use secret_service::EncryptionType;

const NONE: &str = "no secret store (GNOME Keyring, KWallet or KeePassXC) is running to keep the key in";

fn attributes(target: &str) -> HashMap<&str, &str> {
    HashMap::from([("application", "crest"), ("target", target)])
}

fn connect() -> Result<SecretService<'static>, String> {
    SecretService::connect(EncryptionType::Dh).map_err(|_| NONE.to_string())
}

/// When an unlock prompt was last turned down, or failed. The pages read keys at every refresh, so asking again at once would put
/// the prompt back at once, and each ask holds the worker that makes it until the user answers.
static DECLINED: Mutex<Option<Instant>> = Mutex::new(None);
const ASK_AGAIN: Duration = Duration::from_secs(300);

fn declined_lately(at: Option<Instant>) -> bool {
    at.is_some_and(|at| at.elapsed() < ASK_AGAIN)
}

pub fn read(target: &str) -> Option<String> {
    let service = connect().ok()?;
    let found = service.search_items(attributes(target)).ok()?;
    if let Some(item) = found.unlocked.first() {
        return String::from_utf8(item.get_secret().ok()?).ok();
    }
    let item = found.locked.first()?;
    if declined_lately(*DECLINED.lock().unwrap_or_else(|e| e.into_inner())) {
        return None;
    }
    // A locked item asks the user to unlock it, as any app reading the keyring does.
    if item.unlock().is_err() {
        *DECLINED.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
        return None;
    }
    String::from_utf8(item.get_secret().ok()?).ok()
}

pub fn write(target: &str, value: &str) -> Result<(), String> {
    let service = connect()?;
    let collection = service.get_default_collection().map_err(|e| e.to_string())?;
    collection.unlock().map_err(|e| e.to_string())?;
    // `replace`: saving a key again updates it instead of adding another.
    collection.create_item(&format!("Crest {target}"), attributes(target), value.as_bytes(), true, "text/plain").map(|_| ()).map_err(|e| e.to_string())
}

pub fn delete(target: &str) {
    let Ok(service) = connect() else { return };
    let Ok(found) = service.search_items(attributes(target)) else { return };
    for item in found.unlocked.iter().chain(found.locked.iter()) {
        let _ = item.delete();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_turned_down_unlock_is_not_asked_again_at_once() {
        assert!(!declined_lately(None));
        assert!(declined_lately(Some(Instant::now())));
        assert!(!declined_lately(Instant::now().checked_sub(ASK_AGAIN + Duration::from_secs(1))));
    }

    /// Needs a running Secret Service, so it is skipped by default: `cargo test -- --ignored linux::secrets`.
    #[test]
    #[ignore = "needs a Secret Service on the session bus"]
    fn a_key_round_trips_and_is_replaced_and_deleted() {
        let target = "Crest/test-roundtrip";
        delete(target);
        assert_eq!(read(target), None);
        write(target, "first").unwrap();
        assert_eq!(read(target).as_deref(), Some("first"));
        write(target, "second").unwrap();
        assert_eq!(read(target).as_deref(), Some("second"));
        delete(target);
        assert_eq!(read(target), None);
    }

    /// The commands are async and read keys on a Tokio worker; a blocking D-Bus call there must not panic.
    #[test]
    #[ignore = "needs a Secret Service on the session bus"]
    fn a_key_is_read_from_a_tokio_worker() {
        let target = "Crest/test-worker";
        write(target, "value").unwrap();
        let read_on_worker = tauri::async_runtime::block_on(async { tauri::async_runtime::spawn(async move { read(target) }).await.unwrap() });
        delete(target);
        assert_eq!(read_on_worker.as_deref(), Some("value"));
    }
}
