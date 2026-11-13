//! The live glass on the closed notch and the capsule (src/notch/glass), Windows 11 only, behind its own switch in Settings ›
//! Themes, off by default: a copy of the screen just around the closed notch or the capsule, up to 10 times a second.
//!
//! - While the switch is on the notch window stays out of every capture, its own included, whether the copy runs or not:
//!   `glass_live_exclude` sets the flag when it goes on and puts it back when it goes off, `exclude` keeps it out through
//!   recordings, screenshots and Hide Crest from screen sharing, and the copy for the open panel (backdrop.rs) finds it out.
//! - The copy is Windows.Graphics.Capture of the notch's monitor, without the yellow border and the cursor, on the GPU that
//!   drives that monitor, into frames that hold the monitor from its top left corner to the zone's far corner (Windows clips
//!   the rest). Windows sends at most 10 frames a second. One D3D11 device is kept while the switch is on: a new one for
//!   each session cost 0.2 to 2.5 s and memory that did not all come back.
//! - 8-bit frames on an HDR monitor too: what Windows shows in SDR comes out exact, HDR content is cut at SDR white.
//! - A frame goes to the page only when the zone's bytes differ from the last ones sent, a session's first always: the notch
//!   redrawing itself marks the zone dirty with nothing changed behind it, and the glass would redraw itself for ever. At a
//!   still screen Windows sends nothing, so a new zone, or the copy again after the panel was open, is a new session.
//! - One shared buffer per frame, made, filled and posted read only on the main thread (backdrop.rs `share`); at most one
//!   frame waits for it, the newest, dropped there if a start or a stop came since.
//! - Stopping closes the session and the pool, waits for a frame being handled and bumps `gen`, in that order, before the
//!   notch's flag may change: nothing captured with the notch in it can reach the page.
//! - Hidden before Windows 11 24H2, on ARM64 PCs and in the Store build until someone tries it there.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment12, ICoreWebView2_17};
use windows::core::{factory, Interface, Ref, HRESULT};
use windows::Foundation::{TimeSpan, TypedEventHandler};
use windows::Graphics::Capture::{
    Direct3D11CaptureFrame, Direct3D11CaptureFramePool, GraphicsCaptureAccess, GraphicsCaptureAccessKind, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::RectInt32;
use windows::Graphics::SizeInt32;
use windows::Security::Authorization::AppCapabilityAccess::AppCapabilityAccessStatus;
use windows::Win32::Foundation::{E_ACCESSDENIED, HMODULE, HWND, LUID};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Multithread, ID3D11Texture2D, D3D11_BOX, D3D11_CPU_ACCESS_READ,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dwm::DwmFlush;
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIAdapter1, IDXGIDevice, IDXGIFactory1, DXGI_ERROR_DEVICE_REMOVED, DXGI_ERROR_DEVICE_RESET,
};
use windows::Win32::Graphics::Gdi::{MonitorFromWindow, HMONITOR, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::UI::HiDpi::{SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, GetWindowDisplayAffinity, SetWindowDisplayAffinity, SM_REMOTESESSION, WDA_EXCLUDEFROMCAPTURE, WINDOW_DISPLAY_AFFINITY,
};

use super::math::{intersect, Rect};
use super::{backdrop, one_at_a_time, record, CaptureState};

/// Windows 11 24H2, the first with MinUpdateInterval and DirtyRegions. Before it every composition sends a frame, and
/// pacing them in the handler loses the end of a burst, which then stays on the glass at a still screen.
const FIRST_BUILD: u32 = 26100;
/// Frames a second, as many on battery: fewer would not spare the compositor, which does most of the work.
const FPS: u32 = 10;

/// The running session, None while stopped. Held through a whole start, so starts, stops and the switch going off come one
/// at a time; the frame handler never takes it.
static LIVE: Mutex<Option<Live>> = Mutex::new(None);
/// Bumped by every start and every stop: a frame still waiting for the main thread from before is dropped there.
static GEN: AtomicU32 = AtomicU32::new(0);
/// The device sessions are made on, from the switch going on to it going off (`gpu`).
static GPU: Mutex<Option<Gpu>> = Mutex::new(None);

/// Whether the live glass can run on this PC, and if not why: the page shows its switch only when it can.
#[derive(Serialize)]
pub struct Support {
    supported: bool,
    reason: Option<&'static str>,
}

/// A session started: its gen and the zone as kept inside the window and its monitor, px in the window.
#[derive(Serialize)]
pub struct Started {
    gen: u32,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

/// What the page gets with each frame (`sharedbufferreceived`): the session, the frame's number in it, the zone inside the
/// window and the window, px. BGRA rows of `w * 4` bytes.
#[derive(Serialize)]
struct LiveMeta {
    kind: &'static str,
    gen: u32,
    seq: u32,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    ww: i32,
    wh: i32,
}

#[tauri::command]
pub async fn glass_live_supported(window: WebviewWindow) -> Support {
    let reason = support(&window).await;
    Support { supported: reason.is_none(), reason }
}

/// The switch went on or off; the page also calls it at load. On: the notch window out of every capture until it goes off,
/// or a rejection with the reason it cannot run, or `exclude-failed` with the flag as it was. Off: the copy stops, then the
/// flag goes back to what recordings, screenshots and Hide Crest from screen sharing ask for. Either way, again is the same.
#[tauri::command]
pub async fn glass_live_exclude(on: bool, app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if on {
        if let Some(why) = support(&window).await {
            return Err(why.into());
        }
    }
    let notch = backdrop::notch(&window);
    tauri::async_runtime::spawn_blocking(move || switch(&app, HWND(notch as _), on)).await.unwrap_or(Err("failed")).map_err(String::from)
}

/// The live copy of `zone` (px inside the notch window, as in backdrop.rs), in a new session that replaces any other: also the
/// way to change the zone, since at a still screen only a new session sends a frame. Resolves with its gen and the zone as
/// kept; the frames follow, the first one possibly before this answer. Rejects with a short code (`refusal`, then `begin`).
#[tauri::command]
pub async fn glass_live_start(zone: Rect, app: AppHandle, window: WebviewWindow) -> Result<Started, String> {
    let support = support(&window).await;
    let notch = backdrop::notch(&window);
    tauri::async_runtime::spawn_blocking(move || begin(&app, &window, notch, zone, support)).await.unwrap_or(Err("failed")).map_err(String::from)
}

/// Stops the live copy, if it runs; the notch stays out of captures while the switch is on.
#[tauri::command]
pub async fn glass_live_stop() {
    let _ = tauri::async_runtime::spawn_blocking(|| stop(&mut slot())).await;
}

/// The screen went off or to sleep, the session was locked or went to a remote client (sysevents.rs): the copy stops and the
/// page hears why.
pub(crate) fn halt(app: &AppHandle, why: &'static str) {
    halt_if(app, None, why);
}

fn switch(app: &AppHandle, notch: HWND, on: bool) -> Result<(), &'static str> {
    let state = app.state::<CaptureState>();
    let mut live = slot();
    // The copy stops before the flag goes back: a frame taken after it would carry the notch into its own glass.
    if !on {
        stop(&mut live);
        *lock(&GPU) = None;
    }
    {
        let _one = one_at_a_time();
        if on {
            keep_out(notch)?;
            state.live.store(true, Ordering::SeqCst);
        } else if state.live.swap(false, Ordering::SeqCst) {
            if let Some(flag) = backdrop::restore_to(state.excluded(), state.holds.load(Ordering::SeqCst), crate::sharing::hidden(), false) {
                let _ = unsafe { SetWindowDisplayAffinity(notch, flag) };
            }
        }
    }
    // The device now, so the first start does not wait for it; with LIVE still held, so the switch going off waits for it.
    if on {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let _ = gpu(MonitorFromWindow(notch, MONITOR_DEFAULTTONEAREST), true);
        }
    }
    Ok(())
}

