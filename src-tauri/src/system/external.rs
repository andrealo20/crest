//! CPU and GPU temperature and power from a monitoring program the user already runs, for PCs where Windows gives
//! Crest no CPU temperature: HWiNFO's shared memory ("Shared Memory Support"), else LibreHardwareMonitor's (or
//! OpenHardwareMonitor's) WMI namespace, else Core Temp's shared memory (the CPU only). All are read on a thread of
//! their own, so a hung WMI never stalls the sampler, which only takes the last reading. None is ever written to.

use std::collections::HashMap;
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
use windows::Win32::System::Memory::{MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, VirtualQuery, FILE_MAP_READ, MEMORY_BASIC_INFORMATION};
use windows::Win32::System::Variant::{VariantClear, VariantToDouble, VariantToString, VARIANT};
use windows::Win32::System::Wmi::{IWbemClassObject, IWbemServices};

/// While none of the programs is found, they are looked for at most this often.
const LOOK_EVERY: Duration = Duration::from_secs(30);
/// A WMI query that takes longer counts as failed.
const WMI_TIMEOUT: Duration = Duration::from_secs(2);
/// A reading older than this (the thread stuck in WMI) is no reading.
const STALE: Duration = Duration::from_secs(10);

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
    /// The program's name, shown as the source.
    source: &'static str,
    cpu_temp: Option<f64>,
    cpu_watts: Option<f64>,
    gpus: Vec<Gpu>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Gpu {
    name: String,
    temp: Option<f64>,
    watts: Option<f64>,
}

#[derive(Default)]
pub struct External {
    wake: Option<SyncSender<()>>,
    latest: Arc<Mutex<Option<(Instant, Reading)>>>,
}

impl External {
    /// The last reading, and a nudge to the thread for the next one (started on the first call).
    pub fn read(&mut self) -> Option<Reading> {
        let latest = self.latest.clone();
        let wake = self.wake.get_or_insert_with(|| {
            // One pending nudge at most: polls never pile up behind a slow read.
            let (tx, rx) = sync_channel(1);
            thread::spawn(move || run(rx, latest));
            tx
        });
        let _ = wake.try_send(());
        let latest = self.latest.lock().ok()?;
        latest.as_ref().filter(|(at, _)| at.elapsed() < STALE).map(|(_, r)| r.clone())
    }
}

enum Source {
    HwInfo,
    /// The namespace's services and its hardware names by identifier.
    Wmi(&'static str, IWbemServices, HashMap<String, String>),
    CoreTemp,
}

/// A reading with at least one value; a WMI namespace can still answer, empty, after its program has closed.
fn has_values(r: &Reading) -> bool {
    r.cpu_temp.is_some() || r.cpu_watts.is_some() || r.gpus.iter().any(|g| g.temp.is_some() || g.watts.is_some())
}

fn run(rx: Receiver<()>, latest: Arc<Mutex<Option<(Instant, Reading)>>>) {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let mut source: Option<Source> = None;
    let mut look_at = Instant::now();
    while rx.recv().is_ok() {
        let mut reading = match &source {
            Some(Source::HwInfo) => hwinfo(),
            Some(Source::Wmi(name, services, names)) => unsafe { wmi_read(name, services, names) },
            // Core Temp stands in until HWiNFO or LibreHardwareMonitor shows up: dropped at each search, taken again if neither is there.
            Some(Source::CoreTemp) if Instant::now() < look_at => core_temp(),
            Some(Source::CoreTemp) | None => None,
        }
        .filter(has_values);
        if reading.is_none() {
            source = None;
            if Instant::now() >= look_at {
                look_at = Instant::now() + LOOK_EVERY;
                if let Some(r) = hwinfo().filter(has_values) {
                    (source, reading) = (Some(Source::HwInfo), Some(r));
                } else if let Some((name, services, names)) = unsafe { wmi_connect() } {
                    reading = unsafe { wmi_read(name, &services, &names) }.filter(has_values);
                    source = reading.is_some().then_some(Source::Wmi(name, services, names));
                }
                // Last: Core Temp gives the CPU only, the other two the GPUs too.
                if reading.is_none() {
                    if let Some(r) = core_temp().filter(has_values) {
                        (source, reading) = (Some(Source::CoreTemp), Some(r));
                    }
                }
            }
        }
        if let Ok(mut l) = latest.lock() {
            *l = reading.map(|r| (Instant::now(), r));
        }
    }
}

// ---------- Picking the four values ----------

#[derive(PartialEq, Debug)]
enum Device {
    Cpu,
    Gpu(String),
}

#[derive(PartialEq, Clone, Copy, Debug)]
enum Kind {
    Temp,
    Power,
}

#[derive(Debug)]
struct Entry {
    device: Device,
    kind: Kind,
    label: String,
    value: f64,
}

/// Labels in order of preference, matched whole and without case.
struct Labels {
    cpu_temp: &'static [&'static str],
    cpu_power: &'static [&'static str],
    gpu_temp: &'static [&'static str],
    gpu_power: &'static [&'static str],
}

