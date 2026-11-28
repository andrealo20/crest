//! Real levels for the equalizer on Linux (the Windows one is audio.rs).
//!
//! PipeWire is the audio stack of current Ubuntu, Fedora, Debian and Arch, and `pw-record` reads the monitor of the default
//! output (what is being played, whatever the device: speakers, headphones, Bluetooth). An FFT over the latest samples gives
//! the same 4 bands (`audio://levels`) and 12 thinner ones (`audio://spectrum`) as on Windows. It listens to everything
//! playing, not only the shown player: Windows' fallback does the same.
//!
//! Only runs while the frontend asks for it (music playing, equalizer visible). Nothing is stored; samples only live in
//! the ring buffer, and no recording is started otherwise.

use std::collections::VecDeque;
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use rustfft::{num_complex::Complex, FftPlanner};
use tauri::{AppHandle, Emitter, State};

const FFT_SIZE: usize = 1024;
/// Low enough for the bands (up to 9 kHz) and the spectrum (up to 12 kHz), and a light stream.
const RATE: f32 = 24_000.0;
/// ~40 fps. The frontend interpolates with CSS.
const TICK: Duration = Duration::from_millis(25);
/// Bass on the left, treble on the right, log-spaced (Hz).
const BANDS: [(f32, f32); 4] = [(40.0, 160.0), (160.0, 600.0), (600.0, 2400.0), (2400.0, 9000.0)];
const SPECTRUM: usize = 12;
const SPECTRUM_HZ: (f32, f32) = (50.0, 12_000.0);
/// Fast attack, slower release, like an analog meter.
const ATTACK: f32 = 0.55;
const RELEASE: f32 = 0.18;
/// An unchanged reading is still sent this often: the page counts levels older than 400 ms as gone.
const KEEP_ALIVE: Duration = Duration::from_millis(300);
/// While no capture can be started (no `pw-record`, no PipeWire) it is tried again later and later, not every tick.
const RETRY: Duration = Duration::from_secs(5);
const RETRY_MAX: Duration = Duration::from_secs(120);

/// Rounded to 1/1000, so a level fading to silence reaches exactly zero and stops changing.
fn settle<const N: usize>(values: [f32; N]) -> [f32; N] {
    values.map(|v| (v * 1000.0).round() / 1000.0)
}

/// FFT bin edges of the spectrum bands, each band at least one bin wide (the lowest ones are narrower than a bin).
fn spectrum_edges(bin_hz: f32) -> [usize; SPECTRUM + 1] {
    let (lo, hi) = SPECTRUM_HZ;
    let mut edges = [0usize; SPECTRUM + 1];
    for k in 0..=SPECTRUM {
        let hz = lo * (hi / lo).powf(k as f32 / SPECTRUM as f32);
        let bin = ((hz / bin_hz).round() as usize).clamp(1, FFT_SIZE / 2);
        edges[k] = if k == 0 { bin } else { bin.max(edges[k - 1] + 1) };
    }
    edges
}

/// One band: mean magnitude of its bins, auto gain against the band's recent peak, meter smoothing.
fn meter(bins: &[Complex<f32>], peak: &mut f32, level: &mut f32) {
    let energy = bins.iter().map(|c| c.norm()).sum::<f32>() / bins.len().max(1) as f32;
    *peak = energy.max(*peak * 0.996).max(1e-3);
    // Below the noise floor counts as silence.
    let target = if energy < 2e-3 { 0.0 } else { (energy / *peak).powf(0.8).min(1.0) };
    let k = if target > *level { ATTACK } else { RELEASE };
    *level += (target - *level) * k;
}

#[derive(Default)]
pub struct AudioState {
    enabled: Arc<AtomicBool>,
    /// The analysis thread; parked while off, woken here when turned on.
    worker: Mutex<Option<thread::Thread>>,
}

#[tauri::command]
pub fn audio_levels(enabled: bool, state: State<'_, AudioState>) {
    state.enabled.store(enabled, Ordering::Relaxed);
    if enabled {
        if let Some(worker) = state.worker.lock().unwrap().as_ref() {
            worker.unpark();
        }
    }
}

