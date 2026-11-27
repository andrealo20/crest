//! `crest://license?key=<key>`, the link of pomeloapp.net's thanks page after a purchase: the key lands in the licence field of
//! the Pomelo scope, where only the user's click on Activate sends it to the engine. Never in the Store build.
//!
//! The installer registers the scheme (tauri.windows.conf.json, plugins.deep-link), and the Store package declares it in its
//! manifest (packaging/store/AppxManifest.xml, windows.protocol). A portable or test copy points it at its own exe for the
//! current user (HKCU) the first time a licence panel opens in it, but only while no other program that still exists holds
//! it (an installed Crest keeps it). A link starts Crest with the link as its argument; a second start hands its
//! arguments to the running one (single-instance), which comes here.

use std::path::Path;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Url};

const SCHEME: &str = "crest";
/// The keys' alphabet as the licence service makes them (no 0/O, 1/I/L), in four groups of five: `XXXXX-XXXXX-XXXXX-XXXXX`.
const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/// Far above any real link; a longer argument is not read.
const MAX_LINK: usize = 256;

/// The key of the last link, until the settings window's Pomelo licence panel takes it.
static PENDING: Mutex<Option<String>> = Mutex::new(None);

/// A key in its one form: upper case, spaces taken out, then exactly the four groups of ALPHABET.
pub fn key(text: &str) -> Option<String> {
    let key: String = text.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_ascii_uppercase();
    let ok = key.len() == 23 && key.bytes().enumerate().all(|(i, b)| if i % 6 == 5 { b == b'-' } else { ALPHABET.contains(&b) });
    ok.then_some(key)
}

/// The key of `crest://license?key=<key>` (also `crest:license?key=`), None for any other link: another scheme, host or path,
/// a user, port or fragment, or any query but the one `key`.
pub fn parse(link: &str) -> Option<String> {
    if link.len() > MAX_LINK {
        return None;
    }
    let url = Url::parse(link).ok()?;
    let target = match url.host_str() {
        Some(host) => host.eq_ignore_ascii_case("license") && matches!(url.path(), "" | "/"),
        None => url.path().eq_ignore_ascii_case("license"),
    };
    if url.scheme() != SCHEME || !target || url.port().is_some() || !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return None;
    }
    let mut pairs = url.query_pairs();
    let (name, value) = pairs.next()?;
    if name != "key" || pairs.next().is_some() {
        return None;
    }
    key(&value)
}

/// A start's arguments (this process's, or a second start's): false without a `crest:` one. With one, a good key opens the
/// settings on the Pomelo licence panel; anything else is left there and logged, without the link, which may hold a key.
pub fn handle(app: &AppHandle, args: impl IntoIterator<Item = String>) -> bool {
    let Some(link) = args.into_iter().find(|a| a.get(..6).is_some_and(|p| p.eq_ignore_ascii_case("crest:"))) else {
        return false;
    };
    let Some(key) = parse(&link) else {
        eprintln!("licence link ignored: not crest://license?key=<key> ({} bytes)", link.len());
        return true;
    };
    *PENDING.lock().unwrap() = Some(key);
    // The settings window's panel takes it now if open, or as its page loads; never a panel elsewhere.
    let _ = app.emit_to("settings", "licence://key", ());
    // The Pomelo scope is offered wherever links are (Windows, not the Store). Without the package its panel keeps the key
    // until the download beside it is done.
    crate::settings_window::open_settings(app, Some("pomelo-license".into()));
    true
}

/// Who answers the scheme now, from its command in HKCR (the user's over the machine's).
#[cfg_attr(feature = "store", allow(dead_code))]
#[derive(Debug, PartialEq)]
enum Holder {
    /// No one, or a program that is gone: this copy may take it.
    Free,
    Me,
    /// Another program that exists, an installed Crest included: left as it is.
    Other(String),
}

