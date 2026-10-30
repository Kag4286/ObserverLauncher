# ObserverLauncher 6.1.8

ObserverLauncher 6.1.8 focuses on **Renderer performance optimization and memory leak elimination** guided by Chrome DevTools diagnostics. It eradicates layout thrashing during live server polling, introduces sleep mode for background IPC network requests, implements DOM event delegation for large modpacks, optimizes terminal console pruning, and hardens release asset uploads on Windows CI.

For technical details, see the [developer changelog](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#618--2026-10-30).

---

## Elimination of Layout Thrashing (Forced Reflow)

In previous versions, high-frequency TPS and MSPT metric updates (polled every 1–2 seconds while a server was running) caused micro-stutters by querying computed CSS custom properties on every single tick:

- **Cached CSS Theme Properties:** Extracted dynamic CSS variable reads (`--chart-tps`, `--chart-cpu`, `--chart-ram`, `--danger`, `--text-dim`) into `getChartThemeColors()`, querying the root document style tree only once.
- **Overview Sparkline Tab Guard:** Added visibility detection to `drawOvSpark()`. When the Overview tab is in the background, canvas resizing, bounding-box queries (`getBoundingClientRect()`), and context rendering are completely bypassed.

---

## Event Delegation for Content Lists (Plugins, Mods & Datapacks)

Previously, modpacks with hundreds of mods or datapacks attached individual closure callbacks (`input.onchange`, button `onclick`) to every row on every render cycle:

- **Single Container Listener:** Moved all toggle, delete, update, configuration-jump, and validation handlers to a single delegated event listener on the parent lists (`#pluginsList`, `#modsList`, `#datapacksList`).
- **Memory & GC Savings:** Eliminates thousands of detached closure references in V8 Heap memory, dramatically reducing garbage collection pauses when switching servers or updating mod lists.

---

## Background Polling Sleep Mode

- **Quiet Idle State:** The 15-second tunnel status verification timer (`refreshTunnelUI`) now automatically sleeps when the user is working on other tabs or when the tunnel details drawer is closed.
- **Resource Conservation:** Prevents unnecessary IPC messaging over the Electron context bridge, allowing the application to drop into a true low-power idle state when left in the background.

---

## Batched Terminal Console Buffer Pruning

- **Atomic DOM Truncation:** Replaced sequential row-by-row deletions (`while (o.children.length > 2000) o.removeChild(o.firstChild)`) with a single `document.createRange().deleteContents()` call.
- **Smoother Fast-Streaming Logs:** Massive server boot sequences or high-velocity chat/command outputs stream smoothly without blocking renderer frame animations.

---

## CI/CD: Resilient Windows Release Uploads

- **Increased Upload Timeout:** Configured a 10-minute timeout for GitHub asset uploads in `package.json`, preventing socket timeouts when streaming ~100MB installer binaries to GitHub Releases.
- **Node 22 TLS Stability:** Added `--no-network-family-autoselection` and automated 3-attempt retry loops to bypass IPv6 socket resets on GitHub Actions Windows runners, backed by automatic GitHub CLI fallback attachment.

---

## Verification & Testing

- **154 Unit & Integration Test Suites:** 100% passing (`node tests/run.js`).
- **Zero i18n Regressions:** All translations intact across all 7 supported languages.
- **Backward Compatible:** Preserves all existing configurations, instance layouts, and server data.
