//! Audio for recordings: system audio (WASAPI loopback of the default output) and the
//! default microphone, mixed into one stereo track.
//!
//! Both are opened in shared mode asking Windows for 48 kHz stereo 16-bit
//! (AUTOCONVERTPCM), so no resampling happens here. Every packet carries the QPC time
//! of its first frame; the pause clock turns that into media time and the mixer puts
//! it on the timeline. Writing trails the clock by DELAY so late packets still land.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use windows::core::Result;
use windows::Win32::Media::Audio::*;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

use super::math::{to_frames, to_time, Mixer};
use super::record::{Shared, AUDIO_CHANNELS, AUDIO_RATE};

const TICK: Duration = Duration::from_millis(10);
/// How far writing trails the clock (100 ns): above the usual device latency plus a tick.
const DELAY: i64 = 1_500_000;

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
pub fn open_inputs(system: bool, mic: bool) -> (Vec<Input>, Failed) {
    let mut inputs = Vec::new();
    let mut failed = Vec::new();
    for (wanted, loopback, name) in [(system, true, "system"), (mic, false, "mic")] {
        if !wanted {
            continue;
        }
        match unsafe { open(loopback) } {
            Ok(i) => inputs.push(i),
            Err(_) => failed.push(name),
        }
    }
    (inputs, failed)
}

/// Starts the thread that reads the inputs and writes the mixed track.
pub fn start(shared: Arc<Shared>, inputs: Vec<Input>, now: fn() -> i64) -> AudioCapture {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let thread = thread::spawn(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        run(&shared, &inputs, &flag, now);
        for i in inputs {
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

unsafe fn open(loopback: bool) -> Result<Input> {
    unsafe {
        let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
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

fn run(shared: &Shared, inputs: &[Input], stop: &AtomicBool, now: fn() -> i64) {
    let rate = AUDIO_RATE as i64;
    let mut mixer = Mixer::new(inputs.len(), rate);
    loop {
        let last = stop.load(Ordering::Relaxed);
        if !last {
            thread::sleep(TICK);
        }
        for (i, input) in inputs.iter().enumerate() {
            let _ = drain(shared, input, i, &mut mixer);
        }
        // At the end everything up to now goes out, without the delay.
        let elapsed = shared.clock.lock().unwrap().elapsed(now()) - if last { 0 } else { DELAY };
        let (from, samples) = mixer.take(to_frames(elapsed.max(0), rate));
        let _ = shared.write_audio(to_time(from, rate), &samples);
        if last {
            return;
        }
    }
}

fn drain(shared: &Shared, input: &Input, index: usize, mixer: &mut Mixer) -> Result<()> {
    let rate = AUDIO_RATE as i64;
    unsafe {
        while input.capture.GetNextPacketSize()? > 0 {
            let (mut data, mut frames, mut flags, mut qpc) = (std::ptr::null_mut(), 0u32, 0u32, 0u64);
            input.capture.GetBuffer(&mut data, &mut frames, &mut flags, None, Some(&mut qpc))?;
            let n = frames as usize * AUDIO_CHANNELS as usize;
            let silent = flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null();
            // Packets from inside a pause have no media time and are dropped.
            if let Some(t) = shared.clock.lock().unwrap().media(qpc as i64) {
                if silent {
                    mixer.add(index, to_frames(t, rate), &vec![0; n]);
                } else {
                    mixer.add(index, to_frames(t, rate), std::slice::from_raw_parts(data as *const i16, n));
                }
            }
            input.capture.ReleaseBuffer(frames)?;
        }
    }
    Ok(())
}
