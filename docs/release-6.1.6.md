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

The new `areMcVersionsCompatible()` and `checkMcCompat()` engines evaluate these bridges automatically.

### B. Universal Range Parsing & Natural Version Comparison

- **Forge / Maven Interval Ranges:** Accurately evaluates `[1.16.4, 1.16.5]`, `[1.16.4, 1.17)`, `[1.16.4,)`, `(,1.16.5]`, and exact `[version]` syntax.
- **Fabric / NPM Semver:** Accurately evaluates `>=1.16.4 <=1.16.5`, `~1.16.4`, `^1.16.4`, and `*`.
- **Natural Comparison:** Replaces string length or lexicographic checks with numerical segment comparison (`1.10` > `1.9`).

### C. Authoritative Descriptor Parsing (`src/main/mod-metadata.js`)

- **Authoritative Dependency Ranges:** Reads Minecraft dependencies directly from `[[dependencies.<modId>]]` in `mods.toml`, `depends.minecraft` in `fabric.mod.json`, and `mcversion` in legacy `mcmod.info`.
- **Legacy Forge Support (1.7.10–1.12.2):** Added `parseMcModInfo()` to read `mcmod.info` JSON descriptors.
- **Gradle Token Resolution:** Ignores unexpanded `${file.jarVersion}` or `${version}` template tokens, resolving real mod versions from `META-INF/MANIFEST.MF` or filename fallbacks.
- **Metadata vs. Filename Separation:** Classifies whether version info originated from authoritative metadata (`mcSource: 'metadata'`) or a filename guess (`mcSource: 'filename'`).

### D. MCP Tool Enhancements (`src/mcp/tools.js`)

- **`list_content`:** Every mod item now includes `modId`, `mcVersionRange`, `mcSource`, `mcCompatible`, `mcStatus`, and `mcNote`. AI assistants see verified compatibility status directly in the payload.
- **`check_mod_compat`:**
  - Evaluates Minecraft version compatibility against the server target.
  - Detects duplicate `modId`s across multiple jar files (a primary cause of Forge startup crashes).
  - Returns structured `mcSummary` (`scanned`, `compatible`, `crossPatch`, `incompatible`, `unknown`) and per-mod breakdowns.
  - Generates human- and AI-readable notes explaining why cross-patch builds are safe.
- **`plan_modpack` & `install_from_market`:** Allows cross-patch compatible items to pass preflight planning without false rejection warnings.

---

## 3. Developer Verification

- **New Test Suite:** `tests/mc-compat.test.js` covers range evaluation, cross-patch groups, and descriptor parsing (59 tests).
- **MCP Test Suite:** `tests/mcp-mod-compat.test.js` exercises `tCheckModCompat` and `tListContent` against real jar structures and duplicate jars (29 tests).
- **Code Quality:** Zero duplicated CSS selectors or copy-pasted JS blocks verified via `tests/no-dup.test.js`.
- **All 152 Test Files:** Passing cleanly via `node tests/run.js`.
