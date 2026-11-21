// Adapted from ManagedShell (Apache-2.0, github.com/cairoshell/ManagedShell), src/ManagedShell.WindowsTray/NotifyIcon.cs and NotificationArea.cs (the tray's message formats and the click messages).

//! The wire format of the tray: what apps send to `Shell_TrayWnd` in `WM_COPYDATA` (`Shell_NotifyIcon`, the icon position
//! request) and what Crest sends back to them. Pure: explicit little-endian reads with bounds checks, no window, no Win32 calls.
//! The handle fields are 32 bits on x64 and ARM64 alike, so one layout covers both.

use windows::core::GUID;
use windows::Win32::Foundation::RECT;
use windows::Win32::UI::Shell::{
    ABM_GETTASKBARPOS, ABM_QUERYPOS, ABM_SETPOS, NIF_GUID, NIF_ICON, NIF_MESSAGE, NIF_STATE, NIF_TIP, NIN_SELECT, NIS_HIDDEN,
};
use windows::Win32::UI::WindowsAndMessaging::{
    WM_ACTIVATEAPP, WM_COMMAND, WM_CONTEXTMENU, WM_COPYDATA, WM_LBUTTONDBLCLK, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_USER,
};

/// `COPYDATASTRUCT.dwData` of `Shell_NotifyIcon`.
const DW_ICON: usize = 1;
/// `COPYDATASTRUCT.dwData` of the icon position request.
const DW_GET_RECT: usize = 3;
/// The payload of dwData 1 through its GUID (8 header bytes, then the NOTIFYICONDATA up to `guidItem` + 16).
const ICON_LEN: usize = 8 + 952;
/// The payload of dwData 3 through its GUID.
const RECT_LEN: usize = 40;
/// The first registered message number: registered messages are not forwarded.
const REGISTERED: u32 = 0xC000;
/// An appbar call's payload (dwData 0), the same from 32- and 64-bit apps: the 40-byte `APPBARDATA` with 32-bit handles, the
/// message at 40, then the shared memory that carries the answer, its handle (64 bits) at 48 and its process at 56.
const APPBAR_LEN: usize = 64;
const SHARED_AT: usize = 48;
const PID_AT: usize = 56;
/// The `APPBARDATA` in that payload and in the shared memory.
pub(crate) const ABD_LEN: usize = 40;

/// What an app asked of the icon.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum IconOp {
    Add,
    Modify,
    Delete,
    SetFocus,
    SetVersion,
}

/// How an icon is known: by its GUID when the app gave one, else by its window and id.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) enum IconKey {
    Guid(GUID),
    Id { hwnd: u32, uid: u32 },
}

/// The fields of a `NOTIFYICONDATA` that Crest uses. An optional field is `Some` only when its flag says the app set it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct IconData {
    pub(crate) key: IconKey,
    /// The callback window and id, always read from the payload: a GUID key drops them, the clicks still need them.
    pub(crate) hwnd: u32,
    pub(crate) uid: u32,
    pub(crate) flags: u32,
    pub(crate) callback: Option<u32>,
    pub(crate) hicon: Option<u32>,
    pub(crate) tip: Option<String>,
    pub(crate) hidden: Option<bool>,
    pub(crate) version: Option<u32>,
}

/// A parsed `WM_COPYDATA` payload.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Msg {
    Icon(IconOp, IconData),
    /// The icon position request; `corner` 1 asks for (left, top), 2 for (right, bottom).
    GetRect { key: IconKey, corner: u32 },
    /// An appbar message (dwData 0): forwarded, not read.
    AppBar,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Button {
    Left,
    Right,
    Double,
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at.checked_add(4)?)?.try_into().ok()?))
}

fn guid_at(b: &[u8], at: usize) -> Option<GUID> {
    let d = b.get(at..at.checked_add(16)?)?;
    Some(GUID::from_values(
        u32::from_le_bytes(d[0..4].try_into().ok()?),
        u16::from_le_bytes(d[4..6].try_into().ok()?),
        u16::from_le_bytes(d[6..8].try_into().ok()?),
        d[8..16].try_into().ok()?,
    ))
}

