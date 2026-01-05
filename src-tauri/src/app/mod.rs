use std::sync::{Mutex, OnceLock};

use tauri::AppHandle;

mod commands;
mod constants;
mod process;
mod settings;
mod state;
mod window;

pub(super) static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn run() {
  tauri::Builder::default()
    .manage(state::ProcessState {
      inner: Mutex::new(None),
    })
    .setup(|app| {
      let _ = APP_HANDLE.set(app.handle().clone());
      window::spawn_mouse_hook();
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .plugin(tauri_plugin_global_shortcut::Builder::new().build())
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![
      commands::apply_patch,
      commands::apply_nop,
      commands::apply_float,
      commands::attach_process,
      commands::detach_process,
      commands::status,
      commands::set_invincibility,
      commands::set_run_speed,
      commands::reset_run_speed,
      settings::load_settings,
      settings::save_settings,
      commands::get_foreground_window_class,
      commands::get_offsets,
      commands::close_game,
      commands::launch_game
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
