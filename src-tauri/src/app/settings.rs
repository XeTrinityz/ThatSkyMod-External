use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use super::state::AppSettings;

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
  let mut path = app
    .path()
    .app_config_dir()
    .map_err(|_| "Failed to resolve app config directory".to_string())?;
  path.push("settings.json");
  Ok(path)
}

fn migrate_legacy_settings(target: &PathBuf) {
  if target.exists() {
    return;
  }
  let legacy = std::env::var("APPDATA")
    .map(PathBuf::from)
    .ok()
    .map(|dir| dir.join("com.xetrinityz.thatskymodext").join("settings.json"));
  let Some(legacy_path) = legacy else {
    return;
  };
  if !legacy_path.exists() {
    return;
  }
  if let Some(parent) = target.parent() {
    let _ = fs::create_dir_all(parent);
  }
  let _ = fs::copy(legacy_path, target);
}

#[tauri::command]
pub(crate) fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
  let path = settings_path(&app)?;
  migrate_legacy_settings(&path);
  if !path.exists() {
    return Ok(AppSettings::default());
  }
  let contents =
    fs::read_to_string(&path).map_err(|_| "Failed to read settings file".to_string())?;
  let settings: AppSettings =
    serde_json::from_str(&contents).map_err(|_| "Failed to parse settings file".to_string())?;
  Ok(settings)
}

#[tauri::command]
pub(crate) fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
  let path = settings_path(&app)?;
  let payload =
    serde_json::to_string_pretty(&settings).map_err(|_| "Failed to encode settings".to_string())?;
  fs::write(path, payload).map_err(|_| "Failed to write settings file".to_string())?;
  Ok(())
}
