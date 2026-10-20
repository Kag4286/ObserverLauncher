# Contributing to ObserverLauncher

Thanks for taking a look. This project is small, so the process is intentionally light.

## Before you start

- For a bug fix or small change, just open a pull request.
- For a new feature or anything that touches the app's architecture (process launching, metrics
  sampling, IPC channels), open an issue first so we can agree on the approach before you spend time
  on it.

## Development setup

```bash
npm install
npm start        # launch the app in development mode
npm test         # unit/regression suite (node tests/run.js)
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
    `validate.js`, `migrations.js`, `kill.js`, `server-metrics.js`, `server-poll.js`, `curseforge.js`
    (CurseForge API helpers + pure manifest/dependency mapping; the user supplies their own API key),
    `server-compat.js`, `server-java.js`, `version-compare.js` (natural digit-aware version compare),
    `forge-versions.js`, `jar-read.js`, `mod-metadata.js`, `content-ops.js` / `content-updates.js`
    (content toggle/update logic), `datapack.js`, `datapack-order.js` (load order in `level.dat`),
    `secrets.js`, `data-dir.js` (the ONE data-folder resolver), `ipc-shim.js` (a fake `ipcMain` so the
    feature modules register without Electron), `templates.js` (server templates), `docker.js` (a pure
    Dockerfile/compose generator), `modpack-manifest.js` (modpack.json schema + static verifier),
    `modpack-resolve.js` (manifest -> resolved items via the marketplace resolver), `modpack-build.js`
    (resolved items -> a real server folder; pure `planBuild` + injectable `buildPack`),
    `rate-limit.js` (a shared token-bucket used by the MCP and remote servers),
    `stability.js` (persistent per-instance run records + the auto-rollback decision),
    `metrics-store.js` (raw + 1m + 1h metric tiers), `instances-snapshot.js` (cross-instance table),
    `properties-history.js` (snapshot/diff/restore), `template-store.js` (user templates),
    `gamerules.js` (level.dat game rules), `geyser.js` (Geyser config inspect + line-level repair),
    `proxy-config.js` (velocity.toml line-level edit), `pinggy.js` (the Pinggy ssh adapter),
    `webhook.js` (Discord/generic POST), `http-guard.js` (shared Origin/Host/loopback guards),
    `player-analytics.js` (playtime leaderboard), `skins.js` + `skinsrestorer.js` + `client-skins.js`
    + `jar-reader.js` (the player skin chain), and `mods-index.js` (item icons read from mod jars).
  - `remote-ui/` — the Remote-access WEB dashboard (index.html / style.css / app.js), served by
    `remote.js` from a fixed in-memory asset map. Plain scripts, self-contained i18n (7 locales).
  - `mcp/` — optional MCP/AI integration (see below).
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

- **MCP** (`src/mcp/`) — optional local-only AI integration. `tools.js` is the tool registry (name, risk tier, schema, annotations, outputSchema, handler): read tools run freely, write tools ask in-app, destructive always ask — EXCEPT that `mcpAutoAllowWrite` also auto-allows the lifecycle actions (start/stop/restart/force-stop). `server.js` is a loopback HTTP server (127.0.0.1, random port, fresh token) started when enabled; `bridge.js` is a dependency-free stdio MCP server a client launches that forwards calls to the app (runs on the app's own binary via `ELECTRON_RUN_AS_NODE=1`, no system Node needed). **The bridge is extracted standalone (it cannot `require()` app modules), so every surface is served by `server.js` over HTTP and fetched by the bridge**: `/tools`, `/prompts` (+`/prompt`), `/resources`, `/resource-templates`, `/resource`, `/rpc`, `/health`. `prompts.js` (pure) defines the workflow prompts; `resources.js` is the SINGLE SOURCE for the static resource list + RFC 6570 templates + resolver. `confirm.js` bridges write/destroy calls to the in-app dialog. `doctor.js` holds the Server-Doctor diagnostics — pure, testable helpers (console-log analysis, crash summarising, `server.properties` validation, the composite health check) with no Electron dependency. `repair.js` holds the Autonomous Doctor logic (crash-loop / RAM-pressure detection, the `propose_fix` repair planner, and the marketplace mod-name matching used by `apply_fix`); `modpack-plan.js` resolves candidate projects into an install plan with versions + required dependencies. Handlers reuse the same backend functions the IPC layer uses. Security: token is constant-time compared + fail-closed, `/resource` goes through the rate limiter and the per-instance ALS scope, `safeTarget` is fail-CLOSED. Tests: `tests/mcp-tools.test.js`, `mcp-bridge-stdio.test.js`, `mcp-surface.test.js`, `mcp-security-5.test.js`.

- **Preload** (`src/preload.js`) — the **only** bridge between main and renderer. It exposes
  `window.observer.*` over `contextBridge`. `contextIsolation` is on and `nodeIntegration` is off,
  so the renderer never touches Node APIs directly.

- **Renderer** (`src/renderer/`) — the UI. `index.html` is the shell and loads, **in numeric order**:
  - `css/` — styles split by area (`01-tokens.css` … `10-dropdown.css`). Motion lives in
    `08-motion.css` (tokens, stagger, modal fade) and `09-pulse.css` (ambience, boot, lite-mode);
    see `docs/motion.md` for the approved animation patterns and the rules every new animation must
    follow (use tokens, short durations, `prefers-reduced-motion` guard, never animate the console
    or map canvas).
  - `locales/` — one file per language; `meta.js` loads **first** (it defines `window.LOCALES` and
    `LOCALES_META`).
  - `js/` — per-tab logic (`00-core.js` … `13-bootcheck.js`), loaded as classic scripts. There is no
    module system and no bundler, so **load order matters** — a file that uses something defined in a
    later file will throw at load time. Anything called during boot / `refreshUI()` must live in a
    file that loads *before* its caller (this has caused real regressions).
    - `13-bootcheck.js` loads **last** and asserts the core globals exist after every script has
      evaluated; if a load-order regression leaves one undefined it logs a console error and shows a
      banner instead of a silent blank tab. When you add a helper that the boot path or a tab calls
      during eval, add a probe for it here.

## Multi-instance model (v2.0.0)

The app manages several servers at once. The design is what keeps that from becoming a tangle of
globals, so read this before touching backend state.

- **Settings are nested (schema v6).** The store is `{ global..., instances: [], activeInstanceId }`.
  The per-instance keys are listed once in `PER_INSTANCE_KEYS` (`src/main/migrations.js`); the v3→v4
  migration moves them into `instances[0]` (v4→v5 adds the per-instance `accent`/`artSeed` appearance
  keys). `loadSettings()` returns a FLAT view of the ACTIVE
  instance (so old callers kept working), `loadSettingsStore()` returns the nested store, and
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

## Reliability features

Four features keep a server alive without user action. Each is small enough to live in its own module rather than inside the lifecycle code.

- **Scheduler** (`scheduler.js`). A pure `shouldFire()` decides whether a scheduled start or stop is due for a given instance, time and status. `startScheduler` runs one interval for every instance inside `ctx.runInInstance(id)`. A stop is skipped while a backup is in progress. Times are the PC's local clock; a scheduled action that lands while the computer is asleep is skipped, not replayed hours later.
- **Webhook** (`webhook.js`). `fire()` is fire-and-forget. `isSafeWebhookUrl` reuses the public-host rule in `isSafeDownloadUrl`, so a webhook cannot be pointed at a loopback or private host. Messages have a Discord shape or a generic JSON shape.
- **Crash analyser** (`mcp/doctor.js`). The pure `classifyCrash` and `summarizeCrashText` helpers classify the newest crash report. `server-lifecycle.js` calls them on an unexpected exit and pushes a `crash:analysis` event; the renderer draws a banner above the console.
- **Orphan adoption** (`orphan.js`, `orphan-prompt.js`). If a server process is still running when the app starts, a tier-2 orphan asks the user to reconnect or stop. The prompt resolves to `reconnect` after 60 s, so a closed renderer never force-stops a live server.

Prometheus (`prometheus.js`) and the Remote dashboard (`remote.js`) share the loopback guards in `http-guard.js`. Do not write a second Origin or IP check; extend the shared one.

## Bedrock crossplay and tunnels

Two features put a server on the network from a desktop machine.

- **Geyser and Floodgate** (`geyser.js`). `config.yml` is inspected for the four issues that break crossplay most often: `clone-remote-port: true`, a non-default `bedrock.port`, `auth-type` other than floodgate when Floodgate is present, and `use-haproxy-protocol: false`. The Apply fix path edits the file LINE BY LINE and takes a backup first, so a user's own comments and spacing survive. The built-in YAML reader is lossy on purpose; do not re-serialize the file.
- **Tunnels** (`tunnel.js`, `pinggy-tunnel.js`, `tunnel-manager.js`). Playit handles the Java TCP port. Pinggy handles the Bedrock UDP port and runs alongside it. Both are per-instance. Windows OpenSSH reads the password from a console handle, not from stdin, so `pinggy.js` writes a small SSH_ASKPASS helper and spawns ssh with `SSH_ASKPASS_REQUIRE=force`. Do not switch back to piping the password; it hangs.

## Minecraft data formats change between versions

A recurring source of bugs in this project: Mojang moves things around between
Minecraft versions, and the launcher reads those files directly. When you touch
player data or world files, **assume nothing about the layout** — support both the
old and the new shape, and test against a real file when you can.

Known changes the code already handles (keep them working):

- **Player armor + off-hand (1.21.5+ / 26.x):** worn armor and the off-hand item
  moved out of `Inventory` into a top-level `equipment` compound keyed
  `head`/`chest`/`legs`/`feet`/`offhand`. Item stacks also switched from `Count`
  to lowercase `count`. `readPlayerData()` reads both; `stackOf()` normalizes the
  count key.
- **Player data folder (26.1+):** `<world>/players/data/<uuid>.dat` replaced
  `<world>/playerdata/<uuid>.dat`. `findPlayerDataFile()` tries both.
- **Region folders:** overworld regions live under
  `<world>/dimensions/minecraft/overworld/region` on new versions and
  `<world>/region` on old ones. `getRegionDirs()` lists both.
- **Biomes (1.18+):** stored per chunk section as a paletted container
  (`{ palette, data? }`, 64 cells per section, bit-packed longs). See
  `readBiomes()` in `src/main/worldmap.js`.
- **Worn armor textures (1.21.2+):** `models/armor/<mat>_layer_N.png` moved to
  `entity/equipment/humanoid/<mat>.png` and `humanoid_leggings/`. `textures.js`
  `newArmorLayout()` picks the layout with a NUMERIC version compare (a string compare
  sorts `1.9.4` above `1.21.2`), and `armorCandidates()` returns both so a misdetected
  jar still resolves on the next reload.
- **Skin textures the game draws without a file of its own:** `enchanted_golden_apple`
  is rendered from `golden_apple.png` plus a glint, so the mirror 404s the specific
  name. `textures.js` `ITEM_ALIASES` maps those ids, tried AFTER the real name.

## The `tex://` protocol and player skins

