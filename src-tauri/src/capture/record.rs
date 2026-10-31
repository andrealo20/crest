//! Screen recording: Windows.Graphics.Capture delivers frames of a monitor or a window
//! as D3D11 textures; the Media Foundation Sink Writer encodes them to H.264 in an MP4,
//! with the audio track from `audio.rs` as AAC. No ffmpeg.
//!
//! The GPU path hands the textures to the encoder through a DXGI device manager. If the
//! writer cannot start that way (old driver, no hardware encoder), it starts again with
//! frames read back to memory, which Media Foundation converts and encodes in software.
//!
//! Timestamps come from the frames themselves (QPC), shifted by the pause clock, so
//! pauses leave no gap and audio and video share one timeline.

use std::path::Path;
use std::sync::{Arc, Mutex};

use windows::core::{factory, Interface, Result, HSTRING};
use windows::Foundation::TypedEventHandler;
use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureAccess, GraphicsCaptureAccessKind, GraphicsCaptureItem, GraphicsCaptureSession};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::{HMODULE, HWND};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Gdi::HMONITOR;
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;

use super::math::{bitrate, copy_box, even_size, Clock, Pacer};

pub const AUDIO_RATE: u32 = 48_000;
pub const AUDIO_CHANNELS: u32 = 2;

pub enum Source {
    Monitor(HMONITOR),
    Window(HWND),
}

/// State the frame handler and the audio thread share.
pub struct Shared {
    pub clock: Mutex<Clock>,
    writer: Mutex<Writer>,
}

struct Writer {
    sink: IMFSinkWriter,
    video: u32,
    audio: Option<u32>,
    gpu: bool,
    done: bool,
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    staging: Option<ID3D11Texture2D>,
    size: (u32, u32),
    pacer: Pacer,
}

// Media Foundation and D3D11 (with multithread protection on) are free-threaded; every use goes through the mutex.
unsafe impl Send for Writer {}

pub struct Recorder {
    session: GraphicsCaptureSession,
    pool: Direct3D11CaptureFramePool,
    item: GraphicsCaptureItem,
    pub shared: Arc<Shared>,
    pub has_audio: bool,
    /// Frames go to the encoder as GPU textures (false: read back to memory). Read by the live test.
    #[cfg_attr(not(test), allow(dead_code))]
    pub gpu: bool,
}

// WinRT capture objects are agile.
unsafe impl Send for Recorder {}

/// Starts capturing `source` into `path` (an .mp4). Media Foundation must be started on this thread's apartment.
/// `on_closed` runs on a system thread when the window or monitor goes away.
pub fn start(source: Source, path: &Path, fps: u32, audio: bool, now: fn() -> i64, on_closed: impl Fn() + Send + 'static) -> Result<Recorder> {
    unsafe {
        let mut device = None;
        let mut context = None;
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )?;
        let (device, context) = (device.unwrap(), context.unwrap());
        // The encoder uses the device from its own threads.
        let _ = device.cast::<ID3D11Multithread>()?.SetMultithreadProtected(true);
        let winrt: IDirect3DDevice = CreateDirect3D11DeviceFromDXGIDevice(&device.cast::<IDXGIDevice>()?)?.cast()?;

        let interop = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
        let item: GraphicsCaptureItem = match source {
            Source::Monitor(m) => interop.CreateForMonitor(m)?,
            Source::Window(w) => interop.CreateForWindow(w)?,
        };
        let item_size = item.Size()?;
        let size = even_size(item_size.Width.max(2) as u32, item_size.Height.max(2) as u32);

        let mut token = 0;
        let mut manager = None;
        MFCreateDXGIDeviceManager(&mut token, &mut manager)?;
        let manager = manager.unwrap();
        manager.ResetDevice(&device, token)?;
        let (sink, video, audio_stream, gpu) = match open_sink(path, size, fps, audio, Some(&manager)) {
            Ok((s, v, a)) => (s, v, a, true),
            Err(_) => {
                let (s, v, a) = open_sink(path, size, fps, audio, None)?;
                (s, v, a, false)
            }
        };

        let shared = Arc::new(Shared {
            clock: Mutex::new(Clock::new(now())),
            writer: Mutex::new(Writer { sink, video, audio: audio_stream, gpu, done: false, device, context, staging: None, size, pacer: Pacer::new(fps) }),
        });

        // Two buffers: one being copied, one being filled.
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&winrt, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, item_size)?;
        let frames = shared.clone();
        pool.FrameArrived(&TypedEventHandler::new(move |pool: windows::core::Ref<Direct3D11CaptureFramePool>, _| {
            if let Some(pool) = pool.as_ref() {
                let frame = pool.TryGetNextFrame()?;
                let result = frames.on_frame(&frame);
                frame.Close()?;
                result?;
            }
            Ok(())
        }))?;
        item.Closed(&TypedEventHandler::new(move |_, _| {
            on_closed();
            Ok(())
        }))?;

        let session = pool.CreateCaptureSession(&item)?;
        let _ = session.SetIsCursorCaptureEnabled(true);
        // The yellow frame Windows 11 draws around a capture; turning it off needs a one-time permission.
        if GraphicsCaptureAccess::RequestAccessAsync(GraphicsCaptureAccessKind::Borderless).and_then(|op| op.join()).is_ok() {
            let _ = session.SetIsBorderRequired(false);
        }
        // The clock starts with the capture, not before the slow setup above (device, encoder).
        *shared.clock.lock().unwrap() = Clock::new(now());
        session.StartCapture()?;
        Ok(Recorder { session, pool, item, shared, has_audio: audio_stream.is_some(), gpu })
    }
}