/// HWiNFO's original labels (a user's renames are ignored): Intel's package, AMD's Tctl/Tdie.
const HWINFO: Labels = Labels {
    cpu_temp: &["CPU Package", "CPU (Tctl/Tdie)", "CPU (Tdie)", "CPU (Tctl)", "CPU Die (average)"],
    cpu_power: &["CPU Package Power", "CPU PPT"],
    gpu_temp: &["GPU Temperature"],
    gpu_power: &["GPU Power", "GPU PPT", "GPU ASIC Power"],
};

const LHM: Labels = Labels {
    cpu_temp: &["CPU Package", "Core (Tctl/Tdie)", "Core (Tdie)", "Core (Tctl)"],
    cpu_power: &["CPU Package", "Package"],
    gpu_temp: &["GPU Core"],
    gpu_power: &["GPU Package", "GPU Power"],
};

fn pick(source: &'static str, entries: &[Entry], labels: &Labels) -> Reading {
    let find = |device: &Device, kind: Kind, wanted: &[&str]| {
        wanted.iter().find_map(|l| entries.iter().find(|e| &e.device == device && e.kind == kind && e.label.eq_ignore_ascii_case(l)).map(|e| e.value))
    };
    let mut gpus: Vec<Gpu> = Vec::new();
    for e in entries {
        if let Device::Gpu(name) = &e.device {
            if !gpus.iter().any(|g| &g.name == name) {
                gpus.push(Gpu { name: name.clone(), temp: find(&e.device, Kind::Temp, labels.gpu_temp), watts: find(&e.device, Kind::Power, labels.gpu_power) });
            }
        }
    }
    Reading {
        source,
        cpu_temp: find(&Device::Cpu, Kind::Temp, labels.cpu_temp),
        cpu_watts: find(&Device::Cpu, Kind::Power, labels.cpu_power),
        gpus,
    }
}

// ---------- HWiNFO ----------

/// "HWiS"; HWiNFO writes "DEAD" when it stops sharing.
const SIGNATURE: u32 = u32::from_le_bytes(*b"HWiS");
/// HWiNFO_SENSORS_SHARED_MEM2 (packed): signature, version, revision, poll time (8 bytes), then offset, element size
/// and count of the sensor section at 20 and of the reading section at 32.
const HEADER: usize = 44;
/// Sensor element: id, instance, original name (128), user name (128).
const SENSOR_MIN: usize = 264;
/// Reading element: type, sensor index, id, original label (128), user label (128), unit (16), then value at 284.
const READING_MIN: usize = 316;
const TYPE_TEMP: u32 = 1;
const TYPE_POWER: u32 = 5;

fn hwinfo() -> Option<Reading> {
    let bytes = mapping_bytes(w!("Global\\HWiNFO_SENS_SM2"))?;
    Some(pick("HWiNFO", &hwinfo_entries(&bytes)?, &HWINFO))
}

