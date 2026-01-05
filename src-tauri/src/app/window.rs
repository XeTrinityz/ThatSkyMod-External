use tauri::Emitter;
use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::UI::WindowsAndMessaging::{
  CallNextHookEx, GetClassNameW, GetForegroundWindow, GetMessageW, SetWindowsHookExW,
  UnhookWindowsHookEx, MSLLHOOKSTRUCT, MSG, WH_MOUSE_LL, WM_MBUTTONDOWN, WM_XBUTTONDOWN,
};

use super::process::read_wide;
use super::APP_HANDLE;

pub(crate) fn foreground_window_class() -> Option<String> {
  unsafe {
    let hwnd = GetForegroundWindow();
    if hwnd == 0 {
      return None;
    }
    let mut buffer = [0u16; 256];
    let len = GetClassNameW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
    if len <= 0 {
      return None;
    }
    Some(read_wide(&buffer))
  }
}

unsafe extern "system" fn mouse_hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
  if code >= 0 {
    let message = wparam as u32;
    if message == WM_XBUTTONDOWN || message == WM_MBUTTONDOWN {
      let info = &*(lparam as *const MSLLHOOKSTRUCT);
      let mut hotkey = None;
      if message == WM_MBUTTONDOWN {
        hotkey = Some("Mouse3".to_string());
      } else {
        let mouse_data = ((info.mouseData >> 16) & 0xffff) as u16;
        if mouse_data == 1 {
          hotkey = Some("Mouse4".to_string());
        } else if mouse_data == 2 {
          hotkey = Some("Mouse5".to_string());
        }
      }
      if let Some(key) = hotkey {
        if let Some(handle) = APP_HANDLE.get() {
          let _ = handle.emit("mouse-hotkey", key);
        }
      }
    }
  }
  CallNextHookEx(0, code, wparam, lparam)
}

pub(crate) fn spawn_mouse_hook() {
  std::thread::spawn(|| unsafe {
    let hook = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), 0, 0);
    if hook == 0 {
      return;
    }
    let mut msg: MSG = std::mem::zeroed();
    while GetMessageW(&mut msg, 0, 0, 0) != 0 {}
    UnhookWindowsHookEx(hook);
  });
}
