# Changelog

All notable changes to ObserverLauncher are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.7.0] — 2026-09-18

### Added
- **Server scheduler.** Start and stop the server automatically on a daily window: set an
  optional start time, an optional stop time, and the weekdays it applies to (empty = every day).
  Configured in Launcher settings → Schedule, with a plain-language summary of the next run.
  Uses the local system clock; if the computer is asleep at the scheduled time the action is
  skipped. A scheduled stop never interrupts an in-flight backup, and a scheduled start only runs
  when the server is fully stopped (it never fights a transition in progress). The scheduled stop
  is treated as a manual stop, so auto-restart-on-crash does not revive it.
- New `tests/scheduler.test.js` (27 asserts) covering the time-window, weekday and state gates.

### Changed
- **Localization completeness.** ~38 user-facing strings that were still hardcoded English —
  settings validation errors, player op/whitelist/ban toasts, the no-UUID hint, content-import
  and copy feedback, properties/velocity.toml save messages, the install-close guard, the
  player-save confirmation and download-cancelled — now go through `t()` and are translated across
  all 7 locales (i18n now 539 keys). Some remaining English labels inside the create-server wizard
  and player-row buttons are still pending (planned for 0.7.1).

### Fixed
- **The create-server wizard now aborts if saving settings fails**, instead of silently continuing
  to the download step with unsaved/incorrect settings.
- **Orphan `.tmp-*` files** left behind by a crash mid atomic-write are now cleaned up at startup
  (`cleanOrphanTmp`), so they no longer accumulate in the user-data folder.

### Changed — Marketplace redesign
- **The Marketplace tab was rebuilt for clarity and density.** A hero search bar with **Popular**
  quick-pick chips (EssentialsX, LuckPerms, ViaVersion, Spark, WorldEdit, Vault), a segmented
  **Source** control (Modrinth | Hangar | Spigot) replacing the bare dropdown, a single **Sort**
  dropdown instead of three buttons, and an **active-filter chip** row that shows what is
  currently narrowing the results. Results are now a responsive **two-column card grid** (one
  column under 1100px) with icon, title/author, source + kind badges, a clamped description and a
  downloads + Install footer. Import modpack / Export setup moved into the tab header. 9 new i18n
  keys across all 7 locales.

## [0.6.0] — 2026-09-18

### Added
- **CI now runs the test suite on every push and pull request** (`.github/workflows/test.yml`),
  on both Windows and Linux. Failures are caught before merge, and the Linux runner exercises the
  platform-specific code paths. README gained a tests badge.
- **Electron end-to-end (E2E) tests** via Playwright (`tests/e2e/`). They launch the real app
  with a throwaway user-data dir and assert the renderer boots, every tab renders, the language
  switch works, etc. Run locally with `npm run test:e2e`; CI runs them too (xvfb on Linux). Kept
  separate from the unit suite (`npm test`) so neither slows the other down.

### Fixed
- **Page title did not update when changing the language.** `#pageTitle` has no `data-i18n`
  (it is set by `switchTab`), so switching the UI language from Settings left the title in the old
  language until the user clicked another tab. `applyLocale()` now re-derives it from the active
  nav item. (Found by the new E2E test — a real UX bug.)
- **Deleting or importing content while the server is running is now handled gracefully.**
  On Windows a running server keeps plugin/mod jars open, so `fs.unlinkSync` / `fs.copyFileSync`
  could fail with `EBUSY`/`EPERM` — the IPC call rejected and the UI was left with no message.
  The backend now catches the lock and returns a clear error, and the renderer asks for
  confirmation before deleting or importing while the server is up (new content only loads after
  a restart anyway).
- **Session uptime could appear to tick faster than one second.** The clock used a plain
  `setInterval(…, 1000)` (phase-shifted from the real server start) *and* was redrawn directly by
  `refreshUI()` on every state event, so two redraws could land a few hundred ms apart. It now
  schedules the next redraw on the next whole-second boundary of the real uptime, so visible steps
  are always ~1s regardless of when the server started or how often the UI refreshes.

### Changed
- **`server-lifecycle.js` refactor (no behaviour change).** `startServerInternal` (127 lines) was
  split into named helpers: `buildLaunchArgs`, `spawnServerProcess`, `handleAutoRestart`. The main
  function is now ~97 lines and the argument/spawn/auto-restart logic can be reasoned about (and
  tested) on its own.

## [0.5.0] — 2026-09-16