Textures do not go through the normal IPC path. A custom `tex://` scheme serves them so
`<img>` and WebGL can load them; read `src/main/textures.js` and `src/renderer/js/03b-player-3d.js`
before touching either. Four rules that each cost a debugging session:

1. **A WebGL texture upload needs all three CORS pieces.** The scheme is registered with
   `corsEnabled` in `main.js`, every `tex://` response carries `Access-Control-Allow-Origin`, AND
   the `<img>` sets `crossOrigin='anonymous'`. Remove any one and `texImage2D` either throws a
   `SecurityError` or Chromium refuses the request outright.
2. **The skin and the armor share texture unit 0.** `draw()` must rebind the skin texture on every
   frame; otherwise the skin cubes sample the armor atlas at skin UVs and the alpha test deletes the
   torso.
3. **The CSP forbids inline handlers.** A texture that resolves to the 1x1 placeholder is detected in
   a delegated capture `load` listener, never with `onload="..."`.
4. **Nothing Mojang-owned is bundled.** The chain is SkinsRestorer on disk, then the Mojang session
   server, then the user's own client jar, then the public PrismarineJS mirror, then a generated
   initials avatar. Read files on the user's machine at runtime; never copy a texture into the repo.

The Player Inspector's item cells, equipment tiles and tooltips use `data-tip` / `data-tip-html`
(`src/renderer/js/00b-tooltip.js`), not the native `title=` attribute, which is drawn by the OS and
ignores the design tokens.

