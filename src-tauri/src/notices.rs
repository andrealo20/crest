// Translated from BrimDeck (Apache-2.0, github.com/MoFeng2223/BrimDeck), src/BrimDeck.Core/Notices/WindowsNoticeTrigger.cs and src/BrimDeck/Native/WindowsNoticeLog.cs (event log trigger).
//! Live notices: Windows toast notifications mirrored into the notch, and crest-notify messages over a per-user pipe.
//!
//! Windows raises `UserNotificationListener`'s change event only for packaged apps, but its reading calls work for a
//! desktop program. The push notification service writes an entry to its event log for every toast delivered to this
//! user, with the toast's id and app id; Crest subscribes to that log and reads the one toast it names. Nothing is
//! changed or removed in the action centre. When the log is turned off or the subscription fails, the list is read
//! every POLL instead. Both sources send `notices://in`; rules, quiet hours and history live in the frontend.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use tokio::sync::watch;

use crate::notify_wire::{self, Frame, RateLimiter, Reply};

const POLL: Duration = Duration::from_secs(5);
/// Entries come in bursts (ten toasts at once give ten entries within milliseconds): one wait covers them.
const COALESCE: Duration = Duration::from_millis(100);
const CHANNEL: &str = "Microsoft-Windows-PushNotification-Platform/Operational";
const DELIVERED: u32 = 3052;
const SUBMITTED: u32 = 3053;
const CLEARED: u32 = 3055;
/// Notifications Crest itself might raise (the identifier in tauri.conf.json).
const OWN_APP: &str = "io.github.andrealo20.crest";
const ICON_PX: f32 = 48.0;

pub struct NoticesState {
    /// Bumped when the Windows source is switched; its old thread then ends.
    windows_gen: AtomicU64,
    /// The running Windows source thread's channel, to stop it at once.
    windows_tx: Mutex<Option<mpsc::Sender<Trigger>>>,
    /// The Windows source stopped because access was not allowed; started again once it is.
    awaiting_access: AtomicBool,
    /// The pipe server's generation; a watch so a waiting accept wakes when it changes.
    pipe_gen: watch::Sender<u64>,
    on: Mutex<(bool, bool)>,
    status: Mutex<Status>,
    limiter: Arc<Mutex<RateLimiter>>,
}