impl Recorder {
    /// Stops the capture and writes the file's index. Call after the audio thread has finished.
    pub fn stop(self) -> Result<()> {
        let _ = self.session.Close();
        let _ = self.pool.Close();
        drop(self.item);
        let mut w = self.shared.writer.lock().unwrap();
        w.done = true;
        unsafe { w.sink.Finalize() }
    }
}

impl Shared {
    fn on_frame(&self, frame: &windows::Graphics::Capture::Direct3D11CaptureFrame) -> Result<()> {
        let t = frame.SystemRelativeTime()?.Duration;
        let Some(media) = self.clock.lock().unwrap().media(t) else { return Ok(()) };
        let mut w = self.writer.lock().unwrap();
        if w.done || !w.pacer.admit(media) {
            return Ok(());
        }
        let content = frame.ContentSize()?;
        let access: IDirect3DDxgiInterfaceAccess = frame.Surface()?.cast()?;
        let texture: ID3D11Texture2D = unsafe { access.GetInterface()? };
        w.write_frame(&texture, (content.Width.max(0) as u32, content.Height.max(0) as u32), media)
    }

    /// Writes interleaved 16-bit stereo PCM at media time `time`.
    pub fn write_audio(&self, time: i64, samples: &[i16]) -> Result<()> {
        let w = self.writer.lock().unwrap();
        let (Some(stream), false) = (w.audio, w.done) else { return Ok(()) };
        if samples.is_empty() {
            return Ok(());
        }
        unsafe {
            let bytes = std::mem::size_of_val(samples) as u32;
            let buffer = MFCreateMemoryBuffer(bytes)?;
            let mut ptr = std::ptr::null_mut();
            buffer.Lock(&mut ptr, None, None)?;
            std::ptr::copy_nonoverlapping(samples.as_ptr() as *const u8, ptr, bytes as usize);
            buffer.Unlock()?;
            buffer.SetCurrentLength(bytes)?;
            let sample = MFCreateSample()?;
            sample.AddBuffer(&buffer)?;
            sample.SetSampleTime(time)?;
            sample.SetSampleDuration(super::math::to_time((samples.len() / AUDIO_CHANNELS as usize) as i64, AUDIO_RATE as i64))?;
            w.sink.WriteSample(stream, &sample)
        }
    }
}