When you add a reader, prefer the new format first with a legacy fallback, and
add a regression test with a synthesized NBT fixture (see
`tests/player-equipment.test.js` for the pattern).

## Guidelines

- **English only** in code comments, commit messages, and UI strings added to the `en` locale
  (`src/renderer/locales/en.js`).
- **One concern per pull request.** A bug fix and a refactor in the same PR is harder to review and
  harder to revert if something breaks.
- **No duplicated code — copy-paste is the #1 defect this project has had to clean up.** Before adding
  a block, check whether an equivalent helper already exists (`scan_project`, or grep the symbol) and
  reuse or extend it instead of writing a second copy. This applies to AI-assisted changes too: a model
  will happily paste the same 10 lines into two functions, repeat a CSS rule 7 times, or copy a
  `zip`/`tar` wrapper verbatim. After any multi-file change, scan for repeats and extract a shared
  helper. When extracting, keep the behaviour byte-identical and re-run `npm test`.
  A scan that false-positives on `@keyframes from/to` and `@media` overrides is expected — read each
  hit before acting. (See `.agent/memory.md` gotcha 20 for the known benign repeats and the scan recipe.)
- **Explain the "why", not just the "what"** in your PR description — especially for bug fixes. What
  was actually happening, and why did the old code produce that behavior?
