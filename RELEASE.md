# Release Notes

User-facing release notes for each version of ObserverLauncher are published with every release and archived under the `docs/` directory.

- Current Release: [ObserverLauncher 6.1.8](docs/release-6.1.8.md)
- Developer Changelog: [CHANGELOG.md](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#618--2026-10-30)

---

## ObserverLauncher 6.1.8 (Latest)

ObserverLauncher 6.1.8 focuses on **Renderer performance optimization and memory leak elimination** based on Chrome DevTools profiling. It eliminates layout thrashing during live server metric updates, introduces quiet sleep mode for background IPC timers, implements DOM event delegation for large modpacks, accelerates console log truncation with DOM Range, and hardens release asset uploads on Windows CI.

For technical details, see the [developer changelog](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#618--2026-10-30).

### Highlights

1. **Elimination of Layout Thrashing:** Dynamic CSS theme custom properties (`--chart-tps`, `--chart-cpu`, `--chart-ram`) are now cached, removing forced synchronous reflows on high-frequency metrics polling ticks.
2. **Overview Sparkline Tab Guard:** Background data updates bypass canvas re-rendering and bounding-box queries when the Overview tab is not active.
3. **Event Delegation on Content Lists:** Replaced hundreds of individual per-row closure listeners in `#pluginsList`, `#modsList`, and `#datapacksList` with single delegated container listeners, drastically reducing Heap memory footprint and Garbage Collection churn.
4. **Sleep Mode for Background Network IPC:** The 15-second tunnel status verification timer automatically sleeps when the user is working on other tabs or when the tunnel drawer is closed.
5. **Batched Console Log Pruning:** Terminal log buffer capping now uses atomic `document.createRange().deleteContents()`, ensuring smooth rendering during fast log streaming without frame stutter.
6. **Windows CI Upload Resilience:** Configured 10-minute timeout for GitHub asset uploads and added Node 22 IPv6 socket drop mitigations to prevent `socket hang up` during Windows releases.

For full release notes, please see [docs/release-6.1.8.md](docs/release-6.1.8.md).

---

## Previous Releases

- [ObserverLauncher 6.1.7](docs/release-6.1.7.md) — Settings & Content GUI overhaul (anti-card-slop), SSRF IPv6 hardening, Spigot/Bukkit auto-detection, Smart JVM presets, and crash doctor.
- [ObserverLauncher 6.1.5](docs/release-6.1.5.md) — Cross-version Player Inspector (1.8–1.21+), EULA-compliant hybrid texture pipeline, layout fixes, marketplace active server lock, world map caching.
- [ObserverLauncher 6.1.0](docs/release-6.1.0.md) — Pre-flight mod conflict scanner, duplicate modId detector, missing dependency resolver, and unified conflict reporting.
- [ObserverLauncher 6.0.0](docs/release-6.0.0.md) — Multi-instance architecture, Prometheus metrics, Discord webhooks, Pinggy Bedrock tunneling, and server.properties history.