/// The 128-unit tip: UTF-16 up to the first NUL, without carriage returns.
fn tip_at(b: &[u8], at: usize) -> Option<String> {
    let raw = b.get(at..at.checked_add(256)?)?;
    let units: Vec<u16> = raw.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).take_while(|&u| u != 0).collect();
    Some(String::from_utf16_lossy(&units).replace('\r', ""))
}

/// Reads the payload of a `WM_COPYDATA` sent to the tray. A payload too short for its dwData's layout is `Other`.
pub(crate) fn parse(dw_data: usize, bytes: &[u8]) -> Msg {
    match dw_data {
        DW_ICON => parse_icon(bytes).unwrap_or(Msg::Other),
        DW_GET_RECT => parse_rect(bytes).unwrap_or(Msg::Other),
        0 => Msg::AppBar,
        _ => Msg::Other,
    }
}

fn parse_icon(b: &[u8]) -> Option<Msg> {
    if b.len() < ICON_LEN {
        return None;
    }
    let op = match u32_at(b, 4)? {
        0 => IconOp::Add,
        1 => IconOp::Modify,
        2 => IconOp::Delete,
        3 => IconOp::SetFocus,
        4 => IconOp::SetVersion,
        _ => return None,
    };
    let n = 8; // the NOTIFYICONDATA
    let (hwnd, uid, flags) = (u32_at(b, n + 4)?, u32_at(b, n + 8)?, u32_at(b, n + 12)?);
    let has = |f: u32| flags & f != 0;
    let key = key(if has(NIF_GUID.0) { guid_at(b, n + 936)? } else { GUID::zeroed() }, hwnd, uid);
    // The state counts only for the bits the mask names.
    let hidden = if has(NIF_STATE.0) && u32_at(b, n + 284)? & NIS_HIDDEN.0 != 0 { Some(u32_at(b, n + 280)? & NIS_HIDDEN.0 != 0) } else { None };
    Some(Msg::Icon(
        op,
        IconData {
            key,
            hwnd,
            uid,
            flags,
            callback: if has(NIF_MESSAGE.0) { u32_at(b, n + 16) } else { None },
            hicon: if has(NIF_ICON.0) { u32_at(b, n + 20) } else { None },
            tip: if has(NIF_TIP.0) { tip_at(b, n + 24) } else { None },
            hidden,
            version: if op == IconOp::SetVersion { u32_at(b, n + 800) } else { None },
        },
    ))
}

fn parse_rect(b: &[u8]) -> Option<Msg> {
    if b.len() < RECT_LEN {
        return None;
    }
    let (corner, hwnd, uid) = (u32_at(b, 4)?, u32_at(b, 16)?, u32_at(b, 20)?);
    Some(Msg::GetRect { key: key(guid_at(b, 24)?, hwnd, uid), corner })
}

/// An icon's key: a zero GUID is none, so a request and the icon it names key alike.
fn key(guid: GUID, hwnd: u32, uid: u32) -> IconKey {
    if guid == GUID::zeroed() { IconKey::Id { hwnd, uid } } else { IconKey::Guid(guid) }
}

/// A name for an icon that survives restarts and updates: its GUID in braces, else the exe (lower case, each version in its
/// folders as `*`) and the id.
pub(crate) fn identity(guid: Option<GUID>, exe: &str, uid: u32) -> String {
    match guid {
        Some(g) => {
            let tail: String = g.data4[2..].iter().map(|b| format!("{b:02x}")).collect();
            format!("{{{:08x}-{:04x}-{:04x}-{:02x}{:02x}-{tail}}}", g.data1, g.data2, g.data3, g.data4[0], g.data4[1])
        }
        None => {
            let exe = exe.to_lowercase();
            let (folders, file) = exe.split_at(exe.rfind(['\\', '/']).map_or(0, |at| at + 1));
            format!("{}{file}:{uid}", unversioned(folders))
        }
    }
}

