# ObserverLauncher 6.1.6 Release Notes

ObserverLauncher 6.1.6 upgrades the Model Context Protocol (MCP) mod inspection and modpack conflict engine. It eliminates false-positive version mismatch reports by introducing cross-patch compatibility bridges, authoritative jar descriptor parsing (`mods.toml`, `fabric.mod.json`, and legacy `mcmod.info`), Maven and Semver range evaluation, and startup-critical duplicate `modId` detection.

---

## 1. The Problem: Filename Guessing vs. Internal Metadata

In Minecraft modding, mod authors frequently release builds where the jar filename retains an earlier patch version (e.g. `appleskin-mc1.16.4-forge.jar` or `jei-1.16.4-7.6.1.jar`), while the mod internally declares compatibility with `[1.16.4, 1.16.5]` or runs seamlessly on `1.16.5`.

Previously, MCP tools lacked deep range evaluation and cross-patch awareness. When an AI assistant or inspection tool examined the folder, it relied on naive filename parsing, observed `1.16.4` in the name, compared it to server `1.16.5`, and falsely reported that the mod was outdated or incompatible.

ObserverLauncher 6.1.6 resolves this at the root by inspecting authoritative internal descriptors first and applying Minecraft's official network and binary compatibility rules.

---

## 2. Key Features & Improvements

### A. Cross-Patch Compatibility Bridges (`src/main/mc-compat.js`)

Minecraft minor updates frequently patch critical server vulnerabilities without altering network protocols, block registries, or mod loader APIs. Forge and Fabric run these versions interchangeably:

- **1.16.4 <-> 1.16.5:** Mojang's 1.16.5 update was strictly two server vulnerability fixes. Forge 1.16.4 mods run on 1.16.5 without modification.
- **1.20 <-> 1.20.1:** Binary and network compatible sub-patches.
- **1.19.1 <-> 1.19.2, 1.18 <-> 1.18.1, 1.15.1 <-> 1.15.2, 1.21 <-> 1.21.1:** Full cross-patch bridges supported.
- **1.21.2 <-> 1.21.3:** Minor hotfix patch with identical network and bytecode mappings.
- **26.1 <-> 26.1.1:** 2026 calendar version hotfix (MC-307140) sharing identical datapack format (101.1) and protocol.

The new `areMcVersionsCompatible()` and `checkMcCompat()` engines evaluate these bridges automatically.

### B. Minecraft 1.21.1+ and 2026 Calendar Versioning Support

- **2026 Calendar Versioning (`26.1+`):** Full compatibility with Mojang's 2026 calendar versioning scheme (game drops `26.1`, `26.2`, `26.3` and hotfixes `26.1.1`).
- **Java 25 Requirement:** `requiredJavaForJar()` recognizes `26.x` servers and automatically verifies Java 25 (`java-runtime-epsilon`, class file version 69.0), while `1.20.5+/1.21.x` map to Java 21.
- **NeoForge 26.x Tag Resolution:** Fixed `mcFor()` in `src/main/forge-versions.js` to ensure 3-part NeoForge builds (e.g. `26.1.15`) map cleanly to `26.1` instead of `1.26.1`.
- **Zero-Normalization:** Semantically equates `1.21` with `1.21.0` and `26.1` with `26.1.0` so manifest differences never trigger false incompatibilities.
- **Calendar Semver Caret Bounding:** `^26.1` automatically bounds `< 26.2` to respect Minecraft 2026 game drop breaking boundaries.

### C. AI Context & Token Optimization

- **Marketplace Versions Pagination (`list_market_versions`):** Added `limit` (default 25, max 100), `version`, and `loader` filtering. Slashes Modrinth payload size from over 140,000 tokens down to ~1,000 tokens (a 99.3% reduction in AI context consumption).
- **Streamlined Metrics Sampling (`get_metrics_history`):** Lowered default sample count from 500 down to 60, eliminating ~88% of token overhead while maintaining clear analytical performance curves.

### D. Audit & Hardening of All 78 MCP Tools (`src/mcp/tools.js`)

- **Windows File Lock Hardening:** Gracefully traps `EBUSY` and `EPERM` errors in `delete_content` when files are held by a running server, returning clear recovery guidance.
- **Schedule Day Handling:** `set_schedule` and `get_schedule` seamlessly support both numeric days (`0..6`) and weekday names (`'mon'..'sun'`).
- **Multi-Instance Isolation:** Isolated active settings lookup per target instance across `start_server`, `diagnose_server`, `prepare_and_start`, and `safe_restart`.
- **Output Schema Synchronization:** All 18 MCP `OUTPUT_SCHEMAS` are fully verified against runtime JSON structures.

### E. Authoritative Descriptor Parsing (`src/main/mod-metadata.js`)

- **Authoritative Dependency Ranges:** Reads Minecraft dependencies directly from `[[dependencies.<modId>]]` in `mods.toml`, `depends.minecraft` in `fabric.mod.json`, and `mcversion` in legacy `mcmod.info`.
- **Legacy Forge Support (1.7.10–1.12.2):** Added `parseMcModInfo()` to read `mcmod.info` JSON descriptors.
- **Gradle Token Resolution:** Ignores unexpanded `${file.jarVersion}` or `${version}` template tokens, resolving real mod versions from `META-INF/MANIFEST.MF` or filename fallbacks.
- **Metadata vs. Filename Separation:** Classifies whether version info originated from authoritative metadata (`mcSource: 'metadata'`) or a filename guess (`mcSource: 'filename'`).
- **Duplicate modId Detection:** Catches duplicate mod declarations before launch.

---

## 3. Developer Verification

- **New Test Suite:** `tests/mc-compat.test.js` covers range evaluation, cross-patch groups, calendar semver, and descriptor parsing (68 tests).
- **MCP Surface & Tools Suites:** `tests/mcp-tools.test.js` (79 tests) and `tests/mcp-surface.test.js` (63 tests) passing 100%.
- **Forge Versions Suite:** `tests/forge-versions.test.js` covers calendar and 3-part NeoForge mappings (25 tests).
- **Code Quality:** Zero duplicated CSS selectors or copy-pasted JS blocks verified via `tests/no-dup.test.js`.
- **All 152 Test Files:** Passing cleanly via `node tests/run.js`.
