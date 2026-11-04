# AGENT.md - Operational Standards for ObserverLauncher

> This document is mandatory reading for any AI coding assistant or engineer working on ObserverLauncher. Review every section before modifying, creating, or testing code in this repository.

---

## 1. System Identity and Mandate

You are operating as a senior systems engineer and Minecraft server infrastructure specialist.

ObserverLauncher is a dual-mode application:
1. An Electron desktop application featuring an administrative dashboard, log viewer, player inspector, live map renderer, and modpack manager.
2. A headless daemon / CLI server manager capable of orchestrating server processes, multi-instance isolation, and external client connectivity via the Model Context Protocol (MCP).

Every code change must preserve both GUI and headless operating modes without regression.

---

## 2. Non-Negotiable Quality Gates

Before any task is considered complete, the following commands must execute cleanly from the repository root:

```bash
# 1. Zero duplicate code blocks across all CSS and JS files
node tests/no-dup.test.js

# 2. Strict i18n parity across all 7 locales (en, vi, zh, ja, ko, ru, es)
node tests/i18n.test.js

# 3. Full test suite execution (160+ suites must pass 100%)
node tests/run.js
```

### Documentation Contract
Every release or functional change must be recorded across two tracks:
- `CHANGELOG.md`: Following Keep a Changelog formatting.
- `release.md` and version dossier (`docs/release-*.md`): Comprehensive breakdown of architecture updates, security fixes, and migration guides.

Never submit code that reduces test coverage or weakens existing assertions.

---

## 3. Frontend Architecture (Zero-Bundler Contract)

The renderer process runs without webpack, vite, or any intermediate bundler. Scripts are loaded directly via HTML `<script>` tags in strict numeric order (`00-core.js` through `13-bootcheck.js`).

### 3.1 DOM Helpers: Single vs Collection
In `src/renderer/js/00-core.js`:
- `$()` wraps `document.querySelector()` and returns a single `Element` or `null`.
- `$$()` wraps `document.querySelectorAll()` and returns a `NodeList` supporting `.forEach()`.

**Critical rule:** Calling `$(selector).forEach()` throws an immediate `Uncaught TypeError: $(...).forEach is not a function`. Always use `$$()` when querying multiple elements or iterating over chips, tabs, cards, and list items.

```javascript
// WRONG - crashes at runtime:
$('#wmDims .filter-chip').forEach(chip => chip.classList.remove('active'));

// CORRECT:
$$('#wmDims .filter-chip').forEach(chip => chip.classList.remove('active'));
```

### 3.2 Theme CSS Tokens
Form inputs, cards, dialogs, and panels must use design tokens:
- Backgrounds: `var(--bg)`, `var(--panel)`, `var(--field)`, `var(--card)`
- Text: `var(--text)`, `var(--muted)`
- Borders and focus: `var(--border)`, `var(--accent)`, `var(--focus)`

Never hardcode pure white (`#fff`) or dark text on form controls. Doing so creates unreadable high-contrast anomalies in dark mode.

### 3.3 Motion and Animation Invariants
CSS entrance animations (e.g. `slideIn`, `fadeIn`) may trigger only on deliberate user tab navigation. Never trigger animations during periodic pollers, background state synchronizations, or inside `refreshUI()`.

### 3.4 Resilient Asset Loading
Player heads, item textures, armor layers, and mod assets must handle missing resources gracefully:
- Always attach both `onload` and `onerror` handlers to dynamic `Image` instances.
- On failure, provide SVG icon fallbacks or formatted item name initials (e.g. `Diamond Chestplate` -> `DC`). Never leave empty transparent gaps or broken images in slot grids.

---

## 4. Backend and Process Isolation

### 4.1 Headless CLI Isolation
Modules in `src/main/` must be importable in pure Node.js environments without Electron.
- Never `require('electron')` at top-level in core utilities or MCP modules.
- Enforced automatically by `tests/headless-guard.test.js`.
- If an Electron-specific API (such as `app.getPath` or `dialog`) is required, guard it with runtime checks or pass instances through initialization hooks.

### 4.2 Multi-Instance Concurrency
Multi-instance state is managed via `AsyncLocalStorage`:
- Use `ctx.inst()` and `ctx.runInInstance()` to access instance-specific storage and state.
- Never store mutable per-instance properties as flat variables on global `ctx`.
- Instance lookups must support UUIDs, 8-character ID prefixes, and instance folder names.

### 4.3 Atomic File Operations
All persistent data writes (server settings, player metadata, world configs) must use `writeFileAtomic()`:
- Write to a temporary file (`.tmp`) and rename atomically.
- Mitigates corruption during system reboots or sudden power loss.

### 4.4 Network and Extraction Security
- Remote download requests (jars, mods, plugins, tunnel binaries) must pass `isSafeDownloadUrl()`. Block private IP ranges, loopback addresses, and metadata endpoints.
- Archive extractions (zip, mrpack, tar) must use `safeTarget()` to reject directory traversal sequences (Zip-Slip).

---

## 5. Cross-Platform Engineering (Windows vs POSIX)

ObserverLauncher runs on Windows, macOS, and Linux runners (including Ubuntu GitHub Actions).

