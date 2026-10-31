//! Terminal tool: one shell session in a Windows pseudo console (ConPTY).
//! The shell runs as the user; its output only goes to the notch over a channel.

use std::ffi::c_void;
use std::fs::File;
use std::io::{Read, Write};
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};
use windows::core::{HSTRING, PWSTR};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::Console::{ClosePseudoConsole, CreatePseudoConsole, ResizePseudoConsole, COORD, HPCON};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, TerminateJobObject,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows::Win32::System::Pipes::CreatePipe;
use windows::Win32::System::Threading::{
    CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess, InitializeProcThreadAttributeList, ResumeThread, TerminateProcess,
    UpdateProcThreadAttribute, WaitForSingleObject, CREATE_SUSPENDED, EXTENDED_STARTUPINFO_PRESENT, INFINITE, LPPROC_THREAD_ATTRIBUTE_LIST,
    PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, STARTF_USESTDHANDLES, STARTUPINFOEXW,
};

/// A running shell. Dropping it closes the pseudo console, which ends conhost and
/// every console program still attached; the reader thread then sees EOF.
struct Pty {
    hpc: HPCON,
    input: File,
    process: OwnedHandle,
    /// None when Crest itself sits in a job that forbids nesting.
    job: Option<OwnedHandle>,
}

impl Pty {
    fn kill(&self) {
        let killed = self.job.as_ref().is_some_and(|job| unsafe { TerminateJobObject(handle(job), 1) }.is_ok());
        if !killed {
            let _ = unsafe { TerminateProcess(handle(&self.process), 1) };
        }
    }
}

impl Drop for Pty {
    fn drop(&mut self) {
        unsafe { ClosePseudoConsole(self.hpc) };
    }
}

#[derive(Default)]
pub struct TerminalState(Mutex<Option<Arc<Pty>>>);

fn handle(h: &OwnedHandle) -> HANDLE {
    HANDLE(h.as_raw_handle())
}

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\"))
}

fn system32() -> PathBuf {
    PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into())).join("System32")
}

/// PowerShell 7 from PATH or its default install folder. symlink_metadata, because the
/// Store version is an app execution alias that metadata() cannot open.
fn find_pwsh() -> Option<PathBuf> {
    let on_path: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).map(|d| d.join("pwsh.exe")).collect()).unwrap_or_default();
    let installed = ["ProgramFiles", "ProgramW6432"].into_iter().filter_map(std::env::var_os).map(|d| PathBuf::from(d).join("PowerShell\\7\\pwsh.exe"));
    on_path.into_iter().chain(installed).find(|p| std::fs::symlink_metadata(p).is_ok_and(|m| !m.is_dir()))
}

/// The only programs the terminal starts.
fn shell_exe(shell: &str) -> Option<PathBuf> {
    match shell {
        "pwsh" => find_pwsh(),
        "powershell" => Some(system32().join("WindowsPowerShell\\v1.0\\powershell.exe")),
        "cmd" => Some(system32().join("cmd.exe")),
        _ => None,
    }
}

#[derive(Serialize)]
pub struct ShellInfo {
    pwsh: Option<String>,
    powershell: String,
    cmd: String,
    home: String,
}

#[tauri::command]
pub fn terminal_info() -> ShellInfo {
    let s = |p: PathBuf| p.to_string_lossy().into_owned();
    ShellInfo {
        pwsh: find_pwsh().map(s),
        powershell: s(shell_exe("powershell").unwrap_or_default()),
        cmd: s(shell_exe("cmd").unwrap_or_default()),
        home: s(home()),
    }
}

fn size(cols: u16, rows: u16) -> COORD {
    COORD { X: cols.clamp(2, 1000) as i16, Y: rows.clamp(2, 1000) as i16 }
}

/// Starts `shell` (replacing a running session). Output arrives on `on_output` as raw
/// bytes; the last message is JSON `{ "exit": code }`.
#[tauri::command]
pub async fn terminal_start(
    shell: String,
    command_line: String,
    cwd: String,
    cols: u16,
    rows: u16,
    on_output: Channel<InvokeResponseBody>,
    app: AppHandle,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let exe = shell_exe(&shell).ok_or("Shell not found")?;
    let cwd = if Path::new(&cwd).is_dir() { PathBuf::from(cwd) } else { home() };
    let (pty, output) = spawn(&exe, &command_line, &cwd, size(cols, rows)).map_err(|e| e.message())?;
    let pty = Arc::new(pty);
    // Replacing on store (not before spawning) also covers two starts racing each other.
    if let Some(old) = state.0.lock().unwrap().replace(pty.clone()) {
        old.kill();
    }

    let channel = on_output.clone();
    let reader = std::thread::spawn(move || pump(output, &channel));
    std::thread::spawn(move || {
        let mut code = 0u32;
        unsafe {
            WaitForSingleObject(handle(&pty.process), INFINITE);
            let _ = GetExitCodeProcess(handle(&pty.process), &mut code);
        }
        // Forget the session unless a newer one already replaced it.
        {
            let state = app.state::<TerminalState>();
            let mut slot = state.0.lock().unwrap();
            if slot.as_ref().is_some_and(|p| Arc::ptr_eq(p, &pty)) {
                *slot = None;
            }
        }
        drop(pty);
        let _ = reader.join();
        let _ = on_output.send(InvokeResponseBody::Json(format!("{{\"exit\":{code}}}")));
    });
    Ok(())
}