/// `path` with each run of two or more dot-separated numbers as `*`: Squirrel apps (`app-1.0.9175`) and Store packages
/// (`name_1.2.3.0_x64__id`) keep their exe in a folder named by version, which every update renames.
fn unversioned(path: &str) -> String {
    let b = path.as_bytes();
    let digits_end = |at: usize| at + b[at..].iter().take_while(|c| c.is_ascii_digit()).count();
    let (mut out, mut i) = (String::new(), 0);
    while let Some(skip) = path[i..].find(|c: char| c.is_ascii_digit()) {
        let start = i + skip;
        out.push_str(&path[i..start]);
        let mut end = digits_end(start);
        while b.get(end) == Some(&b'.') && b.get(end + 1).is_some_and(u8::is_ascii_digit) {
            end = digits_end(end + 1);
        }
        out.push_str(if path[start..end].contains('.') { "*" } else { &path[start..end] });
        i = end;
    }
    out + &path[i..]
}

/// The messages a click sends to the icon's window, in order. From version 3 the select or context-menu message follows.
pub(crate) fn click_messages(button: Button, version: u32) -> Vec<u32> {
    let mut v = match button {
        Button::Left => vec![WM_LBUTTONDOWN, WM_LBUTTONUP],
        Button::Right => vec![WM_RBUTTONDOWN, WM_RBUTTONUP],
        Button::Double => return vec![WM_LBUTTONDBLCLK, WM_LBUTTONUP],
    };
    if version >= 3 {
        v.push(if button == Button::Left { NIN_SELECT } else { WM_CONTEXTMENU });
    }
    v
}

/// The (wParam, lParam) of a callback message: version 4 packs the point in wParam and the id with the message in lParam,
/// older versions send the id and the message.
pub(crate) fn callback_args(version: u32, uid: u32, msg: u32, x: i32, y: i32) -> (usize, isize) {
    if version >= 4 {
        let word = |v: u32| v & 0xFFFF;
        ((word(x as u32) | word(y as u32) << 16) as usize, (word(uid) << 16 | word(msg)) as isize)
    } else {
        (uid as usize, msg as isize)
    }
}

/// The reply to the position request: the rect's corner as two signed 16-bit halves (x low, y high), widened from 32 bits with
/// its sign as ManagedShell's `MakeLParam`.
pub(crate) fn rect_reply(corner: u32, rect: RECT) -> isize {
    let (x, y) = if corner == 1 { (rect.left, rect.top) } else { (rect.right, rect.bottom) };
    ((x as u32 & 0xFFFF) | (y as u32 & 0xFFFF) << 16) as i32 as isize
}

/// The shared memory of an appbar call that answers through it (`ABM_QUERYPOS`, `ABM_SETPOS`, `ABM_GETTASKBARPOS`): its handle
/// and the process it was made for. None for the other calls and for a payload of another layout.
pub(crate) fn appbar_shared(b: &[u8]) -> Option<(u64, u32)> {
    if b.len() != APPBAR_LEN || u32_at(b, 0)? != ABD_LEN as u32 || !matches!(u32_at(b, 40)?, ABM_QUERYPOS | ABM_SETPOS | ABM_GETTASKBARPOS) {
        return None;
    }
    Some((u64::from_le_bytes(b[SHARED_AT..SHARED_AT + 8].try_into().ok()?), u32_at(b, PID_AT)?))
}

/// Whether an appbar call is Crest's own (explorer.rs): its sender's process, kept beside the shared memory's handle, is
/// `own_pid`. The spy waits on Explorer for those without a cap, as without the spy.
pub(crate) fn waits_for_explorer(b: &[u8], own_pid: u32) -> bool {
    b.len() == APPBAR_LEN && u32_at(b, 0) == Some(ABD_LEN as u32) && u32_at(b, PID_AT) == Some(own_pid)
}

/// A payload `appbar_shared` accepted, with its shared memory moved to `handle` made for process `pid`.
pub(crate) fn reshare(b: &[u8], handle: u64, pid: u32) -> Vec<u8> {
    let mut b = b.to_vec();
    b[SHARED_AT..SHARED_AT + 8].copy_from_slice(&handle.to_le_bytes());
    b[PID_AT..PID_AT + 4].copy_from_slice(&pid.to_le_bytes());
    b
}

