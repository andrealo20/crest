//! Display brightness for the closed notch's HUD.
//!
//! - Built-in panel: WMI's `WmiMonitorBrightnessEvent` (root\WMI), read semi-synchronously on this thread, so nothing calls
//!   back into the process. The panel's level at the start is the baseline: only a different one is reported.
//! - External monitors: DDC/CI has no change event, so while the Brightness alert is on they are read every `POLL`, each
//!   monitor's first reading being its baseline. A monitor that does not answer three times in a row is left alone.
//!
//! Crest never sets the brightness, so every reported change came from somewhere else.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use tauri::AppHandle;
use windows::core::{w, BOOL, BSTR, PCWSTR};
use windows::Win32::Devices::Display::{
    DestroyPhysicalMonitors, GetMonitorBrightness, GetNumberOfPhysicalMonitorsFromHMONITOR, GetPhysicalMonitorsFromHMONITOR, PHYSICAL_MONITOR,
};
use windows::Win32::Foundation::{LPARAM, RECT, TRUE};
use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoSetProxyBlanket, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, EOAC_NONE, RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE,
};
use windows::Win32::System::Variant::{VariantClear, VariantToUInt32, VARIANT};
use windows::Win32::System::Wmi::{IEnumWbemClassObject, IWbemClassObject, IWbemLocator, IWbemServices, WbemLocator, WBEM_FLAG_FORWARD_ONLY, WBEM_FLAG_RETURN_IMMEDIATELY};

/// How often external monitors are read while the Brightness alert is on. A DDC/CI read takes tens of milliseconds per monitor.
const POLL: Duration = Duration::from_secs(2);
/// Failed reads in a row after which a monitor counts as without DDC/CI.
const GIVE_UP: u8 = 3;
// RPC_C_AUTHN_WINNT and RPC_C_AUTHZ_NONE (Win32_System_Rpc is not enabled).
const AUTHN_WINNT: u32 = 10;
const AUTHZ_NONE: u32 = 0;

static DDC: AtomicBool = AtomicBool::new(false);

pub fn set_ddc(on: bool) {
    DDC.store(on, Ordering::Relaxed);
}

pub fn spawn(app: AppHandle) {
    thread::spawn(move || run(app));
}

fn run(app: AppHandle) {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let services = unsafe { wmi() }.inspect_err(|e| eprintln!("brightness: WMI failed: {e}")).ok();
    let mut panel = services.as_ref().and_then(|s| unsafe { first_u8(&query(s, "SELECT CurrentBrightness FROM WmiMonitorBrightness", false).ok()?, w!("CurrentBrightness")) });
    let mut events = services.as_ref().and_then(|s| unsafe { query(s, "SELECT * FROM WmiMonitorBrightnessEvent", true) }.inspect_err(|e| eprintln!("brightness: panel events failed: {e}")).ok());
    let mut external: HashMap<(isize, usize), u8> = HashMap::new();
    let mut fails: HashMap<(isize, usize), u8> = HashMap::new();
    let mut next_poll = Instant::now() + POLL;
    loop {
        let wait = next_poll.saturating_duration_since(Instant::now());
        match &events {
            Some(e) => match unsafe { next_level(e, wait) } {
                Ok(Some(level)) if panel != Some(level) => {
                    panel = Some(level);
                    crate::sysevents::emit_level(&app, "brightness", level, false);
                }
                Ok(_) => {}
                // WMI went away (service restart): the panel stays silent rather than spinning on the error.
                Err(e) => {
                    eprintln!("brightness: panel events stopped: {e}");
                    events = None;
                }
            },
            None => thread::sleep(wait),
        }
        if Instant::now() < next_poll {
            continue;
        }
        next_poll = Instant::now() + POLL;
        if !DDC.load(Ordering::Relaxed) {
            external.clear();
            continue;
        }
        let now = unsafe { external_levels(&mut fails) };
        for (key, level) in &now {
            if external.get(key).is_some_and(|before| before != level) {
                crate::sysevents::emit_level(&app, "brightness", *level, false);
            }
        }
        external = now;
    }
}

unsafe fn wmi() -> windows::core::Result<IWbemServices> {
    unsafe {
        let locator: IWbemLocator = CoCreateInstance(&WbemLocator, None, CLSCTX_INPROC_SERVER)?;
        let empty = BSTR::new();
        let services = locator.ConnectServer(&BSTR::from(r"ROOT\WMI"), &empty, &empty, &empty, 0, &empty, None)?;
        // Without impersonation WMI can refuse the query when the process never set its COM security.
        blanket(&services)?;
        Ok(services)
    }
}