### Added
- **Linux support for the Java auto-installer and .mrpack import/export.** These
  were Windows-only and silently broken on Linux:
  - Java runtime is now fetched for the correct OS (Adoptium `windows`/`linux`/`mac`)
    in the right archive format (`.zip` on Windows, `.tar.gz` elsewhere), and the
    `java` binary is located by the right name (`java.exe` vs `java`).
  - Archive handling is now platform-abstracted (`platform.extractArchive` /
    `createArchive`): PowerShell on Windows, `unzip`/`zip`/`tar` on Linux.
  - Modpack import and export use the same abstraction, so both work on Linux.
- New `tests/java-platform.test.js` covers the platform helpers.

> **Not verified on real Linux hardware.** The Linux paths were fixed from code
> analysis only — no Linux test machine was available. They are covered by unit
> tests for the platform helpers, but the end-to-end Java install and modpack
> import/export on Linux still need a manual check on a real Linux system.
>
> **Spigot's BuildTools needs a JDK, not a JRE.** The one-click "Install Java"
> downloads a JRE (no `javac`), which is enough to *run* a server but not to
> *compile* Spigot. Pick Spigot only if you have a full JDK on the system.

### Security
- **Single-instance lock.** A second copy of the launcher now refuses to start and
  focuses the existing window, instead of racing the first on `settings.json`, the
  server folder, and the running server process.
- **`serverPath` is validated before it becomes the root for file operations.**
  `settings:save` now rejects a path that is not an existing directory, instead of
  trusting the renderer-supplied value verbatim (it drives backups, editor writes,
  player data and content deletion).
- **Player UUIDs are validated.** `player:read`, `player:save`, and the
  whitelist/ban/op toggles now reject anything that is not a plain UUID before it
  is joined into a `<world>/playerdata/<uuid>.dat` path.
- **Unhandled main-process errors are logged** (`uncaughtException` /
  `unhandledRejection`) instead of dying silently.
- New `isSafeUuid` validator + tests (validate.test.js now 47 assertions).
- **Symlink-safe path checks.** `safeTarget` now resolves the real path (not just the string)
  and re-checks it stays inside the root, so a symlink inside the server folder can no longer
  escape it. New `tests/safe-target.test.js`.
- **Input size caps in the main process** (not just the renderer): `properties:save`,
  `properties:raw-save` and `worldmap:waypoints:set` reject oversized payloads.
- **Linux live content refresh fixed.** `fs.watch({recursive:true})` is unsupported on Linux
  (it failed silently), so the content list never refreshed on file changes there. Linux now
  watches the root plus each top-level subfolder manually.
- **Backup uses a stable root snapshot** — changing the server folder mid-backup can no longer
  split one backup across two folders.
- **World Map: jump to coordinates.** A small X Z input next to the toolbar jumps the map to
  typed coordinates (`120 -340`, `120, -340`, or `120 -340 64`). New i18n keys `wm.goto` /
  `wm.gotoPh`.
- **Create-server wizard: cancel a download in progress.** A Cancel button now sits next to the
  download progress and aborts the transfer (AbortController threaded through `download()` in
  http.js → `wizard:cancel` IPC → renderer). Cancelling stops immediately without retry and is
  reported clearly. New i18n key `nsw.cancel`.
- **Create-server wizard: clearer version + Spigot checks.** Picking "specific version" now
  blocks Next when the field is empty or the typed version is definitively not in the live list
  (with a "did you mean" hint) instead of silently falling back to latest. Spigot now checks for a
  full JDK (`javac`) up front, not just a JRE, so the build fails fast with a clear message rather
  than minutes into BuildTools.
- **Removed the dead `wm.cheatNote` string** (the cheat-layer feature it described was dropped
  long ago; the key was unused in the UI).
- **Linux firewall button now copies the ufw command.** Linux cannot open the firewall without
  sudo, so the button relabels to "Copy firewall command" and puts `sudo ufw allow <port>/tcp` on
  the clipboard instead of pretending it can elevate.
- **Linux backup fails clearly when no archiver is installed.** If neither `zip` nor `tar` is on
  the system, the backup returns a clear message instead of a cryptic spawn error.