/// A copy of a whole shared memory mapping, so the checks and the reads see the same bytes while its program keeps writing.
fn mapping_bytes(name: PCWSTR) -> Option<Vec<u8>> {
    unsafe {
        let h = OpenFileMappingW(FILE_MAP_READ.0, false, name).ok()?;
        let view = MapViewOfFile(h, FILE_MAP_READ, 0, 0, 0);
        let _ = CloseHandle(h);
        if view.Value.is_null() {
            return None;
        }
        let mut info = MEMORY_BASIC_INFORMATION::default();
        let ok = VirtualQuery(Some(view.Value), &mut info, size_of::<MEMORY_BASIC_INFORMATION>()) != 0;
        let bytes = ok.then(|| std::slice::from_raw_parts(view.Value as *const u8, info.RegionSize).to_vec());
        let _ = UnmapViewOfFile(view);
        bytes
    }
}

fn u32_at(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(b[at..at + 4].try_into().unwrap())
}

/// A NUL-terminated ANSI string; the labels matched are ASCII.
fn text(b: &[u8]) -> String {
    let end = b.iter().position(|&c| c == 0).unwrap_or(b.len());
    String::from_utf8_lossy(&b[..end]).trim().to_string()
}

/// Every CPU and GPU temperature and power reading, or None when anything in the layout does not add up.
fn hwinfo_entries(buf: &[u8]) -> Option<Vec<Entry>> {
    if buf.len() < HEADER || u32_at(buf, 0) != SIGNATURE {
        return None;
    }
    let field = |at: usize| u32_at(buf, at) as usize;
    let (s_at, s_size, s_count) = (field(20), field(24), field(28));
    let (r_at, r_size, r_count) = (field(32), field(36), field(40));
    if s_size < SENSOR_MIN || r_size < READING_MIN {
        return None;
    }
    let fits = |at: usize, size: usize, count: usize| size.checked_mul(count).and_then(|n| n.checked_add(at)).is_some_and(|end| at >= HEADER && end <= buf.len());
    if !fits(s_at, s_size, s_count) || !fits(r_at, r_size, r_count) {
        return None;
    }
    let mut entries = Vec::new();
    for i in 0..r_count {
        let r = &buf[r_at + i * r_size..][..r_size];
        let sensor = u32_at(r, 4) as usize;
        if sensor >= s_count {
            return None;
        }
        let kind = match u32_at(r, 0) {
            TYPE_TEMP => Kind::Temp,
            TYPE_POWER => Kind::Power,
            _ => continue,
        };
        let name = text(&buf[s_at + sensor * s_size + 8..][..128]);
        // "CPU [#0]: AMD Ryzen 7 5800X: Enhanced", "GPU [#0]: NVIDIA GeForce RTX 3080: "
        let device = if name.starts_with("CPU [") {
            Device::Cpu
        } else if let Some(rest) = name.strip_prefix("GPU [").and_then(|n| n.split_once("]: ")).map(|(_, r)| r) {
            Device::Gpu(rest.split(':').next().unwrap_or(rest).trim().to_string())
        } else {
            continue;
        };
        let unit = text(&r[268..284]);
        let mut value = f64::from_le_bytes(r[284..292].try_into().unwrap());
        match kind {
            // HWiNFO shares values in the unit it shows.
            Kind::Temp if unit.ends_with('F') => value = (value - 32.0) * 5.0 / 9.0,
            Kind::Power if unit != "W" => continue,
            _ => {}
        }
        if value.is_finite() {
            entries.push(Entry { device, kind, label: text(&r[12..140]), value });
        }
    }
    Some(entries)
}

// ---------- Core Temp ----------