/// A running `pw-record` and the thread that moves its samples into the ring buffer.
struct Capture {
    child: Child,
    /// Cleared when the stream ends, so the loop starts a new one.
    alive: Arc<AtomicBool>,
}

impl Drop for Capture {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Where the samples start in what `pw-record` writes to a pipe: a WAV header of a length that depends on the format, so
/// the `data` chunk is looked for, and its 8 bytes (id and size) skipped.
fn data_start(head: &[u8]) -> Option<usize> {
    head.windows(4).position(|w| w == b"data").map(|i| i + 8).filter(|&at| at <= head.len())
}

fn start(samples: Arc<Mutex<VecDeque<f32>>>) -> Option<Capture> {
    let mut child = Command::new("pw-record")
        .args(["--rate", "24000", "--channels", "1", "--format", "f32", "--latency", "30ms", "-P", "stream.capture.sink=true", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut out = child.stdout.take()?;
    let alive = Arc::new(AtomicBool::new(true));
    let flag = alive.clone();
    thread::spawn(move || {
        let mut chunk = [0u8; 4096];
        // Bytes not yet a whole sample, and the header until the data starts.
        let mut pending: Vec<u8> = Vec::new();
        let mut in_data = false;
        while let Ok(n) = out.read(&mut chunk) {
            if n == 0 {
                break;
            }
            pending.extend_from_slice(&chunk[..n]);
            if !in_data {
                match data_start(&pending) {
                    Some(at) => {
                        pending.drain(..at);
                        in_data = true;
                    }
                    // No header in the first kilobytes: not what was asked for.
                    None if pending.len() > 8192 => break,
                    None => continue,
                }
            }
            let whole = pending.len() / 4 * 4;
            let mut ring = samples.lock().unwrap();
            for b in pending[..whole].chunks_exact(4) {
                if ring.len() >= FFT_SIZE * 2 {
                    ring.pop_front();
                }
                ring.push_back(f32::from_le_bytes([b[0], b[1], b[2], b[3]]));
            }
            drop(ring);
            pending.drain(..whole);
        }
        flag.store(false, Ordering::Relaxed);
    });
    Some(Capture { child, alive })
}

pub fn spawn(app: AppHandle, state: &AudioState) {
    let enabled = state.enabled.clone();
    let handle = thread::spawn(move || {
        let samples: Arc<Mutex<VecDeque<f32>>> = Arc::new(Mutex::new(VecDeque::with_capacity(FFT_SIZE * 2)));
        let mut capture: Option<Capture> = None;
        let mut retry_at = Instant::now();
        let mut retry = RETRY;
        let mut sent = ([0.0f32; 4], [0.0f32; SPECTRUM]);
        let mut sent_at = Instant::now();

        let fft = FftPlanner::<f32>::new().plan_fft_forward(FFT_SIZE);
        let window: Vec<f32> = (0..FFT_SIZE).map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / FFT_SIZE as f32).cos()).collect();
        let mut buffer = vec![Complex::new(0.0, 0.0); FFT_SIZE];
        let mut levels = [0.0f32; 4];
        // Auto gain per band so quiet and loud songs move the bars equally.
        let mut peaks = [1e-3f32; 4];
        let mut spectrum = [0.0f32; SPECTRUM];
        let mut spectrum_peaks = [1e-3f32; SPECTRUM];

        loop {
            thread::sleep(TICK);

            // Off, or the screen is off (standby.rs): stop recording and drop the bars to zero.
            if !enabled.load(Ordering::Relaxed) || crate::standby::asleep() {
                if capture.take().is_some() {
                    samples.lock().unwrap().clear();
                    levels = [0.0; 4];
                    spectrum = [0.0; SPECTRUM];
                    let _ = app.emit("audio://levels", levels);
                    let _ = app.emit("audio://spectrum", spectrum);
                    sent = (levels, spectrum);
                    sent_at = Instant::now();
                }
                // Turned on again: a fresh start, not the rest of an old back-off.
                retry_at = Instant::now();
                retry = RETRY;
                thread::park_timeout(Duration::from_secs(1));
                continue;
            }

            // The stream ended (PipeWire restarted, the process died): drop it, and try again after a while.
            if capture.as_ref().is_some_and(|c| !c.alive.load(Ordering::Relaxed)) {
                capture = None;
                samples.lock().unwrap().clear();
                retry_at = Instant::now() + retry;
                retry = (retry * 2).min(RETRY_MAX);
            }
            if capture.is_none() {
                if Instant::now() < retry_at {
                    continue;
                }
                capture = start(samples.clone());
                if capture.is_none() {
                    retry_at = Instant::now() + retry;
                    retry = (retry * 2).min(RETRY_MAX);
                    continue;
                }
            }

            // Take the last FFT_SIZE samples, zero-padded (the monitor sends nothing during silence).
            {
                let mut ring = samples.lock().unwrap();
                let missing = FFT_SIZE.saturating_sub(ring.len());
                for (i, slot) in buffer.iter_mut().enumerate() {
                    let s = if i < missing { 0.0 } else { ring[i - missing] };
                    *slot = Complex::new(s * window[i], 0.0);
                }
                // Drop consumed samples so silence is detected as silence.
                let keep = FFT_SIZE / 2;
                while ring.len() > keep {
                    ring.pop_front();
                }
                if missing > 0 {
                    ring.clear();
                }
            }
            fft.process(&mut buffer);

            let bin_hz = RATE / FFT_SIZE as f32;
            for (band, &(lo, hi)) in BANDS.iter().enumerate() {
                let (from, to) = ((lo / bin_hz) as usize, ((hi / bin_hz) as usize).min(FFT_SIZE / 2));
                meter(&buffer[from..to.max(from + 1)], &mut peaks[band], &mut levels[band]);
            }
            let edges = spectrum_edges(bin_hz);
            for band in 0..SPECTRUM {
                meter(&buffer[edges[band]..edges[band + 1]], &mut spectrum_peaks[band], &mut spectrum[band]);
            }
            let now = (settle(levels), settle(spectrum));
            if now != sent || sent_at.elapsed() > KEEP_ALIVE {
                let _ = app.emit("audio://levels", now.0);
                let _ = app.emit("audio://spectrum", now.1);
                sent = now;
                sent_at = Instant::now();
            }
        }
    });
    *state.worker.lock().unwrap() = Some(handle.thread().clone());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_samples_start_after_the_data_chunk_header() {
        let mut wav = b"RIFF\xff\xff\xff\xffWAVEfmt \x10\0\0\0".to_vec();
        wav.extend_from_slice(b"data\xff\xff\xff\xff");
        let at = data_start(&wav).unwrap();
        wav.extend_from_slice(&1.0f32.to_le_bytes());
        assert_eq!(&wav[at..], &1.0f32.to_le_bytes());
        assert_eq!(data_start(b"RIFF....WAVE"), None);
        // "data" at the very end has no room for its size yet: wait for more bytes.
        assert_eq!(data_start(b"RIFFdata"), None);
    }

    #[test]
    fn spectrum_bands_are_distinct_and_in_range_at_the_capture_rate() {
        let edges = spectrum_edges(RATE / FFT_SIZE as f32);
        assert!(edges[0] >= 1);
        assert!(edges.windows(2).all(|w| w[1] > w[0]), "{edges:?}");
        assert!(edges[SPECTRUM] <= FFT_SIZE);
    }

    #[test]
    fn meter_rises_fast_and_falls_to_silence() {
        let loud = vec![Complex::new(1.0f32, 0.0); 4];
        let (mut peak, mut level) = (1e-3f32, 0.0f32);
        meter(&loud, &mut peak, &mut level);
        assert!((level - ATTACK).abs() < 1e-6);
        let quiet = vec![Complex::new(0.0f32, 0.0); 4];
        for _ in 0..60 {
            meter(&quiet, &mut peak, &mut level);
        }
        assert!(level < 1e-3);
    }
}
