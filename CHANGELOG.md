# Changelog

All notable changes to ObserverLauncher are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

> **Two-track release notes (commitment, from 1.3.0 onward).** This file is the *developer*
> changelog: it documents modules, functions, flags and root causes. It is NOT what users read.
> Every GitHub Release ALSO gets a separate, plain-English summary written for non-technical users —
> what they can now do, what got better, what to watch out for, with no jargon. The two are kept in
> sync: a change lands here and in the release summary. Starting with 1.3.0, no release ships
> without its user-facing summary.

## [2.5.0] — 2026-09-26

**Headline: two-way MCP + Autonomous Doctor, and the project moves to Apache-2.0.** The AI
integration used to be one-directional (the AI calls a tool, the app answers). It is now
two-directional: the AI can SUBSCRIBE to live resources (metrics, console tail, players,
instances) and get pushed updates, and a new `propose_fix` / `apply_fix` pair turns the Server
Doctor from a diagnostician into a repair planner - it proposes a structured fix plan (port
change, missing mod dep, RAM tuning, crash-loop rollback) that the user confirms before anything
runs. License changed MIT -> Apache-2.0 (adds an explicit patent grant + retaliation clause; MIT
has neither).

### Added — MCP two-way resources + subscribe (E1/E2)
- **4 new dynamic resources** exposed by `resourceForUri` (src/mcp/server.js) and advertised in
  `STATIC_RESOURCES` (bridge.js): `observer://metrics/history`, `observer://console/tail`,
  `observer://world/players`, `observer://instances`. Each maps to an existing read tool.
- **`resources/subscribe` / `resources/unsubscribe`** in bridge.js. The bridge polls the subscribed
  resource every 5s and emits `notifications/resources/updated` when the body hash changes, so an
  AI client reacts to changes instead of polling. Capabilities now advertise `subscribe: true` +
  `subscriptions.listen: true`. INSTRUCTIONS updated.

### Added — Autonomous Server Doctor (E3/E4)
- **NEW `src/mcp/repair.js`** (pure, testable): `detectCrashLoop` (>=3 crash-reports in 1h),
  `detectRamPressure` (steady climb = leak, high avg = pressure), `proposeRepair(facts)` ->
  structured plan of `{action, risk, reason, args}`. Actions: `change_port`, `install_dependency`,
  `tune_performance`, `restore_backup`.
- **`propose_fix` (read)** gathers facts (diagnose + port + mod compat + crash loop + RAM trend)
  and returns the plan - changes NOTHING.
- **`apply_fix` (destroy)** executes the approved plan by routing each action to the existing tool
  handlers (set_property / search+install_from_market / restore_backup), so every guard still
  applies. Always confirmed.
- Tool count 68 -> 70. bridge.js STATIC_TOOLS synced (drift guard passes).

### Changed — License MIT -> Apache-2.0
- `LICENSE` rewritten as the Apache License 2.0 (keeps the ObserverLauncher disclaimer at the end);
  new `NOTICE` file with copyright + third-party attribution. `package.json` + `package-lock.json`
  license fields -> `Apache-2.0`; README badge + License section updated. `build.files` now bundles
  `LICENSE` + `NOTICE` into the installer (Apache 2.0 requires distribution of both).

### Changed — polish / cleanup
- **MCP confirm dialog** now shows a short human summary of the tool args (e.g. "Install X (mod)",
  "3 fix(es)", "install X, change_port") instead of a raw JSON dump; falls back to truncated JSON.
  4 i18n keys (mcp.sumInstall/sumAssemble/sumFixes/detail) x7.
- **Removed dead `#miniChart` references** from 07-overview.js + 08-shell.js (the Overview chart
  panel was removed in 1.1.0; the calls were guarded no-ops).

### Fixed — autonomous Doctor could not install a mod it proposed (found by a live MCP test)
- **A run-together modId does not match Modrinth full-text search.** The Doctor only knows the
  modId from jar metadata (e.g. `alexsmobs`), but Modrinth's search returns 0 hits for it while
  `Alex Mobs` works. `apply_fix` therefore reported "No mod found" for a dependency the Doctor had
  correctly detected.
- **New `candidateQueries()` + `pickBestMatch()` in src/mcp/repair.js (pure, tested).** A query is
  expanded into variants (raw, hyphen/space swapped, plural split) and the pooled hits are SCORED;
  the install only proceeds on an exact/normalised match. Two equal candidates -> **ambiguous**, so
  it returns the candidate list instead of blindly installing the top hit (the old code used
  `items[0]`, which could pick an unrelated mod).
- **New `findMarketProject(query, {loader})` in src/main/marketplace.js** ties it together: direct
  `/v2/project/{slug}` lookup first (catches slug-only projects), then variant searches, then the
  scored pick. `apply_fix` INSTALL_DEPENDENCY uses it and reports candidates on ambiguity.

### Fixed — marketplace loader search (same live test)
- **A generic `kind:'mod'` marketplace search fell through to the PLUGIN loader group**, so a mod
  lookup matched nothing. `loaderGroups` in marketplace.js now has a `mod` key (forge/neoforge/
  fabric/quilt union). The `mod` branch uses `explicit || loaderGroups[kind] || loaderGroups.plugin`
  (the `explicit` loader-pin variable was computed but never used before).
- **`apply_fix` pins the install to the server's real loader** (`detectServerTarget`), so a
  NeoForge server cannot get a Forge-only build.

### Fixed — transient registry fetch failures
- **`json()` (src/main/http.js) now retries GETs** with a short backoff (3 attempts, 400/1200 ms).
  A live test observed 2/5 Modrinth calls fail with a transient `fetch failed`. A 4xx is a real
  answer and is never retried; POSTs (CurseForge file-id lookup) are not retried blindly.

### Fixed — auto-update could fail to install while a server was running
- **`app:quit-install` called `quitAndInstall()` directly.** That triggers the app quit -> `before-quit`,
  but `setupQuitHandler` `preventDefault()`s that event while a server is running (to let the world
  save), which can leave the NSIS installer half-triggered and the update unapplied. The handler now
  STOPS the server first (RCON/stdin `stop`), waits up to 30s for the process to exit, force-kills if
  it hangs, THEN calls `quitAndInstall()` with a clean quit path.

### Tests
- NEW `tests/repair.test.js` (40 asserts). `tests/mcp-tools.test.js` +7 asserts (doctor tools +
  marketplace loader regression guards). `npm test` = 58 files PASS; i18n 7x881 clean.

## [2.4.0] — 2026-09-26

**Headline: performance + telemetry polish.** Two long-standing issues a real user hit while
running a NeoForge modpack server: the launcher burned ~17% CPU even when the server was idle, and
the in-app Performance tab showed **0% CPU / 0 MB** for a `run.bat` (jar-less) server because it was
measuring `cmd.exe` instead of the JVM. TPS/MSPT also stayed blank on NeoForge (which rejects
`forge tps`). All three are fixed.

### Fixed — launcher CPU burned by per-second PowerShell spawns (critical)
- **Every metrics tick (1x/s) spawned a fresh `powershell.exe`.** Startup is ~50-120ms of CPU +
  a console-window host, so an idle app showed ~17% CPU. New `src/main/platform/ps-host.js` runs
  **ONE long-lived PowerShell** (a stdin REPL verified to stream line-by-line) shared by all metric
  queries; per-call startup is paid once. Falls back to the one-shot path if the host cannot start.
- **`findJavaDescendant` enumerated EVERY process** each call; now walks only the root pid's
  descendants, one level at a time. (src/main/platform/win32.js)
- `backgroundThrottling` enabled so a hidden window's renderer timers are throttled. (app-lifecycle.js)

### Fixed — Performance showed 0% CPU / 0 MB for a run.bat server
- **A `run.bat` server's root pid is `cmd.exe`, not `java`.** The sampler used to fall back to the
  root pid after two misses, reporting cmd.exe's near-zero numbers forever. It now measures the root
  pid ONLY when that pid is itself java; otherwise it keeps resolving the JVM.
  (src/main/server-metrics.js)

### Fixed — TPS/MSPT blank on NeoForge
- **NeoForge rejects `forge tps`**, so the poll was disabled and TPS stayed empty even with Spark
  installed. When the native tps command is rejected, the launcher now uses **`spark tps`**.
  Spark presence is detected in `mods/`/`plugins/`. (src/main/server-poll.js, server-lifecycle.js)