// core_temp_shared_data_ex (alcpu.com/CoreTemp/developers.html; 32-bit fields, 4-byte aligned): uiLoad[256], uiTjMax[128],
// uiCoreCnt, uiCPUCnt, fTemp[256], fVID, fCPUSpeed, fFSBSpeed, fMultiplier, sCPUName[100], ucFahrenheit and ucDeltaToTjMax,
// where the original layout ends; version 2 adds ucTdpSupported, ucPowerSupported, uiStructVersion, uiTdp[128], fPower[128]
// and fMultipliers[256].
const CT_TJMAX: usize = 1024;
const CT_CORES: usize = 1536;
const CT_CPUS: usize = 1540;
const CT_TEMP: usize = 1544;
const CT_FAHRENHEIT: usize = 2684;
const CT_DELTA: usize = 2685;
/// The bytes of the original layout that are read.
const CT_V1_LEN: usize = 2686;
const CT_POWER_SUPPORTED: usize = 2687;
const CT_VERSION: usize = 2688;
const CT_POWER: usize = 3204;
/// The bytes of the current layout that are read (through fPower).
const CT_EX_LEN: usize = 3716;

fn core_temp() -> Option<Reading> {
    // The current area, then the one older versions made.
    if let Some(r) = mapping_bytes(w!("CoreTempMappingObjectEx")).and_then(|b| core_temp_reading(&b, true)) {
        return Some(r);
    }
    core_temp_reading(&mapping_bytes(w!("CoreTempMappingObject"))?, false)
}

/// The CPU's temperature (its hottest core, fTemp holding each CPU's cores in turn) and power from Core Temp's shared data;
/// `current`: the area with the version-2 fields, which count only when the version says so. None when the layout does not add up.
fn core_temp_reading(buf: &[u8], current: bool) -> Option<Reading> {
    if buf.len() < CT_V1_LEN {
        return None;
    }
    let (cores, cpus) = (u32_at(buf, CT_CORES) as usize, u32_at(buf, CT_CPUS) as usize);
    // fTemp has room for 256 cores in all, uiTjMax and fPower for 128 CPUs.
    if cores == 0 || cpus == 0 || cpus > 128 || cores.checked_mul(cpus).is_none_or(|n| n > 256) {
        return None;
    }
    let (fahrenheit, delta) = (buf[CT_FAHRENHEIT] != 0, buf[CT_DELTA] != 0);
    // shortcut: with both on, TjMax's unit depends on the version (1.20.1 "Fix TjMax reporting in Fahrenheit to shared memory and
    // plugins"); no reading rather than a wrong one, until someone with both settings reports it.
    if fahrenheit && delta {
        return None;
    }
    let f32_at = |at: usize| f32::from_le_bytes(buf[at..at + 4].try_into().unwrap()) as f64;
    let mut hottest: Option<f64> = None;
    for cpu in 0..cpus {
        // Core Temp gives no TjMax for some processors (Zen and Zen+): a distance from it is then no temperature.
        let tjmax = u32_at(buf, CT_TJMAX + cpu * 4);
        if delta && tjmax == 0 {
            continue;
        }
        for core in 0..cores {
            let mut t = f32_at(CT_TEMP + (cpu * cores + core) * 4);
            if delta {
                t = tjmax as f64 - t;
            }
            if fahrenheit {
                t = (t - 32.0) * 5.0 / 9.0;
            }
            if t.is_finite() {
                hottest = Some(hottest.map_or(t, |h| h.max(t)));
            }
        }
    }
    let power = current && buf.len() >= CT_EX_LEN && u32_at(buf, CT_VERSION) >= 2 && buf[CT_POWER_SUPPORTED] != 0;
    let cpu_watts = power.then(|| (0..cpus).map(|c| f32_at(CT_POWER + c * 4)).sum::<f64>()).filter(|w| w.is_finite() && *w > 0.0);
    Some(Reading { source: "Core Temp", cpu_temp: hottest, cpu_watts, gpus: Vec::new() })
}

// ---------- LibreHardwareMonitor / OpenHardwareMonitor ----------

const NAMESPACES: [(&str, &str); 2] = [(r"ROOT\LibreHardwareMonitor", "LibreHardwareMonitor"), (r"ROOT\OpenHardwareMonitor", "OpenHardwareMonitor")];