impl Default for NoticesState {
    fn default() -> Self {
        NoticesState {
            windows_gen: AtomicU64::new(0),
            windows_tx: Mutex::new(None),
            awaiting_access: AtomicBool::new(false),
            pipe_gen: watch::channel(0).0,
            on: Mutex::new((false, false)),
            status: Mutex::new(Status::default()),
            limiter: Arc::new(Mutex::new(RateLimiter::new())),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// allowed | denied | unspecified | unavailable
    access: String,
    /// off | event-log | polling | failed
    mode: String,
    pipe: bool,
    /// The crest-notify channel could not be opened (no user id, or another program holds the name).
    pipe_failed: bool,
}

impl Default for Status {
    fn default() -> Self {
        Status { access: "unspecified".into(), mode: "off".into(), pipe: false, pipe_failed: false }
    }
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NoticeIn {
    /// windows | cli
    source: &'static str,
    app_id: String,
    app_name: String,
    title: String,
    body: String,
    /// A data URL of the app's logo, as Windows gives it; nothing is downloaded.
    icon: Option<String>,
    /// Milliseconds since 1970.
    at: u64,
    replace: Option<String>,
    progress: Option<f64>,
    exit_code: Option<i32>,
    duration_ms: Option<u64>,
    command: Option<String>,
}

/// Switches the two sources. Called by the frontend on start and on every settings change.
#[tauri::command]
pub fn notices_configure(windows: bool, pipe: bool, app: AppHandle, state: State<'_, NoticesState>) {
    let mut on = state.on.lock().unwrap();
    if on.0 != windows {
        let generation = state.windows_gen.fetch_add(1, Ordering::SeqCst) + 1;
        if windows {
            start_windows(&app, generation);
        } else {
            stop_windows(&app);
            set_status(&app, |s| s.mode = "off".into());
        }
    }
    if on.1 != pipe {
        let mut generation = 0;
        state.pipe_gen.send_modify(|g| {
            *g += 1;
            generation = *g;
        });
        if pipe {
            tauri::async_runtime::spawn(pipe_server(app.clone(), generation));
        } else {
            set_status(&app, |s| (s.pipe, s.pipe_failed) = (false, false));
        }
    }
    *on = (windows, pipe);
}

/// The current state. A Windows source that stopped for lack of access starts now if access was granted meanwhile in
/// Windows Settings (the settings page asks for this state when it opens).
#[tauri::command]
pub fn notices_status(app: AppHandle, state: State<'_, NoticesState>) -> Status {
    let mut status = state.status.lock().unwrap().clone();
    status.access = access().into();
    if status.access == "allowed" && state.awaiting_access.swap(false, Ordering::SeqCst) {
        start_if_on(&app);
    }
    status
}

/// Starts (or restarts) the Windows source while its switch is on. The `on` lock is held across the start, so a
/// concurrent notices_configure switching it off waits and then stops this thread, never leaving one running.
fn start_if_on(app: &AppHandle) {
    let state = app.state::<NoticesState>();
    let on = state.on.lock().unwrap();
    if on.0 {
        let generation = state.windows_gen.fetch_add(1, Ordering::SeqCst) + 1;
        start_windows(app, generation);
    }
    drop(on);
}

/// Asks Windows for access to notifications. Windows asks the user only the first time; afterwards the answer is the
/// earlier choice, changed in Settings > Privacy & security > Notifications. Restarts the Windows source when allowed.
/// "request-failed" when Windows refused the request itself (an unpackaged app may get no prompt at all).
#[tauri::command]
pub async fn notices_request_access(app: AppHandle) -> String {
    let (tx, rx) = tokio::sync::oneshot::channel();
    // The consent prompt belongs to the UI thread.
    let asked = app.run_on_main_thread(move || {
        let op = windows::UI::Notifications::Management::UserNotificationListener::Current().and_then(|l| l.RequestAccessAsync());
        let _ = tx.send(op.ok());
    });
    let answered = match (asked, rx.await) {
        (Ok(()), Ok(Some(op))) => matches!(tauri::async_runtime::spawn_blocking(move || op.join()).await, Ok(Ok(_))),
        _ => false,
    };
    let now = access();
    if !answered && now != "allowed" {
        return "request-failed".into();
    }
    if now == "allowed" {
        app.state::<NoticesState>().awaiting_access.store(false, Ordering::SeqCst);
        start_if_on(&app);
    }
    now.into()
}

fn access() -> &'static str {
    use windows::UI::Notifications::Management::{UserNotificationListener, UserNotificationListenerAccessStatus as A};
    match UserNotificationListener::Current().and_then(|l| l.GetAccessStatus()) {
        Ok(A::Allowed) => "allowed",
        Ok(A::Denied) => "denied",
        Ok(_) => "unspecified",
        Err(_) => "unavailable",
    }
}

fn set_status(app: &AppHandle, change: impl FnOnce(&mut Status)) {
    let state = app.state::<NoticesState>();
    let mut status = state.status.lock().unwrap();
    change(&mut status);
    status.access = access().into();
    let _ = app.emit("notices://status", status.clone());
}

// ---------- Windows notifications ----------

#[derive(Debug, PartialEq)]
enum Trigger {
    /// Read this toast and check it belongs to this app.
    Read(u32, String),
    /// An entry without a usable id: compare the whole list with the known ids.
    Full,
    Ignore,
    /// The log stopped delivering.
    Broken,
    /// Switched off or restarted.
    Stop,
}

/// What one log entry asks for. A delivered toast is read directly only when both its id and app id are there, so an
/// entry never leads to showing another app's toast. A clear (3055) does not say which toast went and needs nothing here.
fn trigger(event_id: u32, kind: Option<&str>, app_id: Option<&str>, tracking: Option<u32>) -> Trigger {
    let toast = event_id == DELIVERED || (event_id == SUBMITTED && kind.is_some_and(|k| k.eq_ignore_ascii_case("toast")));
    if event_id == CLEARED || !toast {
        return Trigger::Ignore;
    }
    match (tracking.filter(|&id| id > 0), app_id.map(str::trim).filter(|a| !a.is_empty())) {
        (Some(id), Some(app)) => Trigger::Read(id, app.to_string()),
        _ => Trigger::Full,
    }
}

/// Toasts delivered to or submitted for this user only. A SID that is not plain digits and dashes is left out rather
/// than quoted into the query.
fn query(sid: Option<&str>) -> String {
    let user = match sid {
        Some(s) if s.starts_with("S-1-") && s.len() <= 184 && s[1..].chars().all(|c| c == '-' || c.is_ascii_digit()) => {
            format!(" and Security[@UserID='{s}']")
        }
        _ => String::new(),
    };
    format!("*[System[(EventID={DELIVERED}){user}] or (System[EventID={SUBMITTED}{user}] and EventData[Data[@Name='NotificationType']='toast'])]")
}

fn current(app: &AppHandle, generation: u64) -> bool {
    app.state::<NoticesState>().windows_gen.load(Ordering::SeqCst) == generation
}

/// Starts the Windows source thread for `generation`; the previous thread gets a stop message and ends at once.
fn start_windows(app: &AppHandle, generation: u64) {
    let (tx, rx) = mpsc::channel::<Trigger>();
    if let Some(old) = app.state::<NoticesState>().windows_tx.lock().unwrap().replace(tx.clone()) {
        let _ = old.send(Trigger::Stop);
    }
    let app = app.clone();
    std::thread::spawn(move || windows_source(app, generation, tx, rx));
}

fn stop_windows(app: &AppHandle) {
    if let Some(old) = app.state::<NoticesState>().windows_tx.lock().unwrap().take() {
        let _ = old.send(Trigger::Stop);
    }
}

/// The next wait before subscribing to the log again: 1 min, doubling up to 30 min.
fn resubscribe_after(failures: u32) -> Duration {
    Duration::from_secs(60 * 2u64.pow(failures.saturating_sub(1).min(5))).min(Duration::from_secs(30 * 60))
}

fn windows_source(app: AppHandle, generation: u64, tx: mpsc::Sender<Trigger>, rx: mpsc::Receiver<Trigger>) {
    use std::time::Instant;
    use windows::UI::Notifications::Management::UserNotificationListener;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    let Ok(listener) = UserNotificationListener::Current() else {
        return set_status(&app, |s| s.mode = "failed".into());
    };
    if access() != "allowed" {
        // Started again by notices_request_access or notices_status once allowed.
        app.state::<NoticesState>().awaiting_access.store(true, Ordering::SeqCst);
        return set_status(&app, |s| s.mode = "off".into());
    }
    let mut icons: HashMap<String, Option<String>> = HashMap::new();
    // The first reading is a baseline: toasts already in the action centre are not shown again.
    let mut known: HashSet<u32> = match read_all(&listener) {
        Ok(list) => list.iter().filter_map(|n| n.Id().ok()).collect(),
        Err(_) => return set_status(&app, |s| s.mode = "failed".into()),
    };

    let mut subscription = Subscription::start(tx.clone());
    let mut failures = u32::from(subscription.is_none());
    let mut retry_at = Instant::now() + resubscribe_after(failures);
    let mode = |on: bool| if on { "event-log" } else { "polling" };
    set_status(&app, |s| s.mode = mode(subscription.is_some()).into());

    while current(&app, generation) {
        // Without the log the list is read every POLL; with it nothing happens until an entry arrives.
        let wait = if subscription.is_some() { Duration::from_secs(3600) } else { POLL };
        let mut batch = Vec::new();
        if let Ok(t) = rx.recv_timeout(wait) {
            if t != Trigger::Stop {
                std::thread::sleep(COALESCE);
            }
            batch.push(t);
            batch.extend(rx.try_iter());
        }
        if batch.contains(&Trigger::Stop) || !current(&app, generation) {
            break;
        }
        if batch.contains(&Trigger::Broken) && subscription.is_some() {
            subscription = None;
            failures += 1;
            retry_at = Instant::now() + resubscribe_after(failures);
            set_status(&app, |s| s.mode = "polling".into());
        }
        if subscription.is_none() && Instant::now() >= retry_at {
            subscription = Subscription::start(tx.clone());
            if subscription.is_some() {
                failures = 0;
                set_status(&app, |s| s.mode = "event-log".into());
            } else {
                failures += 1;
                retry_at = Instant::now() + resubscribe_after(failures);
            }
        }

        let mut full = subscription.is_none() || batch.contains(&Trigger::Full);
        if !full {
            for t in batch {
                let Trigger::Read(id, app_id) = t else { continue };
                if known.contains(&id) {
                    continue;
                }
                // Known only once shown: a toast Windows cannot return yet, or one whose app does not match the entry,
                // is left to a full reading of this batch instead of being lost.
                match listener.GetNotification(id) {
                    Ok(n) if emit_toast(&app, &n, Some(&app_id), &mut icons) => {
                        known.insert(id);
                    }
                    _ => full = true,
                }
            }
            if full {
                std::thread::sleep(Duration::from_millis(500));
            }
        }
        // The log never says which toasts were cleared; a long session prunes the set with one reading.
        if full || known.len() > 1000 {
            let Ok(list) = read_all(&listener) else { continue };
            let ids: HashSet<u32> = list.iter().filter_map(|n| n.Id().ok()).collect();
            if full {
                for n in &list {
                    if n.Id().is_ok_and(|id| !known.contains(&id)) {
                        emit_toast(&app, n, None, &mut icons);
                    }
                }
            }
            // Removed toasts leave the set, so it stays the size of the action centre.
            known = ids;
        }
    }
}

fn read_all(
    listener: &windows::UI::Notifications::Management::UserNotificationListener,
) -> windows::core::Result<Vec<windows::UI::Notifications::UserNotification>> {
    let list = listener.GetNotificationsAsync(windows::UI::Notifications::NotificationKinds::Toast)?.join()?;
    Ok(list.into_iter().collect())
}

/// Sends one toast to the frontend. `expected` is the app id the log entry named: a toast from another app is not shown.
fn emit_toast(
    app: &AppHandle,
    n: &windows::UI::Notifications::UserNotification,
    expected: Option<&str>,
    icons: &mut HashMap<String, Option<String>>,
) -> bool {
    let Some(notice) = read_toast(n, expected, icons) else { return false };
    app.emit("notices://in", notice).is_ok()
}

fn read_toast(
    n: &windows::UI::Notifications::UserNotification,
    expected: Option<&str>,
    icons: &mut HashMap<String, Option<String>>,
) -> Option<NoticeIn> {
    use windows::UI::Notifications::KnownNotificationBindings;
    let info = n.AppInfo().ok()?;
    let app_id = info.AppUserModelId().or_else(|_| info.Id()).ok()?.to_string();
    if app_id.is_empty() || app_id.eq_ignore_ascii_case(OWN_APP) {
        return None;
    }
    if expected.is_some_and(|e| !e.eq_ignore_ascii_case(&app_id)) {
        return None;
    }
    let display = info.DisplayInfo().ok();
    let app_name = display.as_ref().and_then(|d| d.DisplayName().ok()).map(|s| s.to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| app_id.clone());
    let visual = n.Notification().and_then(|x| x.Visual()).ok()?;
    let binding = KnownNotificationBindings::ToastGeneric()
        .and_then(|g| visual.GetBinding(&g))
        .or_else(|_| visual.Bindings().and_then(|b| b.GetAt(0)))
        .ok()?;
    let texts: Vec<String> = binding
        .GetTextElements()
        .ok()?
        .into_iter()
        .filter_map(|t| t.Text().ok())
        .map(|t| t.to_string().trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    let title = notify_wire::clean(texts.first().cloned(), notify_wire::MAX_TITLE, false).unwrap_or_default();
    let body = notify_wire::clean(Some(texts.iter().skip(1).cloned().collect::<Vec<_>>().join("\n")), notify_wire::MAX_BODY, true).unwrap_or_default();
    if title.is_empty() && body.is_empty() {
        return None;
    }
    // DateTime counts 100 ns steps since 1601.
    let at = n.CreationTime().map(|t| ((t.UniversalTime - 116_444_736_000_000_000).max(0) / 10_000) as u64).unwrap_or_else(|_| now_ms());
    let icon = icons.entry(app_id.clone()).or_insert_with(|| display.as_ref().and_then(logo)).clone();
    Some(NoticeIn {
        source: "windows",
        app_name: notify_wire::clean(Some(app_name), notify_wire::MAX_FIELD, false).unwrap_or_default(),
        app_id,
        title,
        body,
        icon,
        at,
        ..Default::default()
    })
}

fn logo(display: &windows::ApplicationModel::AppDisplayInfo) -> Option<String> {
    use base64::Engine;
    use windows::Storage::Streams::DataReader;
    let reference = display.GetLogo(windows::Foundation::Size { Width: ICON_PX, Height: ICON_PX }).ok()?;
    let stream = reference.OpenReadAsync().ok()?.join().ok()?;
    let size = stream.Size().ok()? as u32;
    // A logo is a few KB; anything far larger is not worth sending to the WebView on every notice.
    if size == 0 || size > 256 * 1024 {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    reader.LoadAsync(size).ok()?.join().ok()?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    let mime = match image::guess_format(&bytes) {
        Ok(image::ImageFormat::Jpeg) => "image/jpeg",
        Ok(image::ImageFormat::Ico) => "image/x-icon",
        Ok(image::ImageFormat::Bmp) => "image/bmp",
        _ => "image/png",
    };
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The event log subscription. Its callback runs on a thread of the log service and only queues triggers.
struct Subscription {
    handle: windows::Win32::System::EventLog::EVT_HANDLE,
    context: *mut Context,
}

struct Context {
    tx: Mutex<mpsc::Sender<Trigger>>,
    render: windows::Win32::System::EventLog::EVT_HANDLE,
}

impl Subscription {
    fn start(tx: mpsc::Sender<Trigger>) -> Option<Self> {
        use windows::core::{w, HSTRING};
        use windows::Win32::System::EventLog::*;
        unsafe {
            // A turned-off log takes a subscription without complaint and then delivers nothing.
            let config = EvtOpenChannelConfig(None, &HSTRING::from(CHANNEL), 0).ok()?;
            let mut enabled = EVT_VARIANT::default();
            let mut used = 0u32;
            let read = EvtGetChannelConfigProperty(
                config,
                EvtChannelConfigEnabled,
                0,
                std::mem::size_of::<EVT_VARIANT>() as u32,
                Some(&mut enabled),
                &mut used,
            );
            let _ = EvtClose(config);
            if read.is_err() || enabled.Anonymous.BooleanVal.0 == 0 {
                return None;
            }
            let paths = [
                w!("Event/System/EventID"),
                w!("Event/EventData/Data[@Name='NotificationType']"),
                w!("Event/EventData/Data[@Name='AppUserModelId']"),
                w!("Event/EventData/Data[@Name='TrackingId']"),
            ];
            let render = EvtCreateRenderContext(Some(&paths), EvtRenderContextValues.0).ok()?;
            let context = Box::into_raw(Box::new(Context { tx: Mutex::new(tx), render }));
            let sid = notify_wire::identity().map(|(_, sid)| sid);
            let handle = EvtSubscribe(
                None,
                None,
                &HSTRING::from(CHANNEL),
                &HSTRING::from(query(sid.as_deref())),
                None,
                Some(context as *const _),
                Some(on_event),
                EvtSubscribeToFutureEvents.0,
            );
            match handle {
                Ok(handle) => Some(Subscription { handle, context }),
                Err(_) => {
                    let _ = EvtClose(render);
                    drop(Box::from_raw(context));
                    None
                }
            }
        }
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        use windows::Win32::System::EventLog::EvtClose;
        unsafe {
            // Closing the subscription waits for a running callback, so the context is unused afterwards.
            let _ = EvtClose(self.handle);
            let context = Box::from_raw(self.context);
            let _ = EvtClose(context.render);
        }
    }
}

unsafe extern "system" fn on_event(
    action: windows::Win32::System::EventLog::EVT_SUBSCRIBE_NOTIFY_ACTION,
    context: *const core::ffi::c_void,
    event: windows::Win32::System::EventLog::EVT_HANDLE,
) -> u32 {
    use windows::Win32::System::EventLog::*;
    let context = unsafe { &*(context as *const Context) };
    let send = |t: Trigger| {
        let _ = context.tx.lock().unwrap().send(t);
    };
    if action == EvtSubscribeActionError {
        send(Trigger::Broken);
        return 0;
    }
    if action != EvtSubscribeActionDeliver {
        return 0;
    }
    // Four values; strings point into the buffer, so it is sized from a first call. u64 keeps it aligned for EVT_VARIANT.
    let mut used = 0u32;
    let mut count = 0u32;
    let _ = unsafe { EvtRender(Some(context.render), event, EvtRenderEventValues.0, 0, None, &mut used, &mut count) };
    let mut buf = vec![0u64; (used as usize).div_ceil(8).max(1)];
    if unsafe { EvtRender(Some(context.render), event, EvtRenderEventValues.0, (buf.len() * 8) as u32, Some(buf.as_mut_ptr().cast()), &mut used, &mut count) }.is_err() || count < 4 {
        send(Trigger::Full);
        return 0;
    }
    let values = unsafe { std::slice::from_raw_parts(buf.as_ptr() as *const EVT_VARIANT, 4) };
    let number = |v: &EVT_VARIANT| -> Option<u32> {
        unsafe {
            let kind = EVT_VARIANT_TYPE(v.Type as i32);
            if kind == EvtVarTypeUInt16 {
                Some(v.Anonymous.UInt16Val as u32)
            } else if kind == EvtVarTypeUInt32 {
                Some(v.Anonymous.UInt32Val)
            } else if kind == EvtVarTypeInt32 {
                // The log declares TrackingId as Int32; the listener's ids are unsigned, so take it back bit for bit.
                Some(v.Anonymous.Int32Val as u32)
            } else {
                None
            }
        }
    };
    let text = |v: &EVT_VARIANT| -> Option<String> {
        unsafe { (EVT_VARIANT_TYPE(v.Type as i32) == EvtVarTypeString && !v.Anonymous.StringVal.is_null()).then(|| v.Anonymous.StringVal.to_string().ok()).flatten() }
    };
    let t = trigger(
        number(&values[0]).unwrap_or(0),
        text(&values[1]).as_deref(),
        text(&values[2]).as_deref(),
        number(&values[3]),
    );
    if t != Trigger::Ignore {
        send(t);
    }
    0
}

// ---------- crest-notify pipe ----------

/// Builds the pipe's security descriptor: full access for this user's SID only, nobody else (not even administrators
/// or other sessions of the same machine through the network, which reject_remote_clients refuses as well).
struct Descriptor(windows::Win32::Security::PSECURITY_DESCRIPTOR);
// Safety: the descriptor is an immutable LocalAlloc block, only read by CreateNamedPipe and freed once on drop.
unsafe impl Send for Descriptor {}

impl Descriptor {
    fn for_user(sid: &str) -> Option<Self> {
        use windows::Win32::Security::Authorization::{ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1};
        let mut sd = windows::Win32::Security::PSECURITY_DESCRIPTOR::default();
        let sddl = windows::core::HSTRING::from(format!("D:P(A;;GA;;;{sid})"));
        unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(&sddl, SDDL_REVISION_1, &mut sd, None) }.ok()?;
        Some(Descriptor(sd))
    }
}

impl Drop for Descriptor {
    fn drop(&mut self) {
        use windows::Win32::Foundation::{LocalFree, HLOCAL};
        unsafe {
            let _ = LocalFree(Some(HLOCAL(self.0 .0)));
        }
    }
}

fn create_pipe(name: &str, descriptor: &Descriptor, first: bool) -> std::io::Result<NamedPipeServer> {
    use windows::Win32::Security::SECURITY_ATTRIBUTES;
    let mut attrs = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor.0 .0,
        bInheritHandle: false.into(),
    };
    // Safety: attrs is a valid SECURITY_ATTRIBUTES that outlives the call.
    unsafe {
        ServerOptions::new()
            .first_pipe_instance(first)
            .reject_remote_clients(true)
            .max_instances(16)
            .create_with_security_attributes_raw(name, &mut attrs as *mut _ as *mut core::ffi::c_void)
    }
}

async fn pipe_server(app: AppHandle, generation: u64) {
    let state = app.state::<NoticesState>();
    let mut changed = state.pipe_gen.subscribe();
    let limiter = state.limiter.clone();
    let stopped = |rx: &watch::Receiver<u64>| *rx.borrow() != generation;
    let failed = |app: &AppHandle| set_status(app, |s| (s.pipe, s.pipe_failed) = (false, true));
    let Some((session, sid)) = notify_wire::identity() else { return failed(&app) };
    let Some(descriptor) = Descriptor::for_user(&sid) else { return failed(&app) };
    let name = notify_wire::pipe_name(session, &sid);

    // The first instance proves no other process holds the name. An old server still closing (switched off and on
    // quickly) can hold it for a moment, so it is tried a few times.
    let mut server = None;
    for _ in 0..10 {
        if stopped(&changed) {
            return;
        }
        match create_pipe(&name, &descriptor, true) {
            Ok(s) => {
                server = Some(s);
                break;
            }
            Err(_) => tokio::time::sleep(Duration::from_millis(500)).await,
        }
    }
    if server.is_none() {
        return failed(&app);
    }
    set_status(&app, |s| (s.pipe, s.pipe_failed) = (true, false));
    // Clients served at once; the rest wait (and crest-notify retries a busy pipe), so instances never run out.
    let serving = Arc::new(tokio::sync::Semaphore::new(MAX_SERVING));

    loop {
        // A new instance can fail while all are busy; it is tried again shortly, the server never gives up.
        let Some(listening) = server.as_mut() else {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(250)) => server = create_pipe(&name, &descriptor, false).ok(),
                _ = changed.changed() => if stopped(&changed) { break },
            }
            continue;
        };
        tokio::select! {
            connected = listening.connect() => {
                let client = server.take();
                if connected.is_err() {
                    continue;
                }
                let Some(client) = client else { continue };
                let Ok(permit) = serving.clone().acquire_owned().await else { break };
                server = create_pipe(&name, &descriptor, false).ok();
                let app = app.clone();
                let limiter = limiter.clone();
                tauri::async_runtime::spawn(async move {
                    serve(client, session, limiter, move |n| { let _ = app.emit("notices://in", n); }).await;
                    drop(permit);
                });
            }
            _ = changed.changed() => if stopped(&changed) { break },
        }
    }
    if !stopped(&changed) {
        set_status(&app, |s| s.pipe = false);
    }
}

/// Clients served at the same time (pipe instances are capped at 16).
const MAX_SERVING: usize = 12;

/// The logon session of the process at the other end of the pipe.
fn client_session(pipe: &NamedPipeServer) -> Option<u32> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::Pipes::GetNamedPipeClientSessionId;
    let mut id = 0u32;
    unsafe { GetNamedPipeClientSessionId(HANDLE(pipe.as_raw_handle()), &mut id) }.ok()?;
    Some(id)
}