/// Whether the spy passes a message on to Explorer: copy data, activation, commands and the user range; never registered
/// messages (0xC000 and up) nor ordinary window traffic such as timers and paints.
pub(crate) fn forwards(msg: u32) -> bool {
    matches!(msg, WM_COPYDATA | WM_ACTIVATEAPP | WM_COMMAND) || (WM_USER..REGISTERED).contains(&msg)
}

/// Whether the spy posts a forwarded message instead of sending it and waiting: only `WM_USER + 372`, which ManagedShell's
/// TrayService posts to Explorer's tray rather than forward synchronously.
pub(crate) fn posts(msg: u32) -> bool {
    msg == WM_USER + 372
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::UI::Shell::ABM_GETSTATE;
    use windows::Win32::UI::WindowsAndMessaging::{WM_PAINT, WM_TIMER};

    fn put(b: &mut [u8], at: usize, v: u32) {
        b[at..at + 4].copy_from_slice(&v.to_le_bytes());
    }

    /// A dwData 1 payload: the operation, hWnd 0x1234, uID 7 and the flags.
    fn icon_bytes(op: u32, flags: u32) -> Vec<u8> {
        let mut b = vec![0u8; ICON_LEN + 8];
        put(&mut b, 4, op);
        put(&mut b, 8 + 4, 0x1234);
        put(&mut b, 8 + 8, 7);
        put(&mut b, 8 + 12, flags);
        b
    }

    fn set_tip(b: &mut [u8], tip: &str) {
        for (i, u) in tip.encode_utf16().enumerate() {
            b[8 + 24 + i * 2..8 + 26 + i * 2].copy_from_slice(&u.to_le_bytes());
        }
    }

    fn icon(m: Msg) -> (IconOp, IconData) {
        match m {
            Msg::Icon(op, d) => (op, d),
            other => panic!("not an icon message: {other:?}"),
        }
    }

    #[test]
    fn an_added_icon_is_read_from_its_bytes() {
        let mut b = icon_bytes(0, NIF_MESSAGE.0 | NIF_ICON.0 | NIF_TIP.0);
        put(&mut b, 8 + 16, 0x401);
        put(&mut b, 8 + 20, 0x55);
        set_tip(&mut b, "Disk\r\nFull");
        let (op, d) = icon(parse(1, &b));
        assert_eq!(op, IconOp::Add);
        assert_eq!(d.key, IconKey::Id { hwnd: 0x1234, uid: 7 });
        assert_eq!((d.hwnd, d.uid), (0x1234, 7));
        assert_eq!((d.callback, d.hicon), (Some(0x401), Some(0x55)));
        assert_eq!(d.tip.as_deref(), Some("Disk\nFull"));
        assert_eq!((d.hidden, d.version), (None, None));
    }

    #[test]
    fn a_tip_loses_its_carriage_returns() {
        let mut b = icon_bytes(1, NIF_TIP.0);
        set_tip(&mut b, "a\r\nb\rc");
        assert_eq!(icon(parse(1, &b)).1.tip.as_deref(), Some("a\nbc"));
    }

    #[test]
    fn an_icon_with_a_guid_is_known_by_it() {
        let mut b = icon_bytes(1, NIF_GUID.0);
        b[8 + 936..8 + 952].copy_from_slice(&[1, 0, 0, 0, 2, 0, 3, 0, 4, 5, 6, 7, 8, 9, 10, 11]);
        let (_, d) = icon(parse(1, &b));
        assert_eq!(d.key, IconKey::Guid(GUID::from_values(1, 2, 3, [4, 5, 6, 7, 8, 9, 10, 11])));
        assert_eq!((d.hwnd, d.uid), (0x1234, 7));
        // A zero GUID is no GUID: the same key as the position request gives that icon.
        let zero = icon_bytes(1, NIF_GUID.0);
        assert_eq!(icon(parse(1, &zero)).1.key, IconKey::Id { hwnd: 0x1234, uid: 7 });
    }

    #[test]
    fn a_hidden_state_counts_only_through_its_mask() {
        let mut b = icon_bytes(1, NIF_STATE.0);
        put(&mut b, 8 + 280, NIS_HIDDEN.0);
        put(&mut b, 8 + 284, NIS_HIDDEN.0);
        assert_eq!(icon(parse(1, &b)).1.hidden, Some(true));
        put(&mut b, 8 + 280, 0);
        assert_eq!(icon(parse(1, &b)).1.hidden, Some(false));
        put(&mut b, 8 + 280, NIS_HIDDEN.0);
        put(&mut b, 8 + 284, 0);
        assert_eq!(icon(parse(1, &b)).1.hidden, None);
    }

    #[test]
    fn a_version_comes_only_with_set_version() {
        let mut b = icon_bytes(4, 0);
        put(&mut b, 8 + 800, 4);
        assert_eq!(icon(parse(1, &b)).1.version, Some(4));
        put(&mut b, 4, 1);
        assert_eq!(icon(parse(1, &b)).1.version, None);
    }

    #[test]
    fn a_get_rect_request_names_its_icon_and_corner() {
        let mut b = vec![0u8; RECT_LEN];
        put(&mut b, 4, 2);
        put(&mut b, 16, 0x1234);
        put(&mut b, 20, 7);
        assert_eq!(parse(3, &b), Msg::GetRect { key: IconKey::Id { hwnd: 0x1234, uid: 7 }, corner: 2 });
        b[24] = 9;
        assert!(matches!(parse(3, &b), Msg::GetRect { key: IconKey::Guid(_), corner: 2 }));
    }

    #[test]
    fn the_click_message_packs_as_the_icon_version_expects() {
        assert_eq!(callback_args(4, 7, WM_LBUTTONUP, 100, 200), (((200 << 16) | 100) as usize, ((7 << 16) | WM_LBUTTONUP) as isize));
        assert_eq!(callback_args(3, 7, WM_LBUTTONUP, 100, 200), (7, WM_LBUTTONUP as isize));
    }

    #[test]
    fn a_left_click_sends_up_and_select_and_a_right_click_its_menu() {
        assert_eq!(click_messages(Button::Left, 4), [WM_LBUTTONDOWN, WM_LBUTTONUP, NIN_SELECT]);
        assert_eq!(click_messages(Button::Right, 4), [WM_RBUTTONDOWN, WM_RBUTTONUP, WM_CONTEXTMENU]);
        assert_eq!(click_messages(Button::Left, 0), [WM_LBUTTONDOWN, WM_LBUTTONUP]);
        assert_eq!(click_messages(Button::Double, 4), [WM_LBUTTONDBLCLK, WM_LBUTTONUP]);
    }

    #[test]
    fn a_get_rect_reply_packs_signed_coordinates() {
        let rect = RECT { left: -30, top: 40, right: 50, bottom: 60 };
        let unpack = |r: isize| (r as i16 as i32, (r >> 16) as i16 as i32);
        assert_eq!(unpack(rect_reply(1, rect)), (-30, 40));
        assert_eq!(unpack(rect_reply(2, rect)), (50, 60));
        // A y above the primary monitor makes the whole reply negative, as a 32-bit LPARAM widened by the system.
        assert_eq!(rect_reply(1, RECT { left: 5, top: -2, right: 0, bottom: 0 }), ((-2i32 << 16) | 5) as isize);
    }

    #[test]
    fn an_appbar_position_call_names_its_shared_memory() {
        let mut b = vec![0u8; APPBAR_LEN];
        put(&mut b, 0, ABD_LEN as u32);
        b[SHARED_AT..SHARED_AT + 8].copy_from_slice(&0x1_2345_6789u64.to_le_bytes());
        put(&mut b, PID_AT, 77);
        for m in [ABM_QUERYPOS, ABM_SETPOS, ABM_GETTASKBARPOS] {
            put(&mut b, 40, m);
            assert_eq!(appbar_shared(&b), Some((0x1_2345_6789, 77)));
        }
        assert_eq!(appbar_shared(&reshare(&b, 0x42, 9)), Some((0x42, 9)));
        assert_eq!(appbar_shared(&b[..APPBAR_LEN - 1]), None);
        put(&mut b, 40, ABM_GETSTATE); // answered in the return value alone
        assert_eq!(appbar_shared(&b), None);
    }

    #[test]
    fn an_icon_is_known_by_its_guid_or_its_exe_and_id() {
        let g = GUID::from_values(0x1234abcd, 0x5678, 0x9abc, [0xde, 0xf0, 1, 2, 3, 4, 5, 6]);
        assert_eq!(identity(Some(g), "x", 1), "{1234abcd-5678-9abc-def0-010203040506}");
        assert_eq!(identity(None, "C:\\A\\B.EXE", 3), "c:\\a\\b.exe:3");
    }

    #[test]
    fn a_version_in_the_exes_folders_does_not_change_its_name() {
        let id = |exe: &str| identity(None, exe, 1);
        // Squirrel, Store and plain version folders, renamed by every update.
        assert_eq!(id(r"C:\Users\Zoë\AppData\Local\Discord\app-1.0.9175\Discord.exe"), r"c:\users\zoë\appdata\local\discord\app-*\discord.exe:1");
        assert_eq!(
            id(r"C:\Program Files\WindowsApps\MSTeams_24295.605.3225.8804_x64__8wekyb3d8bbwe\ms-teams.exe"),
            r"c:\program files\windowsapps\msteams_*_x64__8wekyb3d8bbwe\ms-teams.exe:1"
        );
        assert_eq!(id(r"C:\Apps\Tool\131.0.6778.86\Tool.exe"), r"c:\apps\tool\*\tool.exe:1");
        // Lone numbers and the exe's own name stay.
        assert_eq!(id(r"C:\Program Files (x86)\Steam 2\v8\app-1.2.exe"), r"c:\program files (x86)\steam 2\v8\app-1.2.exe:1");
    }

    #[test]
    fn only_shell_messages_are_forwarded() {
        for m in [WM_COPYDATA, WM_ACTIVATEAPP, WM_COMMAND, WM_USER, 0xBFFF] {
            assert!(forwards(m));
        }
        for m in [0xC000, 0xC123, WM_TIMER, WM_PAINT] {
            assert!(!forwards(m));
        }
    }

    #[test]
    fn crests_own_appbar_calls_wait_on_explorer() {
        let mut b = vec![0u8; APPBAR_LEN];
        put(&mut b, 0, ABD_LEN as u32);
        put(&mut b, 40, ABM_GETSTATE);
        put(&mut b, PID_AT, 20);
        assert!(waits_for_explorer(&b, 20)); // Crest (pid 20) reading or setting its auto-hide
        assert!(!waits_for_explorer(&b, 30)); // another app's call keeps the cap
        assert!(!waits_for_explorer(&b[..APPBAR_LEN - 1], 20));
        put(&mut b, 0, 48);
        assert!(!waits_for_explorer(&b, 20));
    }

    #[test]
    fn only_one_shell_message_is_posted_on() {
        assert!(posts(WM_USER + 372));
        for m in [WM_USER, WM_USER + 371, WM_USER + 373, WM_COPYDATA, WM_COMMAND, WM_ACTIVATEAPP] {
            assert!(!posts(m));
        }
    }

    #[test]
    fn a_short_or_foreign_payload_is_other() {
        assert_eq!(parse(1, &[]), Msg::Other);
        assert_eq!(parse(1, &icon_bytes(0, 0)[..ICON_LEN - 1]), Msg::Other);
        assert_eq!(parse(3, &[0u8; RECT_LEN - 1]), Msg::Other);
        assert_eq!(parse(9, &icon_bytes(0, 0)), Msg::Other);
        assert_eq!(parse(1, &icon_bytes(77, 0)), Msg::Other);
    }
}
