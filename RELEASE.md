# Release Notes

User-facing release notes for each version of ObserverLauncher are published with every release and archived under the `docs/` directory.

- Current Release: [ObserverLauncher 6.1.6](docs/release-6.1.6.md)
- Developer Changelog: [CHANGELOG.md](CHANGELOG.md)

---

## ObserverLauncher 6.1.6 (Latest)

ObserverLauncher 6.1.6 brings a deep upgrade to the Model Context Protocol (MCP) modpack inspection and conflict engine. It eliminates false-positive incompatibility reports on mods whose filenames indicate older versions (e.g. 1.16.4 on a 1.16.5 server) through cross-patch compatibility bridges, authoritative descriptor parsing (`mods.toml`, `fabric.mod.json`, and legacy `mcmod.info`), Maven and Semver range evaluation, and startup-critical duplicate `modId` detection.

### Key Highlights

1. **Cross-Patch Compatibility Bridges:** Seamless evaluation of binary and network compatible sub-patches (1.16.4 <-> 1.16.5, 1.20 <-> 1.20.1, 1.19.1 <-> 1.19.2, etc.).
2. **Authoritative Descriptor Extraction:** Reads true Minecraft compatibility ranges from `mods.toml`, `fabric.mod.json`, and legacy `mcmod.info` instead of relying on naive filename guesses.
3. **Maven & Semver Range Support:** Full evaluation of interval brackets (`[1.16.4, 1.16.5]`, `[1.16.4, 1.17)`), semver (`>=1.16.4 <=1.16.5`, `~1.16.4`), and wildcards.
4. **Enhanced MCP Tools (`check_mod_compat`, `list_content`):** Returns structured diagnostics (`mcSummary`, `mcStatus`, and explicit `note` explanations) so AI assistants never misdiagnose compatible mods.
5. **Duplicate Mod Detection:** Scans for multiple jars sharing the same `modId` to catch startup crash loops before launch.

For full release notes, please see [docs/release-6.1.6.md](docs/release-6.1.6.md).

---

## Previous Releases

- [ObserverLauncher 6.1.5](docs/release-6.1.5.md) — Cross-version Player Inspector (1.8–1.21+), EULA-compliant hybrid texture pipeline, layout fixes, marketplace active server lock, world map caching.