/// One client: one request line, one reply line, within two seconds. A client from another logon session of the same
/// user (a second sign-in, a service) is refused.
async fn serve(mut pipe: NamedPipeServer, session: u32, limiter: Arc<Mutex<RateLimiter>>, emit: impl FnOnce(NoticeIn)) {
    if client_session(&pipe) != Some(session) {
        return;
    }
    let read = async {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            match notify_wire::take_line(&buf) {
                Frame::Line(line) => return Some(line),
                Frame::TooLong => return None,
                Frame::Incomplete => {}
            }
            match pipe.read(&mut chunk).await {
                Ok(0) | Err(_) => return None,
                Ok(n) => buf.extend_from_slice(&chunk[..n]),
            }
        }
    };
    let Ok(Some(line)) = tokio::time::timeout(Duration::from_secs(2), read).await else { return };
    let reply = match notify_wire::parse(&line) {
        Err(why) => Reply::new("rejected", Some(why)),
        Ok(_) if !limiter.lock().unwrap().allow(now_ms()) => Reply::new("limited", None),
        Ok(r) => {
            let name = r.source.clone().unwrap_or_else(|| "crest-notify".into());
            let notice = NoticeIn {
                source: "cli",
                app_id: format!("cli:{}", name.to_lowercase()),
                app_name: name,
                title: r.title.or_else(|| r.command.clone()).unwrap_or_default(),
                body: r.body.unwrap_or_default(),
                icon: None,
                at: now_ms(),
                replace: r.replace,
                progress: r.progress,
                exit_code: r.exit_code,
                duration_ms: r.duration_ms,
                command: r.command,
            };
            emit(notice);
            Reply::new("accepted", None)
        }
    };
    if let Some(out) = notify_wire::encode(&reply) {
        let _ = pipe.write_all(&out).await;
        let _ = pipe.flush().await;
    }
    // Disconnecting would discard a reply the client has not read yet; wait (briefly) for it to hang up instead.
    let _ = tokio::time::timeout(Duration::from_secs(1), pipe.read(&mut [0u8; 1])).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn triggers() {
        assert_eq!(trigger(DELIVERED, None, Some(" App.Id "), Some(7)), Trigger::Read(7, "App.Id".into()));
        assert_eq!(trigger(SUBMITTED, Some("Toast"), Some("a"), Some(7)), Trigger::Read(7, "a".into()));
        assert_eq!(trigger(SUBMITTED, Some("tile"), Some("a"), Some(7)), Trigger::Ignore);
        assert_eq!(trigger(DELIVERED, None, None, Some(7)), Trigger::Full);
        assert_eq!(trigger(DELIVERED, None, Some("a"), Some(0)), Trigger::Full);
        assert_eq!(trigger(DELIVERED, None, Some("a"), None), Trigger::Full);
        assert_eq!(trigger(CLEARED, None, Some("a"), Some(7)), Trigger::Ignore);
        assert_eq!(trigger(1, None, Some("a"), Some(7)), Trigger::Ignore);
        // An id past i32::MAX arrives negative from the log and is taken back bit for bit.
        assert_eq!(trigger(DELIVERED, None, Some("a"), Some(-5i32 as u32)), Trigger::Read(4294967291, "a".into()));
    }

    #[test]
    fn backoff() {
        let mins = |f| resubscribe_after(f).as_secs() / 60;
        assert_eq!((mins(0), mins(1), mins(2), mins(3), mins(5), mins(6), mins(40)), (1, 1, 2, 4, 16, 30, 30));
    }

    #[test]
    fn queries() {
        assert!(query(Some("S-1-5-21-1-2")).contains("Security[@UserID='S-1-5-21-1-2']"));
        assert!(!query(Some("S-1-5' or '1'='1")).contains("UserID"));
        assert!(!query(None).contains("UserID"));
    }

    /// A real pipe with the user-only descriptor: a second first instance is refused, one request gets one reply.
    #[test]
    fn pipe_round_trip() {
        use std::io::{BufRead, Write};
        let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
        let (session, sid) = notify_wire::identity().expect("identity");
        let name = format!("{}-test-{}", notify_wire::pipe_name(session, &sid), std::process::id());
        let descriptor = Descriptor::for_user(&sid).expect("descriptor");
        let got = Arc::new(Mutex::new(Vec::<NoticeIn>::new()));
        let limiter = Arc::new(Mutex::new(RateLimiter::new()));
        rt.block_on(async {
            let server = create_pipe(&name, &descriptor, true).expect("first instance");
            assert!(create_pipe(&name, &descriptor, true).is_err(), "a second first instance must fail");
            let sink = got.clone();
            let task = tokio::spawn(async move {
                server.connect().await.unwrap();
                serve(server, session, limiter, move |n| sink.lock().unwrap().push(n)).await;
            });
            let client_name = name.clone();
            let reply = tokio::task::spawn_blocking(move || {
                use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
                let qos = windows::Win32::Storage::FileSystem::SECURITY_IDENTIFICATION.0;
                let mut pipe = std::fs::OpenOptions::new().read(true).write(true).security_qos_flags(qos).open(&client_name).unwrap();
                // The check crest-notify makes: the server end runs as this user.
                let mut pid = 0u32;
                unsafe { windows::Win32::System::Pipes::GetNamedPipeServerProcessId(windows::Win32::Foundation::HANDLE(pipe.as_raw_handle()), &mut pid) }.unwrap();
                assert_eq!(notify_wire::pid_token(pid), notify_wire::own_token());
                pipe.write_all(b"{\"title\":\"Build\",\"source\":\"CI\",\"progress\":40}\n").unwrap();
                let mut out = String::new();
                std::io::BufReader::new(pipe).read_line(&mut out).unwrap();
                out
            })
            .await
            .unwrap();
            task.await.unwrap();
            assert_eq!(reply.trim(), r#"{"result":"accepted"}"#);
        });
        let got = got.lock().unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!((got[0].app_id.as_str(), got[0].title.as_str(), got[0].progress), ("cli:ci", "Build", Some(40.0)));
    }
}