- **Keep IPC channel names stable.** `preload.js` and the renderer depend on the exact channel
  strings used in `ipcMain.handle(...)`. Renaming one means updating the bridge and every caller.
- **Validate untrusted input.** Anything arriving from the renderer (or a remote API) is treated as
  untrusted. Use the shared validators in `src/main/validate.js` and `safeTarget` in
  `src/main/fs-utils.js`. The renderer mirrors some checks for instant feedback, but the backend must
  re-validate as defense in depth.
- **Follow the motion contract.** New animation uses the duration/easing tokens (`var(--dur-*)`,
  `var(--ease-*)`) from `01-tokens.css`, never literal `.2s`/`150ms`, and guards Lite mode and
  `prefers-reduced-motion`. `tests/motion-tokens.test.js` is a ratchet: it fails if the count of
  literal durations in CSS goes up. See `docs/motion.md`.
- **Run the tests** before opening a PR: `npm test`. The suite includes architecture guards
  (`tests/arch-*.test.js`) that check boot order, IPC channel parity, the atomic-write whitelist and
  the per-instance accessors, plus `tests/headless-guard.test.js` (a ratchet: no top-level
  `require('electron')` or `app.getPath('userData'|'temp')` outside `data-dir.js`). `npm run test:e2e`
  runs the Playwright suite.
- **Test on Windows** if you can — Windows and Linux are the currently supported platforms, and
  several code paths (`powershell.exe`, `cmd.exe`, `run.bat`) are Windows-specific.

## Adding a language

1. Create a new file in `src/renderer/locales/` (e.g. `it.js` for Italian) by copying
   `src/renderer/locales/en.js`. Keep the keys identical — the app falls back to English for any key
   missing in the active locale, so a partial translation still works, it just won't be fully
   translated yet.
2. Add an entry to `window.LOCALES_META` in `src/renderer/locales/meta.js`:
   `{ code: 'it', name: 'Italiano' }`.
3. Load the new file in `src/renderer/index.html` — add `<script src="locales/it.js"></script>`
   alongside the other locale tags (they sit just before the `js/*` tags).
4. Add the language code to **both** hardcoded lists so the tests and CI see it:
   - `tests/i18n.test.js` — the `['en', 'vi', …]` array near the top.
   - `window.LOCALES_META` in `src/renderer/locales/meta.js` (step 2 above).
   NOTE: the `#languageSelect` dropdown is populated at runtime from `LOCALES_META`
   (`08-shell.js`), so you do **not** edit `index.html` options by hand — a manual `<option>`
   would be overwritten on boot.
5. Run `npm test` — the i18n test checks every locale has every key the `en` block defines, and
   that every key referenced from `index.html` **and** from `t('…')`/`tf('…')` literals in
   `src/renderer/js/*.js` actually exists in `en`. (Dynamic/concatenated keys are skipped.)

The UI is now **fully translated** — the i18n test enforces that every `data-i18n*` attribute and
every `t('…')` literal has a key in all 7 locales (no missing keys). When you add new UI text, add
the key to `en.js` first, then translate the other six — the test fails until all seven have it.

## Reporting bugs

The most useful bug report includes:

- What you clicked / typed, and what you expected to happen.
- The actual Console output from the launcher at the time (not just "it crashed") — the launcher's
  **Console** tab, or the server's own `logs/latest.log` if the server process itself failed.
- Your Minecraft server software and version (Paper 1.21.4, Forge 1.20.1, etc.) if relevant.
- Your OS and, if a metric looks wrong, your Windows display language (some bugs are locale-specific).

## Code of conduct

Be respectful. Disagreements about code are fine; personal attacks are not.
