//! Audio for recordings (a screen recording's track, or an audio-only one): system audio (WASAPI loopback of the default
//! output) and the default microphone, mixed into one stereo track.
//!
//! Both are opened in shared mode asking Windows for 48 kHz stereo 16-bit
//! (AUTOCONVERTPCM), so no resampling happens here. Every packet carries the QPC time
//! of its first frame; the pause clock turns that into media time and the mixer puts
//! it on the timeline. Writing trails the clock by DELAY so late packets still land.
//! When Windows drops an input (default device changed, unplugged), it is opened again.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use windows::core::Result;
use windows::Win32::Media::Audio::*;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

use super::math::{to_frames, to_time, Clock, Mixer};
use super::record::{AUDIO_CHANNELS, AUDIO_RATE};

const TICK: Duration = Duration::from_millis(10);
const RETRY: Duration = Duration::from_millis(500);
/// A lost input that stays unavailable is tried less and less often, down to this.
const RETRY_MAX: Duration = Duration::from_secs(10);
/// How far writing trails the clock (100 ns): above the usual device latency plus a tick.
const DELAY: i64 = 1_500_000;

/// Where the mixed track goes: a screen recording (record.rs) or an audio-only one (voice.rs).
pub trait AudioSink: Send + Sync + 'static {
    /// The pause clock: packet times become media times through it.
    fn clock(&self) -> &Mutex<Clock>;
    /// Interleaved 16-bit stereo PCM at media time `time`.
    fn write_audio(&self, time: i64, samples: &[i16]) -> Result<()>;
    /// Every tick with the media time written up to; a screen recording keeps a still video stream moving with it.
    fn tick(&self, _media: i64) {}
}

pub struct Input {
    client: IAudioClient,
    capture: IAudioCaptureClient,
}

// Opened in the multithreaded apartment, so usable from the audio thread.
unsafe impl Send for Input {}

pub struct AudioCapture {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

/// Which requested inputs could not be opened ("system", "mic").
pub type Failed = Vec<&'static str>;

/// Opens and starts the inputs. Done before the video starts: opening takes a few hundred
/// ms, and packets from before the clock's start are dropped anyway. Needs COM (MTA) on this thread.
/// One slot per requested input; one that did not open is tried again while recording (a headset mic can lag).
pub fn open_inputs(system: bool, mic: bool) -> (Vec<Slot>, Failed) {
    let mut inputs = Vec::new();
    let mut failed = Vec::new();
    for (wanted, loopback, name) in [(system, true, "system"), (mic, false, "mic")] {
        if !wanted {
            continue;
        }
        let input = unsafe { open_new(loopback) }.ok();
        if input.is_none() {
            failed.push(name);
        }
        inputs.push(Slot { loopback, input, wait: RETRY, retry: Instant::now() + RETRY });
    }
    (inputs, failed)
}

/// Starts the thread that reads the inputs and writes the mixed track.
pub fn start<S: AudioSink>(shared: Arc<S>, mut slots: Vec<Slot>, now: fn() -> i64) -> AudioCapture {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let thread = thread::spawn(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        run(&*shared, &mut slots, &flag, now);
        for i in slots.into_iter().filter_map(|s| s.input) {
            let _ = unsafe { i.client.Stop() };
        }
    });
    AudioCapture { stop, thread: Some(thread) }
}

impl AudioCapture {
    /// Writes what is left and ends the thread.
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

unsafe fn open_new(loopback: bool) -> Result<Input> {
    unsafe { open(&CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?, loopback) }
}

unsafe fn open(devices: &IMMDeviceEnumerator, loopback: bool) -> Result<Input> {
    unsafe {
        let device = devices.GetDefaultAudioEndpoint(if loopback { eRender } else { eCapture }, eConsole)?;
        let client: IAudioClient = device.Activate(CLSCTX_ALL, None)?;
        let block = (AUDIO_CHANNELS * 2) as u16;
        let format = WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_PCM as u16,
            nChannels: AUDIO_CHANNELS as u16,
            nSamplesPerSec: AUDIO_RATE,
            nAvgBytesPerSec: AUDIO_RATE * block as u32,
            nBlockAlign: block,
            wBitsPerSample: 16,
            cbSize: 0,
        };
        let mut flags = AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
        if loopback {
            flags |= AUDCLNT_STREAMFLAGS_LOOPBACK;
        }
        // 200 ms of buffer: room for a slow tick.
        client.Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 2_000_000, 0, &format, None)?;
        let capture: IAudioCaptureClient = client.GetService()?;
        client.Start()?;
        Ok(Input { client, capture })
    }
}

/// An input and how to get it back when Windows drops it.
pub struct Slot {
    input: Option<Input>,
    loopback: bool,
    /// Pause before the next try; doubles on each failure.
    wait: Duration,
    retry: Instant,
}

fn run<S: AudioSink>(shared: &S, slots: &mut [Slot], stop: &AtomicBool, now: fn() -> i64) {
    let rate = AUDIO_RATE as i64;
    let mut mixer = Mixer::new(slots.len(), rate);
    // One enumerator for every retry.
    let mut devices: Option<IMMDeviceEnumerator> = None;
    loop {
        let last = stop.load(Ordering::Relaxed);
        if !last {
            thread::sleep(TICK);
        }
        for (i, slot) in slots.iter_mut().enumerate() {
            // The default device changed or went away (AUDCLNT_E_DEVICE_INVALIDATED and the like):
            // open the new default, retrying until there is one (twice a second at first, then less often).
            let failed = slot.input.as_ref().is_some_and(|input| drain(shared, input, i, &mut mixer).is_err());
            if failed {
                slot.input = None;
            }
            if slot.input.is_none() && Instant::now() >= slot.retry {
                if devices.is_none() {
                    devices = unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.ok();
                }
                slot.input = devices.as_ref().and_then(|d| unsafe { open(d, slot.loopback) }.ok());
                slot.wait = if slot.input.is_some() { RETRY } else { (slot.wait * 2).min(RETRY_MAX) };
                slot.retry = Instant::now() + slot.wait;
            }
        }
        // At the end everything up to now goes out, without the delay.
        let elapsed = shared.clock().lock().unwrap().elapsed(now()) - if last { 0 } else { DELAY };
        let (from, samples) = mixer.take(to_frames(elapsed.max(0), rate));
        let _ = shared.write_audio(to_time(from, rate), &samples);
        shared.tick(elapsed.max(0));
        if last {
            return;
        }
    }
}

fn drain<S: AudioSink>(shared: &S, input: &Input, index: usize, mixer: &mut Mixer) -> Result<()> {
    let rate = AUDIO_RATE as i64;
    unsafe {
        while input.capture.GetNextPacketSize()? > 0 {
            let (mut data, mut frames, mut flags, mut qpc) = (std::ptr::null_mut(), 0u32, 0u32, 0u64);
            input.capture.GetBuffer(&mut data, &mut frames, &mut flags, None, Some(&mut qpc))?;
            let n = frames as usize * AUDIO_CHANNELS as usize;
            let silent = flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null();
            let lost = flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY.0 as u32 != 0;
            // Packets from inside a pause have no media time and are dropped.
            if let Some(t) = shared.clock().lock().unwrap().media(qpc as i64) {
                if silent {
                    mixer.add(index, to_frames(t, rate), &vec![0; n], lost);
                } else {
                    mixer.add(index, to_frames(t, rate), std::slice::from_raw_parts(data as *const i16, n), lost);
                }
            }
            input.capture.ReleaseBuffer(frames)?;
        }
    }
    Ok(())
}
