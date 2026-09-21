# Changelog

All notable changes to ObserverLauncher are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.3.0] — 2026-09-21

A polish + personality release. No new server features — the goal was to make the interface feel
like a live instrument (motion, console, sparklines) while staying calm and beginner-friendly.

### Added — Console (the tab people live in)
- **Log search box** — client-side substring filter over every rendered line, debounced, with a
  clear button. Works together with the existing level chips.
- **Per-line level badges** (CMD / INF / WRN / ERR) so severity scans down the column at a glance.
- **Auto-scroll toggle** — pin to the newest line or read history without being yanked down;
  scrolling away by hand turns it off automatically.

### Added — Signature motion, ambience & personality ("the launcher comes alive")
- **Signal Field** — a CSS-only ambient background layer that breathes with the poll cycle and
  shifts mood with server state (offline = cold/still, running = warm/lively, starting = building).
  No canvas, no per-frame JS — GPU transforms only, so it stays cheap.
- **State choreography** — `<html>` carries `is-offline`/`is-starting`/`is-running`; the status pill,
  hero, workspace and ambient field all warm up / cool down together.
- **Boot sequence (reworked)** — a real startup screen: brand mark + a progress bar that tracks
  the ACTUAL boot milestones (backend state → market versions → ready), not a fixed timer. The bar
  eases toward each milestone AND slowly creeps forward between them, so it never looks frozen
  while a network call is in flight; it only reaches 100% when boot truly finishes. A slow scan
  line + core glow give it life. Click/key to skip, a 4s safety timeout guarantees it never hangs,
  `pointer-events:none` so it never blocks clicks, removed under reduced motion / Lite.
- **Auto-backup redesigned** (Settings > Reliability). The interval chips and the retention row
  were a loose stack that wrapped badly. Now each control is its own labelled row (INTERVAL /
  KEEP) with a fixed label column, aligned number boxes and a clear hint — easier to read and use.
- **Cursor proximity** — rail items brighten as the pointer nears them (`--prox`, rAF-throttled),
  plus a breathing glow on the active item.
- **Corner-bracket focus** — a consistent signature focus ring across interactive elements.
- **Console stream sweep** — a new log line carries a brief left→right highlight (gated to small
  batches so a startup flood does not strobe); colour follows the line level.