- **Spark prints TPS / tick-durations as a HEADER line then a VALUES line**, which the single-line
  parser never saw. `parseServerLine` now remembers the header (per-instance WeakMap) and reads the
  next line's numbers (`TPS from last...` -> tps, `Tick durations...` -> mspt median).
  (src/main/server-files.js)
- **`spark tps` output spammed the console** (`[spark-worker-pool-...]` lines). The auto-poll
  suppress filter now also hides Spark's TPS / tick-duration / CPU-usage lines. (server-lifecycle.js)

### Tests
- New `tests/ps-host.test.js` (8 asserts). `npm test` = 56 files PASS; arch ctx covers `sparkAvailable`.

## [2.3.0] — 2026-09-25

**Headline: the MCP modpack tools now stop the wrong-loader / missing-dependency crash chain before
it starts.** An AI building a modpack over MCP used to get a clean-looking plan that then crashed the
server (a Forge mod on NeoForge, a wrong-MC build, or a required dependency the registry never
published — e.g. Kotlin for Forge). Plan/assemble now hard-filter by the server's real loader + MC,
read each mod's own metadata for required deps, and explain_crash reads the server log for the exact
missing mod. Plus two new tools (`check_mod_compat`, `read_crash_report`) and marketplace/diagnostic
polish.

### Fixed — wrong-loader / wrong-MC installs (critical)
- **The modpack planner only WARNED on a loader/MC mismatch, so bad versions still installed.**
  `plan_modpack` + `assemble_modpack` now hard-reject a resolved version whose loader/MC does not
  match the server (`filterPlan` + `versionMatchesServer`); the plan lists them under `rejected`, and
  assemble skips them (reporting `blocked`) unless `force:true`. (src/mcp/modpack-plan.js,
  src/mcp/tools.js)
- **Root cause: the server target was detected from the jar NAME only.** A jar-less NeoForge/Forge
  `run.bat` server resolved to `{ mc: null, loader: 'vanilla' }`, so the loader filter was a no-op.
  New `detectServerTarget()` reads `libraries/` (via `detectForgeMcVersion`) for the real loader + MC.
  (src/main/server-compat.js)
- **`search_marketplace` could return a Forge/Fabric build for a NeoForge search** (it relaxed the
  loader facet). Added a `loader` param that pins the loader and does NOT relax.
  (src/main/marketplace.js, src/mcp/tools.js)

### Fixed — missing transitive dependencies
- **Dependencies that are not on the registry were invisible.** After a version resolves, its jar is
  inspected (`META-INF/neoforge.mods.toml` / `mods.toml` / `fabric.mod.json`) for REQUIRED
  dependencies and checked against the plan/folder; missing ones are returned as `missing_deps`.
  (src/main/jar-read.js, src/main/mod-metadata.js, src/mcp/tools.js)
- **New tool `check_mod_compat`:** pre-start scan of `mods/` for wrong-loader jars, client-only mods,
  and missing required dependencies (reads each jar once via `openJar`).

### Fixed — crash diagnosis missed the real cause
- **`explain_crash` said "No associated exception found" while the cause was in `latest.log`.** It now
  also scans the log tail for `Missing or unsupported mandatory dependencies` and
  `Skipping jar … is for Minecraft Forge`, returning concrete `missingDeps` / `skippedJars` and
  raising confidence to `high`. (src/mcp/doctor.js — `scanLogForMissingDeps`, src/mcp/tools.js)
- **New tool `read_crash_report`:** read a crash-report from the server folder (the general
  `read_file` is rooted at the project, not the server).

### Changed — client/server environment model
- **A single 4-bucket env model** (`client-only` | `server-only` | `both` | `unknown`) normalizes
  Modrinth's `env` (`client`/`server`: required|optional|unsupported) and Fabric's
  `environment` (client|server|*). `list_content` annotates each mod with `env` + `serverUsable`.
- **Removed a WRONG env heuristic:** v2.3.0 derived `env` from NeoForge/Forge `displayTest`, but that
  field only controls the client/server version-mismatch warning — it is NOT a side marker. NeoForge
  now leaves `env` to Modrinth metadata. (src/main/mod-metadata.js `normalizeEnv`)
- **`search_marketplace` env was always null:** the Modrinth search API returns `client_side` /
  `server_side`, not `env`. Now mapped through `normalizeEnv`. (src/main/marketplace.js)
- **`list_content` / `check_mod_compat` env for NeoForge jars:** a NeoForge jar has no static side
  field, so env is now also read from `observerlauncher-manifest.json` (the Modrinth env recorded at
  install time). Manifest entries now carry `env`. (src/mcp/tools.js, src/main/marketplace.js)
- **`kotlinforforge` (and similar) had no `loader`:** its jar uses a non-standard layout, so no
  descriptor was readable. `loaderFromFilename` derives the loader from the file name as a last
  resort, and such a guessed loader is flagged (`loaderGuessed`) so it is NOT treated as an
  authoritative mismatch (a Forge-named jar can run on NeoForge). (src/main/mod-metadata.js,
  src/mcp/tools.js)
- **NeoForge env hint restored (carefully):** dropping `displayTest` entirely was too aggressive —
  it is a WEAK side hint and the only signal for a NeoForge jar not installed via the Marketplace.
  `classifyJar` now stores it as `envHint` (NOT authoritative `env`), and env priority is
  metadata > Modrinth manifest > `envHint` (each `list_content` row carries `envSource`).
  (src/main/mod-metadata.js, src/mcp/tools.js)

### Changed — polish
- **`search_marketplace` timeout** raised 15s -> 25s (parallel searches could time out); `json()`
  accepts an optional timeout. (src/main/http.js)
- **`list_content`** annotates each mod with its declared `loader` and a `loaderMismatch` flag.
- **`check_performance`** says "metrics warming up — retry in a few seconds" instead of a silent
  `tps: null` right after start.

### Fixed — follow-up bugs found in MCP testing (same release)
- **`check_mod_compat` false positive on mods whose descriptor is unreadable** (e.g. Kotlin for Forge
  ships `kotlinforforge-5.12.0-all.jar`): modId came back null, so an INSTALLED mod was reported as
  missing. `classifyJar` now derives the mod id from the FILE NAME as a last resort
  (`modIdFromFilename`), so present-set matching still works. (src/main/mod-metadata.js)
- **Soft/optional dependencies were reported as required** (modernfix -> JEI, noisium -> biox).
  `parseTomlDependencies` now respects `type = "optional"` (mandatory derived from type), and
  `missingDependencies` skips optional deps. (src/main/mod-metadata.js, src/mcp/modpack-plan.js)
- **`read_crash_report` returned confidence `medium` with no mods** for an FML report whose cause was
  only in `logs/latest.log`. It now always scans the log tail (like `explain_crash`) and merges
  `missing` / `fromLog`, raising confidence to `high`. (src/mcp/tools.js)
- **`type = "incompatible"` deps were treated as missing** (Noisium declares `biox` as INCOMPATIBLE —
  "crashes world gen" — yet it was reported as a missing required dependency). The parser now reads
  the 4 relation types (required/optional/discouraged/incompatible) and keeps the `reason`;
  `missingDependencies` skips incompatible, and new `conflictingDependencies` reports an incompatible
  mod that IS installed under `conflicts`. (src/main/mod-metadata.js, src/mcp/modpack-plan.js,
  src/mcp/tools.js)

### Tests
- New `tests/server-compat.test.js` (15 asserts), `tests/jar-metadata.test.js` (21). Extended
  `mcp-modpack-plan` (filterPlan/missingDependencies) and `mcp-doctor` (scanLogForMissingDeps).
  `npm test` = 55 files PASS; i18n 7x877 clean; STATIC_TOOLS drift guard passes.

## [2.2.0] — 2026-09-24

**Headline: the Create-server wizard was reworked end to end, and the multi-instance folder bug is
fixed.** This release fixes a serious bug where creating a new server could check/download into a
DIFFERENT instance's folder, plus download failures (Paper/Folia "no stable build", NeoForge wrong
version), Java version handling, and a console-spam bug. Plan + progress: docs/v2.2.0-plan.md.

