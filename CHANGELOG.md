# Changelog

All notable changes to ObserverLauncher are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.2.0] — 2026-09-09

### Refactor
- Split the 1088-line `src/main.js` into a thin wiring file plus 10 focused
  modules (`context`, `server-lifecycle`, `backups`, `players`, `marketplace`,
  `wizard`, `settings-handlers`, `content-handlers`, `app-lifecycle`, `kill`,
  `validate`). All 45 IPC channels unchanged.
- Split the renderer monoliths: `app.js` (1704 lines) → `renderer/js/` (9 files
  by tab), `style.css` (1114 lines) → `renderer/css/` (8 files),
  `locales.js` (175 KB) → `renderer/locales/` (one file per language).

### Security
- Validate the firewall port inside `platform/win32.js` and `platform/linux.js`
  (defense in depth against command injection into the elevated PowerShell).
- Validate player names (`/^[A-Za-z0-9_]{3,16}$/`), ban reasons and console
  commands (single-line only) in backend and renderer — blocks stdin command
  injection such as `kick Notch\nstop`.
- Backup restore/delete now require a plain `.zip` basename inside
  `observerlauncher-backups` (no more `../world/x.zip` escapes).
- Linux restore pre-lists archives and refuses entries with absolute paths or
  `..` segments (zip-slip); world names are validated and passed after `--`
  so `-prefixed` names can't become CLI flags.

### Bug fixes
- Fixed Start button dead on launch: backend now initializes (server path +
  Java detection) before the window opens, so the first `settings:get`
  snapshot is already correct; boot also re-syncs once if Java/files are
  missing. Added `tests/boot-state.test.js`.
- `settings:get` / `files:get` never reject anymore (safe empty snapshot).
- `server:start` always resolves `{ok:false}` with a reason instead of
  rejecting silently; Start/Stop buttons toast every IPC failure.

### Features
- New **Force stop** button (top bar): terminates the server process tree
  immediately, even while starting or stuck stopping. Confirms first
  (unsaved progress may be lost), suppresses auto-restart. New
  `server:force-stop` IPC plus `tests/force-stop.test.js`.

### UI
- New motion system (`css/08-motion.css`): direction-aware tab slide,
  modal rise, opacity-only list refresh, global `prefers-reduced-motion`
  kill-switch.
- Overview hero redesigned: identity (name + status pill + plain sentence),
  problems-only setup checklist, one-line meta visible while running, and a
  single 5-cell stats row (players · TPS · CPU · RAM · allocate RAM).

## [0.1.0] — initial experimental release
