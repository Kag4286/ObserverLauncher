# Contributing to ObserverLauncher

Thanks for taking a look. This project is small, so the process is intentionally light.

## Before you start

- For a bug fix or small change, just open a pull request.
- For a new feature or anything that touches the app's architecture (process launching, metrics
  sampling, IPC channels, MCP tools), open an issue first so we can agree on the approach before you spend time
  on it.

## Development setup

```bash
npm install
npm start        # launch the app in development mode
npm test         # unit/regression suite (node tests/run.js — 154 test suites)
npm run test:e2e # Playwright smoke tests against the real Electron app
```

The app is plain Electron — **no bundler, no build step for development**. There are three layers,
plus a window-less entry point that reuses the exact same backend:

- **Main process** (`src/main.js`) — the Electron entry point. It is a thin composition root: it
  creates the shared state object and registers feature modules. Almost all logic lives in
  `src/main/`:
  - Feature modules (stateful, take `ipcMain` + `ctx`): `context.js`, `server-lifecycle.js`,
    `backups.js`, `players.js`, `marketplace.js`, `modpacks.js`, `wizard.js`, `settings-handlers.js`,
    `content-handlers.js`, `app-lifecycle.js`, `scheduler.js`, `tunnel.js`, `orphan.js`,
    `orphan-prompt.js`, `rcon.js`, `runtime-state.js`, `tunnel-manager.js`, `remote.js`,
    `pinggy-tunnel.js` (per-instance ssh child for the Bedrock UDP tunnel), `bulk-instances.js`
    (pure start-all/stop-all planners), `prometheus.js` (the loopback `/metrics` endpoint).
  - Plain helpers (testable without an Electron window): `settings.js`, `fs-utils.js`, `http.js`,
    `java.js`, `server-files.js`, `network.js`, `editor.js`, `worldmap.js`, `textures.js`,
    `validate.js` (IPC & SSRF guards covering IPv4/IPv6 loopback, link-local, ULA, multicast, and private ranges),
    `migrations.js`, `kill.js`, `server-metrics.js`, `server-poll.js`, `curseforge.js`
    (CurseForge API helpers + pure manifest/dependency mapping; the user supplies their own API key),
    `server-compat.js` (loader detection for Vanilla, Paper/Purpur/Spigot/Bukkit, Fabric, Forge, NeoForge, Velocity),
    `server-java.js`, `version-compare.js` (natural digit-aware version compare),
    `forge-versions.js`, `jar-read.js`, `mod-metadata.js` (reads `mods.toml`, `fabric.mod.json`, `mcmod.info`),
    `content-conflicts.js` (pre-flight mod conflict scanner, duplicate modId detector, missing dependency resolver),
    `mc-compat.js` (cross-patch compatibility bridges e.g. 1.16.4/1.16.5, universal Forge & Fabric range evaluator),
    `content-ops.js` (datapack validation, extraction & content toggle), `content-updates.js` (content update check/apply/rollback),
    `datapack.js`, `datapack-order.js` (load order in `level.dat`), `secrets.js`, `data-dir.js` (the ONE data-folder resolver),
    `ipc-shim.js` (a fake `ipcMain` so the feature modules register without Electron), `templates.js` (server templates),
    `docker.js` (a pure Dockerfile/compose generator), `modpack-manifest.js` (modpack.json schema + static verifier),
    `modpack-resolve.js` (manifest -> resolved items via the marketplace resolver), `modpack-build.js`
    (resolved items -> a real server folder; pure `planBuild` + transactional `buildPack`),
    `rate-limit.js` (a shared token-bucket used by the MCP and remote servers),
    `stability.js` (persistent per-instance run records + the auto-rollback decision),
    `metrics-store.js` (raw + 1m + 1h metric tiers), `instances-snapshot.js` (cross-instance table),
    `properties-history.js` (snapshot/diff/restore), `template-store.js` (user templates),
    `gamerules.js` (level.dat game rules), `geyser.js` (Geyser config inspect + line-level repair),
    `proxy-config.js` (velocity.toml line-level edit), `pinggy.js` (the Pinggy ssh adapter),
    `webhook.js` (Discord/generic webhook alerts with SSRF filtering), `http-guard.js` (shared Origin/Host/loopback guards),
    `player-analytics.js` (playtime leaderboard), `skins.js` + `skinsrestorer.js` + `client-skins.js`
    + `jar-reader.js` (the player skin chain), and `mods-index.js` (item icons read from mod jars).
  - `remote-ui/` — the Remote-access WEB dashboard (`index.html` / `style.css` / `app.js`), served by
    `remote.js` from a fixed in-memory asset map. Plain scripts, self-contained i18n (7 locales).
  - `mcp/` — local-only AI integration (78 structured tools, see below).
  - `adapters/` — per-software download resolvers (vanilla, papermc, purpur, leaf, fabric, forge,
    spigot, mojang).
  - `platform/` — Windows/Linux process-tree walking, metrics and firewall (`win32.js`, `linux.js`,
    dispatched by `index.js`).

  Each of these modules is a plain `require()`-able file with no dependency on a running window, so
  it can be unit-tested in isolation. A module MUST NOT `require('electron')` at the top level — that
  throws under plain Node and breaks the headless entry point. Require it lazily inside a GUI-only
  path instead; `tests/headless-guard.test.js` fails the build if a top-level require reappears.