### Fixed — multi-instance folder leak (critical)
- **The wizard could target the wrong instance's folder.** After `instanceAdd` + `instanceSwitch`,
  `getSettings()` still read `serverPath` from the previous instance's DOM input, so `saveSettings`
  overwrote the NEW instance with the OLD instance's path — the wizard then reported the old server's
  jar (e.g. `purpur-26.2.jar`) for an empty new folder. FIX: the wizard forces `serverPath: nsw.folder`
  when saving; `wizard:create` also takes an explicit `instance` id and runs inside
  `runInInstance(id)`, and `instances:switch` re-enters the target instance's ALS scope before
  touching `ctx.currentServerPath`/watchers/java. (src/renderer/js/12-wizard.js,
  src/main/wizard.js, src/main/settings-handlers.js)
- **Failed creates left orphan instances** ("a pile of McMod instances"). The instance is added
  before `wizard:create`; on failure it is now removed (a cancel keeps it).

### Fixed — server download
- **Paper/Folia "no stable build" failure.** The wizard defaulted to the newest version, which
  PaperMC often ships only as ALPHA/BETA right after a release, so "Latest" failed. `papermc.js` now
  walks the newest versions for the newest STABLE build (`resolveStableVersion`) and the error names
  it. Verified live: paper -> 26.2-83, folia -> 26.1.2-6.
- **NeoForge installed a beta for the wrong Minecraft.** Maven `<latest>` is a `-beta`, and the list
  spans every MC (1700+). The version step now defaults to the newest NON-prerelease and annotates
  each entry with its MC + stable flag (src/main/forge-versions.js).
- **Forge/NeoForge installer hardening (P1e):** the downloaded installer is rejected if it is
  implausibly small (<4 KB), and a failed installer now reports a short tail of its output instead of
  a bare exit code.

### Added — Wizard GUI/UX rewrite (Phase 2)
- **Card-based software picker:** a responsive 2-column grid, each card = icon + name + tag + one-line
  description + a requirements pill (Git/JDK/installer); Vanilla carries a **Recommended** badge.
- **MC-first version step for Forge/NeoForge:** pick the Minecraft version first, then a build for that
  line (newest stable first, beta tagged). A **back button** returns to the MC list (the old picker was
  a dead end). The MC labels are now real (`1.21.1`, not `21`).
- **Version chips** mark/dim non-stable versions (Paper/Folia ALPHA, NeoForge beta).
- **Review step** shows the download source, the Java the server needs, and warns when the local Java
  is too old.
- **Download state** shows speed (EMA) + ETA + Cancel.
- **Actionable errors** (`nswFriendlyError`): network, checksum, Git, JDK, folder-not-empty, disk, and
  "no stable build" (which jumps back to the version step).
- **MCP confirm dialog** now names the target instance; `assemble_modpack` returns plan-level warnings.

### Fixed — Java version handling
- **Auto-install picked the wrong Java.** It always installed Java >= 21, so old servers (1.16.5-
  need Java 8) got Java 21 and could not start. It now installs the LTS the jar needs (8/11/17/21/25),
  and is allowed to install when the detected Java is the WRONG version (older OR newer) — e.g. switch
  Java 25 -> 21 for a 1.21.1 server.
- **Java for a jar-less server (NeoForge/Forge run.bat).** A server launched via `run.bat` has no
  runnable jar, so the requirement was unknown and auto-install defaulted to Java 21 — wrong for old
  Forge (1.16.5 needs Java 8). The launcher now reads the target Minecraft version from the server's
  `libraries/` tree (`net/neoforged/neoforge/<ver>` or `net/minecraftforge/forge/<mc>-<ver>`) and
  resolves the exact Java. (src/main/server-java.js, used by files:get / settings:get / instance
  snapshot / server:files / start validation / MCP status+diagnose)
- **Java for a jar-less server (NeoForge/Forge run.bat).** A server launched via `run.bat` has no
  runnable jar, so the requirement was unknown and auto-install defaulted to Java 21 — wrong for old
  Forge (1.16.5 needs Java 8). The launcher now reads the target Minecraft version from the server's
  `libraries/` tree (`net/neoforged/neoforge/<ver>` or `net/minecraftforge/forge/<mc>-<ver>`) and
  resolves the exact Java. (src/main/server-java.js, used by files:get / settings:get / instance
  snapshot / server:files / start validation / MCP status+diagnose)
- **Java for a jar-less server (NeoForge/Forge run.bat).** A server launched via `run.bat` has no
  runnable jar, so the requirement was unknown and auto-install defaulted to Java 21 — wrong for old
  Forge (1.16.5 needs Java 8). The launcher now reads the target Minecraft version from the server's
  `libraries/` tree (`net/neoforged/neoforge/<ver>` or `net/minecraftforge/forge/<mc>-<ver>`) and
  resolves the exact Java. (src/main/server-java.js, used by files:get / settings:get / instance
  snapshot / server:files / start validation / MCP status+diagnose)
- **Java for a jar-less server (NeoForge/Forge run.bat).** A server launched via `run.bat` has no
  runnable jar, so the requirement was unknown and auto-install defaulted to Java 21 — wrong for old
  Forge (1.16.5 needs Java 8). The launcher now reads the target Minecraft version from the server's
  `libraries/` tree (`net/neoforged/neoforge/<ver>` or `net/minecraftforge/forge/<mc>-<ver>`) and
  resolves the exact Java. (src/main/server-java.js, used by files:get / settings:get / instance
  snapshot / server:files / start validation / MCP status+diagnose)
- **Java for a jar-less server (NeoForge/Forge run.bat).** A server launched via `run.bat` has no
  runnable jar, so the requirement was unknown and auto-install defaulted to Java 21 — wrong for old
  Forge (1.16.5 needs Java 8). The launcher now reads the target Minecraft version from the server's
  `libraries/` tree (`net/neoforged/neoforge/<ver>` or `net/minecraftforge/forge/<mc>-<ver>`) and
  resolves the exact Java. (src/main/server-java.js, used by files:get / settings:get / instance
  snapshot / server:files / start validation / MCP status+diagnose)
- **Java for a jar-less server (NeoForge/Forge run.bat).** A server launched via `run.bat` has no
  runnable jar, so the requirement was unknown and auto-install defaulted to Java 21 — wrong for old
  Forge (1.16.5 needs Java 8). The launcher now reads the target Minecraft version from the server's
  `libraries/` tree (`net/neoforged/neoforge/<ver>` or `net/minecraftforge/forge/<mc>-<ver>`) and
  resolves the exact Java. (src/main/server-java.js, used by files:get / settings:get / instance
  snapshot / server:files / start validation / MCP status+diagnose)
- **Overview shows Java need vs detected** ("needs Java 21, have 25") with a warning when Java is
  newer than an old server can use.

### Fixed — MCP confirm dialog lost its buttons (GUI/UX)
- **A long MCP confirmation dialog pushed Allow/Deny off-screen.** `assemble_modpack` (and any
  tool with a big `args` payload) rendered the whole JSON body inside `.confirm-modal`, which had
  no height cap; the overlay is a centered grid with no scroll, so the modal was clipped and the
  action row was unreachable. The modal is now a height-capped flex column where only the body
  scrolls, so the head and the Allow/Deny buttons stay pinned and always visible.
  (src/renderer/css/06-modals.css)

### Fixed — console spam
- **`forge tps` spam.** Some NeoForge builds reject `forge tps`, so the 5s poll printed "Unknown or
  incomplete command" forever. Those replies are now suppressed, and a per-instance `tpsUnsupported`
  flag stops the tps poll entirely after the server rejects it.

### Fixed — instance rename crash
- **`prompt() is not supported`.** `renameInstancePrompt` used `window.prompt`, unsupported in
  Electron's sandboxed renderer. Replaced with an in-app `promptDialog()`.

### Tests
- New tests/forge-versions.test.js (17 asserts). src/main/forge-versions.js extracted (pure mcFor/
  isPrerelease/annotateVersions). npm test = 52 files.

## [2.1.0] — 2026-09-24

**Headline: MCP modpack intelligence.** An AI client can now assemble a whole modpack - search,
resolve versions, check item-vs-item and item-vs-server compatibility, follow dependencies, and
install the batch in one confirmed action - instead of installing one file at a time. Rides along:
secrets encrypted at rest, rule-based crash classification, port-holder diagnosis, and test debt.
Plan + progress: docs/v2.1.0-plan.md.