#[cfg_attr(feature = "store", allow(dead_code))]
fn holder(command: Option<&str>, me: &Path, exists: impl Fn(&Path) -> bool) -> Holder {
    let Some(exe) = command.and_then(|c| crate::browser_search::split_command(c).into_iter().next()).filter(|e| !e.is_empty()) else {
        return Holder::Free;
    };
    let plain = |p: &str| p.trim_start_matches(r"\\?\").to_lowercase();
    if plain(&exe) == plain(&me.to_string_lossy()) {
        Holder::Me
    } else if exists(Path::new(&exe)) {
        Holder::Other(exe)
    } else {
        Holder::Free
    }
}

/// The key of the last link, once, when `take` (the settings window's Pomelo licence panel). Every licence panel asks, and the
/// first ask points the scheme at this exe for the current user when it is free.
#[tauri::command]
pub fn files_link_key(app: AppHandle, take: bool) -> Option<String> {
    // The Store package's manifest holds the scheme.
    #[cfg(not(feature = "store"))]
    register(&app);
    #[cfg(feature = "store")]
    let _ = app;
    if take {
        PENDING.lock().unwrap().take()
    } else {
        None
    }
}

/// Once per run: the scheme to this exe for the current user, when it is free.
#[cfg(not(feature = "store"))]
fn register(app: &AppHandle) {
    use tauri_plugin_deep_link::DeepLinkExt;
    use windows::Win32::System::Registry::HKEY_CLASSES_ROOT;
    static REGISTER: std::sync::Once = std::sync::Once::new();
    REGISTER.call_once(|| {
        let Ok(me) = std::env::current_exe() else { return };
        match holder(crate::browser_search::reg_string(HKEY_CLASSES_ROOT, r"crest\shell\open\command", None).as_deref(), &me, |p| p.is_file()) {
            Holder::Me => {}
            Holder::Other(exe) => eprintln!("licence link: {SCHEME}: belongs to {exe}, left as it is"),
            Holder::Free => {
                if let Err(e) = app.deep_link().register(SCHEME) {
                    eprintln!("licence link: could not register {SCHEME}: {e}");
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_scheme_is_taken_only_when_free_or_its_program_is_gone() {
        let me = Path::new(r"D:\Crest portable\Crest.exe");
        let there = |p: &Path| p.to_string_lossy().starts_with(r"C:\Program Files");
        assert_eq!(holder(None, me, there), Holder::Free);
        assert_eq!(holder(Some(""), me, there), Holder::Free);
        assert_eq!(holder(Some(r#""D:\crest PORTABLE\crest.exe" "%1""#), me, there), Holder::Me);
        assert_eq!(holder(Some(r#""\\?\D:\Crest portable\Crest.exe" "%1""#), me, there), Holder::Me);
        // An installed Crest, or any other program that is there, keeps it.
        assert_eq!(holder(Some(r#""C:\Program Files\Crest\Crest.exe" "%1""#), me, there), Holder::Other(r"C:\Program Files\Crest\Crest.exe".into()));
        // A portable or test copy since deleted gives it up.
        assert_eq!(holder(Some(r#""E:\old copy\Crest.exe" "%1""#), me, there), Holder::Free);
    }

    const KEY: &str = "ABCDE-FGHJK-MNPQR-STUV2";

    #[test]
    fn keys_are_normalised_then_checked() {
        assert_eq!(key(KEY).as_deref(), Some(KEY));
        assert_eq!(key(" abcde-fghjk-mnpqr-stuv2 ").as_deref(), Some(KEY));
        assert_eq!(key("ABCDE - FGHJK - MNPQR - STUV2").as_deref(), Some(KEY));
        for bad in [
            "",
            "ABCDEFGHJKMNPQRSTUV2",            // no dashes
            "ABCDE-FGHJK-MNPQR-STUV",          // short
            "ABCDE-FGHJK-MNPQR-STUV22",        // long
            "ABCDE-FGHJK-MNPQR-STUV2-ABCDE",   // a fifth group
            "ABCDE-FGHJK-MNPQR-STUV0",         // 0
            "ABCDE-FGHJK-MNPQR-STUVO",         // O
            "ABCDE-FGHJK-MNPQR-STUV1",         // 1
            "ABCDE-FGHJK-MNPQR-STUVI",         // I
            "ABCDE-FGHJK-MNPQR-STUVL",         // L
            "ABCDEF-GHJK-MNPQR-STUV2",         // dash out of place
            "ABCDE_FGHJK_MNPQR_STUV2",
            "ABCDE-FGHJK-MNPQR-STUVÉ",
            "ABCDE-FGHJK-MNPQR-STU\u{0}2",
            "ABCDE-FGHJK-MNPQR-ST\"V2",
        ] {
            assert_eq!(key(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn only_the_licence_link_with_one_key_passes() {
        for good in [
            "crest://license?key=ABCDE-FGHJK-MNPQR-STUV2",
            "crest://license/?key=ABCDE-FGHJK-MNPQR-STUV2",
            "crest:license?key=ABCDE-FGHJK-MNPQR-STUV2",
            "CREST://LICENSE?key=abcde-fghjk-mnpqr-stuv2",
            "crest://license?key=%20abcde-fghjk-mnpqr-stuv2%20",
            "crest://license?key=ABCDE+-FGHJK-MNPQR-STUV2",
        ] {
            assert_eq!(parse(good).as_deref(), Some(KEY), "{good}");
        }
        // A space in place of a dash is not a dash.
        assert_eq!(parse("crest://license?key=abcde%20fghjk-mnpqr-stuv2"), None);
    }

    #[test]
    fn every_other_link_is_ignored() {
        let long = format!("crest://license?key={KEY}&pad={}", "A".repeat(300));
        for bad in [
            "",
            "license?key=ABCDE-FGHJK-MNPQR-STUV2",
            "https://license?key=ABCDE-FGHJK-MNPQR-STUV2",
            "http://pomeloapp.net/crest/license?key=ABCDE-FGHJK-MNPQR-STUV2",
            "file:///C:/license?key=ABCDE-FGHJK-MNPQR-STUV2",
            "crestx://license?key=ABCDE-FGHJK-MNPQR-STUV2",
            "crest://licence?key=ABCDE-FGHJK-MNPQR-STUV2",
            "crest://settings?key=ABCDE-FGHJK-MNPQR-STUV2",
            "crest://license/activate?key=ABCDE-FGHJK-MNPQR-STUV2",
            "crest://license/../settings?key=ABCDE-FGHJK-MNPQR-STUV2",
            "crest:///license?key=ABCDE-FGHJK-MNPQR-STUV2",
            "crest://lic%65nse?key=ABCDE-FGHJK-MNPQR-STUV2",
            "crest://user@license?key=ABCDE-FGHJK-MNPQR-STUV2",
            "crest://license:8080?key=ABCDE-FGHJK-MNPQR-STUV2",
            "crest://license?key=ABCDE-FGHJK-MNPQR-STUV2#x",
            "crest://license",
            "crest://license?",
            "crest://license?key=",
            "crest://license?Key=ABCDE-FGHJK-MNPQR-STUV2",
            "crest://license?code=ABCDE-FGHJK-MNPQR-STUV2",
            "crest://license?key=ABCDE-FGHJK-MNPQR-STUV2&key=ABCDE-FGHJK-MNPQR-STUV3",
            "crest://license?key=ABCDE-FGHJK-MNPQR-STUV2&activate=1",
            "crest://license?activate=1&key=ABCDE-FGHJK-MNPQR-STUV2",
            "crest://license?key=ABCDE-FGHJK-MNPQR-STUV2-ABCDE-FGHJK-MNPQR-STUV2",
            "crest://license?key=ABCDE-FGHJK-MNPQR-STUV0",
            "crest://license?key=ABCDE-FGHJK-MNPQR-STUV%22",
            "crest://license?key=ABCDE-FGHJK-MNPQR-STUV%00",
            "crest://license?key=ABCDE-FGHJK-MNPQR-STU%C3%892",
            "crest://license?key=<script>",
            long.as_str(),
        ] {
            assert_eq!(parse(bad), None, "{bad}");
        }
        assert_eq!(parse(&format!("crest://license?key={}", "A".repeat(10_000))), None);
    }
}
