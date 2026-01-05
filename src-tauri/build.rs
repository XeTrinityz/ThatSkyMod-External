fn main() {
  let mut attributes = tauri_build::Attributes::new();
  let profile = std::env::var("PROFILE").unwrap_or_default();

  if profile != "debug" {
    let windows = tauri_build::WindowsAttributes::new()
      .app_manifest(include_str!("windows-app-manifest.xml"));
    attributes = attributes.windows_attributes(windows);
  }

  tauri_build::try_build(attributes).expect("failed to run build script")
}