/// The notch out of captures: the flag, read back, then a frame of DWM so the next capture is without it. On a failure the
/// flag goes back to what it was. Under `one_at_a_time`.
fn keep_out(notch: HWND) -> Result<(), &'static str> {
    let mut was = 0u32;
    unsafe { GetWindowDisplayAffinity(notch, &mut was) }.map_err(|_| "exclude-failed")?;
    if was == WDA_EXCLUDEFROMCAPTURE.0 {
        return Ok(());
    }
    let set = unsafe { SetWindowDisplayAffinity(notch, WDA_EXCLUDEFROMCAPTURE) }.is_ok();
    let mut now = 0u32;
    if !set || unsafe { GetWindowDisplayAffinity(notch, &mut now) }.is_err() || now != WDA_EXCLUDEFROMCAPTURE.0 {
        let _ = unsafe { SetWindowDisplayAffinity(notch, WINDOW_DISPLAY_AFFINITY(was)) };
        return Err("exclude-failed");
    }
    let _ = unsafe { DwmFlush() };
    Ok(())
}

/// Why the live glass cannot run here, None when it can. Worked out once, as soon as the answer is sure.
async fn support(window: &WebviewWindow) -> Option<&'static str> {
    static KNOWN: OnceLock<Option<&'static str>> = OnceLock::new();
    if let Some(known) = KNOWN.get() {
        return *known;
    }
    let why = match unsupported(crate::terminal::windows_build(), crate::native_machine(), cfg!(feature = "store")) {
        None => match capture(window).await {
            Some(true) => None,
            Some(false) => Some("unsupported"),
            // Not known this time (the window closing, WinRT failing): no for now, and the page asks again (live.ts).
            None => return Some("failed"),
        },
        why => why,
    };
    *KNOWN.get_or_init(|| why)
}

/// The reasons that come before trying anything, in the contract's order. ARM64 and the Store build have never been tried,
/// and a PC whose architecture cannot be read is not taken for x64.
fn unsupported(build: u32, machine: Option<&str>, store: bool) -> Option<&'static str> {
    if build < FIRST_BUILD {
        Some("old-windows")
    } else if machine == Some("aarch64") {
        Some("arm64")
    } else if store {
        Some("store")
    } else if machine != Some("x86_64") {
        Some("unsupported")
    } else {
        None
    }
}

/// Windows.Graphics.Capture, and a WebView2 that takes shared buffers (backdrop.rs `share`); None when it could not be asked.
async fn capture(window: &WebviewWindow) -> Option<bool> {
    if !GraphicsCaptureSession::IsSupported().ok()? {
        return Some(false);
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |webview| {
            let _ = tx.send(unsafe {
                webview.environment().cast::<ICoreWebView2Environment12>().is_ok()
                    && webview.controller().CoreWebView2().is_ok_and(|core| core.cast::<ICoreWebView2_17>().is_ok())
            });
        })
        .ok()?;
    rx.await.ok()
}

/// Why a session cannot start now, from what Rust knows before it looks at the screen, in the contract's order.
fn refusal(build: u32, live: bool, transparency: bool, remote: bool, locked: bool, asleep: bool) -> Option<&'static str> {
    if build < FIRST_BUILD {
        Some("old-windows")
    } else if !live {
        // Without the exclusion the notch would show in its own glass.
        Some("not-excluded")
    } else if let Some(why) = backdrop::refusal(build, transparency, remote) {
        Some(why)
    } else if locked {
        Some("locked")
    } else if asleep {
        Some("asleep")
    } else {
        None
    }
}

/// The zone the page asked for (px in the window) kept inside the window and its monitor: where it is in the window, where in
/// the monitor (the frames and their dirty regions count from the monitor's corner), and the frames' size, which reaches from
/// that corner to the zone's far one. None when nothing of it is on the monitor.
fn clip(zone: Rect, window: Rect, monitor: Rect) -> Option<(Rect, Rect, SizeInt32)> {
    let (x0, y0) = (zone.x.clamp(0, window.w), zone.y.clamp(0, window.h));
    let (x1, y1) = (zone.x.saturating_add(zone.w).clamp(0, window.w), zone.y.saturating_add(zone.h).clamp(0, window.h));
    let on = intersect(Rect { x: window.x + x0, y: window.y + y0, w: x1 - x0, h: y1 - y0 }, monitor)?;
    let there = Rect { x: on.x - monitor.x, y: on.y - monitor.y, ..on };
    Some((Rect { x: on.x - window.x, y: on.y - window.y, ..on }, there, SizeInt32 { Width: there.right(), Height: there.bottom() }))
}