### Added — modpack planner/assembler (MCP)
- **`plan_modpack` now detects item-vs-ITEM conflicts** (`planConflicts` in src/mcp/modpack-plan.js):
  the same project planned at two different versions, two projects writing the same file, and Modrinth
  `incompatible` relations. The per-item check only compared an item against the SERVER before; two
  items could still clash with each other. Returned as `conflicts[]`.
- **`plan_modpack` flags already-installed content** (`alreadyInstalled` per item + a top-level count),
  so an AI can skip a re-install instead of overwriting a file the user already has.
- **Plan-level warnings** (`planWarnings`): a Fabric/Quilt server with mods but no Fabric API
  (`fabricApiMissing`), a proxy config present (`proxy`), and a per-mod Java requirement that exceeds
  the server's Java (`java`) - each a stable code the AI can act on.
- **Install a modpack from the registry.** `install_from_market` accepts `kind: 'modpack'` - it
  downloads the `.mrpack` and runs the SAME `importMrpackFromPath` the GUI uses (files + overrides),
  instead of requiring a manual download. New read tool **`search_modpacks`** (Modrinth).
- **`list_market_versions` is multi-source** (Modrinth + Hangar + CurseForge) via a shared
  `listMarketVersions()` in src/main/marketplace.js - was Modrinth-only. Pick an exact `versionId`
  before installing.
- **`assemble_modpack` preflight + undo aid.** It resolves every item first and returns
  `preflight.totalBytes` (+ `over500MB`) before downloading, and records `createdFiles` so a partial
  failure can be undone with a follow-up `delete_content` (the user still approves).
- **Dependency follow depth raised 2 -> 3** (required Modrinth deps), keeping the seen-set cycle guard
  and the `capPlan` budget.
- `resolveMarketDownload` / `listMarketVersions` now also return `size` (non-breaking).
- bridge.js `STATIC_TOOLS` + `search_modpacks` (drift guard passes). Tests: tests/mcp-modpack-plan.test.js.

### Security — secrets encrypted at rest
- New **src/main/secrets.js**: secrets are stored as `safe:<base64>` (Electron `safeStorage` - DPAPI /
  libsecret / Keychain) or `plain:<value>` when no keyring is available. `settings.js` wraps every
  secret on write and unwraps on read; applied to `curseforgeApiKey` and per-instance `rconPassword`.
- No new migration version: wrapping is idempotent and backward compatible (a legacy value with no
  prefix is read as plaintext). A `safe:` value that cannot be decrypted returns empty rather than
  leaking ciphertext as a password. Tests: tests/settings-secrets.test.js.

### Added — diagnostics
- **Crash classifier** (`doctor.classifyCrash`): maps a crash report to a category an AI can act on -
  out-of-memory, java-version, mixin-conflict, mod-dependency, port-conflict, corrupt-jar (or unknown) -
  with a confidence and concrete hints. `explain_crash` now returns it as `classification`.
- **Port-holder diagnosis** (`check_port`): when a port is busy, reports whether ANOTHER
  ObserverLauncher instance holds it vs an unknown process, and suggests the next free port.
- **PII scrub now covers IPv6** (and IPv4 octets are range-checked, so `999.1.1.1` is left alone),
  while still leaving a log timestamp like `12:34:56` untouched. `select_instance` description warns
  that it switches the user's GUI (prefer a per-call `instance:` or `get_instance_snapshot` to read).

### Changed — polish
- **MCP confirm dialog names the target instance.** The write/destroy confirmation now shows which
  server the tool will act on (resolved before the dialog, not after), so a multi-instance user does
  not have to read the raw JSON args to find out. New i18n key `mcp.targetInstance` (7 locales).
- **`assemble_modpack` returns plan-level warnings** (Fabric API missing / proxy / Java) in its report,
  the same helper `plan_modpack` uses, so the install result is self-contained.

### Tests
- New tests/mcp-modpack-plan.test.js (planner/conflict/warning helpers), tests/settings-secrets.test.js,
  tests/server-properties.test.js (the `buildPropertiesContent` security choke point: in-place edits,
  CRLF, newline-injection and prototype-pollution rejection). i18n dynamic-key coverage and the
  metrics-tick assertion were verified already-present.

### Notes
- `detectServerCompat` (modpacks.js) is deliberately NOT merged with `detectSoftware`
  (server-files.js): the former is finer (splits forge/neoforge + fabric/quilt) for modpack compat,
  the latter returns the coarse group the UI wants. The `.mrpack` build path is already shared.
- Deferred to 2.2.0: verify the Linux build on real hardware, the Electron 37 EOL upgrade, and
  auto-update code-signing.

## [2.0.0] — 2026-09-23

**Headline: multi-instance management.** Single-server -> manage N servers, each with
its own folder, Java runtime, RCON, schedule, backups and public tunnel. Work was phased
(A foundation -> B UI -> C hardening). Plan + progress: docs/v2.0.0-plan.md. With a single
instance the app behaves as before (lists and gates stay hidden).

### Security — Playit agent integrity (Phase C item 12)
- `installPlayitAgent` now verifies the downloaded agent before use: the SHA-256 is taken from the
  release's `asset.digest` (GitHub publishes it with the API response — always current, never stale),
  falling back to a pinned hash table (`PLAYIT_PINNED_SHA256`, v1.0.10) when no digest is present. A
  mismatch deletes the file and refuses to install. `sha256File` streams the hash (no full-file buffer).
- Authenticode: Windows-only `Get-AuthenticodeSignature` status is LOGGED (not enforced) — the agent
  may legitimately be unsigned, so a hard failure would break the install.
- **Fixed:** `pickPlayitAsset` used a plain `.find()`, so on Windows it selected
  `playit-windows-x86_64-signed.msi` (listed first) over `playit-windows-x86_64.exe` and saved the MSI
  as `playit.exe` — the agent would never run. Now installer/archive packages (.msi/.apk/.deb/...) are
  deprioritised in favour of a runnable binary. Tests: tests/tunnel.test.js (32 asserts).
- Hash source note: the GitHub API is anonymous rate-limited, but the release page's
  `expanded_assets` fragment returns the same `sha256:` digests — how the pinned table was captured.

### Fixed — MCP multi-instance correctness + agent workflow
- **Settings/schedule tools now honour the `instance` arg.** `get_settings`/`set_setting`/`get_schedule`/
  `set_schedule` used `loadSettings()`/`saveSettings()`, which always resolve the ACTIVE instance, so
  targeting another instance read the wrong server and — worse — `set_setting` WROTE to the active one.
  New `settings.saveSettingsFor(id, flat)` writes a SPECIFIC instance (global keys stay top-level);
  the tools read via `loadSettingsFor(ctx.inst())`. Omitted instance = active (backward compatible).
- **`kick_player` / `stop_server` / `stop_instance` now route through `sendConsoleCommand`** (RCON-first,
  stdin fallback) instead of writing `ctx.serverProcess.stdin` directly — the old path silently failed
  for an RCON-attached or adopted server (stdin stub is null).
- Removed dead `loadSettings()` in `get_status`.
### Added — `get_instance_snapshot` MCP tool (workflow)
- Read ANY instance's full state (status, console tail, live metrics, java, files) WITHOUT making it
  active — so an AI can inspect/compare a background server without flipping the user's GUI. Mirrors the
  IPC `instances:snapshot`. bridge.js INSTRUCTIONS + STATIC_TOOLS updated. Tests: tests/mcp-instance-settings.test.js (48 files).

### Fixed — Players tab flicker while the console was busy
- The server folder watcher rescanned on every write while the server was running. A live server
  writes logs/ and world/ constantly, so `fs.watch` fired nonstop; each rescan pushed `server:files`
  -> `refreshUI()` -> a full rebuild of the Players (and Content) lists, which replayed their stagger
  animation and looked like flicker. The watcher now rescans only while the server is fully stopped
  (those mid-run writes never change what `serverFiles()` reports anyway).
- `renderPlayers()` gained a signature guard: if the page content is unchanged it leaves the DOM
  alone instead of rebuilding innerHTML (which restarted the row animation). The signature includes
  the locale, filter, search, page and each row's state.