impl Writer {
    fn write_frame(&mut self, src: &ID3D11Texture2D, content: (u32, u32), time: i64) -> Result<()> {
        let (tw, th) = self.size;
        let (cw, ch) = copy_box(content, self.size);
        unsafe {
            // A new texture per frame: the encoder may still hold the last one.
            let desc = D3D11_TEXTURE2D_DESC {
                Width: tw,
                Height: th,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
                CPUAccessFlags: 0,
                MiscFlags: 0,
            };
            let mut texture = None;
            self.device.CreateTexture2D(&desc, None, Some(&mut texture))?;
            let texture = texture.unwrap();
            if cw < tw || ch < th {
                // A window got smaller than at the start: black around it instead of old pixels.
                let mut rtv = None;
                self.device.CreateRenderTargetView(&texture, None, Some(&mut rtv))?;
                self.context.ClearRenderTargetView(&rtv.unwrap(), &[0.0, 0.0, 0.0, 1.0]);
            }
            let area = D3D11_BOX { left: 0, top: 0, front: 0, right: cw, bottom: ch, back: 1 };
            self.context.CopySubresourceRegion(&texture, 0, 0, 0, 0, src, 0, Some(&area));

            let buffer = if self.gpu {
                let b = MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, &texture, 0, false)?;
                b.SetCurrentLength(b.cast::<IMF2DBuffer>()?.GetContiguousLength()?)?;
                b
            } else {
                self.read_back(&texture)?
            };
            let sample = MFCreateSample()?;
            sample.AddBuffer(&buffer)?;
            sample.SetSampleTime(time)?;
            sample.SetSampleDuration(self.pacer.interval())?;
            self.sink.WriteSample(self.video, &sample)
        }
    }

    /// CPU path: copies the frame into a memory buffer, rows top to bottom.
    unsafe fn read_back(&mut self, texture: &ID3D11Texture2D) -> Result<IMFMediaBuffer> {
        let (w, h) = self.size;
        unsafe {
            if self.staging.is_none() {
                let desc = D3D11_TEXTURE2D_DESC {
                    Width: w,
                    Height: h,
                    MipLevels: 1,
                    ArraySize: 1,
                    Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                    SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                    Usage: D3D11_USAGE_STAGING,
                    BindFlags: 0,
                    CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                    MiscFlags: 0,
                };
                let mut t = None;
                self.device.CreateTexture2D(&desc, None, Some(&mut t))?;
                self.staging = t;
            }
            let staging = self.staging.as_ref().unwrap();
            self.context.CopyResource(staging, texture);
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            self.context.Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;
            let row = (w * 4) as usize;
            let buffer = MFCreateMemoryBuffer(row as u32 * h)?;
            let mut ptr = std::ptr::null_mut();
            buffer.Lock(&mut ptr, None, None)?;
            for y in 0..h as usize {
                std::ptr::copy_nonoverlapping((mapped.pData as *const u8).add(y * mapped.RowPitch as usize), ptr.add(y * row), row);
            }
            buffer.Unlock()?;
            self.context.Unmap(staging, 0);
            buffer.SetCurrentLength(row as u32 * h)?;
            Ok(buffer)
        }
    }
}

fn pack(hi: u32, lo: u32) -> u64 {
    ((hi as u64) << 32) | lo as u64
}

/// The MP4 writer: H.264 from BGRA frames, and AAC from 48 kHz stereo PCM when `audio`.
unsafe fn open_sink(path: &Path, (w, h): (u32, u32), fps: u32, audio: bool, manager: Option<&IMFDXGIDeviceManager>) -> Result<(IMFSinkWriter, u32, Option<u32>)> {
    unsafe {
        let mut attrs = None;
        MFCreateAttributes(&mut attrs, 2)?;
        let attrs = attrs.unwrap();
        attrs.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1)?;
        if let Some(m) = manager {
            attrs.SetUnknown(&MF_SINK_WRITER_D3D_MANAGER, m)?;
        }
        let sink = MFCreateSinkWriterFromURL(&HSTRING::from(path), None, &attrs)?;

        let out = MFCreateMediaType()?;
        out.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        out.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)?;
        out.SetUINT32(&MF_MT_AVG_BITRATE, bitrate(w, h, fps))?;
        out.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
        out.SetUINT64(&MF_MT_FRAME_SIZE, pack(w, h))?;
        out.SetUINT64(&MF_MT_FRAME_RATE, pack(fps, 1))?;
        out.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack(1, 1))?;
        let video = sink.AddStream(&out)?;

        let input = MFCreateMediaType()?;
        input.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        input.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32)?;
        input.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
        input.SetUINT64(&MF_MT_FRAME_SIZE, pack(w, h))?;
        input.SetUINT64(&MF_MT_FRAME_RATE, pack(fps, 1))?;
        input.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack(1, 1))?;
        // Positive stride = rows top to bottom (RGB defaults to bottom-up).
        input.SetUINT32(&MF_MT_DEFAULT_STRIDE, w * 4)?;
        sink.SetInputMediaType(video, &input, None)?;

        let audio = if audio {
            let block = AUDIO_CHANNELS * 2;
            let out = MFCreateMediaType()?;
            out.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
            out.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_AAC)?;
            out.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)?;
            out.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, AUDIO_RATE)?;
            out.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, AUDIO_CHANNELS)?;
            // 192 kbit/s, one of the four rates the AAC encoder accepts.
            out.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 24_000)?;
            let stream = sink.AddStream(&out)?;
            let input = MFCreateMediaType()?;
            input.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
            input.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_PCM)?;
            input.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)?;
            input.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, AUDIO_RATE)?;
            input.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, AUDIO_CHANNELS)?;
            input.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, block)?;
            input.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, AUDIO_RATE * block)?;
            sink.SetInputMediaType(stream, &input, None)?;
            Some(stream)
        } else {
            None
        };
        sink.BeginWriting()?;
        Ok((sink, video, audio))
    }
}