### 5.1 Path Traversal Defense
On POSIX platforms, `path.basename` does NOT treat backslash (`\`) as a path separator:
```javascript
// On Linux / macOS:
path.basename('..\\server.properties'); // Returns '..\\server.properties' (NOT 'server.properties')
```

Every path sanitization routine must explicitly verify both slash variants:
```javascript
function isSafeFilename(name) {
  if (typeof name !== 'string') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (path.basename(name) !== name) return false;
  return true;
}
```

### 5.2 CRLF and Git Invariants
On Windows development environments, text files may be checked out with CRLF (`\r\n`). Tests and string replacement logic must normalize line endings (`\r\n` to `\n`) before applying regex assertions or multi-line comparisons.

### 5.3 Shell Execution
Never invoke Windows-specific shell commands (`cmd.exe /c`, `powershell`) in core logic without platform guards and POSIX equivalents. Prefer Node standard library (`fs`, `child_process.spawn`) with explicit argument arrays.

---

## 6. Minecraft Server Domain Rules

### 6.1 Polymorphic Server Engines
ObserverLauncher supports two distinct runtime paradigms:

1. **Java Server Engines** (Paper, Purpur, Spigot, Vanilla, Forge, Fabric, Folia, Leaf, etc.):
   - Require Java Runtime Environment (JRE) detection (Java 8, 11, 17, 21, 25).
   - Require JVM arguments (e.g. Aikar's optimized garbage collection flags).
   - Require `eula=true` in `eula.txt`.
   - Primary port: TCP 25565.

2. **Native Rust Engines** (Horizon Native):
   - Executable runs directly without a JRE.
   - Does NOT accept JVM flags (`-Xmx`, `-XX:+UseG1GC`).
   - Does NOT use or require `eula.txt`.
   - Server lifecycle handlers must branch on `serverType === 'horizon'`.

### 6.2 Minecraft NBT Evolution and Defensive Parsing
Minecraft data structures evolve across major updates:
- **1.12 - 1.16**: Classic inventory slots, numeric or flat compound tags.
- **1.18**: 3D biome representation (4x4x4 quart blocks replacing legacy 2D column arrays).
- **1.20+**: Component-based item syntax replacing arbitrary NBT tags.
- **1.21.2+**: Armor texture path migrated from `textures/models/armor/` to `textures/entity/equipment/humanoid/`.
- **1.21.5+ / 26.x**: Player equipment moved to a top-level `equipment` compound; item count serialized as lowercase `count`; entity attributes may be stored under `simple.health` or `simple.food_level`.

**Defensive UI Rule:** Never assume a property exists directly on parsed NBT objects. Always supply fallbacks to avoid displaying `undefined` in UI statistics and inventories:
```javascript
const health = nbt.Health?.value ?? nbt.simple?.health?.value ?? 20;
const food = nbt.foodLevel?.value ?? nbt.simple?.food_level?.value ?? 20;
```

### 6.3 Networking and Tunnel Protocols
- Java Edition default: TCP 25565.
- Bedrock Edition default: UDP 19132.
- Geyser / Floodgate bridge translates Bedrock packets to Java servers.
- Built-in Pinggy tunnel manager must support both `--tcp` (Java) and `--udp` (Bedrock) modes.

---

## 7. Model Context Protocol (MCP) Standards

The built-in MCP server (`src/mcp/`) enables external AI agents to inspect, manage, and troubleshoot servers.

### 7.1 Risk Tiers
Every tool must declare its access risk level:
- `'read'`: Non-destructive queries (`get_status`, `list_instances`, `read_file`, `doctor_diagnose`). Auto-allowed.
- `'write'`: Modifications (`write_file`, `set_setting`, `install_plugin`). Auto-allowed if `mcpAutoAllowWrite` is enabled; otherwise requires GUI confirmation.
- `'destroy'`: High-impact actions (`delete_content`, `stop_server`, `delete_instance`). Always requires explicit GUI user confirmation.

### 7.2 Fast-Path Input Pre-Validation
Validate all inputs inside `callTool` BEFORE triggering `confirmOnGui()`:
- Path traversal attempts, disallowed setting keys, and invalid filenames must fail immediately in less than 1 second.
- Never make an external agent wait 60 seconds for a user confirmation dialog only to reject an invalid parameter afterward.

### 7.3 Secret Masking
All file reads executed over MCP (`read_file`, `read_many_files`) must pass output through `maskSecrets()`. Passwords, RCON credentials (`rcon.password`), authorization headers, and private tunnel tokens must be masked as `[redacted]`.

### 7.4 Virtual Resources and Alias Resolution
- Virtual MCP resource URIs (`observer://server/status`, `server/status`) must be routed to dynamic status handlers.
- Crash report queries must support aliases: `latest`, `latest.txt`, and `newest` resolving to the most recently created report file.
- Multi-instance resolution must accept instance folder names, display names, and ID prefixes.

---

## 8. Development Discipline and Code Quality

### 8.1 Investigation Before Modification
1. Trace the execution flow to find the root cause before editing code.
2. Formulate a minimal, targeted fix. Avoid broad refactorings that affect unrelated features.
3. Verify changes locally with the corresponding test suite.

### 8.2 Regression Testing Rule
Every bug fix must include a companion regression test in `tests/` verifying both the failure condition and the resolved behavior.

### 8.3 Communication and Documentation Style
- Adhere to the principles in `Wikipedia:Signs_of_AI_writing`.
- Write concise, concrete, and technically precise documentation.
- Avoid superficial filler phrases ("testament to", "crucial milestone", "delve into", "seamless").
- Do not use decorative em-dashes (`—`). Use colons, parentheses, or periods.
- Commit messages must follow Conventional Commits (`fix:`, `feat:`, `refactor:`, `test:`, `docs:`, `chore:`).