### Fixed — Player inspector width + text clipping
- The inspector modal is `class="modal wide player-modal"`. `.modal.wide` (specificity 0,2,0) in
  06-modals.css beat `.player-modal` (0,1,0) in 07-polish.css, so the width stayed at 720px and the
  two-column body squeezed its content. The rule now matches the specificity
  (`.modal.wide.player-modal`) and the modal opens at 1120px.
- The dimension line and the readout values used `white-space:nowrap` + ellipsis, which truncated
  `minecraft:overworld` to `overwor...`. Both now wrap (`overflow-wrap:anywhere`).

### Changed — README rewrite (2.0.0)
- Rewrote README.md from scratch: shorter, denser, no filler. Removed the marketing tone, the
  "What is this?" essay, and repeated superlatives. Added a multi-instance section (the 2.0.0
  headline) and updated the FAQ entry that wrongly said settings are shared one-set-only.

### Changed — micro-interactions (UI polish, option A)
- Added an understated motion layer (end of `css/09-pulse.css`) for surfaces that used to snap:
  form controls (input/select/textarea) now ease border/shadow on hover+focus; filter chips,
  interactive rows/cards (player/backup/world/diag/file), icon/row/copy buttons, step chips and
  badges, progress bars, and command-bar buttons get a quiet colour/border hand-off. No hover
  lifts or scale beyond the existing press rule; every duration uses `var(--dur-*)`, so the
  motion-tokens ratchet stays at 124 and the global reduced-motion kill still applies.
- Accordions (`<details>`) now animate open/close via `::details-content` + `interpolate-size:
  allow-keywords` (progressive — falls back to instant on older engines); scrollbars gained a
  hover-emphasis thumb + transparent track/corner.

### Added — Tunnel overview (Q2)
- Settings > Advanced gains a **Tunnel overview** table: one row per instance with its
  status dot, name and public Playit address (or a "no address yet" hint) plus an
  **Open dashboard** button. Pure renderer — `listInstances()` now also returns the
  per-instance `tunnelAddress`/`autoTunnel`, so no new IPC channel. Hidden with a single
  instance, so the one-server screen is unchanged. i18n tun.ov* (7 locales, 837 keys).

### Added — process identity helper (M1, orphan-cleanup prereq)
- `platform.getProcessInfo(pid)` -> `{ alive, name, startTimeMs }` or `null`
  (win32.js + linux.js). Windows: `Get-CimInstance Win32_Process` Name +
  CreationDate->epoch-ms. Linux: `/proc/<pid>/stat` (state, starttime field 22) +
  `/proc/stat btime`; a zombie (`Z`) reports not-alive. The creation time is the
  PID-REUSE guard for orphan cleanup (never kill a recycled pid). Tests:
  tests/process-info.test.js.

### Added — settings schema v4 (M2, multi-instance store)
- Settings move from flat single-server to `{ global..., instances:[],
  activeInstanceId }`. `migrations.js` v3->v4 moves the per-instance keys
  (serverPath, javaPath, memoryMin/Max, jvmArgs, autoRestart*, autoBackupMinutes,
  backupRetention, schedule*, autoTunnel, tunnelAddress) into `instances[0]`
  (id `default`, name = basename). Global keys stay top-level. Empty serverPath ->
  `instances: []`.
- **Data-loss trap closed.** `loadSettings()` now backs up `settings.json` ->
  `settings.v3.bak.json` BEFORE migrating, and on a migration throw returns the
  ORIGINAL settings (legacy code returned full defaults, which would silently wipe
  a user's config). A store written by a NEWER app is not downgraded (version gate
  + warning). Root cause note: migrate() runs inside try/catch in loadSettings.
- **Flat-view shim** (`flattenActive`/`nestInstances`): `loadSettings()` still
  returns the flat shape and `saveSettings()` re-nests, so the ~26 existing
  callers (settings-handlers, wizard, tunnel, mcp/tools) needed NO change. Tests:
  tests/migration-v4.test.js (35 asserts).

### Added — persistent process identity (M3)
- New `src/main/runtime-state.js`: per-instance `{ pid, processStartedAt,
  serverPath }` in `userData/runtime.json` (kept separate from settings.json so the
  settings:save rewrite cannot race/lose it). `server-lifecycle.js` records it on
  spawn (start-time refined from getProcessInfo) and clears it on error/exit.
  This is what makes orphan cleanup possible after an app crash. Tests:
  tests/runtime-state.test.js.

### Added — instance context foundation (M4a)
- `context.js` gains `instances: Map`, `activeInstanceId`, and an
  `AsyncLocalStorage`-backed `ctx.inst()` / `ctx.runInInstance(id, fn)` /
  `ctx.seedInstances()`. `settings.js` gains `loadSettingsStore()` (nested store, for
  seeding) while `loadSettings()` stays flat. Why: instance id travels WITH the async
  call chain, so concurrent handlers cannot race a global mutation. Tests:
  tests/instance-context.test.js (ALS isolation across interleaved chains).

### Changed — per-instance ctx accessors + choke-point wrapping (M4b)
- Every per-instance `ctx` field (`currentServerPath`, `serverProcess`,
  `consoleBuffer`, `live`, `metricsHistory`, `currentSoftware`, restart/backup/
  scheduler timers, `buildProcess`, `wizardAbort`, content/editor watchers, ...) is now
  a getter/setter over the CURRENT instance's state object (`instState()`), so call-sites
  keep plain property syntax while `ctx.inst()` (AsyncLocalStorage) routes each read/write
  to the right instance. Single source of truth: `INST_FIELDS` + `freshInstState()`.
- `serverStatus` / `javaInfo` / tunnel / mcp stay GLOBAL for now (serverStatus is deferred
  to its own careful step because `setServerStatus` feeds it).
- `ctx.seedInstances()` now MERGES instead of replacing the instances Map, so runtime
  fields survive a settings-driven re-seed (previously a re-seed would wipe live state).
- Choke points wrapped in `ctx.runInInstance(activeInstanceId, ...)`: the MCP `callTool`
  handler (src/mcp/server.js) and every IPC handler (src/main.js routes a thin `ipcMain`
  proxy that only rewrites `handle`). Stops an instance switch mid-await from leaking
  state across concurrent calls. Tests: tests/arch-ctx-accessors.test.js (static guard +
  accessor + ALS isolation).

### Changed — per-instance event gate (M5)
- `context.js` `send()` now gates four channels (`server:metrics`, `server:live`,
  `server:files`, `server:log`): a push is dropped unless `ctx.inst()` equals the
  active instance, so N background instances no longer cost N× IPC + N× renderer
  redraws for a view nobody is looking at. Background instances still SAMPLE (metrics
  history keeps filling).
- `server:state` is NOT gated (the rail status dot must reflect a background crash/stop).
  `server:log` error lines (`type:'error'` or ERROR/Exception text) BYPASS the gate so a
  background crash still reaches the rail badge; all other lines are gated. `appendLog`
  stamps `instanceId` on every line. Non-gated channels (`app:*`, `tunnel:*`, `market:*`,
  ...) are unchanged. Tests: tests/instance-event-gate.test.js.
- NOTE: the renderer-side switch snapshot (`getInstanceSnapshot(id)` on instance switch)
  belongs to the Phase B UI and is not built yet; this is the backend half.

### Added — multi-instance backend + rail list (Phase B, B1+B2)
- B1 (backend CRUD): `settings.js` gains `listInstances/addInstance/switchInstance/
  renameInstance/removeInstance` (id = 4 random bytes hex; add refuses a folder already
  used by another instance; remove never touches the folder on disk). New IPC
  `instances:list/add/switch/remove/rename` + preload bridge; `settings:get` now returns
  `instances[]` + `activeInstanceId`. Every mutation re-seeds ctx. Tests:
  tests/instance-crud.test.js (30).
- B2 (rail): `.instance-list` between the brand and the nav (items use `.inst-item` +
  data-instance, NOT `.nav-item`/data-tab, so switchTab + keyboard nav are untouched).
  Renderer `renderInstanceList()` (called from refreshUI) + `switchInstance(id)` re-pulls
  the snapshot. List stays hidden with a single instance, so first-run UI is unchanged.
  i18n nav.instances/addInstance + inst.* (7 locales). CSS uses var(--dur-fast) (motion
  ratchet).