fn begin(app: &AppHandle, window: &WebviewWindow, notch: isize, zone: Rect, support: Option<&'static str>) -> Result<Started, &'static str> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let _ = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
    let mut live = slot();
    stop(&mut live);
    let state = app.state::<CaptureState>();
    let remote = unsafe { GetSystemMetrics(SM_REMOTESESSION) } != 0 || crate::sysevents::remote();
    let locked = crate::sysevents::locked();
    // The window's flag as well as the switch: whatever wrote it last, the notch must be out before anything is copied.
    let mut flag = 0u32;
    let out = unsafe { GetWindowDisplayAffinity(HWND(notch as _), &mut flag) }.is_ok() && flag == WDA_EXCLUDEFROMCAPTURE.0;
    if let Some(why) = refusal(
        crate::terminal::windows_build(),
        state.live.load(Ordering::SeqCst) && out,
        backdrop::transparency(),
        remote,
        locked,
        crate::standby::settling(),
    ) {
        return Err(why);
    }
    let (win, monitor, handle) = backdrop::placement(HWND(notch as _)).ok_or("no-window")?;
    let (at, zone, size) = clip(zone, win, monitor).ok_or("no-window")?;
    if let Some(why) = support {
        return Err(why);
    }
    if !borderless() {
        return Err("border-denied");
    }
    let gen = GEN.fetch_add(1, Ordering::SeqCst).wrapping_add(1);
    *live = Some(open(handle, zone, size, gen, to_page(window.clone(), gen, at, win), halt_later(app.clone(), gen))?);
    Ok(Started { gen, x: at.x, y: at.y, w: at.w, h: at.h })
}

/// Windows' answer to capturing without the yellow border. A yes is kept; a no is asked again at the next start, since a
/// failure that passes would otherwise leave the switch on with no glass until Crest restarts. The Store build would show a
/// prompt and wait for it, so this never runs on the main thread.
fn borderless() -> bool {
    static ALLOWED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if ALLOWED.load(Ordering::Relaxed) {
        return true;
    }
    let yes = GraphicsCaptureAccess::RequestAccessAsync(GraphicsCaptureAccessKind::Borderless).and_then(|op| op.join())
        == Ok(AppCapabilityAccessStatus::Allowed);
    ALLOWED.store(yes, Ordering::Relaxed);
    yes
}

/// The GPU that drives `monitor`; None when no GPU lists it.
fn output(dxgi: &IDXGIFactory1, monitor: HMONITOR) -> Option<IDXGIAdapter1> {
    unsafe {
        for i in 0.. {
            let adapter = dxgi.EnumAdapters1(i).ok()?;
            for j in 0.. {
                let Ok(output) = adapter.EnumOutputs(j) else { break };
                if output.GetDesc().is_ok_and(|d| d.Monitor == monitor) {
                    return Some(adapter);
                }
            }
        }
        None
    }
}

/// A D3D11 device and what a capture needs of it.
#[derive(Clone)]
struct Gpu {
    /// The GPU it was made on; None for the default one or WARP, which no other session gets.
    luid: Option<LUID>,
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    winrt: IDirect3DDevice,
}

// D3D11 with multithread protection on, WinRT objects agile.
unsafe impl Send for Gpu {}

/// The kept device, made again when another GPU drives `monitor` or the device was lost. `fallback`: the default GPU, or
/// WARP, when the monitor's own GPU gives no device; not after a loss, which would carry on in software.
fn gpu(monitor: HMONITOR, fallback: bool) -> windows::core::Result<Gpu> {
    let mut kept = lock(&GPU);
    let dxgi: IDXGIFactory1 = unsafe { CreateDXGIFactory1()? };
    let adapter = output(&dxgi, monitor).and_then(|a| Some((unsafe { a.GetDesc1() }.ok()?.AdapterLuid, a)));
    let luid = adapter.as_ref().map(|(luid, _)| *luid);
    if let Some(gpu) = kept.as_ref().filter(|g| g.luid.is_some() && g.luid == luid && unsafe { g.device.GetDeviceRemovedReason() }.is_ok()) {
        return Ok(gpu.clone());
    }
    *kept = None;
    let made = device(adapter, fallback)?;
    *kept = Some(made.clone());
    Ok(made)
}

/// A D3D11 device on `gpu`, the one that drives the notch's monitor, so frames are not copied between GPUs.
fn device(gpu: Option<(LUID, IDXGIAdapter1)>, fallback: bool) -> windows::core::Result<Gpu> {
    unsafe {
        let on_gpu = gpu.and_then(|(luid, gpu)| {
            let (mut device, mut context) = (None, None);
            let flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
            D3D11CreateDevice(
                &gpu,
                D3D_DRIVER_TYPE_UNKNOWN,
                HMODULE::default(),
                flags,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
            .ok()?;
            Some((device?, context?, Some(luid)))
        });
        let (device, context, luid) = match on_gpu {
            Some(made) => made,
            None if fallback => {
                let (device, context) = record::d3d_device()?;
                (device, context, None)
            }
            None => return Err(DXGI_ERROR_DEVICE_REMOVED.into()),
        };
        // Windows' capture threads use it as well as the frame handler.
        let _ = device.cast::<ID3D11Multithread>()?.SetMultithreadProtected(true);
        let winrt = CreateDirect3D11DeviceFromDXGIDevice(&device.cast::<IDXGIDevice>()?)?.cast()?;
        Ok(Gpu { luid, device, context, winrt })
    }
}

/// Where the zone is read from the GPU.
fn staging(device: &ID3D11Device, zone: Rect) -> windows::core::Result<ID3D11Texture2D> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: zone.w as u32,
        Height: zone.h as u32,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
    };
    let mut texture = None;
    unsafe { device.CreateTexture2D(&desc, None, Some(&mut texture))? };
    record::out(texture)
}

