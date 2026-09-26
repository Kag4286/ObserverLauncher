# ObserverLauncher 2.3.0

Better AI-assisted modpack building. If you use the MCP / AI integration to install mods, this release stops the most common crash: a plan that looks fine but breaks the server on startup.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#230--2026-09-25) — the two are kept in sync.

---

## The big one: no more "looks fine, then crashes"

When an AI assistant installed a batch of mods for you, it could pick a version built for **Forge** on a **NeoForge** server, or for the **wrong Minecraft version**, and the plan still said everything was OK — then the server refused to start. That can't happen anymore:

- The planner now checks every mod against your **real** server (loader + Minecraft version) and **refuses** versions that don't match instead of just warning.
- It works even for **NeoForge/Forge servers that start from `run.bat`** (no `.jar` file) — the launcher reads the server's own files to figure out what it is.
- The batch installer skips any incompatible item and tells you which ones it skipped (and why).

## Missing dependencies, caught before the crash

Some mods need other mods that aren't listed anywhere online (a classic example: **Kotlin for Forge**). The launcher now opens each downloaded mod and reads what it *actually* requires, then reports anything still missing under `missing_deps` — before you start the server.

There's also a new **`check_mod_compat`** you (or your AI assistant) can run on any server: it scans `mods/` for jars built for the wrong loader, client-only mods, and missing required dependencies.

## Better crash explanations

- **`explain_crash` now reads the server log, not just the crash report.** It used to say "No associated exception found" while the real cause (a missing mod, or a jar for the wrong loader) was sitting in `latest.log`. It now lists the exact missing mods and skipped jars.
- **New `read_crash_report`** tool to read a crash-report directly from your server folder.

## Smaller improvements

- **Searching the marketplace** can now be pinned to a specific loader (NeoForge / Forge / Fabric / Quilt), so a NeoForge search no longer returns Forge builds. Searches also wait longer before timing out when several run at once.
- **`list_content`** now flags mods whose loader doesn't match the server.
- **`check_performance`** says "metrics warming up" instead of showing an empty result right after a server starts.

## What to watch out for

- These changes make the AI path stricter on purpose: if a mod genuinely has no build for your loader/Minecraft version, it will now be **skipped** rather than installed and crashing. You can still force a specific item through if you know what you're doing.
- Everything else (the wizard, Java handling, backups) is unchanged from 2.2.0.

---

<details>
<summary>For developers — full technical changelog</summary>

The complete module-by-module changelog (root causes, functions, flags, test counts) is in
[CHANGELOG.md § [2.3.0]](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#230--2026-09-25).

Highlights for maintainers:
- **New pure modules:** `src/main/jar-read.js` (zlib-only ZIP reader: `readJarEntry`, `openJar`),
  `src/main/mod-metadata.js` (`classifyJar` -> loader/env/modId + dependency parsers),
  `src/main/server-compat.js` (`detectServerTarget` reads `libraries/` for jar-less servers;
  `versionMatchesServer`).
- **Planner hard-filter:** `filterPlan` + `versionMatchesServer` in `modpack-plan.js`, wired into
  `plan_modpack` (returns `rejected`) and `assemble_modpack` (skips, reports `blocked`, `force:true`
  overrides).
- **Dep resolution from jar metadata:** `missingDependencies` + `openJar`; new `check_mod_compat` +
  `read_crash_report` tools (STATIC_TOOLS in sync — drift guard passes).
- **Diagnosis:** `doctor.scanLogForMissingDeps` parses `latest.log` for missing-dep / skipped-jar
  lines; `explain_crash` raises confidence to `high` when found.
- **Tests:** `tests/server-compat.test.js` (15), `tests/jar-metadata.test.js` (13); `npm test` = 55
  files PASS; i18n 7x877 clean.

</details>