unsafe fn wmi_connect() -> Option<(&'static str, IWbemServices, HashMap<String, String>)> {
    for (namespace, name) in NAMESPACES {
        let Ok(services) = (unsafe { crate::brightness::wmi(namespace) }) else { continue };
        // Hardware names change only with the hardware: asked once, for matching GPUs to the adapters.
        let rows = unsafe { rows(&services, "SELECT Identifier, Name FROM Hardware") }?;
        let names = rows.iter().filter_map(|o| Some((unsafe { prop_text(o, w!("Identifier")) }?, unsafe { prop_text(o, w!("Name")) }?))).collect();
        return Some((name, services, names));
    }
    None
}

/// One query per refresh.
unsafe fn wmi_read(source: &'static str, services: &IWbemServices, names: &HashMap<String, String>) -> Option<Reading> {
    let rows = unsafe { rows(services, "SELECT Parent, Name, SensorType, Value FROM Sensor WHERE SensorType='Temperature' OR SensorType='Power'") }?;
    let entries: Vec<Entry> = rows
        .iter()
        .filter_map(|o| unsafe {
            let kind = if prop_text(o, w!("SensorType"))? == "Temperature" { Kind::Temp } else { Kind::Power };
            wmi_entry(&prop_text(o, w!("Parent"))?, prop_text(o, w!("Name"))?, kind, prop_number(o, w!("Value"))?, names)
        })
        .collect();
    Some(pick(source, &entries, &LHM))
}

/// Parents: "/intelcpu/0", "/amdcpu/0"; "/gpu-nvidia/0", "/gpu-amd/0", "/gpu-intel/0" (OpenHardwareMonitor: "/nvidiagpu/0", "/atigpu/0").
fn wmi_entry(parent: &str, label: String, kind: Kind, value: f64, names: &HashMap<String, String>) -> Option<Entry> {
    let device = if parent.contains("cpu/") {
        Device::Cpu
    } else if parent.contains("gpu") {
        Device::Gpu(names.get(parent).cloned().unwrap_or_else(|| parent.to_string()))
    } else {
        return None;
    };
    value.is_finite().then_some(Entry { device, kind, label, value })
}

/// Every row, or None on an error or when the rows take longer than `WMI_TIMEOUT` altogether.
unsafe fn rows(services: &IWbemServices, wql: &str) -> Option<Vec<IWbemClassObject>> {
    unsafe {
        let list = crate::brightness::query(services, wql, false).ok()?;
        let deadline = Instant::now() + WMI_TIMEOUT;
        let mut out = Vec::new();
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return None;
            }
            let mut batch: [Option<IWbemClassObject>; 32] = Default::default();
            let mut returned = 0;
            let hr = list.Next(left.as_millis() as i32, &mut batch, &mut returned);
            out.extend(batch.into_iter().take(returned as usize).flatten());
            match hr.0 {
                // WBEM_S_NO_ERROR: a full batch, maybe more.
                0 => continue,
                // WBEM_S_FALSE: the last rows.
                1 => return Some(out),
                // WBEM_S_TIMEDOUT or an error.
                _ => return None,
            }
        }
    }
}

unsafe fn prop_text(object: &IWbemClassObject, name: PCWSTR) -> Option<String> {
    unsafe {
        let mut value = VARIANT::default();
        object.Get(name, 0, &mut value, None, None).ok()?;
        let mut buf = [0u16; 256];
        let ok = VariantToString(&value, &mut buf).is_ok();
        let _ = VariantClear(&mut value);
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        ok.then(|| String::from_utf16_lossy(&buf[..len]))
    }
}