/// Where a frame for the page goes: its `seq` and the zone's rows.
type Sink = Box<dyn Fn(u32, Vec<u8>) + Send>;
/// Called when the session has to stop on its own, with the reason for the page.
type Fault = Arc<dyn Fn(&'static str) + Send + Sync>;

struct Live {
    gen: u32,
    session: GraphicsCaptureSession,
    pool: Direct3D11CaptureFramePool,
    _item: GraphicsCaptureItem,
    frames: Arc<Mutex<Frames>>,
}

// WinRT capture objects are agile.
unsafe impl Send for Live {}

/// Starts capturing `zone` (px in `monitor`) into frames of `size`: frames for the page to `send`, a reason to stop on its own
/// to `fault`. Access refused (Settings › Privacy & security, or a policy, for a packaged Crest) is `capture-denied`.
fn open(monitor: HMONITOR, zone: Rect, size: SizeInt32, gen: u32, send: Sink, fault: Fault) -> Result<Live, &'static str> {
    let failed = |_| "failed";
    let denied = |e: windows::core::Error| if e.code() == E_ACCESSDENIED { "capture-denied" } else { "failed" };
    let gpu = gpu(monitor, true).map_err(failed)?;
    let staging = staging(&gpu.device, zone).map_err(failed)?;
    let item: GraphicsCaptureItem = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
        .and_then(|interop| unsafe { interop.CreateForMonitor(monitor) })
        .map_err(denied)?;
    let content = item.Size().map_err(failed)?;
    let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&gpu.winrt, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size).map_err(failed)?;
    let session = pool.CreateCaptureSession(&item).map_err(denied)?;
    let _ = session.SetIsCursorCaptureEnabled(false);
    session.SetIsBorderRequired(false).map_err(|_| "border-denied")?;
    session.SetMinUpdateInterval(TimeSpan { Duration: 10_000_000 / FPS as i64 }).map_err(failed)?;
    let frames = Arc::new(Mutex::new(Frames {
        done: false,
        seq: 0,
        gpu,
        staging,
        monitor,
        zone,
        size,
        content,
        last: Vec::new(),
        renewed: false,
        copies: 0,
        send,
        fault: fault.clone(),
    }));
    let handler = frames.clone();
    pool.FrameArrived(&TypedEventHandler::new(move |pool: Ref<Direct3D11CaptureFramePool>, _| {
        let mut frames = lock(&handler);
        if let (Some(pool), false) = (pool.as_ref(), frames.done) {
            match frames.next(pool) {
                Step::Skip => {}
                Step::Send(seq, pixels) => (frames.send)(seq, pixels),
                Step::Stop(why) => {
                    frames.done = true;
                    (frames.fault)(why);
                }
            }
        }
        Ok(())
    }))
    .map_err(failed)?;
    // The monitor was unplugged or switched off.
    item.Closed(&TypedEventHandler::new(move |_, _| {
        fault("monitor");
        Ok(())
    }))
    .map_err(failed)?;
    session.StartCapture().map_err(denied)?;
    Ok(Live { gen, session, pool, _item: item, frames })
}

/// Ends the session in `slot`, if any, and gives its gen: no frame comes any more, the one being handled is finished, and one
/// waiting for the main thread is dropped there. Only after this may the notch's flag change.
fn stop(slot: &mut Option<Live>) -> Option<u32> {
    let live = slot.take()?;
    let _ = live.session.Close();
    let _ = live.pool.Close();
    let mut frames = lock(&live.frames);
    frames.done = true;
    // The last copy goes now, not when Windows lets the handler go.
    frames.last = Vec::new();
    drop(frames);
    GEN.fetch_add(1, Ordering::SeqCst);
    Some(live.gen)
}

/// Stops the session `gen` (any for None) and tells the page why with `glass://live`.
fn halt_if(app: &AppHandle, gen: Option<u32>, why: &'static str) {
    let stopped = {
        let mut live = slot();
        if gen.is_some() && live.as_ref().map(|l| l.gen) != gen {
            return;
        }
        stop(&mut live)
    };
    if let Some(gen) = stopped {
        let _ = app.emit("glass://live", serde_json::json!({ "gen": gen, "reason": why }));
    }
}

/// The frame handler and the item's events cannot stop their own session, which waits for the handler: another thread does.
fn halt_later(app: AppHandle, gen: u32) -> Fault {
    Arc::new(move |why| {
        let app = app.clone();
        std::thread::spawn(move || halt_if(&app, Some(gen), why));
    })
}

/// Frames for the page, posted from the main thread.
fn to_page(window: WebviewWindow, gen: u32, at: Rect, win: Rect) -> Sink {
    let waiting = Arc::new(Waiting::default());
    Box::new(move |seq, pixels| {
        let meta = LiveMeta { kind: "glass-live", gen, seq, x: at.x, y: at.y, w: at.w, h: at.h, ww: win.w, wh: win.h };
        let Ok(meta) = serde_json::to_string(&meta) else { return };
        if !waiting.put((pixels, meta)) {
            return;
        }
        let next = waiting.clone();
        let posted = window.with_webview(move |webview| {
            if let Some((pixels, meta)) = next.take(gen) {
                let _ = backdrop::share(&webview, &pixels, &meta);
            }
        });
        // The window is gone: let the next frame try again.
        if posted.is_err() {
            waiting.take(gen);
        }
    })
}

/// The frame waiting for the main thread, at most one: a busy main thread never piles copies up.
#[derive(Default)]
struct Waiting(Mutex<Option<(Vec<u8>, String)>>);

impl Waiting {
    /// Leaves a frame to wait, in place of an older one; true when no post is on its way to take it.
    fn put(&self, frame: (Vec<u8>, String)) -> bool {
        lock(&self.0).replace(frame).is_none()
    }

    /// The frame for the post, unless a start or a stop came after session `gen`'s.
    fn take(&self, gen: u32) -> Option<(Vec<u8>, String)> {
        lock(&self.0).take().filter(|_| GEN.load(Ordering::SeqCst) == gen)
    }
}

