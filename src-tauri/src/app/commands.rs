use tauri::State;
use windows_sys::Win32::Foundation::CloseHandle;
use windows_sys::Win32::System::Threading::{
  OpenProcess, TerminateProcess, PROCESS_CREATE_THREAD, PROCESS_QUERY_INFORMATION, PROCESS_TERMINATE,
  PROCESS_VM_OPERATION, PROCESS_VM_READ, PROCESS_VM_WRITE,
};

use super::constants::*;
use super::process::{
  apply_patch_at, find_pid_by_name, find_pid_by_window_class, get_module_base,
  resume_process_threads, suspend_process_threads,
};
use super::state::{
  AttachResponse, ForegroundWindow, ProcessHandle, ProcessState, StatusResponse,
};
use super::window::foreground_window_class;

#[tauri::command]
pub(crate) fn apply_patch(
  state: State<'_, ProcessState>,
  offset: u64,
  bytes: Vec<u8>,
  enabled: bool,
) -> Result<(), String> {
  let mut guard = state.inner.lock().map_err(|_| "State lock error".to_string())?;
  let handle = guard.as_mut().ok_or_else(|| "Process not attached".to_string())?;
  let address = handle.base + offset as usize;
  let threads = suspend_process_threads(handle.pid);
  let result = apply_patch_at(handle, address, &bytes, enabled);
  resume_process_threads(threads);
  result
}

#[tauri::command]
pub(crate) fn apply_nop(
  state: State<'_, ProcessState>,
  offset: u64,
  size: u64,
  enabled: bool,
) -> Result<(), String> {
  let mut guard = state.inner.lock().map_err(|_| "State lock error".to_string())?;
  let handle = guard.as_mut().ok_or_else(|| "Process not attached".to_string())?;
  let address = handle.base + offset as usize;
  let bytes = vec![0x90; size as usize];
  let threads = suspend_process_threads(handle.pid);
  let result = apply_patch_at(handle, address, &bytes, enabled);
  resume_process_threads(threads);
  result
}

#[tauri::command]
pub(crate) fn apply_float(
  state: State<'_, ProcessState>,
  offset: u64,
  value: f32,
  enabled: bool,
) -> Result<(), String> {
  let mut guard = state.inner.lock().map_err(|_| "State lock error".to_string())?;
  let handle = guard.as_mut().ok_or_else(|| "Process not attached".to_string())?;
  let address = handle.base + offset as usize;
  let bytes = value.to_le_bytes();
  apply_patch_at(handle, address, &bytes, enabled)
}

#[tauri::command]
pub(crate) fn attach_process(state: State<'_, ProcessState>) -> Result<AttachResponse, String> {
  let pid = find_pid_by_window_class(SKY_WINDOW_CLASS)
    .or_else(|| find_pid_by_name(SKY_EXE))
    .ok_or_else(|| "Sky.exe not found".to_string())?;

  let base = get_module_base(pid, SKY_EXE).ok_or_else(|| "Failed to find module base".to_string())?;
  let handle = unsafe {
    OpenProcess(
      PROCESS_QUERY_INFORMATION
        | PROCESS_CREATE_THREAD
        | PROCESS_VM_READ
        | PROCESS_VM_WRITE
        | PROCESS_VM_OPERATION,
      0,
      pid,
    )
  };
  if handle == 0 {
    return Err("Failed to open Sky.exe process".to_string());
  }

  let mut guard = state.inner.lock().map_err(|_| "State lock error".to_string())?;
  let process = ProcessHandle {
    handle,
    pid,
    base,
    original: std::collections::HashMap::new(),
  };
  *guard = Some(process);

  Ok(AttachResponse { pid, base })
}

#[tauri::command]
pub(crate) fn detach_process(state: State<'_, ProcessState>) -> Result<(), String> {
  let mut guard = state.inner.lock().map_err(|_| "State lock error".to_string())?;
  let _ = guard.take();
  Ok(())
}

#[tauri::command]
pub(crate) fn status(state: State<'_, ProcessState>) -> Result<StatusResponse, String> {
  let guard = state.inner.lock().map_err(|_| "State lock error".to_string())?;
  Ok(StatusResponse {
    attached: guard.is_some(),
    pid: guard.as_ref().map(|handle| handle.pid),
  })
}

#[tauri::command]
pub(crate) fn close_game() -> Result<(), String> {
  let pid = find_pid_by_window_class(SKY_WINDOW_CLASS)
    .or_else(|| find_pid_by_name(SKY_EXE))
    .ok_or_else(|| "Sky.exe not found".to_string())?;
  let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };
  if handle == 0 {
    return Err("Failed to open Sky.exe process".to_string());
  }
  let result = unsafe { TerminateProcess(handle, 0) };
  unsafe {
    CloseHandle(handle);
  }
  if result == 0 {
    return Err("Failed to close Sky.exe".to_string());
  }
  Ok(())
}

#[tauri::command]
pub(crate) fn launch_game() -> Result<(), String> {
  let status = std::process::Command::new("cmd")
    .args(["/C", "start", "", "steam://rungameid/2325290"])
    .status()
    .map_err(|_| "Failed to launch Steam".to_string())?;
  if !status.success() {
    return Err("Steam launch command failed".to_string());
  }
  Ok(())
}

#[tauri::command]
pub(crate) fn get_foreground_window_class() -> Result<ForegroundWindow, String> {
  let class_name = foreground_window_class().ok_or_else(|| "No foreground window".to_string())?;
  Ok(ForegroundWindow { class_name })
}

#[tauri::command]
pub(crate) fn set_invincibility(state: State<'_, ProcessState>, enabled: bool) -> Result<(), String> {
  let mut guard = state.inner.lock().map_err(|_| "State lock error".to_string())?;
  let handle = guard.as_mut().ok_or_else(|| "Process not attached".to_string())?;
  let address = handle.base + OFFSET_INVINCIBILITY;
  if enabled {
    if !handle.original.contains_key(&address) {
      let original = super::process::read_bytes(handle.handle, address, 1)?;
      handle.original.insert(address, original);
    }
    super::process::write_bytes(handle.handle, address, &[0x01])?;
  } else if let Some(original) = handle.original.remove(&address) {
    super::process::write_bytes(handle.handle, address, &original)?;
  } else {
    super::process::write_bytes(handle.handle, address, &[0x00])?;
  }
  Ok(())
}

#[tauri::command]
pub(crate) fn set_run_speed(state: State<'_, ProcessState>, value: f32) -> Result<(), String> {
  let mut guard = state.inner.lock().map_err(|_| "State lock error".to_string())?;
  let handle = guard.as_mut().ok_or_else(|| "Process not attached".to_string())?;
  let address = handle.base + OFFSET_RUN_SPEED;
  if !handle.original.contains_key(&address) {
    let original = super::process::read_bytes(handle.handle, address, 4)?;
    handle.original.insert(address, original);
  }
  super::process::write_bytes(handle.handle, address, &value.to_le_bytes())?;
  Ok(())
}

#[tauri::command]
pub(crate) fn reset_run_speed(state: State<'_, ProcessState>) -> Result<(), String> {
  set_run_speed(state, DEFAULT_RUN_SPEED)
}