- B3 (add/remove/rename UI): the wizard is now the "Add instance" flow — 5 steps, step 1
  picks the folder, and Review CREATES A NEW INSTANCE (fresh id, made active) for that
  folder before running the download (never overwrites the active instance's settings).
  The rail's "+ Add instance" and the onboarding/welcome "Create a new server" buttons
  open it. Each rail row has rename (prompt) + remove (confirm, refuses while running,
  never deletes the folder) icon buttons. i18n nsw.folder*/railFolder + inst.removeConfirm/
  stopFirst (820 keys).
- B4 (switch scope): `settings:get` also returns the active instance's `metricsHistory`.
  On switch the renderer repaints the console from the new instance's buffer
  (`repaintConsole`) and rebuilds the chart ring (`rebuildSamples`). The non-gated
  `server:state` is now tracked per instance (`state.instanceStatus`) so a background
  instance's crash/stop updates its rail dot WITHOUT flipping the active view.
- B5 (concurrent start + RAM budget): `ctx.serverStatus`, `waitingForDone` and
  `runtimeInstanceId` are now PER-INSTANCE (the last two were a module-level `let`). Every
  server-process callback (error/stdout/stderr/exit + the two timers) is wrapped in
  `ctx.runInInstance(instId, ...)` so a background server's events can never read or write the
  active instance's state. Starting instance B while A runs is now allowed. New
  `platform.getTotalMemoryMB()` + `checkRamBudget()`: sums memoryMax of running instances +
  the new one vs total RAM — blocks >100%, logs a warning >80%. Tests:
  tests/instance-start.test.js. NOTE: the metrics sampler is still a single global loop bound
  to the active instance, so a BACKGROUND instance's metrics are not sampled yet (Phase C).

### Hardened — Phase C (13/14/15/17)
- 13: `doctor.js` console analysis now has a regex/scan budget — each line is capped at
  REGEX_MAX_LINE (4000) and the whole scan stops after ANALYZE_BUDGET_MS (250ms), returning a
  `timedOut` flag instead of risking a catastrophic-backtracking freeze.
- 14/15: NEW `tests/arch-hardening.test.js` — (a) `13-bootcheck.js` must be the LAST script in
  index.html; (b) every channel preload.js invokes is registered in src/main (64/64); (c) no
  non-whitelisted `fs.writeFileSync` in src/main (atomic-write guard, whitelist for the atomic
  helper + tiny/binary/staging/user-path writers).
- 17: `doctor.scrubPII()` masks IPv4 + email; wired into the MCP read_console + analyze_console
  tools and the console export, so logs shared with an AI or a file do not leak addresses.
- A7/A8 (multi-instance foundation): `checkPortLease()` refuses starting an instance whose
  `server-port` is already used by another RUNNING instance (reads each instance's
  server.properties). `safeTarget` confinement is per-instance root (ctx.currentServerPath is an
  ALS accessor), so a path resolving into instance B from instance A is rejected. Tests:
  tests/instance-port-path.test.js.
- 16: graceful-shutdown escalation. `server:stop` now arms `scheduleGracefulEscalation` —
  `stop` -> wait 15s -> SIGTERM/taskkill -> wait 5s -> SIGKILL, logging which instance had to be
  force-killed (its world may not be fully saved). Per-instance `shutdownTimer`; each tick runs
  inside runInInstance(instId) so it can never touch another instance. Critical with N servers.

### Added — orphan cleanup, 3-tier (M8)
- NEW `src/main/orphan.js`. After a crash, `runtime.json` (M3) records a pid per instance and
  `platform.getProcessInfo` (M1) reports whether it is alive + its real creation time. Tiers:
  **t1** alive java + stored stopped -> auto-kill (leftover) + log; **t2** alive java + stored
  running/starting -> left untouched for review (GUI dialog is a later step); **t3** alive but a
  DIFFERENT creation time or not java (PID reuse) -> never kill, just drop the stale record.
  `runtime-state.setInstanceStatus` + `context.setServerStatus` keep the tier hint current. Wired
  into `main.js` boot. Tests: tests/orphan.test.js.

### Changed — per-instance metrics sampling
- `startMetrics` now samples EVERY instance, not just the active one: one interval loops the
  instance ids and runs each tick inside `ctx.runInInstance(id, ...)`, so a background server's
  `metricsHistory` keeps filling and its chart is correct the moment you switch to it. Per-instance
  counters are keyed by instance id. GATED channels keep this at 0 IPC for unseen servers.

### Added — RCON transport (M6)
- NEW `src/main/rcon.js`: a dependency-free Source-RCON client (pure `encodePacket`/`decodePacket`
  + `RconClient` connect/auth/exec/close; a `-1` packet id signals auth failure) plus
  `makeRconCreds` and `desiredRconProps`.
- Per-instance `rconPort`/`rconPassword` (added to PER_INSTANCE_KEYS + defaults — no new migration
  version needed). Before spawn, `ensureRconInProperties` writes `enable-rcon=true` + the port +
  password into server.properties (existing user RCON config is preserved). On `Done (...)!` the
  app attaches an RCON client; on exit/error it closes it. Console commands now go through
  `sendConsoleCommand` (RCON first, stdin fallback for the first seconds of boot). Both the IPC
  `server:command` and the MCP `send_command` tool route through it. `checkPortLease` also guards
  `rcon.port` across running instances. Tests: tests/rcon.test.js (real mock server + fallback).

### Changed — per-instance Java (M7, JRE isolation)
- `ctx.javaInfo` (the detected Java runtime) is now PER-INSTANCE, not a global. A background
  instance's Java detection no longer overwrites the active instance's. `instances:switch`
  re-detects Java from the target instance's own `javaPath`. Because each spawn uses
  `ctx.javaInfo.path`, instance A (Java 17) and B (Java 21) can run at the same time. The JRE
  auto-installer already caches per major version (userData/jre<major>), shared by instances.

### Added — TunnelManager (M10)
- The Playit daemon is GLOBAL (one process serves N tunnels); the app now tracks WHICH instances
  still need it via `ctx.tunnelDaemonUsers` (Set<instanceId>) + `src/main/tunnel-manager.js`. When
  an instance stops (or its server exits) it is dropped from the set, and the daemon is killed ONLY
  when no instance still needs it AND the app started it — a user-run daemon is never stopped.
  `autoStartTunnel` registers the instance before starting. `tunnelAddress` stays per-instance.

### Added — MCP multi-instance (M11)
- New MCP tools: `list_instances` (read), `select_instance` (write), `start_instance` /
  `stop_instance` (write/destroy). Every server-scoped tool now accepts an optional `instance` arg
  (resolved at the single `callTool` choke point); omitted -> the active instance, so existing AI
  clients keep working. `settings.js` gains `loadSettingsFor(id)` + `resolveInstanceId(id)`.
  bridge.js INSTRUCTIONS describe the multi-instance model and STATIC_TOOLS lists the 4 new names.

### Changed — per-instance scheduler
- `startScheduler` now runs the schedule for EVERY instance (looping `ctx.instances` and running
  each tick inside `ctx.runInInstance(id)`), so a background server still auto start/stops on its
  own schedule. `schedulerTick(ctx, now, settings?)` stays backward-compatible. Instances with no
  server folder are skipped.
- `startAutoBackupWatcher` also runs for EVERY instance now (each keeps its own autoBackupMinutes
  cadence, since autoBackupMinutes/backupRetention are per-instance).
- Orphan tier-2 now ASKS the user: a server left running by a crash shows a dialog (Reconnect /
  Stop it). Reconnect keeps the runtime record (default on Escape); Stop force-kills the tree. New
  `src/main/orphan-prompt.js` + i18n orphan.* (7 locales). Reconnect now FULLY re-attaches:
  `adoptProcess` adopts the live pid (alive + java + start-time guard), makes it `ctx.serverProcess`
  (stub, no stdin), sets status running, re-attaches RCON, resumes metrics on the pid, and a liveness
  poll replaces the missing exit event; `server:stop` uses RCON for an adopted process. The foreign
  process's stdout can't be recovered, so the live console tail is unavailable for an adopted server.

### Added — instance snapshot (B4 follow-up)
- `instances:snapshot(id)` returns a full state snapshot of ANY instance (status, console tail,
  live, metrics history, java, files, active flag) without switching the active one. New preload
  `instanceSnapshot(id)`; tests/instance-snapshot.test.js.

### Notes
- Test suite: 47 files, all passing (`npm test`); Playwright E2E `npm run test:e2e`.
  With one instance the behaviour is unchanged by design (lists/gates stay hidden).
- Known gap: Phase C item 12 (Playit binary SHA-256 pin + Authenticode verification)
  is still open — it needs a real per-release hash, which is blocked by an anonymous
  GitHub API rate limit. Authenticode can be checked from the downloaded file when the
  pinned hash is available. See docs/v2.0.0-plan.md PROGRESS block.

## [1.5.0] — 2026-09-22

A hardening release. No new server features. It closes four weaknesses found in an external review:
silent renderer load-order failures, an untested responsive layout, an MCP path rewrite that could
mis-fire in a packaged build, and an unenforced motion contract.

### Added — CurseForge as a fourth marketplace source
- Search + install from CurseForge (which hosts many mods/modpacks that are not on Modrinth).
  Because Overwolf's Terms of Service forbid sharing an API key, the app **never bundles one**: the
  user pastes their own key in Settings and it is stored locally, sent only to api.curseforge.com,
  and never logged. The CurseForge source only appears once a key is saved.
- Honest handling of the author distribution toggle (since 10/2024 authors can block third-party
  downloads): for those projects the API returns no download URL, so instead of a fake error the UI
  shows a **no auto-install** badge and an **Open page** button (the manual import path already
  exists). The app deliberately does NOT synthesize a CDN URL to bypass the toggle.
- New pure module `src/main/curseforge.js` (classIdForKind, loaderIdFor, cfFileInstallable,
  mapCfItem, pickCfFile); `searchMarket`/`resolveMarketDownload` gained a CurseForge branch reusing
  the same guards (isSafeDownloadUrl, safeTarget, 512 MB cap, manifest). `isSafeDownloadUrl` now
  allows `forgecdn.net`. `json()` accepts optional headers. New IPC `market:curseforge-status`.
  MCP `search_marketplace`/`install_from_market` accept `curseforge`; blocked projects return
  `blocked:true`. Tests: tests/curseforge.test.js (29 asserts). Tool count unchanged (60).

### Fixed — MCP planner source allowlist + assemble warnings (external review)
- **`normalizePlanItem` was missing `curseforge`** in its source allowlist, so a CurseForge item
  passed to `plan_modpack`/`assemble_modpack` was silently coerced to Modrinth and resolved the
  wrong project (or failed confusingly) — even though search/install already advertised 4 sources.
  Added `'curseforge'`. Regression assert added (parses the allowlist from tools.js).
- **`assemble_modpack` now returns per-item compatibility warnings.** It recomputes `itemCompat`
  for each installed item, so the report carries warnings even if the caller never ran
  `plan_modpack` first (that "show plan, then assemble" flow is prompt-driven, not enforced).
  Added `withWarnings` count to the result.

### Added — CurseForge version picker
- The install modal now shows a **version list for CurseForge projects** too (was Modrinth-only).
  `market:detail` gained a `curseforge` branch that fetches `/mods/{id}/files` and maps each file to
  the SAME shape the version picker already uses (via new pure `mapCfFileToVersion`); files the
  author blocked for third-party downloads are flagged and labelled. Needs the user's key.
- `resolveMarketDownload` now honours an explicit `versionId` for CurseForge (picks that exact file
  before falling back to the newest match). Limitations kept honest: CF files carry no loader list
  and no per-version dependency graph, so those stay empty.
- Tests: curseforge.test.js +9 asserts (mapCfFileToVersion) -> 68 total.

### Added — CurseForge dependencies surfaced in the MCP planner
- `plan_modpack` now lists a CurseForge item's declared dependencies as an informational field
  (`entry.dependencies`, each `{ projectId, type, uncertain }`). They are **shown, never
  auto-installed**: CurseForge publishes no official `relationType` value table, so required vs
  optional cannot be told apart reliably. An `incompatible` dependency becomes a plan warning.
- `curseforge.js` gained `cfDependencies(file)` (maps the widely-used 3=required/2=optional/
  5=incompatible, marks everything else `uncertain:true`); `resolveMarketDownload` CF branch now
  returns those deps. Modrinth deps (clear types + versionId) are still auto-followed depth 1-2;
  the `versionId` guard means CF deps are not queued. Tests: +8 asserts.

### Added — CurseForge modpack import (.zip with manifest.json) + blocked-mod fallback
- The import dialog now accepts BOTH `.mrpack` and a CurseForge `.zip`. A dispatcher detects the
  format from the extracted archive (`modrinth.index.json` vs `manifest.json`) and routes to the
  right importer; the `.mrpack` path is unchanged.
- CurseForge packs reference files by `{projectID, fileID}` with no URLs, so `importCfModpack`
  resolves them through the CF API (needs the user's key), downloads what the author allows, copies
  overrides, and records manifest entries. `resolveCfFileIds` batches the lookups (1000/call).
- **Blocked-mod UX (Prism-style).** Mods whose author disabled third-party downloads cannot be
  auto-installed, so they are returned as a `blocked[]` list. The renderer opens a dialog listing
  each one with an **Open page** link; the user drops the files into the server folder and clicks
  **Check**, which hashes what is on disk against the expected SHA1 (`verifyBlockedFiles`, new IPC
  `modpack:verify-blocked`, preload `verifyBlockedMods`). The app never bypasses the author's choice.
- `curseforge.js` gained pure helpers `parseCfManifest`, `cfLoaderFromManifest`, `partitionCfFiles`,
  `verifyBlockedFiles`. `http.js` `json()` gained optional `method`/`body` for the CF POST. Tests:
  curseforge.test.js grew to 51 asserts (manifest/loader/partition/verify).

### Added — MCP modpack builder (plan + assemble)
- Two new MCP tools let an AI build a whole modpack with ONE confirmation instead of one per file.
  **`plan_modpack` (read)** resolves a list of candidate ids into an install plan: exact version,
  target folder, per-item compatibility warnings against the detected server (MC/loader mismatch,
  client-only), and required Modrinth dependencies (depth 1-2, capped). **`assemble_modpack`
  (write)** installs the approved list in a single confirmed batch and returns a per-item report
  (installed/failed). The AI supplies ids/source/version only; URLs and hashes are always resolved
  by the app from the registry (never taken from the model). Tool count 58 -> 60.
- NEW pure module `src/mcp/modpack-plan.js` (folderForKind, itemCompat, dedupeById, capPlan) so the
  decision logic is unit-tested without network or Electron (tests/modpack-plan.test.js, 19 asserts).
  `resolveMarketDownload` now also returns gameVersions/loaders/dependencies (non-breaking; existing
  callers ignore them). bridge STATIC_TOOLS updated (drift guard passes).

### Added — renderer boot self-check (fail loud)
- **`js/13-bootcheck.js`** (new, loads LAST): asserts the small set of globals the boot path and each
tab need (`javaMajorOf`, `applyLocale`, `switchTab`, `refreshUI`, `openEd`, `wmLoad`, …) actually
exist after every script has evaluated. The renderer is classic scripts in load order with no
bundler, so a helper used before its file loads throws a ReferenceError and the tab silently goes
blank (shipped 3 times: `javaMajorOf`, `debounce`, `switchTab`). Now a missing global logs a console
error AND shows a fixed banner, so a load-order regression is loud instead of a blank screen. Uses
bare `typeof` probes (not `eval`) because the CSP is `script-src 'self'`.

### Added — responsive E2E test
- The E2E helper injects a style tag neutralising the 1100px breakpoint so nav clicks work on small
CI screens; that left the real responsive layout untested. A new test removes the inject, sets a
narrow viewport and asserts `.rail` hides below 1100px and shows at/above it, then restores the
desktop layout. Suite is now 12 tests.

### Changed — MCP bridge path rewrite
- `bridgeScriptPath()` (src/mcp/server.js) now rewrites only the exact `app.asar` path SEGMENT
instead of a plain `String.replace('app.asar', …)`, which could also rewrite an already-unpacked
path (`app.asar.unpacked` -> `app.asar.unpacked.unpacked`) or an unrelated directory containing the
substring.

### Added — motion-token ratchet test
- `tests/motion-tokens.test.js` (new) counts literal durations in `transition`/`animation` CSS and
fails if the count rises above the 1.5.0 baseline (124). A hard rule would fail today (older rules
still use literal ms/s); the ratchet stops the debt growing while allowing it to shrink.

### Notes
- `npm test` 29 files PASS, `npm run test:e2e` 12 tests PASS. Version not bumped yet.

## [1.4.0] — 2026-09-21

A hardening + tooling release. No new server features — the goal is a sharper safety net and a
cleaner codebase: real end-to-end coverage of the UI, per-download size caps, a stricter i18n test,
duplicate-locale-key cleanup, and honest World Map behaviour on modded servers.

### Added — E2E coverage (tests/e2e/)
- **Interaction suite** (`interaction.spec.js`, new): the E2E suite grew from 4 smoke tests to 11.
  It now drives real flows and asserts the renderer stays error-free — the class of bug unit tests
  cannot see (boot-order ReferenceErrors, JS-measured elements inside hidden tabs, JS-owned text
  clobbered by `applyLocale`).
- **Renderer-error capture** in `helpers.js`: every `pageerror` / `console.error` is collected and
  asserted empty after a full tab + modal tour.
- **Fixture server** (`makeFixtureServer()`): a throwaway server folder (server.properties, plugins,
  world, logs) so Content / file-browser / editor / Properties flows run offline and deterministically.
- **E2E hook** (`OBSERVER_E2E=1`, read in `preload.js` -> `observer.isE2E`, `java.js`, `08-shell.js`):
  boot skips the Modrinth version fetch and the real `java -version` spawn, so the suite is offline
  and CI-runner-independent. (Previously the env var was set by the helper but read nowhere.)
- CI: `playwright.config.js` retries once on CI only; `test.yml` Node 20 -> 22 (matches release.yml).

### Changed — World Map on modded servers (honest degradation)
- **Custom biome colours.** `biomeColor()` no longer falls back to one grey for every biome it does
  not recognise (usually mod-added); unknown ids get a stable hash-derived colour, so each custom
  biome is distinct and consistent across sessions. Named vanilla families (ocean/forest/…) still
  use the curated palette.
- **Custom-dimension awareness.** New backend `listDimensions(root, levelName)` scans
  `<world>/dimensions/<namespace>/<path>`; `worldmap:load` returns the list. The map cannot draw
  modded dimensions yet, so the tab now shows a one-line note naming them instead of silently
  showing the wrong (overworld) data.
- **Modded banner.** When the server jar looks modded (forge/neoforge/fabric/quilt) or the world
  declares non-`minecraft:` dimensions, a short note appears above the map. JS-owned text (no
  `data-i18n`), so `applyLocale()` cannot clobber it.

### Changed — download size caps
- `download()` already had a 2 GB default cap; every caller now passes an explicit per-purpose
  `maxBytes`: server jars 1 GB, modpack packages 1 GB, JDK/JRE archives 512 MB, market files and
  modpack members 512 MB, Forge/Spigot/BuildTools installers and the Playit agent 256 MB. A
  hostile or redirected URL can no longer fill the disk on a path where 2 GB was far too generous.

### Changed — i18n test
- The i18n test now also resolves the one **finite** dynamic-key family: `t('nav.' + tab)` is checked
  against every `data-tab` declared in the HTML (10 candidates), instead of staying blind to it.
- Removed **66 redundant duplicate locale keys** (33 each in pt-BR and zh-CN) — byte-identical blocks
  that the runtime object silently deduped. `i18n.test.js` now reports "no duplicate keys in any
  locale".

### Notes
- `npm test` (28 files) and `npm run test:e2e` (11 tests) both green. Version NOT bumped yet.
- Screenshots in README are still from before the 1.1.0 UI overhaul (tracked separately).

## [1.3.5] — 2026-09-21

Closes the main dead ends in the MCP diagnostics workflow, from a detailed community issue.

### Added — MCP diagnostics
- **`read_server_log`** — tails the server log file (`logs/latest.log` by default) with a bounded
  line count and byte cap, so an AI can see what happened on a PREVIOUS run after a restart (the
  in-memory console buffer is lost on restart). Deliberately NOT added to the editor allowlist —
  it is a read-only tail confined to `logs/`, so a 500 MB log can't blow the context window.
- **`list_crash_reports`** — lists every crash-report (name, mtime, size), newest first.
- **`explain_crash` now takes an optional `name`** — read an older crash instead of only the newest.
- **`get_metrics_history`** — a time series of sampled metrics (tps, mspt, cpu, ram, players) so an
  AI can answer 'is memory climbing?' / 'when did TPS drop?'. Backed by a 1800-sample ring buffer
  (~30 min) in the main process, downsampled to a bounded count.

### Changed — MCP player tools
- **`ban_player` accepts an `ip`** — ban/unban an IP (`ban-ip` / `banned-ips.json`), not only a name.
- **`op_player` accepts a `level` (1–4)** — create lower-privilege moderators, not just full op.

### Notes
- Tool count 55 -> 58. `npm test` (28 files) and E2E remain green; new asserts cover the log tail
  and crash-report helpers. Helper: `isSafeIp` validates any IP that reaches a console command.

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

### Security (post-release audit)
- **MCP schedules never fired.** `set_schedule` stored weekday NAMES (`['mon'..]`) but the scheduler
  compared against `getDay()` NUMBERS, so every AI-created schedule was silently dead. Both sides now
  use numbers (names are still accepted and normalised). +3 regression tests.
- **`content:delete` path traversal.** `fileName` was unchecked, so `../../server.properties`
  resolved inside the server root (passing `safeTarget`) and deleted files outside plugins/mods.
  Now requires a plain basename.
- **Marketplace install SSRF.** `market:install` downloaded the resolved URL without
  `isSafeDownloadUrl` (modpack + MCP install already checked). Added the guard.
- **`playitPath` RCE via MCP.** `set_setting` allowed setting the Playit binary path, which
  `tunnel:start` then spawns. Removed it from the MCP-settable list (GUI-only now).
- **Editor extension allowlist.** The IPC editor path skipped the `ALLOWED` extension check (MCP
  enforced it), so `.jar`/`.dat` could be read or overwritten as text. Both now share one rule.
- **`server.properties` injection.** `buildPropertiesContent` (the choke point for the GUI grid AND
  MCP `set_property`) drops keys with newlines/`__proto__` and values containing newlines.
- **Bridge config file mode.** `mcp-bridge.json` (holds the MCP token) is written `0o600`.
- **Tunnel address validation.** `tunnel:set-address` now accepts only a plain host/host:port.

### Fixed
- **Download hardening** — `download()` gained a max-size cap (disk-fill guard) and an in-flight
  lock so two downloads to the same file can't race on the same `.part`.
- **Windows/Linux archive parity** — Windows `createBackup` now validates world names like Linux;
  `extractArchive` pre-checks for zip-slip; `createArchive` archives the folder CONTENTS so a
  `.mrpack` has the same layout on both platforms.
- **Console stdin guards** — whitelist/ban/op writes check `stdin.writable` and never throw when the
  server just exited (which used to reject the IPC with no toast).
- **De-duplicated locale keys** (`eyebrow.perf` ×4, `im.preparing` ×2).

### Changed
- **Electron 37 → 44** (37 was end-of-life). `npm audit` now reports 0 vulnerabilities. Verified on
  the packaged Windows build.
- **De-duplicated `.mrpack` export** — the IPC and MCP exporters now share `buildMrpackEntries` +
  `dependenciesFor`, so they can never drift.
- **New test: `mcp-confirm.test.js`** — the write/destroy confirmation gate had none. The
  metrics-tick test's always-true assertion was replaced with real miss/reset checks.

### Notes
- `npm test` (28 files) and the E2E suite remain green, on Electron 44. i18n is 787 keys × 7 locales.
- New `docs/motion.md`. Reduced-motion guards added for every new pattern.
- The packaged **Windows** build was smoke-tested by hand; the **Linux** AppImage is still not
  verified on real hardware (unchanged standing limitation).
- Electron does not hot-reload — restart the app to see UI changes.

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