- **Headless** (`src/headless.js` + `src/cli.js`) — the no-window entry point. `headless.js` builds
  the same `ctx` + shim + feature modules with no `BrowserWindow`, `app.whenReady`, auto-updater,
  `tex://` protocol or single-instance lock, then runs the backend init (Java detect, folder watcher,
  metrics, auto-backup, scheduler) and starts the MCP server when enabled. `cli.js` is the `observer`
  command (`status`, `start`, `stop`, `logs`, `backup`, `doctor`, `templates`, `docker create`, …) and
  is `bin.observer`. Both must stay Electron-free (see the guard test above).

- **MCP** (`src/mcp/`) — local-only AI integration. `tools.js` is the tool registry (name, risk tier, schema, annotations, outputSchema, handler): read tools run freely, write tools ask in-app, destructive always ask — EXCEPT that `mcpAutoAllowWrite` also auto-allows the lifecycle actions (start/stop/restart/force-stop). `server.js` is a loopback HTTP server (127.0.0.1, random port, fresh token) started when enabled; `bridge.js` is a dependency-free stdio MCP server a client launches that forwards calls to the app (runs on the app's own binary via `ELECTRON_RUN_AS_NODE=1`, no system Node needed). **The bridge is extracted standalone (it cannot `require()` app modules), so every surface is served by `server.js` over HTTP and fetched by the bridge**: `/tools`, `/prompts` (+`/prompt`), `/resources`, `/resource-templates`, `/resource`, `/rpc`, `/health`. `prompts.js` (pure) defines the workflow prompts; `resources.js` is the SINGLE SOURCE for the static resource list + RFC 6570 templates + resolver. `confirm.js` bridges write/destroy calls to the in-app dialog. `doctor.js` holds the Server-Doctor diagnostics — pure, testable helpers (console-log analysis, crash summarising, `server.properties` validation, bytecode class version checking for Java mismatches, composite health check). `repair.js` holds the Autonomous Doctor logic (crash-loop / RAM-pressure detection, the `propose_fix` repair planner, and marketplace mod-name matching); `modpack-plan.js` resolves candidate projects into an install plan with versions + required dependencies. Security: token is constant-time compared + fail-closed, `/resource` goes through the rate limiter and the per-instance ALS scope, `safeTarget` is fail-CLOSED.

- **Preload** (`src/preload.js`) — the **only** bridge between main and renderer. It exposes
  `window.observer.*` over `contextBridge`. `contextIsolation` is on and `nodeIntegration` is off,
  so the renderer never touches Node APIs directly.

- **Renderer** (`src/renderer/`) — the UI. `index.html` is the shell and loads, **in numeric order**:
  - `css/` — styles split by area (`01-tokens.css` … `10-dropdown.css`). Motion lives in
    `08-motion.css` (tokens, stagger, modal fade) and `09-pulse.css` (ambience, boot, lite-mode);
    see `docs/motion.md` for the approved animation patterns.
    - **Motion scoping:** Entrance animations (`rowIn`, `panelIn`) are scoped strictly to tab transitions
      (`.tab-enter-fwd`, `.tab-enter-back`). They MUST NOT trigger during background sync, data polling,
      or `refreshUI()` calls.
    - **Input & Form styling:** Every text, password, and number field MUST adhere to `DESIGN.md`:
      use `background: var(--field)`, `border: 1px solid var(--field-border)`, `border-radius: var(--r-sm)`,
      and `color: var(--text)`. Never allow inputs to render with default OS white backgrounds.
  - `locales/` — one file per language; `meta.js` loads **first** (it defines `window.LOCALES` and
    `LOCALES_META`).
  - `js/` — per-tab logic (`00-core.js` … `13-bootcheck.js`), loaded as classic scripts. There is no
    module system and no bundler, so **load order matters** — a file that uses something defined in a
    later file will throw at load time. Anything called during boot / `refreshUI()` must live in a
    file that loads *before* its caller.
    - **Selector convention:** `$` is `document.querySelector` (single element); `$$` is `document.querySelectorAll`
      (returns a NodeList with `.forEach`). NEVER call `.forEach` on `$()` — doing so throws a runtime `TypeError`.
    - `13-bootcheck.js` loads **last** and asserts the core globals exist after every script has
      evaluated; if a load-order regression leaves one undefined it logs a console error and shows a
      banner instead of a silent blank tab.

## Multi-instance model (v2.0.0+)

The app manages several servers at once. The design is what keeps that from becoming a tangle of
globals, so read this before touching backend state.

- **Settings are nested (schema v6).** The store is `{ global..., instances: [], activeInstanceId }`.
  The per-instance keys are listed once in `PER_INSTANCE_KEYS` (`src/main/migrations.js`).
  `loadSettings()` returns a FLAT view of the ACTIVE instance, `loadSettingsStore()` returns the nested store, and
  `loadSettingsFor(id)` / `saveSettingsFor(id, flat)` read and write a SPECIFIC instance. Use the
  `*For(id)` variants in any code that targets an instance by id — plain `loadSettings()` always
  means the active one.
- **The instance id travels with the call chain.** `context.js` holds `ctx.instances` (a Map), an
  `activeInstanceId`, and an `AsyncLocalStorage`-backed `ctx.inst()` / `ctx.runInInstance(id, fn)`.
  Per-instance `ctx` fields are getter/setter accessors over `instState()`; call-sites keep plain
  property syntax (`ctx.currentServerPath`) and the ALS routes each read/write to the right instance.
  The `callTool` choke point (`src/mcp/server.js`) and every IPC handler (`src/main.js` wraps
  `ipcMain.handle`) run inside `runInInstance`, so a switch mid-await cannot leak state across calls.
- **Adding a per-instance field** means editing three places or the guard misses it: `freshInstState()`
  and `INST_FIELDS` in `context.js`, plus the `MIGRATED` list in `tests/arch-ctx-accessors.test.js`.
  The arch test fails if a per-instance field is left as a flat property on the `ctx` literal.
- **Reusable timers loop over instances.** The metrics sampler, scheduler and auto-backup watcher run
  one loop over `ctx.instances.keys()`, each tick wrapped in `ctx.runInInstance(id)` with
  `loadSettingsFor(id)`. Follow that pattern for anything recurring.
- **Gated events.** `context.js` `send()` drops `server:metrics`, `server:live`, `server:files` and
  `server:log` unless `ctx.inst()` is the active instance; `server:state` and error log lines always
  pass. New push channels default to ungated — add them to `GATED_CHANNELS` if they are per-instance.

## Reliability & Security features

- **Scheduler** (`scheduler.js`). A pure `shouldFire()` decides whether a scheduled start or stop is due for a given instance, time and status. A stop is skipped while a backup is in progress. Times are the PC's local clock; a scheduled action that lands while the computer is asleep is skipped, not replayed hours later.
- **SSRF Defense-in-Depth** (`validate.js`). `isSafeDownloadUrl()` enforces strict URL validation before any download or webhook is triggered. It rejects private IPv4 ranges, IPv4-mapped IPv6 (`::ffff:...`), loopback (`::1`, `127.0.0.1`), link-local (`fe80::/10`, `169.254.x`), unique local LAN (`fc00::/7`), and multicast (`ff00::/8`, `224.0.0.0/4`).
- **Webhook** (`webhook.js`). `fire()` is fire-and-forget. Uses `isSafeDownloadUrl` so a webhook cannot be pointed at internal or metadata services. Messages support Discord and generic JSON formats.
- **Crash Doctor** (`mcp/doctor.js`). Pure `classifyCrash` and `summarizeCrashText` helpers classify crash logs, identify missing dependencies or mod conflicts, and translate bytecode class versions (`69.0` -> Java 25, `65.0` -> Java 21) into plain-language explanations.
- **Orphan adoption** (`orphan.js`, `orphan-prompt.js`). If a server process is still running when the app starts, a tier-2 orphan prompt asks the user to reconnect or stop. Resolves to `reconnect` after 60 s, preventing accidental termination of live servers.
- **Prometheus & Remote Security** (`http-guard.js`). Prometheus (`prometheus.js`) and the Remote dashboard (`remote.js`) share the loopback guards in `http-guard.js` (Origin check, Host validation, and loopback IP enforcement).

## Bedrock crossplay and tunnels

- **Geyser and Floodgate** (`geyser.js`). `config.yml` is inspected for the four issues that break crossplay most often: `clone-remote-port: true`, a non-default `bedrock.port`, `auth-type` other than floodgate when Floodgate is present, and `use-haproxy-protocol: false`. The Apply fix path edits the file LINE BY LINE and takes a backup first, so a user's own comments and spacing survive.
- **Tunnels** (`tunnel.js`, `pinggy-tunnel.js`, `tunnel-manager.js`). Playit handles the Java TCP port. Pinggy handles the Bedrock UDP port and runs alongside it. Both are per-instance. Windows OpenSSH reads the password from a console handle, not from stdin, so `pinggy.js` writes a small `SSH_ASKPASS` helper and spawns ssh with `SSH_ASKPASS_REQUIRE=force`.

## Minecraft data formats change between versions

Mojang frequently adjusts data layouts between Minecraft versions, and the launcher reads those files directly. When touching player data or world files, **assume nothing about the layout** — support both old and new shapes:

- **Player armor + off-hand (1.21.5+ / 26.x):** worn armor and off-hand moved out of `Inventory` into top-level `equipment` (`head`/`chest`/`legs`/`feet`/`offhand`). Stacks switched from `Count` to lowercase `count`. `readPlayerData()` reads both; `stackOf()` normalizes the count key.
- **Player data folder (26.1+):** `<world>/players/data/<uuid>.dat` replaced `<world>/playerdata/<uuid>.dat`. `findPlayerDataFile()` tries both.
- **Region folders:** overworld regions live under `<world>/dimensions/minecraft/overworld/region` on new versions and `<world>/region` on old ones. `getRegionDirs()` lists both.
- **Biomes (1.18+):** stored per chunk section as a paletted container (`{ palette, data? }`, 64 cells per section, bit-packed longs). See `readBiomes()` in `src/main/worldmap.js`.
- **Worn armor textures (1.21.2+):** `models/armor/<mat>_layer_N.png` moved to `entity/equipment/humanoid/<mat>.png` and `humanoid_leggings/`. `textures.js` `newArmorLayout()` picks layout using numeric version comparison.

## The `tex://` protocol and player skins

Textures do not go through the normal IPC path. A custom `tex://` scheme serves them so `<img>` and WebGL can load them (`src/main/textures.js` and `src/renderer/js/03b-player-3d.js`):

1. **WebGL texture upload needs all three CORS pieces.** The scheme is registered with `corsEnabled` in `main.js`, every `tex://` response carries `Access-Control-Allow-Origin`, AND the `<img>` sets `crossOrigin='anonymous'`.
2. **Skin and armor share texture unit 0.** `draw()` must rebind the skin texture on every frame.
3. **CSP forbids inline handlers.** Detection uses delegated capture `load` listeners, never `onload="..."`.
4. **Nothing Mojang-owned is bundled.** Textures are resolved dynamically from SkinsRestorer on disk, Mojang session servers, client jars, and public PrismarineJS mirrors. Never commit textures into the repo.

## Guidelines

- **English only** in code comments, commit messages, and UI strings added to the `en` locale (`src/renderer/locales/en.js`).
- **One concern per pull request.** A bug fix and a refactor in the same PR is harder to review and harder to revert if something breaks.
- **No duplicated code — copy-paste is the #1 defect this project has had to clean up.** Before adding a block, check whether an equivalent helper already exists and reuse or extend it.
- **Explain the "why", not just the "what"** in your PR description.
- **Keep IPC channel names stable.** `preload.js` and the renderer depend on the exact channel strings used in `ipcMain.handle(...)`.
- **Validate untrusted input.** Anything arriving from the renderer (or a remote API) is treated as untrusted. Use `src/main/validate.js` and `safeTarget` in `src/main/fs-utils.js`.
- **Follow the motion contract.** New animation uses tokens (`var(--dur-*)`, `var(--ease-*)`) from `01-tokens.css`, never literal `.2s`/`150ms`, and guards Lite mode and `prefers-reduced-motion`.
- **Run the tests** before opening a PR: `npm test` (154 test suites) and `node tests/i18n.test.js`.
- **Test on Windows** if you can — Windows and Linux are supported platforms, and several paths (`powershell.exe`, `cmd.exe`, `run.bat`) are Windows-specific.

## Adding a language

1. Create a new file in `src/renderer/locales/` (e.g. `it.js` for Italian) by copying `src/renderer/locales/en.js`. Keep keys identical.
2. Add an entry to `window.LOCALES_META` in `src/renderer/locales/meta.js`: `{ code: 'it', name: 'Italiano' }`.
3. Load the new file in `src/renderer/index.html` — add `<script src="locales/it.js"></script>` alongside the other locale tags.
4. Add the language code to `tests/i18n.test.js` (`LOCALES` array).
5. Run `npm test` and `node tests/i18n.test.js` — the i18n test verifies that all locales contain all required keys with zero dead or missing keys.

## Reporting bugs

The most useful bug report includes:

- What you clicked / typed, and what you expected to happen.
- The actual Console output from the launcher or `logs/latest.log`.
- Minecraft server software and version (e.g. Paper 1.21.4, Forge 1.20.1).
- Operating system and display language.

## Code of conduct

Be respectful. Disagreements about code are fine; personal attacks are not.