unsafe fn blanket(proxy: impl windows::core::Param<windows::core::IUnknown>) -> windows::core::Result<()> {
    unsafe { CoSetProxyBlanket(proxy, AUTHN_WINNT, AUTHZ_NONE, PCWSTR::null(), RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE, None, EOAC_NONE) }
}

unsafe fn query(services: &IWbemServices, wql: &str, notification: bool) -> windows::core::Result<IEnumWbemClassObject> {
    unsafe {
        let flags = WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY;
        let (lang, wql) = (BSTR::from("WQL"), BSTR::from(wql));
        let list = if notification { services.ExecNotificationQuery(&lang, &wql, flags, None)? } else { services.ExecQuery(&lang, &wql, flags, None)? };
        let _ = blanket(&list);
        Ok(list)
    }
}

/// The next panel event's level within `wait`; `Ok(None)` when none came.
unsafe fn next_level(events: &IEnumWbemClassObject, wait: Duration) -> windows::core::Result<Option<u8>> {
    unsafe {
        let mut objects: [Option<IWbemClassObject>; 1] = [None];
        let mut returned = 0;
        events.Next(wait.as_millis().min(i32::MAX as u128) as i32, &mut objects, &mut returned).ok()?;
        Ok(objects[0].as_ref().filter(|_| returned == 1).and_then(|o| prop_u8(o, w!("Brightness"))))
    }
}

/// The property of the first object a plain query returns.
unsafe fn first_u8(list: &IEnumWbemClassObject, name: PCWSTR) -> Option<u8> {
    unsafe {
        let mut objects: [Option<IWbemClassObject>; 1] = [None];
        let mut returned = 0;
        // WBEM_INFINITE: a plain query ends on its own.
        let _ = list.Next(-1, &mut objects, &mut returned);
        objects[0].as_ref().filter(|_| returned == 1).and_then(|o| prop_u8(o, name))
    }
}

unsafe fn prop_u8(object: &IWbemClassObject, name: PCWSTR) -> Option<u8> {
    unsafe {
        let mut value = VARIANT::default();
        object.Get(name, 0, &mut value, None, None).ok()?;
        let level = VariantToUInt32(&value).ok();
        let _ = VariantClear(&mut value);
        level.map(|l| l.min(100) as u8)
    }
}

/// The brightness of every external monitor that answers over DDC/CI, keyed by its display handle and index on it.
unsafe fn external_levels(fails: &mut HashMap<(isize, usize), u8>) -> HashMap<(isize, usize), u8> {
    let mut monitors: Vec<HMONITOR> = Vec::new();
    let mut out = HashMap::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(each), LPARAM(&mut monitors as *mut _ as isize));
        for monitor in monitors {
            let mut count = 0;
            if GetNumberOfPhysicalMonitorsFromHMONITOR(monitor, &mut count).is_err() || count == 0 {
                continue;
            }
            let mut list = vec![PHYSICAL_MONITOR::default(); count as usize];
            if GetPhysicalMonitorsFromHMONITOR(monitor, &mut list).is_err() {
                continue;
            }
            for (i, physical) in list.iter().enumerate() {
                let key = (monitor.0 as isize, i);
                let failed = fails.entry(key).or_insert(0);
                if *failed >= GIVE_UP {
                    continue;
                }
                let (mut min, mut cur, mut max) = (0, 0, 0);
                match (GetMonitorBrightness(physical.hPhysicalMonitor, &mut min, &mut cur, &mut max) != 0).then(|| ddc_percent(min, cur, max)).flatten() {
                    Some(level) => {
                        *failed = 0;
                        out.insert(key, level);
                    }
                    None => *failed += 1,
                }
            }
            let _ = DestroyPhysicalMonitors(&list);
        }
    }
    out
}

unsafe extern "system" fn each(monitor: HMONITOR, _: HDC, _: *mut RECT, list: LPARAM) -> BOOL {
    unsafe { (*(list.0 as *mut Vec<HMONITOR>)).push(monitor) };
    TRUE
}

/// A DDC/CI reading on the monitor's own scale (often 0..100, not always) as a percent.
fn ddc_percent(min: u32, current: u32, max: u32) -> Option<u8> {
    if max <= min {
        return None;
    }
    let span = (max - min) as f64;
    Some(((current.clamp(min, max) - min) as f64 * 100.0 / span).round() as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ddc_percent_maps_the_monitor_scale() {
        assert_eq!(ddc_percent(0, 70, 100), Some(70));
        assert_eq!(ddc_percent(0, 128, 255), Some(50));
        assert_eq!(ddc_percent(20, 20, 120), Some(0));
        // Out of range readings are clamped, a broken range is no reading.
        assert_eq!(ddc_percent(0, 300, 100), Some(100));
        assert_eq!(ddc_percent(50, 50, 50), None);
        assert_eq!(ddc_percent(80, 10, 20), None);
    }
}
