//! The saved keys on Linux, in the desktop's own secret store.
//!
//! The Secret Service is the freedesktop interface that GNOME Keyring, KWallet and KeePassXC all answer, so this is the
//! Keychain and the Credential Manager of the other platforms (secrets.rs). Each key is an item in the default collection,
//! found again by its attributes. Where nothing answers (a bare window manager) a key can't be saved, and the error says so.

use std::collections::HashMap;

use secret_service::blocking::SecretService;
use secret_service::EncryptionType;

const NONE: &str = "no secret store (GNOME Keyring, KWallet or KeePassXC) is running to keep the key in";

fn attributes(target: &str) -> HashMap<&str, &str> {
    HashMap::from([("application", "crest"), ("target", target)])
}

fn connect() -> Result<SecretService<'static>, String> {
    SecretService::connect(EncryptionType::Dh).map_err(|_| NONE.to_string())
}

pub fn read(target: &str) -> Option<String> {
    let service = connect().ok()?;
    let found = service.search_items(attributes(target)).ok()?;
    let item = found.unlocked.first().or(found.locked.first())?;
    // A locked item asks the user to unlock it, as any app reading the keyring does.
    item.unlock().ok()?;
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
