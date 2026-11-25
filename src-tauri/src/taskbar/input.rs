//! The bar's input language (Windows only): the keyboard layout of the window in front, as Windows' indicator by the tray
//! writes it. Read again when the front changes and on the shell hook's `HSHELL_LANGUAGE` (tasks.rs), never polled.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::core::PCWSTR;
use windows::Win32::Globalization::{GetLocaleInfoEx, LCIDToLocaleName, LOCALE_SISO3166CTRYNAME, LOCALE_SISO639LANGNAME2};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyboardLayout, GetKeyboardLayoutList};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

use super::bar;

/// "ITA" over "IT".
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct InputLang {
    lang: String,
    region: String,
}

/// The last one the bar has: sent by `changed`, or read by the page itself (`taskbar_input`).
static LAST: Mutex<Option<InputLang>> = Mutex::new(None);

/// The parts as the indicator writes them: upper case, without spaces around.
fn label(iso639_3: &str, iso3166: &str) -> InputLang {
    InputLang { lang: iso639_3.trim().to_uppercase(), region: iso3166.trim().to_uppercase() }
}

/// One field of locale `name` (NUL ended); empty when Windows has none.
fn info(name: &[u16], kind: u32) -> String {
    let mut buf = [0u16; 16];
    let n = unsafe { GetLocaleInfoEx(PCWSTR(name.as_ptr()), kind, Some(&mut buf)) };
    String::from_utf16_lossy(&buf[..(n.max(1) as usize - 1).min(buf.len())])
}

/// Whether Windows shows its indicator: with more than one keyboard layout, or with a Chinese, Japanese or Korean one, whose
/// input methods all share one layout (Microsoft Pinyin, WeChat and the rest are one zh-CN layout, #99).
fn shown(layouts: i32, langid: u32) -> bool {
    // The primary language: LANG_CHINESE, LANG_JAPANESE, LANG_KOREAN.
    layouts >= 2 || (layouts == 1 && matches!(langid & 0x3ff, 0x04 | 0x11 | 0x12))
}

/// The foreground window's keyboard layout as Windows' indicator writes it: "ITA" over "IT"; None where Windows shows no
/// indicator (`shown`), or when the layout has no locale.
pub(crate) fn current() -> Option<InputLang> {
    let tid = unsafe { GetWindowThreadProcessId(GetForegroundWindow(), None) };
    // The low word is the language id, which is the locale id with the default sort.
    let langid = unsafe { GetKeyboardLayout(tid) }.0 as usize as u32 & 0xffff;
    if !shown(unsafe { GetKeyboardLayoutList(None) }, langid) {
        return None;
    }
    let mut name = [0u16; 85];
    if unsafe { LCIDToLocaleName(langid, Some(&mut name), 0) } == 0 {
        return None;
    }
    Some(label(&info(&name, LOCALE_SISO639LANGNAME2), &info(&name, LOCALE_SISO3166CTRYNAME))).filter(|l| !l.lang.is_empty())
}

/// The input language for the bar's page as it starts; it follows `taskbar://input` after.
#[tauri::command]
pub fn taskbar_input() -> Option<InputLang> {
    let now = current();
    *LAST.lock().unwrap_or_else(|e| e.into_inner()) = now.clone();
    now
}

/// The front or the layout changed (tasks.rs): the primary bar hears the input language when it is another. Only the primary
/// bar draws it, as Windows draws it by the main taskbar's tray.
pub(super) fn changed(app: &AppHandle) {
    let now = current();
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    if *last != now {
        *last = now.clone();
        let _ = app.emit_to(bar::LABEL, "taskbar://input", now);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_label_is_upper_case_and_trimmed() {
        assert_eq!(label("ita", "it"), InputLang { lang: "ITA".into(), region: "IT".into() });
        assert_eq!(label(" eng ", "gb"), InputLang { lang: "ENG".into(), region: "GB".into() });
    }

    #[test]
    fn shown_with_two_layouts_or_with_a_chinese_japanese_or_korean_one() {
        // Italian alone: Windows shows no indicator; with English as well, it does.
        assert!(!shown(1, 0x0410));
        assert!(shown(2, 0x0410));
        // Every Chinese input method shares one layout (#99): Windows still shows its indicator, as for Japanese and Korean.
        for langid in [0x0804, 0x0404, 0x0c04, 0x0411, 0x0412] {
            assert!(shown(1, langid), "{langid:#06x}");
        }
        assert!(!shown(0, 0x0409));
    }

    #[test]
    fn empty_parts_give_empty_strings() {
        assert_eq!(label("", ""), InputLang { lang: String::new(), region: String::new() });
    }

    #[test]
    fn a_locale_gives_its_iso_names() {
        let name: Vec<u16> = "it-IT\0".encode_utf16().collect();
        assert_eq!(label(&info(&name, LOCALE_SISO639LANGNAME2), &info(&name, LOCALE_SISO3166CTRYNAME)), label("ita", "it"));
    }
}
