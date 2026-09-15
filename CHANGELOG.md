# Changelog

All notable changes to ObserverLauncher are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.3.1] — 2026-09-15

### Changed
- **README rewritten end to end.** Moved the focus from marketing to practical
  use: a step-by-step quick start, an expanded Troubleshooting section built
  from real bug reports, a FAQ, a Data & privacy section, Known limitations, a
  Roadmap, and an Architecture overview for contributors. Added three UI
  screenshots.
- **CONTRIBUTING.md updated** to match the v0.2.0+ split structure (it still
  referenced the old `app.js` / `locales.js` / `style.css` files). Documents the
  three-layer main/preload/renderer design, the load-order rules for the
  renderer, the stable-IPC-channel rule, and the shared validators.

### Added
- `docs/` folder with three screenshots (Overview, World Map, Marketplace).

### Removed
- `check-i18n.js` and `.github/workflows/pages.yml` — leftovers from the
  marketing website, which is no longer part of this repository. Only the
  release workflow remains.

## [0.3.0] — 2026-09-09

### Added
- **Force stop** button in the top bar: terminates the server process tree
  immediately, even while starting or stuck stopping. Confirms first
  (unsaved progress may be lost), suppresses auto-restart. New
  `server:force-stop` IPC (`src/main/kill.js` shared kill-tree).
- **World Map upgrades**
  - Click a marker (player / spawn / waypoint) for a popup with exact XYZ,
    dimension and a Copy button; clicking empty map shows that point's coords.
  - Live layer: while the server runs and the tab is open, player positions
    re-read every 15s (camera untouched) and explored chunks re-scan every
    45s. Player dots carry the save-file mtime shown as "saved HH:MM:SS".

### UI — PULSE SYSTEM redesign
- New motion system (`css/08-motion.css` + `css/09-pulse.css`): direction-aware
  tab slide, modal rise, opacity-only list refresh, global `prefers-reduced-motion`
  kill-switch, one-time boot scanline.
- **Pulse Wave**: 8 ticks in the command bar beating on each ~5s server poll
  while running — the launcher's live heartbeat.
- Rail nav: hairline left-tick signature, active halo, softer settings break.
- Console rebuilt as a fixed-viewport terminal: dense rows, timestamps,
  per-level left-border tint, segmented filters, log-line enter animation.
  Long lines now wrap/scroll in place instead of stretching the tab.
- Players roster densified (38px rows, smaller avatar/buttons), hover lifts
  removed app-wide in favour of border/ink feedback.
- Toasts are queued (max 3), bottom-left, styled per success/error.
- Overview hero: name + status pill + plain sentence, problems-only setup
  checklist, single 5-cell stats row.

### Refactor
- Split `marketplace.js` into `marketplace.js` (remote catalog) +
  `modpacks.js` (`.mrpack` import/export).

### Bug fixes
- **Start button dead on launch**: backend initializes before the window opens
  and boot re-syncs if Java/files were missing.
- **RAM/CPU showing 0 / "—"**: PowerShell culture decimal — `Number("45,6712")`
  was NaN. Metrics now run under `InvariantCulture` and a `parseMetricValue`
  normalizes comma decimals (fixes vi-VN / de-DE / pt-BR systems).
- **World Map blank tab**: the load-time `switchTab` capture threw after the
  GUI split; lazy-load moved into `switchTab`, readers never reject.
- `settings:get` / `files:get` never reject; `server:start` always resolves
  `{ok:false}` with a reason instead of rejecting silently.
- Console no longer grows unbounded with long log lines (fixed viewport).
- Force-stop added `server:force-stop` + `tests/force-stop.test.js`,
  `tests/metrics-parse.test.js`, `tests/worldmap-wiring.test.js`.

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
