//! Real levels for the equalizer.
//!
//! Listens only to the shown player: process loopback of its process tree
//! (loopback.rs), so a notification sound or a video call doesn't move the bars.
//! Where that is not possible (older Windows, a player without its own audio session)
//! it falls back to WASAPI loopback of the default output device, which delivers
//! everything that is playing. An FFT over the latest samples gives 4 frequency bands,
//! sent as `audio://levels` (0..1).
//!
//! Only runs while the frontend asks for it (music playing, equalizer visible).
//! Nothing is stored or recorded; samples only live in the ring buffer.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream};
use rustfft::{num_complex::Complex, FftPlanner};
use tauri::{AppHandle, Emitter, Manager, State};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

use crate::loopback::{self, ProcessCapture};
use crate::media::MediaState;

const FFT_SIZE: usize = 1024;
/// ~40 fps. The frontend interpolates with CSS.
const TICK: Duration = Duration::from_millis(25);
/// Bass on the left, treble on the right, log-spaced (Hz).
const BANDS: [(f32, f32); 4] = [(40.0, 160.0), (160.0, 600.0), (600.0, 2400.0), (2400.0, 9000.0)];
/// Fast attack, slower release, like an analog meter.
const ATTACK: f32 = 0.55;
const RELEASE: f32 = 0.18;
/// How often the shown app and the output device are checked.
const CHECK: Duration = Duration::from_secs(2);
/// How often a system-wide capture tries to become a player-only one again.
const RETRY: Duration = Duration::from_secs(5);

/// What the equalizer listens to.
enum Capture {
    /// Only the shown player's process tree.
    Player(ProcessCapture),
    /// Everything on the default output device.
    System { _stream: Stream, device: Option<cpal::DeviceId> },
}

fn shown_app(app: &AppHandle) -> String {
    app.state::<MediaState>().shown().map(|(id, _)| id).unwrap_or_default()
}

fn default_output() -> Option<cpal::DeviceId> {
    cpal::default_host().default_output_device().and_then(|d| d.id().ok())
}

fn push(ring: &mut VecDeque<f32>, mono: &mut dyn Iterator<Item = f32>) {
    for s in mono {
        if ring.len() >= FFT_SIZE * 2 {
            ring.pop_front();
        }
        ring.push_back(s);
    }
}