/// Keeps reading even if the webview is gone, so conhost never blocks on a full pipe.
fn pump(mut output: File, channel: &Channel<InvokeResponseBody>) {
    let mut buf = vec![0u8; 16 * 1024];
    while let Ok(n) = output.read(&mut buf) {
        if n == 0 {
            break;
        }
        let _ = channel.send(InvokeResponseBody::Raw(buf[..n].to_vec()));
    }
}

fn spawn(exe: &Path, command_line: &str, cwd: &Path, size: COORD) -> windows::core::Result<(Pty, File)> {
    unsafe {
        let (mut in_read, mut in_write, mut out_read, mut out_write) = (HANDLE::default(), HANDLE::default(), HANDLE::default(), HANDLE::default());
        CreatePipe(&mut in_read, &mut in_write, None, 0)?;
        let in_read = OwnedHandle::from_raw_handle(in_read.0);
        let input = File::from_raw_handle(in_write.0);
        CreatePipe(&mut out_read, &mut out_write, None, 0)?;
        let output = File::from_raw_handle(out_read.0);
        let out_write = OwnedHandle::from_raw_handle(out_write.0);

        let hpc = CreatePseudoConsole(size, handle(&in_read), handle(&out_write), 0)?;
        // conhost holds its own copies of these ends now.
        drop(in_read);
        drop(out_write);

        match launch(hpc, exe, command_line, cwd) {
            Ok((process, job)) => Ok((Pty { hpc, input, process, job }, output)),
            Err(e) => {
                // Close the read end first so conhost cannot block on unread output.
                drop(output);
                ClosePseudoConsole(hpc);
                Err(e)
            }
        }
    }
}

/// Job that kills the shell and everything it started once its last handle closes:
/// on kill, on quit, and when Crest crashes.
unsafe fn kill_on_close_job() -> windows::core::Result<OwnedHandle> {
    let job = OwnedHandle::from_raw_handle(CreateJobObjectW(None, None)?.0);
    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(
        handle(&job),
        JobObjectExtendedLimitInformation,
        &info as *const _ as *const c_void,
        std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
    )?;
    Ok(job)
}

unsafe fn launch(hpc: HPCON, exe: &Path, command_line: &str, cwd: &Path) -> windows::core::Result<(OwnedHandle, Option<OwnedHandle>)> {
    let job = kill_on_close_job()?;
    let mut bytes = 0usize;
    // The first call only reports the size and fails by design.
    let _ = InitializeProcThreadAttributeList(None, 1, None, &mut bytes);
    // usize elements keep the list pointer aligned.
    let mut buffer = vec![0usize; bytes.div_ceil(std::mem::size_of::<usize>())];
    let attrs = LPPROC_THREAD_ATTRIBUTE_LIST(buffer.as_mut_ptr().cast());
    InitializeProcThreadAttributeList(Some(attrs), 1, None, &mut bytes)?;

    let result = (|| {
        UpdateProcThreadAttribute(attrs, 0, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize, Some(hpc.0 as *const c_void), std::mem::size_of::<HPCON>(), None, None)?;
        let mut si = STARTUPINFOEXW::default();
        si.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
        // Null std handles: otherwise the shell inherits Crest's own (a console in dev) instead of the pseudo console.
        si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        si.lpAttributeList = attrs;
        let mut cmd: Vec<u16> = command_line.encode_utf16().chain([0]).collect();
        let mut pi = PROCESS_INFORMATION::default();
        CreateProcessW(
            &HSTRING::from(exe.as_os_str()),
            Some(PWSTR(cmd.as_mut_ptr())),
            None,
            None,
            false,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED,
            None,
            &HSTRING::from(cwd.as_os_str()),
            &si.StartupInfo,
            &mut pi,
        )?;
        let process = OwnedHandle::from_raw_handle(pi.hProcess.0);
        let thread = OwnedHandle::from_raw_handle(pi.hThread.0);
        // Suspended until it is in the job, so nothing it starts escapes.
        let job = AssignProcessToJobObject(handle(&job), handle(&process)).is_ok().then_some(job);
        ResumeThread(handle(&thread));
        Ok((process, job))
    })();
    DeleteProcThreadAttributeList(attrs);
    result
}

/// Keystrokes and pastes. Sync on purpose: commands then run in order on the main thread.
#[tauri::command]
pub fn terminal_write(data: String, state: State<'_, TerminalState>) -> Result<(), String> {
    let pty = state.0.lock().unwrap().clone().ok_or("No session")?;
    (&pty.input).write_all(data.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_resize(cols: u16, rows: u16, state: State<'_, TerminalState>) {
    if let Some(pty) = state.0.lock().unwrap().as_ref() {
        let _ = unsafe { ResizePseudoConsole(pty.hpc, size(cols, rows)) };
    }
}

#[tauri::command]
pub fn terminal_kill(state: State<'_, TerminalState>) {
    if let Some(pty) = state.0.lock().unwrap().take() {
        pty.kill();
    }
}

/// Clipboard text for right-click paste (reading it in the webview would need a permission prompt).
#[tauri::command]
pub fn terminal_clipboard_text() -> Option<String> {
    arboard::Clipboard::new().and_then(|mut c| c.get_text()).ok()
}