unsafe fn prop_number(object: &IWbemClassObject, name: PCWSTR) -> Option<f64> {
    unsafe {
        let mut value = VARIANT::default();
        object.Get(name, 0, &mut value, None, None).ok()?;
        let n = VariantToDouble(&value).ok();
        let _ = VariantClear(&mut value);
        n
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put(buf: &mut [u8], at: usize, bytes: &[u8]) {
        buf[at..at + bytes.len()].copy_from_slice(bytes);
    }

    /// A shared memory image with the given sensors and readings (sensor index, type, label, unit, value).
    fn image(sensors: &[&str], readings: &[(u32, u32, &str, &str, f64)]) -> Vec<u8> {
        let (s_at, s_size, r_size) = (HEADER, SENSOR_MIN + 128, READING_MIN + 144);
        let r_at = s_at + s_size * sensors.len();
        let mut buf = vec![0u8; r_at + r_size * readings.len()];
        put(&mut buf, 0, &SIGNATURE.to_le_bytes());
        for (at, v) in [(20, s_at), (24, s_size), (28, sensors.len()), (32, r_at), (36, r_size), (40, readings.len())] {
            put(&mut buf, at, &(v as u32).to_le_bytes());
        }
        for (i, name) in sensors.iter().enumerate() {
            put(&mut buf, s_at + i * s_size + 8, name.as_bytes());
        }
        for (i, (sensor, kind, label, unit, value)) in readings.iter().enumerate() {
            let at = r_at + i * r_size;
            put(&mut buf, at, &kind.to_le_bytes());
            put(&mut buf, at + 4, &sensor.to_le_bytes());
            put(&mut buf, at + 12, label.as_bytes());
            put(&mut buf, at + 268, unit.as_bytes());
            put(&mut buf, at + 284, &value.to_le_bytes());
        }
        buf
    }

    fn sample() -> Vec<u8> {
        image(
            &["System: ASUS", "CPU [#0]: AMD Ryzen 7 5800X: Enhanced", "GPU [#0]: NVIDIA GeForce RTX 3080: "],
            &[
                (0, TYPE_TEMP, "CPU Package", "\u{b0}C", 30.0),
                (1, TYPE_TEMP, "CPU Die (average)", "\u{b0}C", 60.0),
                (1, TYPE_TEMP, "CPU (Tctl/Tdie)", "\u{b0}C", 64.5),
                (1, TYPE_POWER, "CPU Package Power", "W", 48.2),
                (1, 2, "CPU Core Voltage", "V", 1.2),
                (2, TYPE_TEMP, "GPU Temperature", "\u{b0}F", 140.0),
                (2, TYPE_POWER, "GPU Power", "W", 220.0),
            ],
        )
    }

    #[test]
    fn hwinfo_layout() {
        let r = pick("HWiNFO", &hwinfo_entries(&sample()).unwrap(), &HWINFO);
        // The board's "CPU Package" is not the processor's; Tctl/Tdie beats the die average.
        assert_eq!(r.cpu_temp, Some(64.5));
        assert_eq!(r.cpu_watts, Some(48.2));
        assert_eq!(r.gpus, vec![Gpu { name: "NVIDIA GeForce RTX 3080".into(), temp: Some(60.0), watts: Some(220.0) }]);
    }

    #[test]
    fn hwinfo_rejects_bad_layouts() {
        let good = sample();
        assert!(hwinfo_entries(&good[..good.len() - 1]).is_none(), "truncated");
        assert!(hwinfo_entries(&good[..HEADER - 1]).is_none(), "no header");
        let mut dead = good.clone();
        put(&mut dead, 0, b"DEAD");
        assert!(hwinfo_entries(&dead).is_none(), "wrong signature");
        let mut many = good.clone();
        put(&mut many, 40, &u32::MAX.to_le_bytes());
        assert!(hwinfo_entries(&many).is_none(), "reading count past the end");
        let mut huge = good.clone();
        put(&mut huge, 24, &u32::MAX.to_le_bytes());
        put(&mut huge, 28, &u32::MAX.to_le_bytes());
        assert!(hwinfo_entries(&huge).is_none(), "huge element size and count");
        let mut small = good.clone();
        put(&mut small, 36, &100u32.to_le_bytes());
        assert!(hwinfo_entries(&small).is_none(), "elements smaller than the layout");
        let mut orphan = good;
        let first = u32_at(&orphan, 32) as usize;
        put(&mut orphan, first + 4, &9u32.to_le_bytes());
        assert!(hwinfo_entries(&orphan).is_none(), "reading of a sensor that does not exist");
    }

    #[test]
    fn labels_by_preference() {
        let e = |device: Device, kind, label: &str, value| Entry { device, kind, label: label.into(), value };
        let gpu = || Device::Gpu("Radeon RX 7800 XT".into());
        let r = pick(
            "LibreHardwareMonitor",
            &[e(Device::Cpu, Kind::Power, "Package", 30.0), e(Device::Cpu, Kind::Power, "CPU Package", 35.0), e(Device::Cpu, Kind::Temp, "core (tctl/tdie)", 70.0), e(gpu(), Kind::Temp, "GPU Hot Spot", 90.0), e(gpu(), Kind::Temp, "GPU Core", 62.0)],
            &LHM,
        );
        assert_eq!((r.cpu_temp, r.cpu_watts), (Some(70.0), Some(35.0)));
        assert_eq!(r.gpus, vec![Gpu { name: "Radeon RX 7800 XT".into(), temp: Some(62.0), watts: None }]);
        let names = HashMap::from([("/gpu-nvidia/0".to_string(), "NVIDIA GeForce RTX 4070".to_string())]);
        assert_eq!(wmi_entry("/gpu-nvidia/0", "GPU Core".into(), Kind::Temp, 50.0, &names).unwrap().device, Device::Gpu("NVIDIA GeForce RTX 4070".into()));
        assert_eq!(wmi_entry("/amdcpu/0", "Package".into(), Kind::Power, 20.0, &names).unwrap().device, Device::Cpu);
        assert!(wmi_entry("/lpc/nct6798d", "CPU Core".into(), Kind::Temp, 40.0, &names).is_none(), "board sensors are skipped");
    }

    /// Core Temp's shared data in the current layout (version 2): cores per CPU, temperatures in fTemp order, TjMax and
    /// package power per CPU (no power: not supported).
    fn core_temp_image(cpus: u32, cores: u32, temps: &[f32], tjmax: &[u32], fahrenheit: bool, delta: bool, watts: &[f32]) -> Vec<u8> {
        let mut buf = vec![0u8; CT_EX_LEN];
        put(&mut buf, CT_CORES, &cores.to_le_bytes());
        put(&mut buf, CT_CPUS, &cpus.to_le_bytes());
        for (i, t) in temps.iter().enumerate() {
            put(&mut buf, CT_TEMP + i * 4, &t.to_le_bytes());
        }
        for (i, t) in tjmax.iter().enumerate() {
            put(&mut buf, CT_TJMAX + i * 4, &t.to_le_bytes());
        }
        buf[CT_FAHRENHEIT] = fahrenheit as u8;
        buf[CT_DELTA] = delta as u8;
        put(&mut buf, CT_VERSION, &2u32.to_le_bytes());
        buf[CT_POWER_SUPPORTED] = !watts.is_empty() as u8;
        for (i, w) in watts.iter().enumerate() {
            put(&mut buf, CT_POWER + i * 4, &w.to_le_bytes());
        }
        buf
    }

    #[test]
    fn core_temp_hottest_core_and_power() {
        let r = core_temp_reading(&core_temp_image(2, 2, &[45.0, 52.5, 48.0, 50.0], &[100, 100], false, false, &[20.0, 15.0]), true).unwrap();
        // Each CPU's package power, added up.
        assert_eq!(r, Reading { source: "Core Temp", cpu_temp: Some(52.5), cpu_watts: Some(35.0), gpus: vec![] });
    }

    #[test]
    fn core_temp_units_and_distance_to_tjmax() {
        // Three CPUs of two cores: fTemp holds each CPU's cores in turn, and each CPU has its own TjMax. Reading TjMax by core,
        // or fTemp by core first, would give 80 or 60 instead.
        let delta = core_temp_image(3, 2, &[50.0, 50.0, 20.0, 50.0, 50.0, 50.0], &[100, 90, 80], false, true, &[]);
        assert_eq!(core_temp_reading(&delta, true).unwrap().cpu_temp, Some(70.0));
        // Core Temp gives no TjMax for some processors (Zen and Zen+): a distance from nothing is no temperature.
        let unknown = core_temp_image(1, 2, &[30.0, 40.0], &[0], false, true, &[]);
        assert_eq!(core_temp_reading(&unknown, true).unwrap().cpu_temp, None);
        let fahrenheit = core_temp_image(1, 1, &[122.0], &[212], true, false, &[]);
        assert_eq!(core_temp_reading(&fahrenheit, true).unwrap().cpu_temp, Some(50.0));
        // TjMax's unit with Fahrenheit on changed between versions: both at once give no reading rather than a wrong one.
        assert!(core_temp_reading(&core_temp_image(1, 1, &[54.0], &[212], true, true, &[]), true).is_none());
    }

    #[test]
    fn a_reading_without_values_is_no_reading() {
        // What a WMI namespace can still answer after its program has closed.
        let empty = Reading { source: "LibreHardwareMonitor", cpu_temp: None, cpu_watts: None, gpus: vec![Gpu { name: "GPU".into(), temp: None, watts: None }] };
        assert!(!has_values(&empty));
        assert!(has_values(&Reading { cpu_watts: Some(12.0), ..empty.clone() }));
        assert!(has_values(&Reading { gpus: vec![Gpu { name: "GPU".into(), temp: Some(55.0), watts: None }], ..empty }));
    }

    #[test]
    fn core_temp_power_only_from_version_2() {
        let mut image = core_temp_image(1, 1, &[40.0], &[100], false, false, &[35.0]);
        // The older area (CoreTempMappingObject) has the original fields only.
        assert_eq!(core_temp_reading(&image, false).unwrap().cpu_watts, None);
        put(&mut image, CT_VERSION, &1u32.to_le_bytes());
        assert_eq!(core_temp_reading(&image, true).unwrap().cpu_watts, None, "version 1 has no power");
    }

    #[test]
    fn core_temp_rejects_bad_data() {
        let good = core_temp_image(1, 2, &[40.0, 41.0], &[100], false, false, &[20.0]);
        assert!(core_temp_reading(&good[..CT_V1_LEN - 1], false).is_none(), "truncated");
        let mut none = good.clone();
        put(&mut none, CT_CORES, &0u32.to_le_bytes());
        assert!(core_temp_reading(&none, true).is_none(), "no cores");
        let mut many = good.clone();
        put(&mut many, CT_CPUS, &200u32.to_le_bytes());
        assert!(core_temp_reading(&many, true).is_none(), "more CPUs than the arrays hold");
        // The current layout cut short before fPower: the temperature still counts, the power is not read past the end.
        assert_eq!(core_temp_reading(&good[..CT_V1_LEN], true).map(|r| (r.cpu_temp, r.cpu_watts)), Some((Some(41.0), None)));
    }

    #[test]
    fn shared_memory_is_read_by_name() {
        use windows::Win32::Foundation::INVALID_HANDLE_VALUE;
        use windows::Win32::System::Memory::{CreateFileMappingW, FILE_MAP_WRITE, PAGE_READWRITE};
        // A mapping made here stands in for Core Temp's own, under a name no program uses.
        let name: Vec<u16> = format!("CrestTestCoreTemp{}\0", std::process::id()).encode_utf16().collect();
        let image = core_temp_image(1, 1, &[47.0], &[100], false, false, &[]);
        unsafe {
            let h = CreateFileMappingW(INVALID_HANDLE_VALUE, None, PAGE_READWRITE, 0, image.len() as u32, PCWSTR(name.as_ptr())).unwrap();
            let view = MapViewOfFile(h, FILE_MAP_WRITE, 0, 0, 0);
            std::ptr::copy_nonoverlapping(image.as_ptr(), view.Value as *mut u8, image.len());
            let bytes = mapping_bytes(PCWSTR(name.as_ptr()));
            let _ = UnmapViewOfFile(view);
            let _ = CloseHandle(h);
            let bytes = bytes.unwrap();
            assert_eq!(&bytes[..image.len()], &image[..]);
            assert_eq!(core_temp_reading(&bytes, true).unwrap().cpu_temp, Some(47.0));
        }
    }
}
