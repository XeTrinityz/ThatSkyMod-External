use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

pub(crate) struct ProcessHandle {
  pub(crate) handle: isize,
  pub(crate) pid: u32,
  pub(crate) base: usize,
  pub(crate) original: HashMap<usize, Vec<u8>>,
}

impl Drop for ProcessHandle {
  fn drop(&mut self) {
    unsafe {
      windows_sys::Win32::Foundation::CloseHandle(self.handle);
    }
  }
}

pub(crate) struct ProcessState {
  pub(crate) inner: Mutex<Option<ProcessHandle>>,
}

#[derive(Serialize)]
pub(crate) struct AttachResponse {
  pub(crate) pid: u32,
  pub(crate) base: usize,
}

#[derive(Serialize)]
pub(crate) struct StatusResponse {
  pub(crate) attached: bool,
  pub(crate) pid: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ForegroundWindow {
  pub(crate) class_name: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct AppSettings {
  pub(crate) theme: String,
  pub(crate) always_on_top: bool,
  pub(crate) reduce_motion: bool,
  pub(crate) non_activate_window: bool,
  pub(crate) app_scale: f32,
  pub(crate) memory_saver: bool,
  pub(crate) feature_hotkeys: HashMap<String, String>,
}

impl Default for AppSettings {
  fn default() -> Self {
    Self {
      theme: "aqua".to_string(),
      always_on_top: false,
      reduce_motion: false,
      non_activate_window: false,
      app_scale: 1.0,
      memory_saver: false,
      feature_hotkeys: HashMap::new(),
    }
  }
}