#[derive(Default)]
pub struct AudioState {
    enabled: Arc<AtomicBool>,
    /// The capture thread; parked while off, woken here when turned on.
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

pub fn spawn(app: AppHandle, state: &AudioState) {
    let enabled = state.enabled.clone();
    let handle = thread::spawn(move || {
        // Process loopback is created, read and dropped on this thread (MTA; cpal accepts it).
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let samples: Arc<Mutex<VecDeque<f32>>> = Arc::new(Mutex::new(VecDeque::with_capacity(FFT_SIZE * 2)));
        let failed = Arc::new(AtomicBool::new(false));
        let mut capture: Option<Capture> = None;
        // The app the capture was opened for, and when a player-only capture was last tried.
        let mut player_app = String::new();
        let mut last_check = Instant::now();
        let mut last_try = Instant::now();

        let fft = FftPlanner::<f32>::new().plan_fft_forward(FFT_SIZE);
        let window: Vec<f32> = (0..FFT_SIZE)
            .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / FFT_SIZE as f32).cos())
            .collect();
        let mut buffer = vec![Complex::new(0.0, 0.0); FFT_SIZE];
        let mut levels = [0.0f32; 4];
        // Auto gain per band so quiet and loud songs move the bars equally.
        let mut peaks = [1e-3f32; 4];
        let mut sample_rate = 48_000.0f32;

        loop {
            thread::sleep(TICK);

            if !enabled.load(Ordering::Relaxed) {
                // Off: close the capture and drop the bars to zero.
                if capture.take().is_some() {
                    samples.lock().unwrap().clear();
                    levels = [0.0; 4];
                    let _ = app.emit("audio://levels", levels);
                }
                // Sleep until `audio_levels(true)` instead of waking 40×/s. The timeout
                // only guards against a missed unpark (turned on before `worker` was set).
                thread::park_timeout(Duration::from_secs(1));
                continue;
            }

            // Another app shown, the player restarted (new process), headphones plugged in
            // (system capture) or an error: reconnect. A system capture also keeps trying
            // to become a player-only one, and is only replaced once that works.
            let mut reopen = failed.swap(false, Ordering::Relaxed);
            if !reopen && last_check.elapsed() > CHECK {
                last_check = Instant::now();
                let shown = shown_app(&app);
                let mut upgrade = false;
                match &capture {
                    Some(Capture::Player(c)) => reopen = shown != player_app || loopback::process_of(&player_app) != Some(c.pid),
                    Some(Capture::System { device, .. }) => {
                        reopen = *device != default_output();
                        upgrade = !reopen && (shown != player_app || last_try.elapsed() > RETRY);
                    }
                    None => {}
                }
                if upgrade {
                    player_app = shown;
                    last_try = Instant::now();
                    if let Some(player) = loopback::process_of(&player_app).and_then(ProcessCapture::start) {
                        capture = Some(Capture::Player(player));
                        sample_rate = loopback::RATE as f32;
                        samples.lock().unwrap().clear();
                    }
                }
            }
            if capture.is_none() || reopen {
                drop(capture.take()); // close the old stream before opening a new one
                samples.lock().unwrap().clear();
                player_app = shown_app(&app);
                last_try = Instant::now();
                capture = match loopback::process_of(&player_app).and_then(ProcessCapture::start) {
                    Some(player) => {
                        sample_rate = loopback::RATE as f32;
                        Some(Capture::Player(player))
                    }
                    None => open(samples.clone(), failed.clone()).map(|(stream, rate, id)| {
                        sample_rate = rate;
                        Capture::System { _stream: stream, device: id }
                    }),
                };
                if capture.is_none() {
                    thread::sleep(Duration::from_secs(1));
                    continue;
                }
            }
            if let Some(Capture::Player(player)) = &capture {
                let mut ring = samples.lock().unwrap();
                if !player.drain(&mut |mono| push(&mut ring, mono)) {
                    failed.store(true, Ordering::Relaxed);
                }
            }

            // Take the last FFT_SIZE samples, zero-padded (loopback sends nothing during silence).
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

            let bin_hz = sample_rate / FFT_SIZE as f32;
            for (band, &(lo, hi)) in BANDS.iter().enumerate() {
                let (from, to) = ((lo / bin_hz) as usize, ((hi / bin_hz) as usize).min(FFT_SIZE / 2));
                let energy: f32 = buffer[from..to.max(from + 1)].iter().map(|c| c.norm()).sum::<f32>() / (to - from).max(1) as f32;

                peaks[band] = energy.max(peaks[band] * 0.996).max(1e-3);
                // Below the noise floor counts as silence.
                let target = if energy < 2e-3 { 0.0 } else { (energy / peaks[band]).powf(0.8).min(1.0) };
                let k = if target > levels[band] { ATTACK } else { RELEASE };
                levels[band] += (target - levels[band]) * k;
            }
            let _ = app.emit("audio://levels", levels);
        }
    });
    *state.worker.lock().unwrap() = Some(handle.thread().clone());
}

/// Opens a loopback stream on the default output device. Writes mono samples to `samples`.
fn open(samples: Arc<Mutex<VecDeque<f32>>>, failed: Arc<AtomicBool>) -> Option<(Stream, f32, Option<cpal::DeviceId>)> {
    let device = cpal::default_host().default_output_device()?;
    let id = device.id().ok();
    let supported = device.default_output_config().ok()?;
    let channels = supported.channels().max(1) as usize;
    let rate = supported.sample_rate() as f32;
    let config = supported.config();

    let feed = move |mono: &mut dyn Iterator<Item = f32>| push(&mut samples.lock().unwrap(), mono);
    let on_error = move |_| failed.store(true, Ordering::Relaxed);

    // The shared-mode mix format is almost always f32; i16 as a fallback.
    let stream = match supported.sample_format() {
        SampleFormat::F32 => device.build_input_stream::<f32, _, _>(
            config,
            move |data, _| feed(&mut data.chunks(channels).map(|f| f.iter().sum::<f32>() / channels as f32)),
            on_error,
            None,
        ),
        SampleFormat::I16 => device.build_input_stream::<i16, _, _>(
            config,
            move |data, _| {
                feed(&mut data.chunks(channels).map(|f| f.iter().map(|&s| s as f32 / 32768.0).sum::<f32>() / channels as f32))
            },
            on_error,
            None,
        ),
        _ => return None,
    }
    .ok()?;
    stream.play().ok()?;
    Some((stream, rate, id))
}