### Security
- **Modpack download URLs are now validated.** A `.mrpack` file is untrusted
  input, and its `downloads` URLs were fetched verbatim — a crafted pack could
  point at `file://` (local file read) or a private/loopback host (SSRF to the
  user's router or cloud metadata endpoint). `isSafeDownloadUrl()` now allows
  only http(s) to a public host and rejects `file:`, localhost, `::1`, `.local`,
  and IPv4 private/loopback/link-local/CGNAT ranges. Unsafe entries are skipped.
- **Renderer is now sandboxed** (`sandbox: true`), on top of the existing
  `contextIsolation` + `nodeIntegration: false`.
- **Navigation and popups are blocked.** The window refuses `window.open()` and
  any navigation away from the local `file://` UI, so a stray link or injected
  markup cannot replace the app with a remote page.
- New `tests/download-url.test.js` covers the URL allowlist.

### Changed
- **Split the largest modules for maintainability** (no behaviour change):
  - `renderer/js/08-shell.js` (622 lines) → kept as the app shell (nav, boot, live
    status) plus three focused files loaded after it: `10-properties.js`
    (server-properties tab), `11-market.js` (marketplace tab), `12-wizard.js`
    (new-server wizard).
  - `renderer/js/01-content.js` → kept the content list; the in-place file editor
    moved to `01b-editor.js` (loads between 01 and 02, since 02 calls `openEd`).
  - `main/server-lifecycle.js` → metrics sampling moved to `server-metrics.js` and
    auto-poll to `server-poll.js`; both are re-exported so existing callers and
    tests keep working.
  - The console and onboarding blocks stay in `08-shell.js` on purpose — the boot
    sequence calls them during script evaluation, so they cannot load later.
- **Fixed a boot error from the split:** `javaMajorOf` was briefly moved into the
  wizard file, but the Overview calls it during boot before that file loads. It now
  lives in `00-core.js`, which loads first.

## [0.4.0] — 2026-09-15

### Added
- **Spawn-area biomes load immediately.** At the default zoom the viewport spans far too many
  chunks to fetch, so the spawn area used to sit on the seed wash until you zoomed in. A bounded
  prefetch around spawn now fills in real biomes as soon as the map opens.
- **Reload / dimension switch no longer keep stale map data.** Reloading clears cached biomes and
  the explored-chunk mask now resets before the new dimension loads (no brief flash of the old one).
- **Checked chunks are shaded distinctly.** Chunks the launcher has read but that carry no biome
  data now render as a neutral slate instead of being indistinguishable from not-yet-loaded areas.
- **Explored-chunk scan now ignores unfinished (proto) chunks.** For worlds under 3000 chunks the
  scanner reads each chunk's `Status` and keeps only finished (`minecraft:full`) ones, so a chunk
  left half-generated by a crash no longer shows as explored. Larger worlds keep the fast
  header-only scan to avoid blocking the main process.
- **Real biome preview on the World Map.** The terrain layer now reads the
  actual biome data from your world's region files (1.18+ paletted biome
  containers) instead of the seed-based approximation. Each visible chunk is
  coloured by its real surface biome, fetched lazily for the current viewport
  and cached per region. The toggle is now labelled **Biomes**.
  - New `worldmap:biomes` IPC + `worldmapBiomes` bridge; `readBiomes()` in
    `src/main/worldmap.js` decodes the bit-packed biome palette, so only the
    chunks in view are parsed (measured ~0.7 ms/chunk on a real 26.x world).
  - Cells without loaded data still fall back to the seed wash, and the
    chunk-explored mask is unchanged.
- Two new i18n keys, `wm.loadingBiomes` and `wm.zoomInBiomes`, added to all 7
  languages for the biome loading / zoom-in hints.

### Changed
- **World Map markers are now easy to tell apart.** Spawn was previously an
  identical dot to players; it is now a 5-point star, players are filled rings
  with a dark core, and every marker has a contrast halo + stroked label.
- **World Map performance + clarity pass.**
  - Biome data is no longer fetched when the viewport is too wide (far zoom-out or a
    huge window): below a zoom threshold or above ~1600 visible chunks the map keeps
    the seed wash instead of parsing thousands of chunks, so panning can no longer
    tie up the main process. The backend per-request cap was lowered to match.
  - The map now shows a small **"Loading biomes…"** hint while a fetch is in flight
    and a **"Zoom in to see detailed biomes"** hint when the view is too wide — both
    translated across all 7 languages.
  - Marker text labels hide below a zoom threshold (no more overlapping smear when
    zoomed out) and flip to the left of the marker so they never run off the canvas.
- Localised label updates for the Biomes toggle across all 7 languages.

### Changed — Player inspector redesign
- **The player inspector is now a two-column layout** (stats + equipment on the
  left, inventory + ender chest on the right) that collapses to one column on
  narrow windows. The modal is much wider (up to 1120px / 96vw) so item names
  and ids have room to breathe instead of being truncated.
- **No more overlapping / colliding text.** The header, stat fields, section
  heads and item rows were all reworked so every flexible element can shrink
  (`min-width:0`) and long values ellipsize or wrap instead of pushing siblings
  into each other. The stat grid now auto-fits its columns, the UUID wraps
  cleanly, and the item-name column can no longer shove the count or id.
- Equipment and inventory stay as lists (per the requested design). Item rows
  now show just the slot + item name (and count for stacks); the long
  `minecraft:...` id is gone from the row (it was truncated anyway) and lives in
  the hover tooltip instead, freeing the room the name needed.

