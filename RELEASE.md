# Release Notes

User-facing release notes for each version of ObserverLauncher are published with every release and archived under the `docs/` directory.

- Current Release: [ObserverLauncher 6.1.6](docs/release-6.1.6.md)
- Developer Changelog: [CHANGELOG.md](CHANGELOG.md)

---

## ObserverLauncher 6.1.6 (Latest)

ObserverLauncher 6.1.6 delivers a comprehensive upgrade to the Model Context Protocol (MCP) mod inspection engine, crash-hardens all 78 MCP tools, optimizes AI context and token efficiency (up to 99.3% reduction on marketplace queries), and provides rock-solid compatibility for Minecraft 1.21.1+ and 2026 calendar versioning (Minecraft 26.1+, Java 25).

### Key Highlights

1. **Minecraft 1.21.1+ & 2026 Calendar Versioning (26.1+):** Full cross-patch bridges for 1.21.2 <-> 1.21.3 and 26.1 <-> 26.1.1, Java 25 verification, NeoForge 26.x calendar tag resolution, zero-normalization (`1.21` == `1.21.0`, `26.1` == `26.1.0`), and calendar semver caret (`^26.1`) bounding.
2. **AI Token & Context Optimization:** Added pagination (`limit: 25`, max 100) and version/loader filtering to `list_market_versions`, reducing Modrinth response sizes from ~140,000 tokens down to ~1,000 tokens (99.3% savings). Metrics sampling in `get_metrics_history` defaults to 60 points, slashing context overhead by 88%.
3. **Cross-Patch Compatibility Bridges:** Mod inspection recognizes cross-patch compatibility groups (1.16.4/1.16.5, 1.20/1.20.1, 1.21/1.21.1, 1.21.2/1.21.3, 26.1/26.1.1) so valid mods are never falsely reported as incompatible.
4. **All 78 MCP Tools Audited:** Hardened against Windows file locks (`EBUSY` / `EPERM`) during content deletion, synchronized schedule formats (`0..6` and `'mon'..'sun'`), isolated multi-instance settings, and aligned all 18 output schemas with runtime payloads.
5. **Duplicate modId & Authoritative Descriptors:** Scans internal jar metadata (`mods.toml`, `fabric.mod.json`, `mcmod.info`) and detects duplicate `modId`s that cause startup crashes before launching.

For full release notes, please see [docs/release-6.1.6.md](docs/release-6.1.6.md).

---

## Previous Releases

- [ObserverLauncher 6.1.5](docs/release-6.1.5.md) — Cross-version Player Inspector (1.8–1.21+), EULA-compliant hybrid texture pipeline, layout fixes, marketplace active server lock, world map caching.
