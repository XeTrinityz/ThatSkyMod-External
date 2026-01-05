# That Sky Mod External

External companion app for That Sky Mod (Sky: Children of the Light), built with Tauri + React. It attaches to `Sky.exe` and provides a clean desktop UI for toggles, emotes, spells, and session details.

## Features
- Attach/detach from `Sky.exe` and show session/auth details
- Player, movement, and camera helpers (godmode, infinite energy, super jump, free zoom, and more)
- Emotes and spells browser with search, icons, and quick actions
- Global hotkeys, theme presets, always-on-top, scaling, reduce motion, and memory saver
- Multi-tab UI: Overview, Player, Settings

## Tech Stack
- Tauri v2 + Rust backend
- React + TypeScript + Vite

## Getting Started
```bash
npm install
npm run tauri:dev
```

## Build
```bash
npm run tauri:build
```

## Scripts
- `npm run tauri:dev` - Tauri dev app
- `npm run tauri:build` - Tauri production build

## Project Structure
- `src/` - React UI
- `src-tauri/` - Rust backend and Tauri config
- `public/` - Static assets
- `dist/` - Frontend build output

## Notes
- Windows-first: expects `Sky.exe` to be running when attaching.
- Not affiliated with or endorsed by thatgamecompany.

---
This project is not affiliated with thatgamecompany (TGC) or Sky: Children of the Light.