### Changed — Content file browser
- **The editor's file browser is now a collapsible folder tree** instead of one
  flat list of every editable file (a real server folder can have 500+). Folders
  show a caret and a file count; click to expand/collapse. Search still shows a
  flat, full-path list so a known filename is one glance away.

### Changed — Launcher settings tab
- **The Settings tab is now a single vertical column** instead of a staggered
  two-column grid, so the sections read top-to-bottom in a logical order with no
  gaps. Each section is numbered (01, 02, …) for a clear reading order, and the
  section subtitles are de-emphasised so the numbered title leads the eye.
- **The header (with its Apply button) is pinned** while the settings list
  scrolls, so the Apply action is always reachable.
- **The "Launcher settings" rail button** is now a normal navigation item in the
  same group as the other tabs (the dashed, pill-shaped special-case styling is
  gone).

### Fixed
- **Player inspector showed no armor or off-hand item on 1.21.5+ / 26.x
  servers.** Minecraft 1.21.5 moved a player's worn armor and off-hand item out
  of `Inventory` into a top-level `equipment` compound, and item stacks switched
  from `Count` to lowercase `count`. `readPlayerData` now reads both layouts and
  normalizes the count key; the existing legacy slot scan is kept as a fallback.
- **Player inventory item counts showed `×undefined`** on modern servers — same
  `Count`/`count` change, now normalized everywhere a stack is read.
- **"Clear inventory, armor and off-hand" left armor and off-hand behind** on
  modern servers. The player-save handler now also clears the `equipment`
  compound when it exists.
- **Blurry, dim text while scrolling.** The boot `pulseScan` animation ended on
  `filter:blur(0) saturate(1)` with `fill-mode:both`, which permanently promoted
  the whole app shell to its own GPU compositing layer and disabled subpixel
  text antialiasing. It now ends on `filter:none`.
- **Players tab search box did nothing.** `03-players.js` called `debounce()` at
  load time, but that helper is defined later in `08-shell.js`, so it threw a
  `ReferenceError` before the listener was attached. Replaced with a self-
  contained debounce.
- **World Map console error when the tab opened before the world loaded.**
  `wmVisible()`/`wmDraw()` could run with `wm.level === null` (ResizeObserver
  firing early); both now guard against it.
- **Google Fonts were blocked by the Content Security Policy**, so the UI ran on
  fallback system fonts. `style-src` now allows `fonts.googleapis.com` and
  `font-src` allows `fonts.gstatic.com`.
- **Corrupted `en.js` locale file.** It contained five duplicate blocks of the
  `wm.*` keys (Russian/German/Spanish/Vietnamese/English) stacked on top of each
  other; only the last (English) one took effect, so the UI looked fine but the
  file was a mess. Reduced to the single English block.

### Fixed — auto-update
- **Update failures were silent.** The auto-updater had no `error` handler and its IPC calls
  returned bare promises, so an offline check, a 404 asset or a bad signature left the button
  stuck on "Checking…" with no message. Errors are now surfaced to the UI (`app:update-error` +
  `onUpdateError`), every update IPC resolves `{ok:false}` instead of rejecting, and the buttons
  are wrapped so a failure always shows a reason and resets. Checking in a dev build now says so
  instead of erroring.
- **Installing an update while the server runs now warns first.** The install button asks for
  confirmation when a server is running, since installing restarts the launcher and stops it.
- New i18n keys `upd.error` and `upd.confirmRunning` added to all 7 languages.

### Fixed — downloads
- **Downloads no longer die on a brief network hiccup.** The old download used a
  single request with a hard 5-minute total timeout: a slow-but-healthy 80 MB jar
  could be aborted because the wall clock ran out, and one dropped packet killed
  the whole transfer with no retry. The timeout is now **stall-based** (it only
  fires after 30 s with no bytes received), a failed attempt is **retried** up to
  4 times with backoff, and — when the server supports it — the transfer
  **resumes** from the bytes already on disk via an HTTP `Range` request instead
  of starting over. Partial data is kept in a `.part` file between attempts.
- **A failed Java install can no longer wipe a working Java.** The auto-installer
  used to delete the existing runtime folder *before* extracting; a bad extract
  then left the user with no Java at all. It now extracts into a staging folder
  and only swaps it in after `java.exe` is confirmed present.

### Tests
- New `tests/player-equipment.test.js` covers both the modern `equipment`
  layout and the legacy Inventory-slot layout.
- New `tests/download-resume.test.js` covers clean download, resume after a
  mid-stream drop (Range-capable server) and restart after a drop
  (non-Range server).

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
