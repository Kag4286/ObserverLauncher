# Architecture and Engineering Guidelines

Reference notes for contributors working on ObserverLauncher internals.

## 1. Dual Operating Mode

ObserverLauncher runs in two entry points sharing the same backend modules:

1. Electron desktop app (`src/main.js`) with log viewer, player inspector, live map renderer, and modpack manager.
2. Headless CLI / daemon (`src/headless.js`, `src/cli.js`) managing server processes, multi-instance isolation, and local HTTP / RPC interfaces.

Every backend change must work in both Electron and headless Node environments.

## 2. Quality Checks

Run these checks from the repository root before opening a pull request:

```bash
node tests/no-dup.test.js
node tests/i18n.test.js
node tests/run.js
```

## 3. Frontend Architecture (No Bundler)

The renderer loads classic `<script>` tags in numeric order (`00-core.js` through `13-bootcheck.js`) directly in `src/renderer/index.html`.

### DOM Helpers
In `src/renderer/js/00-core.js`:
- `$()` wraps `document.querySelector()` and returns a single `Element` or `null`.
- `$$()` wraps `document.querySelectorAll()` and returns an array supporting `.forEach()`.

Never call `.forEach()` on `$()`.

### Theme Tokens and Motion
- Form controls, cards, dialogs, and panels use tokens from `01-tokens.css` (`--bg`, `--panel`, `--field`, `--card`, `--text`, `--border`, `--accent`, `--focus`).
- Entrance animations belong only on deliberate tab transitions, never during polling or `refreshUI()`.
- Dynamic `Image` loaders attach both `onload` and `onerror` handlers and provide fallback icons or labels when assets are missing.

## 4. Backend and Process Isolation

### Headless Isolation
Modules under `src/main/` must be importable in plain Node.js without Electron:
- Do not call top-level `require('electron')` in core utilities or `src/mcp/` modules (enforced by `tests/headless-guard.test.js`).
- Load Electron APIs lazily or pass paths through initialization hooks (`dataDir()`).

### Multi-Instance Concurrency
Per-instance runtime state is isolated via `AsyncLocalStorage`:
- Use `ctx.inst()` and `ctx.runInInstance()` for instance state.
- Do not store per-instance mutable fields flat on global `ctx`.

### File and Network Safety
- Persistent writes (settings, player metadata, world configs) use `writeFileAtomic()` (`.tmp` write followed by rename).
- Remote downloads must pass `isSafeDownloadUrl()` (blocking loopback, link-local, metadata endpoints, and private subnets).
- Archive extraction validates targets with `safeTarget()` against path traversal (Zip-Slip).

## 5. Cross-Platform Rules (Windows & POSIX)

- POSIX `path.basename` does not treat `\` as a separator. Always check both `/` and `\` explicitly when sanitizing filenames.
- Normalize `\r\n` to `\n` in string comparisons and regex tests when reading files checked out on Windows.
- Guard platform-specific commands (`powershell.exe`, `cmd.exe`, `/proc`) cleanly and prefer Node standard library `fs` / `child_process.spawn` with argument arrays.

## 6. Minecraft Server Engines and Formats

### Java vs Native Rust Engines
- **Java engines** (Paper, Purpur, Spigot, Vanilla, Forge, NeoForge, Fabric, Folia, Leaf, Velocity): require JRE detection (Java 8, 17, 21, 25), JVM flags, and `eula.txt`.
- **Native Rust engines** (Horizon, Pumpkin): run as standalone binaries without a JRE, JVM memory flags, or `eula.txt`. Lifecycle and config handlers branch on engine type (`horizon`, `pumpkin`, or `native`).

### Minecraft NBT Evolution
Support both legacy and modern layouts when parsing saves and player files:
- **1.12 - 1.16:** Legacy inventory slots, flat structures (`Level.Structures.Starts`), and numeric biome IDs.
- **1.18+:** 3D paletted biome containers (4x4x4 cells per section).
- **1.20+:** Component-based item format.
- **1.21.2+:** Armor textures moved to `textures/entity/equipment/humanoid/`.
- **1.21.5+ / 26.x:** Worn armor moved to top-level `equipment`, lowercase `count`, and attributes under `simple.health` / `simple.food_level`. Always use safe fallbacks when reading NBT values.

### Networking
- Java Edition default: TCP `25565`.
- Bedrock Edition default: UDP `19132`.
- Built-in Playit.gg (TCP) and Pinggy (TCP/UDP) tunnel managers support Geyser/Floodgate crossplay setups.

## 7. Automation Interface (`src/mcp/`)

- Tools declare a risk tier: `'read'` (auto-allowed), `'write'` (requires GUI confirmation unless `mcpAutoAllowWrite` is enabled), and `'destroy'` (always prompts in GUI).
- Validate paths, filenames, and setting keys in `callTool` before triggering `confirmOnGui()`.
- Pass file-read outputs through `maskSecrets()` so RCON passwords, tokens, and credentials are redacted.
- Support crash alias resolution (`latest`, `latest.txt`, `newest`) and multi-instance lookup by ID prefix, name, or folder name.