- **Needle-settle numbers** — small value changes overshoot ~4% and settle, like a gauge.
- **Marketplace: dependencies + source links.** The install modal (Modrinth only) now shows a
  **DEPENDENCIES** section: each required dep with a name, an *installed* tick (matched against
  plugins/mods on disk), and a red *incompatible* flag. One button installs every missing required
  dependency in sequence (with confirm + progress). Optional deps are listed but never auto-installed.
  Also adds **Open project page** / **View source** buttons — opened in the system browser through an
  allowlisted `market:open-external` IPC (https to modrinth/hangar/spigot/github/gitlab/bitbucket/
  curseforge only; file:// and arbitrary hosts are rejected). The install modal's sections now rise
  in a short cascade on open.
- **Interface animation setting** (Settings > Preferences, default **Full**) — a *Lite* option that
  turns off the ambience, boot sequence, cursor proximity/spotlight and list stagger for weaker
  PCs. Full stays the default; Lite is opt-in and persists.
- **Content / world lists now actually animate.** The first stagger pass targeted
  `.content-row`/`.world-row` classes that never existed — content rows are `<li data-name>` and
  worlds are `.worlds-list li`, so those lists were static. Selectors corrected.

### Added — Signature motion (first pass)
- **Motion foundation**: tokenised durations/eases (`--dur-micro/fast/tab/modal/slow`,
  `--ease-emphasized`, `--stagger`) plus `docs/motion.md` — a one-page contract for every future
  animation.
- **Value tweening** (`tweenNumber` in `00-core.js`): live readouts (CPU %, players) count toward
  their new value instead of snapping.
- **List stagger reveal**: dense rows rise in a short cascade when a tab opens (capped at 7 rows).
- **Modal** uses the emphasized ease for a hair of settle; press feedback unified across all buttons.
- **Sparkline** in the Overview Server-stats panel: a tiny live TPS · CPU trace.
- **Micro-interactions**: magnetic primary button (≤3px cursor pull) and a cursor spotlight on tab
  headers. Both are pointer-only and fully disabled under `prefers-reduced-motion`.

### Notes
- `npm test` (27 files) and the E2E suite remain green. i18n is 761 keys × 7 locales.
- New `docs/motion.md`. Reduced-motion guards added for every new pattern.
- Not eyeballed in the running app by the developer (no screen capture) — verify visually on your
  machine; Electron does not hot-reload.

## [1.2.0] — 2026-09-20

A hardening **and** World Map detail release. No new user-facing features — the focus was a deep
backend security/robustness audit plus real per-cell biomes on the map.

### Security
- **Fixed a zip-slip vulnerability on Linux** (`platform/linux.js::extractArchive`). The archive
  extraction used by modpack import (`.mrpack`) and the Java installer did not pre-check entry
  paths, so a crafted archive could write files outside the destination folder. It now lists the
  entries and refuses the whole archive on the first unsafe path — the same guard `restoreBackup`
  already used. (Windows was unaffected: `Expand-Archive` blocks this itself.)
- **Closed a path-parity gap in the MCP `export_modpack` tool.** It joined a hand-editable
  manifest's `fileName` straight into a path, unlike the IPC `modpack:export` path which was
  hardened in 1.0.0. Both now require a plain basename and resolve through `safeTarget`.

### Fixed
- **Player `.dat` edits are now atomic** (`players.js::savePlayer`). A crash mid-write could
  truncate a player file; it now goes through `writeFileAtomic` (a backup is still taken first).
- **Memory settings are validated on save** (`settings:save`). `memoryMin`/`memoryMax` are clamped
  to a 1–64 GB integer range with `max >= min`, matching what the MCP `set_setting` path already
  enforced — a bad value can no longer produce an invalid `-Xms`/`-Xmx` flag.
- **`content:import` guards a null destination** before `mkdirSync`, so a malformed `level-name`
  can no longer throw and reject the IPC.
- **MCP tool cleanup.** Removed dead, wrong-signature `get_player_data` helper code;
  `send_console_command` now caps input at 2000 characters; `kick_player` reuses the shared
  `isSafePlayerName` validator instead of an inline regex.

### Added
- **World Map: real per-cell biomes (4×4 per chunk).** The backend used to collapse each chunk's
  paletted biome container to a single surface biome, so coastlines and biome edges rendered as
  one flat colour. `readBiomes` now also returns a 4×4 grid of per-column biomes
  (`biomeGridFromSection`), and the renderer paints each cell with its own biome colour — so
  chunk-internal biome boundaries (ocean meeting plains, forest edges) show up when zoomed in.
  Falls back to the single whole-chunk biome when a grid is unavailable. No extra disk I/O.

### Added — MCP "Server Doctor" (turn an AI client into a real server manager)
- **New diagnostics tools (read-only).** `diagnose_server` (full health check: folder, jar, Java
  version/arch, EULA, port, world, backups, recent crash — each with a level and a concrete fix),
  `analyze_console` (groups console errors/warnings — OOM, port-busy, exceptions, lag — by
  signature and ranks them), `explain_crash` (summarises the newest crash-report),
  `check_performance` (TPS/MSPT thresholds), `validate_config` (server.properties checks),
  `check_port` (bind test), `read_many_files` (batch up to 5), and `doctor_report` (one-shot
  combined report).
- **Composite safe workflows (write, GUI-confirmed).** `prepare_and_start` refuses on hard errors,
  takes a safety backup, then starts; `safe_restart` backs up, gracefully stops (waits up to 30s),
  then starts again.
- **`read_audit_log`** — every write/destroy MCP call is appended to `userData/mcp-audit.log`
  (capped ~256 KB) so the user and the AI can see exactly what changed.
- **Resources.** The MCP server now advertises `observer://server/{status,properties,console,diagnosis}`
  so a client can pull state as context without spending a tool call.

### Changed — MCP protocol & safety
- **`initialize` now returns `instructions`** telling the client what it can read freely, that
  write/destroy need approval, and the doctor workflow to follow.
- **Tool results carry `structuredContent`** (machine-readable) alongside the text blob.
- **Read-only mode** (`mcpReadOnly`): when on, write/destroy tools are refused before any dialog,
  so an AI can explore with zero risk. Settable via `set_setting`.
- **Per-tool rate limit** (60/min) in the MCP HTTP server so a runaway client loop cannot hammer
  the main process.

### Notes
- `npm test` (27 files — new `tests/mcp-doctor.test.js`, 31 asserts) and the E2E suite remain green.
  New tests cover the 4×4 biome grid and the doctor's pure analysis helpers.
- Still not verified on real Linux hardware (no machine/tester available) — the Linux fixes are
  logic- and unit-verified only.
- MCP tool count grew from 44 to 55 (doctor + composites + audit log).
- Post-review fixes: `safe_restart` moved to the **destroy** tier (it stops a running server, so it
  always confirms); `install_from_market` gained a `source` param and now installs from Modrinth,
  **Hangar and Spigot** (shares the GUI's resolver); the offline `STATIC_TOOLS` list in `bridge.js`
  is complete again and a regression test now fails if it drifts from the live registry;
  `read_many_files` uses the editor's rails (binary sniff) instead of reading any file as text.

## [1.1.1] — 2026-09-20

A small follow-up to 1.1.0: documentation brought in line with the new interface, and a fresh
set of screenshots.

### Changed
- **README and CONTRIBUTING updated to match the 1.1.0 UI** — the Overview description, the
  Allocate-RAM location, the World Map wording and the MCP settings path (now under **Advanced**)
  were stale. The module lists in both docs now include the modules they were missing
  (`tunnel.js`, `scheduler.js`), and the i18n note reflects that all 7 locales are complete.
- **Screenshots replaced** to show the current interface.

### Notes
- No code changes — documentation only. `npm test` (26 files) and the E2E suite remain green.

## [1.1.0] — 2026-09-20

A stability **and usability** release. No new features — the goal was to make 1.0.0 rock-solid
(fewer freezes, clearer errors, safer defaults, a self-maintaining backup folder) **and** to make
the interface far calmer for a first-time user. Guided by a hardening pass against a comparable
project (CalaKuad1/Minecraft-Local-Server-GUI).

### Changed — UI/UX overhaul (beginner-first, less clutter)
- **Sidebar regrouped.** The ten flat nav items are now three labelled clusters — **Server**
  (Overview/Console/Players/Performance), **Content & world**, **Configuration** — so the eye
  scans a few groups instead of a wall of buttons.
- **Overview decluttered.** The hero is now just the server name, status and Choose/Create. A
  fresh install (no folder chosen yet) shows only that. The five stat tiles moved into their own
  **Server stats** panel, split into a read-only **Stats** half (players/TPS/CPU/RAM) and a
  separate bordered **ALLOCATE RAM** box. The redundant in-page performance chart was removed
  (the Performance tab already covers it), and the Playit tunnel box is now a collapsed row.
- **No more radio jargon.** Removed the decorative "CH.01/CH.02" badges, the meaningless (and
  wrong) "01/08" tab counter, the duplicated all-caps kickers above every tab title, and
  overlapping decorative labels — the UI now says what it does in plain words.
- **Launcher settings split into Basic / Advanced.** A segmented switch keeps everyday settings
  (server folder, Java, preferences, reliability) on **Basic**; power controls (tunnel path,
  schedule, updates, MCP/AI, JVM arguments) live on **Advanced**. Sections are grouped
  (Setup / Personal / Automation) and the internet-tunnel settings moved out from under Java
  runtime, where they never belonged.
- **World Map warning rewritten for non-technical users** — it no longer talks about "CPU" or
  "TPS"; it just says drawing the map is heavy, the app may feel slow, and to pan in small steps.
- Copy across all 7 locales updated to match (now 756 keys).

### Fixed
- **The app no longer freezes every 15 seconds while the tunnel is polled.** The tunnel status
  check ran the Playit agent with a *blocking* `spawnSync` (up to an 8s timeout) on a 15s timer —
  which stalled the entire Electron main process (every IPC call, file watcher and repaint waited
  on it) whenever the agent was slow or its service pipe was stuck. It now runs asynchronously with
  a hard kill-timeout, and overlapping polls are coalesced. The UI stays responsive even if the
  Playit service hangs.
- **Java errors are now readable.** When Java was missing or the path was wrong, the Settings UI
  showed the raw `spawn java ENOENT` / `EACCES` message. These are now mapped to plain, actionable
  text that names the cause and the fix (e.g. "No Java found at … — install Java or point the path
  at a real java executable.").
- **Removed a console log that spammed every 15 seconds** while the Playit agent was not installed.

### Added
- **Automatic backup rotation.** Auto-backups used to accumulate forever and could slowly fill the
  disk. A new **"Keep auto-backups"** field (Launcher settings → Reliability, default 10) keeps the
  newest N automatic snapshots and deletes older ones. **Manual backups are never touched** — only
  snapshots the app created on a schedule are pruned, so a backup you made on purpose is always
  safe. (Settings migration v2 → v3 adds the field automatically.)
- **Extra hardening on the local MCP server.** Requests carrying a browser `Origin` header, or a
  `Host` that is not a loopback address, are now rejected before authentication — defence in depth
  against localhost CSRF / DNS-rebinding. The real Node client never sends either, so nothing
  changes for legitimate use.

### Fixed (UI)
- **The Basic/Advanced switch in Settings now highlights on first open.** The Settings tab is
  hidden at startup, so the sliding pill measured 0px and only appeared after a click. It now
  re-measures as soon as the tab becomes visible.
- **Auto-backup settings no longer look cramped.** Reliability was a 2-column grid that squeezed
  the backup controls; it is now a single full-width column with a clean separator.

### Notes
- No IPC channels, element IDs or metric logic were changed — only layout, copy and the two small
  measurement fixes above. Existing settings keep working (auto-migrated). All 26 unit-test files
  and the 4 Playwright E2E tests pass.
- Verified by unit/integration tests and on-screen checks; the backup rotation and the asynchronous
  tunnel refresh have not yet been exercised against a live Playit agent / real large world on this
  machine.

## [1.0.0] — 2026-09-20

First stable release. This milestone is deliberately about **polish and automation**, not new
surface area — the feature set from 0.9.0 is now rounded off, hardened and made hands-off.

### Added — Real terrain on the World Map
- **The World Map now draws real terrain relief, not a seed-noise guess.** Each chunk's own
  `Heightmaps` (already parsed for biomes — no extra disk read) is unpacked and downsampled to a
  4×4 grid per chunk, so hills and ridges shade the biome colour and water reads as water. The
  seed-based wash is now only a placeholder for chunks that have not loaded yet.
- Detail kicks in when zoomed in (chunk ≥ 24px); farther out it stays one flat cell per chunk for
  speed. New pure helpers `unpackHeightmap` / `downsampleHeights` are unit-tested.
- **Performance: colours are cached per chunk.** Terrain colours depend only on a chunk's own data
  (biome + heightmap), not the camera, so they are computed once per chunk and reused while panning
  and zooming — the biggest source of map stutter is gone. The per-chunk cache is cleared when the
  world or dimension changes.
- **Known limitation, shown in the tab.** A short notice on the World Map explains that panning,
  zooming and biome loading are CPU-heavy and can briefly lower a running server's TPS — so users
  know to pan in small steps and close the tab when done.

### Changed — Performance tab rework
- **The Performance tab is now glanceable for first-time users.** The four KPI cards show
  only a label, one big number, a status badge and a quiet bar — the per-card explainer
  lines ("Target 20.00 • higher is better", "Server's Java process", …) are gone; the
  explanations live behind the `?` tooltips. Chart headers are down to "Tick" and
  "CPU & RAM" with dot-only legends (no more "38 samples • 1s interval" or launcher-RAM
  footnotes), and empty states say one line with a Start action.
- **One offline banner instead of four empty widgets.** While the server is stopped a
  single strip ("Server is off — start it to see live numbers.") with a Start button
  explains the dashes; the numbers dim so `—` reads as resting, not broken. The banner
  reuses the main Start button, so there is still exactly one start path.
- **Diagnostics collapsed into "Details & tools".** The capability panel (full vs partial
  telemetry, Players / Get Spark actions) now sits inside a closed-by-default disclosure
  instead of a full paragraph + checklist + buttons competing with the numbers.
- Copy shortened across all 7 locales; no IPC, metric or chart logic changed (all element
  IDs preserved).

### Added — Auto-tunnel
- **The tunnel can now start and stop with the server.** A new **"Keep it on automatically"**
  toggle — right inside the Overview tunnel box, and mirrored in Launcher settings — starts the
  Playit service whenever the server runs and stops it when the server stops. No more remembering
  to press "Set up Playit" each session: turn the server on and your public address is live.
- **Safety first.** The app only stops a Playit service it started itself — never one you run for
  other purposes. Auto-tunnel does nothing unless you enable it, and only acts while the server is
  actually running.

### Changed — Player inspector rebuild
- **Player inspector rebuilt into 3 tabs.** Reading, live admin and risky file edits no longer sit
  side by side. **Overview** is read-only (stats, equipment, inventory, ender chest). **Live
  actions** run as server commands and work **while the server is running** (gamemode, XP, give
  item, heal, feed, clear inventory, kick) — the player must be online. **Saved data (edit)** is the
  old `.dat` editor, disabled while the server runs (with a hint to use Live actions instead).
  Destructive live actions confirm first.
- **Your public address is remembered.** The address you paste is now saved in settings (not just
  the browser session), so it is shown again every time you open the app.
- **Easier for first-timers.** The tunnel controls and the 4-step guide live in the Overview card
  where you actually share the server, instead of being buried in Launcher settings.
- **Less cluttered Overview.** The long port-forwarding note and the firewall button now sit behind
  an **Advanced** disclosure, and the tunnel's step-by-step guide sits behind a **How?** toggle — so
  the panel reads cleanly at a glance while everything is still one click away. The performance
  chart shows a plain "start the server" placeholder when the server is stopped instead of an empty
  plot.

### Fixed
- **Modpack export validated manifest paths.** A hand-edited `observerlauncher-manifest.json`
  entry could point outside the plugins/mods folder; export now accepts a plain basename only and
  resolves it through the same path-safety check the rest of the app uses.
- **Tunnel status pill could stay stuck on "OFF".** The pill element carried a `data-i18n`
  attribute, so the locale refresh overwrote the live status text back to "OFF". The element is now
  owned by the status updater only.

---

## [0.9.0] — 2026-09-19

Play your server over the internet without port forwarding, plus a round of polish: the
i18n debt is closed, MCP marketplace search reaches full source parity, the metrics sampler
is hardened, and the console can be exported.

> **Direction from 0.9.0 onward: stability over new features.** The feature set is now broad
> enough. Future releases (0.9.x and 1.0) will **prioritise polish, hardening and bug fixes** to
> keep the app stable and predictable, rather than adding new capabilities. New features are
> considered only when they remove a real, recurring pain point — not for their own sake.

### Added — Public tunnel (Playit.gg)
- **Share your server to the internet without port forwarding.** A new panel on the Overview
  "How friends can join" card starts the [Playit.gg](https://playit.gg) agent, which gives your
  server a public address (`name.playit.gg`) anyone can join — no router configuration. First run
  shows the claim link to link the machine to your Playit account; the address is fixed, unlike
  free rotating tunnels.
- **Safe by construction.** Never auto-starts: the button opens a clear confirmation ("this opens
  your server to the internet") and only works while the server is running. The tunnel is torn down
  automatically when the server stops, the folder changes, or the app quits. The provider is a
  fixed enum and the claim link is opened externally only if it is `https://` on a `playit.gg` host.
- **One-click agent install.** If no Playit agent is found, the app downloads the right build from
  the official GitHub release automatically (no manual path hunting) — the same way it already
  installs Java. The **Set up Playit** button then starts the Playit background service and opens the
  playit.gg dashboard, where you create the tunnel. The public address is pasted into the app (the
  Playit agent does not expose it over the command line). A **Browse…** button lets advanced users
  point at an existing `playit.exe`.
- New `src/main/tunnel.js` + `tests/tunnel.test.js` (address/claim parsing, provider validation).

### Added
- **Four new MCP tools** (44 total): `get_schedule` / `set_schedule` (read/set the server
  start-stop schedule), `list_waypoints` (World Map waypoints) and `kick_player` (kick an online
  player). Risk tiers follow the existing model (read free, write asks).
- **Export the console log to a `.txt` file.** A new **Export** button in the Console header writes
  the current buffer (up to 2000 lines, with timestamps) wherever you choose. New IPC
  `console:export` + `con.export`/`con.exported`/`con.exportFailed` i18n keys.

### Changed
- **`search_marketplace` now supports all three sources.** The MCP tool previously accepted only
  `source=modrinth`; it now delegates to the **same** pure `searchMarket()` the GUI marketplace uses,
  so Modrinth, **Hangar** and **Spigot** all work over MCP and the facet/loader logic can no longer
  drift between the two. New `source` and `offset` parameters.
- **Closed the localization debt** carried since 0.7.0. Hardcoded English strings across the renderer
  (create-server wizard, player row actions, marketplace install dialog, Worlds, shell/connect,
  player-data inspector) now go through `t()`. i18n grew **579 → 682 keys** across all 7 locales.

### Fixed
- **Metrics sampler could overlap itself.** `startMetrics` used `setInterval(async …)` without
  awaiting the previous tick, so a slow sample (Java-descendant lookup ~3s, process metrics ~5s)
  could let the next tick start first — overlapping `server:metrics` sends and racing the CPU-delta
  baseline, which made the CPU% readout jitter. The tick is now a guarded, awaitable unit.
- **Pointless idle metrics traffic.** While the server was stopped the sampler still pushed a metrics
  event every second (~86k/day). The idle push is now throttled to about once every 5 seconds.

---

## [0.8.0] — 2026-09-19

### Added — MCP / AI integration (major feature)
ObserverLauncher can now act as an **MCP server**, so any MCP client (Claude Desktop, Cursor, …)
can read and control the server in natural language — check status, read the console, manage files,
install plugins, import modpacks, and more.

**Architecture**
- `src/mcp/tools.js` — a **40-tool registry**. Each tool declares a name, description, JSON input
  schema and a **risk tier**, and its handler reuses the *same* backend function the GUI/IPC layer
  uses (no duplicated logic). The 40 tools:
  - *Read (18):* `get_status`, `read_console`, `list_players`, `get_player_data` (by UUID **or**
    name), `list_files`, `read_file`, `search_files`, `list_content`, `get_properties`,
    `get_raw_properties`, `get_world_info`, `list_worlds`, `list_backups`, `get_network_info`,
    `get_java_info`, `get_settings`, `search_marketplace`, `list_market_versions`.
  - *Write (17):* `start_server`, `send_console_command`, `set_property`, `set_raw_properties`,
    `write_file`, `edit_file`, `create_backup`, `install_from_market`, `install_local_jar`,
    `import_modpack_path`, `export_modpack`, `save_player_data`, `op_player`, `whitelist_player`,
    `ban_player`, `install_java`, `set_setting`.
  - *Destroy (5):* `stop_server`, `force_stop_server`, `delete_content`, `delete_backup`,
    `restore_backup`.
- `src/mcp/server.js` — a loopback HTTP server the app starts when MCP is enabled. Binds
  **`127.0.0.1` only** on a **random port**, with a **fresh 32-byte bearer token every launch**
  (written to `userData/mcp-bridge.json`). `GET /tools` serves the real schemas; `POST /rpc` runs a
  tool. Oversized bodies get a real `413`.
- `src/mcp/bridge.js` — a **dependency-free** stdio MCP server the client launches. It implements
  `initialize` / `tools/list` / `tools/call` / `ping` directly (no SDK), fetches the real tool
  schemas from the app over HTTP, and forwards calls. It runs on the app's **own binary** via
  `ELECTRON_RUN_AS_NODE=1`, so a packaged install needs **no system Node.js**.
- `src/mcp/confirm.js` — bridges a pending write/destroy tool call to the in-app confirm dialog
  (`mcp:confirm-request` / `mcp:confirm-response`), with a 61s cleanup timer so the pending map
  never leaks.

**Permission model (3 tiers)**
- **read** — runs freely.
- **write** — asks for an in-app confirmation first; skippable with the *Auto-allow write tools*
  setting. Destructive tools are never covered by that setting.
- **destroy** — **always** asks; a 60s timeout denies.

**Security**
- Loopback-only, random port, per-launch token; the token file is removed on quit.
- `install_local_jar` accepts only a `.jar` (regular file, ≤100 MB) — the one tool that reads
  outside the server root.
- `write_file` / `edit_file` enforce the editor's text-extension allowlist (an AI can't overwrite a
  `.jar`/`.dat` with text), and `set_setting` uses a per-key allowlist that deliberately **excludes
  `serverPath`** (the root of every file op stays GUI-only).
- `install_from_market` validates download URLs (`isSafeDownloadUrl`) and picks by version/loader
  instead of blindly taking the first build.
- `search_files` caps files + bytes and yields to the event loop so a big scan can't freeze the UI.

**Settings UI**
- New **MCP / AI** section: enable toggle, auto-allow-write toggle, a live **LIVE/OFF** pill with
  the listening port, and **Copy MCP config** (emits the exact client JSON — app binary +
  `ELECTRON_RUN_AS_NODE` + `OBSERVER_MCP_USERDATA`). The app toasts + logs when an AI client first
  connects.

**Tests**
- `tests/mcp-tools.test.js` (registry/risk/schema), `tests/mcp-server.test.js` (boots the real HTTP
  server: auth 401/200, `/tools`, tool call, destroy denied) and `tests/mcp-bridge-stdio.test.js`
  (spawns `bridge.js` as a child process and drives MCP JSON-RPC over stdio against a fake app).
- **Modpack compatibility checking.** Importing a `.mrpack` now reads its declared
  `dependencies` (Minecraft version + `forge` / `neoforge` / `fabric-loader` / `quilt-loader`) and
  compares them with the current server. On a mismatch, a local import asks before installing
  ("Cancel" / "Install anyway"); the Marketplace path reports through its existing warning panel.
  No warning is raised when either side's version is unknown, so unknown packs are never blocked.
- New `tests/modpack-compat.test.js` (27 asserts) for the detection + comparison helpers.

### Changed
- **Modpack export writes real dependencies** (Minecraft version + loader) instead of an empty
  object, so other launchers know what to build. Paper-like servers export only the Minecraft
  version (Modrinth has no paper loader key).
- **Modpack import lists every file it would overwrite** (previously only `server.properties` and
  `eula.txt`), with a stronger warning when those config files are among them.
- **Export warns about untracked files** — plugins/mods copied in by hand can't be traced to a
  download URL and would be silently missing from the pack; the user is now told and can cancel.

### Fixed
- **Overview EULA chip never updated after a start.** `server:files` carried only the file list, so
  when the server wrote `eula.txt` on first start the "EULA will be accepted on start" chip stayed
  put. The push now includes `eulaAccepted` and the renderer merges it.
- **Settings header overlapped the section list.** The Launcher-settings header was `position:
  sticky`; with the taller `.tab-head` strip it looked stuck over the first rows. It now scrolls
  with the list.

## [0.7.1] — 2026-09-18

### Changed
- **README refresh for the 0.7.0 redesign.** The Screenshots section is now a 10-image tour
  (one description per tab: overview, console, players, player-inspector, performance, content,
  marketplace, worlds, worldmap, editor), and the feature tour gained a **Server schedule** section.
  All screenshots re-captured against the redesigned UI.

### Fixed
- **Marketplace tab eyebrow duplicated the Content tab's.** Both showed "CONTENT BAY"; the
  Marketplace now reads "PLUGIN STORE" (all 7 locales).

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

### Changed — full UI/UX redesign
- **One consistent tab header everywhere.** Eight ad-hoc header styles (`.content-head`,
  `.marketplace-head`, `.perf-head`, `.worlds-hero`, `.settings-hero`, `.roster-head`, `.flat-head`,
  `.terminal-head`) collapsed into a single **`.tab-head`** component (icon + eyebrow + title +
  subtitle + actions). Applied to Content, Worlds, Players, Performance, Settings, World Map,
  Marketplace and Properties. Overview (hero dashboard) and Console (terminal) keep their bespoke,
  function-specific headers by design.
- **Design-language foundation.** Added spacing (`--s1..--s5`) and type (`--fs-tab/sec/sub/label`)
  scales plus a canonical `.sec-head-v2` section header, so panels stop drifting in size/radius.
- **Content tab reworked for large plugin/mod sets.** The old three narrow columns (each with its
  own tiny scroll) are gone — now a single tall list with a **Plugins | Mods | Datapacks**
  segmented switch and a **filter box**, so hundreds of jars are one scroll, not three.
- **Worlds & backups** now stack as two full-width sections (worlds on top, the backup timeline
  below at full width) instead of a cramped split grid.
- **Marketplace rebuilt** for clarity and density: hero search with **Popular** quick-pick chips
  (EssentialsX, LuckPerms, ViaVersion, Spark, WorldEdit, Vault), a segmented **Source** control
  (Modrinth | Hangar | Spigot), a single **Sort** dropdown, an **active-filter chip** row, and a
  responsive **two-column card grid** of results (icon, title/author, source + kind badges, clamped
  description, downloads + Install).
- **Native `confirm()` dialogs replaced** by an in-app, on-brand confirm dialog (`confirmDialog()`)
  across all 16 call sites — backup, restore, delete, ban, kick, force-stop, firewall, update
  install, editor close/reload and content-import-while-running no longer show the white OS chrome.
- **Localization completeness.** ~38 user-facing strings that were still hardcoded English —
  settings validation errors, player op/whitelist/ban toasts, the no-UUID hint, content-import
  and copy feedback, properties/velocity.toml save messages, the install-close guard, the
  player-save confirmation and download-cancelled — now go through `t()` and are translated across
  all 7 locales (i18n now 555 keys). Some remaining English labels inside the create-server wizard
  and player-row buttons are still pending (planned for 0.7.1).

### Fixed
- **The create-server wizard now aborts if saving settings fails**, instead of silently continuing
  to the download step with unsaved/incorrect settings.
- **Orphan `.tmp-*` files** left behind by a crash mid atomic-write are now cleaned up at startup
  (`cleanOrphanTmp`), so they no longer accumulate in the user-data folder.
- **Duplicate element IDs in the Marketplace header** (`importModpack` / `exportModpack`) collided
  with the Content tab's buttons, so only one of each pair was wired — the other silently did
  nothing. Removed the duplicates.

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