/// What the frame handler keeps between frames. Every use goes through its mutex.
struct Frames {
    /// Set by `stop`, or when the session stops on its own: a frame that still comes is left alone.
    done: bool,
    seq: u32,
    gpu: Gpu,
    staging: ID3D11Texture2D,
    monitor: HMONITOR,
    /// The zone in the monitor, px.
    zone: Rect,
    /// The frames' size.
    size: SizeInt32,
    /// The monitor's size at the start: frames of another size mean it changed, and the zone with it.
    content: SizeInt32,
    /// The zone's bytes last sent, empty before the session's first frame.
    last: Vec<u8>,
    /// The device was made again once; a second loss stops the session.
    renewed: bool,
    /// Zones read, sent or not (the live test looks at it).
    #[cfg_attr(not(test), allow(dead_code))]
    copies: u32,
    send: Sink,
    fault: Fault,
}

// D3D11 with multithread protection on, WinRT objects agile; every use goes through the mutex.
unsafe impl Send for Frames {}

/// What a frame comes to.
enum Step {
    Skip,
    Send(u32, Vec<u8>),
    Stop(&'static str),
}

impl Frames {
    fn next(&mut self, pool: &Direct3D11CaptureFramePool) -> Step {
        let taken = match pool.TryGetNextFrame() {
            Ok(frame) => {
                let step = self.take(&frame);
                let _ = frame.Close();
                step
            }
            // No frame waiting comes back as an error with a success code (record.rs).
            Err(e) if !e.code().is_err() => return Step::Skip,
            Err(e) => Err(e),
        };
        // A lost device shows as an error here or from Map: a new device once, then the session stops. Any other error loses
        // this frame only.
        taken.unwrap_or_else(|e| {
            let lost = device_lost(e.code(), unsafe { self.gpu.device.GetDeviceRemovedReason() }.is_err());
            if lost && (std::mem::replace(&mut self.renewed, true) || self.renew(pool).is_err()) {
                Step::Stop("device")
            } else {
                Step::Skip
            }
        })
    }

    fn take(&mut self, frame: &Direct3D11CaptureFrame) -> windows::core::Result<Step> {
        if frame.ContentSize()? != self.content {
            return Ok(Step::Stop("monitor"));
        }
        let z = self.zone;
        // No dirty regions (they cannot be read) count as the zone dirty.
        if !self.last.is_empty() && frame.DirtyRegions().is_ok_and(|dirty| !touches(dirty, z)) {
            return Ok(Step::Skip);
        }
        let access: IDirect3DDxgiInterfaceAccess = frame.Surface()?.cast()?;
        let texture: ID3D11Texture2D = unsafe { access.GetInterface()? };
        let area = D3D11_BOX { left: z.x as u32, top: z.y as u32, front: 0, right: z.right() as u32, bottom: z.bottom() as u32, back: 1 };
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        let context = &self.gpu.context;
        let changed = unsafe {
            context.CopySubresourceRegion(&self.staging, 0, 0, 0, 0, &texture, 0, Some(&area));
            context.Map(&self.staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;
            let (row, pitch) = (z.w as usize * 4, mapped.RowPitch as usize);
            let rows = std::slice::from_raw_parts(mapped.pData as *const u8, pitch * (z.h as usize - 1) + row);
            let changed = refresh(&mut self.last, rows, pitch, row);
            context.Unmap(&self.staging, 0);
            changed
        };
        self.copies += 1;
        if !changed {
            return Ok(Step::Skip);
        }
        self.seq += 1;
        Ok(Step::Send(self.seq, self.last.clone()))
    }

    /// A new device on the monitor's GPU and the pool made again on it, as the Screen capture docs say for a lost device.
    fn renew(&mut self, pool: &Direct3D11CaptureFramePool) -> windows::core::Result<()> {
        let gpu = gpu(self.monitor, false)?;
        let staging = staging(&gpu.device, self.zone)?;
        pool.Recreate(&gpu.winrt, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, self.size)?;
        (self.gpu, self.staging) = (gpu, staging);
        Ok(())
    }
}

/// Whether a frame's error means the GPU was lost: the error says so, or the device does. A pool closed by `stop` under a
/// frame being handled (RO_E_CLOSED) is not.
fn device_lost(error: HRESULT, removed: bool) -> bool {
    error == DXGI_ERROR_DEVICE_REMOVED || error == DXGI_ERROR_DEVICE_RESET || removed
}

/// Whether one of a frame's dirty regions reaches the zone, both px in the monitor.
fn touches(dirty: impl IntoIterator<Item = RectInt32>, zone: Rect) -> bool {
    dirty.into_iter().any(|r| intersect(Rect { x: r.X, y: r.Y, w: r.Width, h: r.Height }, zone).is_some())
}

/// Copies the zone's rows, `pitch` bytes apart in `mapped` and `row` bytes long, over `last`; whether a byte changed. An empty
/// `last` is the session's first frame, which always counts.
fn refresh(last: &mut Vec<u8>, mapped: &[u8], pitch: usize, row: usize) -> bool {
    let rows = mapped.chunks(pitch);
    let first = last.is_empty();
    if first {
        last.resize(rows.len() * row, 0);
    }
    let mut changed = first;
    for (to, from) in last.chunks_exact_mut(row).zip(rows) {
        let from = &from[..row];
        if to != from {
            to.copy_from_slice(from);
            changed = true;
        }
    }
    changed
}

fn slot() -> MutexGuard<'static, Option<Live>> {
    lock(&LIVE)
}

/// A poisoned lock is taken as it is. Only a build that unwinds (the tests) can poison one: the release build aborts on a panic.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reasons_it_cannot_run_in_the_order_of_the_contract() {
        let x64 = Some("x86_64");
        assert_eq!(unsupported(26100, x64, false), None);
        assert_eq!(unsupported(26300, x64, false), None);
        // Windows 11 23H2: no MinUpdateInterval.
        assert_eq!(unsupported(22631, x64, false), Some("old-windows"));
        assert_eq!(unsupported(19045, x64, false), Some("old-windows"));
        assert_eq!(unsupported(26100, Some("aarch64"), false), Some("arm64"));
        assert_eq!(unsupported(26100, x64, true), Some("store"));
        // An architecture it does not know or cannot read is no.
        assert_eq!(unsupported(26100, Some("other"), false), Some("unsupported"));
        assert_eq!(unsupported(26100, None, false), Some("unsupported"));
        // Several at once: the first one.
        assert_eq!(unsupported(19045, Some("aarch64"), true), Some("old-windows"));
        assert_eq!(unsupported(26100, Some("aarch64"), true), Some("arm64"));
        assert_eq!(unsupported(26100, None, true), Some("store"));
    }

    #[test]
    fn a_start_refuses_in_the_order_of_the_contract() {
        assert_eq!(refusal(26100, true, true, false, false, false), None);
        assert_eq!(refusal(22631, true, true, false, false, false), Some("old-windows"));
        assert_eq!(refusal(19045, true, true, false, false, false), Some("old-windows"));
        assert_eq!(refusal(26100, false, true, false, false, false), Some("not-excluded"));
        assert_eq!(refusal(26100, true, false, false, false, false), Some("transparency-off"));
        assert_eq!(refusal(26100, true, true, true, false, false), Some("remote"));
        assert_eq!(refusal(26100, true, true, false, true, false), Some("locked"));
        assert_eq!(refusal(26100, true, true, false, false, true), Some("asleep"));
        // Several at once: the first one.
        assert_eq!(refusal(19045, false, false, true, true, true), Some("old-windows"));
        assert_eq!(refusal(26100, false, false, true, true, true), Some("not-excluded"));
        assert_eq!(refusal(26100, true, false, true, true, true), Some("transparency-off"));
        assert_eq!(refusal(26100, true, true, true, true, true), Some("remote"));
        assert_eq!(refusal(26100, true, true, false, true, true), Some("locked"));
    }

    #[test]
    fn the_zone_keeps_to_the_window_and_its_monitor_and_sizes_the_frames() {
        let monitor = Rect { x: 0, y: 0, w: 2880, h: 1800 };
        let window = Rect { x: 680, y: 0, w: 1520, h: 1120 };
        // Under the closed notch, centred at the top: the frames reach from the monitor's corner to the zone's far one.
        let (at, there, size) = clip(Rect { x: 460, y: 0, w: 600, h: 120 }, window, monitor).unwrap();
        assert_eq!((at, there), (Rect { x: 460, y: 0, w: 600, h: 120 }, Rect { x: 1140, y: 0, w: 600, h: 120 }));
        assert_eq!((size.Width, size.Height), (1740, 120));
        // A capsule low on the screen: frames nearly as tall as the monitor.
        let low = Rect { x: 680, y: 1500, w: 1520, h: 300 };
        let (_, there, size) = clip(Rect { x: 600, y: 40, w: 320, h: 120 }, low, monitor).unwrap();
        assert_eq!((there, (size.Width, size.Height)), (Rect { x: 1280, y: 1540, w: 320, h: 120 }, (1600, 1660)));
        // Past the window's edges: cut to the window.
        let (at, _, _) = clip(Rect { x: -20, y: 1100, w: 100, h: 100 }, window, monitor).unwrap();
        assert_eq!(at, Rect { x: 0, y: 1100, w: 80, h: 20 });
        // On a monitor right of and above the primary: counted from that monitor's corner, cut where the window leaves it.
        let right = Rect { x: 2880, y: -200, w: 1920, h: 1080 };
        let there_window = Rect { x: 3080, y: -200, w: 1520, h: 1120 };
        let (at, there, size) = clip(Rect { x: 460, y: 0, w: 600, h: 120 }, there_window, right).unwrap();
        assert_eq!((at, there), (Rect { x: 460, y: 0, w: 600, h: 120 }, Rect { x: 660, y: 0, w: 600, h: 120 }));
        assert_eq!((size.Width, size.Height), (1260, 120));
        assert_eq!(clip(Rect { x: 0, y: 1060, w: 100, h: 60 }, there_window, right).map(|c| c.0), Some(Rect { x: 0, y: 1060, w: 100, h: 20 }));
        assert_eq!(clip(Rect { x: 0, y: 1090, w: 100, h: 30 }, there_window, right), None);
        // Empty, absurd or off the window.
        assert_eq!(clip(Rect { x: 0, y: 0, w: 0, h: 120 }, window, monitor), None);
        assert_eq!(clip(Rect { x: 100, y: 0, w: -50, h: 120 }, window, monitor), None);
        assert_eq!(clip(Rect { x: i32::MAX, y: 0, w: i32::MAX, h: 10 }, window, monitor), None);
        assert_eq!(clip(Rect { x: 2000, y: 0, w: 100, h: 100 }, window, monitor), None);
    }

    #[test]
    fn only_a_changed_zone_counts_and_the_first_always() {
        // Two rows of 2 px (8 bytes) in a mapping 12 bytes apart: 4 bytes of padding after the first row.
        let mut mapped = vec![1u8; 20];
        let mut last = Vec::new();
        assert!(refresh(&mut last, &mapped, 12, 8));
        assert_eq!(last, vec![1u8; 16]);
        assert!(!refresh(&mut last, &mapped, 12, 8));
        mapped[10] = 9;
        assert!(!refresh(&mut last, &mapped, 12, 8), "the padding is not the zone");
        mapped[13] = 9;
        assert!(refresh(&mut last, &mapped, 12, 8));
        assert_eq!(last[9], 9);
        assert!(!refresh(&mut last, &mapped, 12, 8));
        // A black first frame goes too.
        assert!(refresh(&mut Vec::new(), &[0u8; 8], 8, 8));
    }

    #[test]
    fn a_frame_is_read_when_a_dirty_region_reaches_the_zone() {
        let zone = Rect { x: 1140, y: 0, w: 600, h: 120 };
        let r = |x, y, w, h| RectInt32 { X: x, Y: y, Width: w, Height: h };
        assert!(!touches(vec![], zone));
        assert!(!touches(vec![r(0, 500, 300, 300), r(1740, 0, 50, 120)], zone), "beside the zone");
        assert!(touches(vec![r(0, 500, 300, 300), r(1700, 100, 200, 200)], zone));
        assert!(touches(vec![r(0, 0, 2880, 1800)], zone));
    }

    #[test]
    fn only_a_lost_gpu_makes_the_device_again() {
        use windows::Win32::Foundation::{E_FAIL, RO_E_CLOSED};
        assert!(device_lost(DXGI_ERROR_DEVICE_REMOVED, false));
        assert!(device_lost(DXGI_ERROR_DEVICE_RESET, false));
        assert!(device_lost(E_FAIL, true), "the device says it is gone");
        // The pool closed by a stop under a frame being handled.
        assert!(!device_lost(RO_E_CLOSED, false));
        assert!(!device_lost(E_FAIL, false));
    }

    #[test]
    fn the_newest_frame_waits_and_a_start_or_stop_drops_it() {
        let waiting = Waiting::default();
        let gen = GEN.load(Ordering::SeqCst);
        assert!(waiting.put((vec![1], "a".into())));
        // A post is on its way: the newer frame takes the older one's place.
        assert!(!waiting.put((vec![2], "b".into())));
        assert_eq!(waiting.take(gen), Some((vec![2], "b".into())));
        assert_eq!(waiting.take(gen), None);
        assert!(waiting.put((vec![3], "c".into())));
        GEN.fetch_add(1, Ordering::SeqCst);
        assert_eq!(waiting.take(gen), None);
        assert!(waiting.put((vec![4], "d".into())), "dropped, and the slot free again");
    }

    #[test]
    fn meta_and_answers_as_the_page_reads_them() {
        let meta = LiveMeta { kind: "glass-live", gen: 3, seq: 41, x: 470, y: 0, w: 600, h: 120, ww: 1520, wh: 1120 };
        let sent = r#"{"kind":"glass-live","gen":3,"seq":41,"x":470,"y":0,"w":600,"h":120,"ww":1520,"wh":1120}"#;
        assert_eq!(serde_json::to_string(&meta).unwrap(), sent);
        assert_eq!(serde_json::to_string(&Started { gen: 3, x: 470, y: 0, w: 600, h: 120 }).unwrap(), r#"{"gen":3,"x":470,"y":0,"w":600,"h":120}"#);
        let yes = Support { supported: true, reason: None };
        assert_eq!(serde_json::to_string(&yes).unwrap(), r#"{"supported":true,"reason":null}"#);
        let no = Support { supported: false, reason: unsupported(26100, Some("x86_64"), true) };
        assert_eq!(serde_json::to_string(&no).unwrap(), r#"{"supported":false,"reason":"store"}"#);
    }
}

#[cfg(test)]
mod live {
    //! Shows three windows for about ten seconds and copies the screen under them: a grey one, on top of it a magenta one
    //! kept out of captures the way the notch is, and one above them that changes away from the zone. Nothing is saved. It shows on screen, so only on request, with the PC free
    //! and unlocked, from a process without a package identity (explorer.exe, not a packaged terminal):
    //! `cargo test --lib capture::glass_live::live -- --ignored --nocapture`.
    use std::time::{Duration, Instant};

    use super::*;
    use windows::core::w;
    use windows::Win32::Foundation::{COLORREF, LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        BeginPaint, CreateSolidBrush, DeleteObject, EndPaint, FillRect, GetMonitorInfoW, InvalidateRect, MonitorFromPoint, UpdateWindow, MONITORINFO,
        MONITOR_DEFAULTTOPRIMARY, PAINTSTRUCT,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::*;

    // COLORREF, 0x00BBGGRR.
    const GREY: u32 = 0x0060_6060;
    const GREEN: u32 = 0x0000_a000;
    const MAGENTA: u32 = 0x00ff_00ff;
    const MAGENTA_2: u32 = 0x00fe_00ff;

    unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        unsafe {
            match msg {
                WM_PAINT => {
                    let mut ps = PAINTSTRUCT::default();
                    let dc = BeginPaint(hwnd, &mut ps);
                    let brush = CreateSolidBrush(COLORREF(GetWindowLongPtrW(hwnd, GWLP_USERDATA) as u32));
                    FillRect(dc, &ps.rcPaint, brush);
                    let _ = DeleteObject(brush.into());
                    let _ = EndPaint(hwnd, &ps);
                    LRESULT(0)
                }
                WM_ERASEBKGND => LRESULT(1),
                WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
                _ => DefWindowProcW(hwnd, msg, wparam, lparam),
            }
        }
    }

    /// A small topmost popup that never takes the focus.
    fn window(r: Rect, colour: u32) -> HWND {
        unsafe {
            let instance = GetModuleHandleW(None).unwrap();
            let style = WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
            let hwnd = CreateWindowExW(
                style,
                w!("CrestLiveTest"),
                w!("Crest live test"),
                WS_POPUP,
                r.x,
                r.y,
                r.w,
                r.h,
                None,
                None,
                Some(instance.into()),
                None,
            )
            .unwrap();
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, colour as isize);
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            hwnd
        }
    }

    fn paint(hwnd: HWND, colour: u32) {
        unsafe {
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, colour as isize);
            let _ = InvalidateRect(Some(hwnd), None, false);
            let _ = UpdateWindow(hwnd);
        }
    }

    /// Keeps the windows painting for `d`, calling `each` about every 16 ms.
    fn run(d: Duration, mut each: impl FnMut()) {
        let end = Instant::now() + d;
        let mut msg = MSG::default();
        while Instant::now() < end {
            each();
            unsafe {
                while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
            std::thread::sleep(Duration::from_millis(16));
        }
    }

    /// Runs until `done`, at most `limit`; whether it got done.
    fn until(limit: Duration, mut done: impl FnMut() -> bool) -> bool {
        let end = Instant::now() + limit;
        while !done() {
            if Instant::now() > end {
                return false;
            }
            run(Duration::from_millis(16), || {});
        }
        true
    }

    /// A BGRA pixel close to a COLORREF.
    fn near(p: &[u8], colour: u32) -> bool {
        let want = [(colour >> 16) as u8, (colour >> 8) as u8, colour as u8];
        p[..3].iter().zip(want).all(|(a, b)| a.abs_diff(b) <= 2)
    }

    fn all(px: &[u8], colour: u32) -> bool {
        px.chunks_exact(4).all(|p| near(p, colour))
    }

    fn any_magenta(px: &[u8]) -> bool {
        px.chunks_exact(4).any(|p| p[2] > 200 && p[1] < 60 && p[0] > 200)
    }

    #[test]
    #[ignore]
    fn the_glass_copies_what_is_behind_the_notch_and_only_when_it_changes() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let _ = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            let class = WNDCLASSW {
                lpfnWndProc: Some(proc),
                hInstance: GetModuleHandleW(None).unwrap().into(),
                lpszClassName: w!("CrestLiveTest"),
                ..Default::default()
            };
            RegisterClassW(&class);
        }
        let handle = unsafe { MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY) };
        let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
        assert!(unsafe { GetMonitorInfoW(handle, &mut info) }.as_bool());
        let m = info.rcMonitor;
        let monitor = Rect { x: m.left, y: m.top, w: m.right - m.left, h: m.bottom - m.top };
        // Left of the middle, away from the notch, the taskbar and the corner where notifications show.
        let behind = Rect { x: monitor.x + 120, y: monitor.y + 360, w: 320, h: 160 };
        let grey = window(behind, GREY);
        let notch = window(Rect { x: behind.x + 80, y: behind.y + 40, w: 160, h: 80 }, MAGENTA);
        // On the monitor and in the frames, away from the zone.
        let far = window(Rect { x: behind.x, y: behind.y - 220, w: 160, h: 120 }, GREY);
        run(Duration::from_millis(200), || {});
        let out = || {
            let _one = one_at_a_time();
            keep_out(notch).unwrap();
        };
        out();
        eprintln!("borderless allowed: {}", borderless());
        // The zone is the grey window, which the stand-in notch sits in.
        let (_, zone, size) = clip(Rect { x: 0, y: 0, w: behind.w, h: behind.h }, behind, monitor).unwrap();
        let frames: Arc<Mutex<Vec<(u32, Vec<u8>)>>> = Arc::default();
        let faults: Arc<Mutex<Vec<&'static str>>> = Arc::default();
        let start = || {
            let (sent, failed) = (frames.clone(), faults.clone());
            let send: Sink = Box::new(move |seq, px| lock(&sent).push((seq, px)));
            Some(open(handle, zone, size, 1, send, Arc::new(move |why| lock(&failed).push(why))).unwrap())
        };
        let count = || lock(&frames).len();

        // A new session sends its first frame, without the notch.
        let t = Instant::now();
        let mut live = start();
        assert!(until(Duration::from_secs(1), || count() == 1), "no first frame");
        eprintln!("first frame after {:?}", t.elapsed());
        {
            let sent = lock(&frames);
            assert_eq!(sent[0].0, 1);
            assert!(!any_magenta(&sent[0].1), "the notch is in its own glass");
            assert!(all(&sent[0].1, GREY), "the copy is not the window behind the notch");
        }

        // The notch changes at 60 Hz, nothing behind it does: copies maybe, nothing sent.
        let copies = lock(&live.as_ref().unwrap().frames).copies;
        let mut flip = false;
        run(Duration::from_millis(1500), || {
            flip = !flip;
            paint(notch, if flip { MAGENTA_2 } else { MAGENTA });
        });
        eprintln!("notch changing for 1.5 s: {} zones read, {} sent", lock(&live.as_ref().unwrap().frames).copies - copies, count() - 1);
        assert_eq!(count(), 1, "sent although nothing behind the notch changed");

        // What is behind changes: sent, still without the notch.
        paint(grey, GREEN);
        assert!(until(Duration::from_secs(1), || count() >= 2), "the change behind the notch was not sent");
        run(Duration::from_millis(300), || {});
        {
            let sent = lock(&frames);
            let (seq, px) = sent.last().unwrap();
            assert_eq!(*seq as usize, sent.len());
            assert!(!any_magenta(px) && all(px, GREEN), "the new copy is not the window behind the notch");
        }

        // A change behind the notch, then 20 to 80 ms later one away from it, then nothing, 20 times: the change behind
        // still comes, so a frame's dirty regions cover all the changes since the frame before, not only the last one.
        let mut colour = GREEN;
        let mut slowest = Duration::ZERO;
        for i in 0..20u64 {
            colour = if colour == GREEN { GREY } else { GREEN };
            let t = Instant::now();
            paint(grey, colour);
            run(Duration::from_millis(20 + i * 37 % 61), || {});
            paint(far, if i % 2 == 0 { GREEN } else { GREY });
            let came = until(Duration::from_millis(300), || lock(&frames).last().is_some_and(|(_, px)| all(px, colour)));
            assert!(came, "change {i} behind the notch did not come");
            slowest = slowest.max(t.elapsed());
            run(Duration::from_millis(150), || {});
        }
        eprintln!("20 changes behind the notch followed by one away from it: all came, the slowest after {slowest:?}");

        // Stopped, then the flag back as when the switch goes off: nothing comes after, whatever changes.
        let gen = GEN.load(Ordering::SeqCst);
        assert_eq!(stop(&mut live), Some(1));
        let after = count();
        unsafe { SetWindowDisplayAffinity(notch, windows::Win32::UI::WindowsAndMessaging::WDA_NONE) }.unwrap();
        run(Duration::from_millis(400), || {
            flip = !flip;
            paint(notch, if flip { MAGENTA_2 } else { MAGENTA });
            paint(grey, if flip { GREY } else { GREEN });
        });
        assert_eq!(count(), after, "a frame came after the stop");
        // Greater, not one more: other tests in this process move GEN too.
        assert!(GEN.load(Ordering::SeqCst) > gen);

        // A new session at a still screen still sends a first frame.
        out();
        paint(grey, GREY);
        run(Duration::from_millis(300), || {});
        let t = Instant::now();
        let mut live = start();
        assert!(until(Duration::from_secs(1), || count() == after + 1), "a new session at a still screen sent nothing");
        eprintln!("first frame of a new session at a still screen after {:?}", t.elapsed());
        {
            let sent = lock(&frames);
            let (seq, px) = sent.last().unwrap();
            assert_eq!(*seq, 1);
            assert!(!any_magenta(px) && all(px, GREY));
        }
        stop(&mut live);
        *lock(&GPU) = None;
        assert!(lock(&faults).is_empty(), "{:?}", lock(&faults));
        unsafe {
            let _ = DestroyWindow(far);
            let _ = DestroyWindow(notch);
            let _ = DestroyWindow(grey);
        }
    }
}
