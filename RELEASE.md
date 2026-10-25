# Release Notes

User-facing release notes for each version of ObserverLauncher are published with every release and archived under the `docs/` directory.

- Current Release: [ObserverLauncher 6.1.5](docs/release-6.1.5.md)
- Developer Changelog: [CHANGELOG.md](CHANGELOG.md)

---

## ObserverLauncher 6.1.5 (Latest)

ObserverLauncher 6.1.5 brings a major overhaul to the Player Inspector with cross-version save parsing (from legacy 1.12.2 up to modern 1.21+), an EULA-compliant hybrid texture pipeline, visual enchantment and durability indicators, inventory layout fixes, smart active server locking with visual build cards in the Marketplace, and optimized multi-version chunk caching on the World Map.

### Key Highlights

1. **Player Inspector Across All Versions:** Full compatibility with 1.12.2 legacy numeric IDs and NBT compounds up to modern 1.20.5+ item components.
2. **EULA-Compliant Hybrid Texture Pipeline:** 4-tier resolution (local cache -> mod jars -> local client installation -> CDN fallback) with candidate mappings for blocks without 2D icons (pumpkins, buttons, crafting tables, stairs, etc.).
3. **Equipment & Inventory Layout Polish:** Clean square tiles (48x48px), zero text overlap, no clipped lines, uniform 9-column inventory grid.
4. **Marketplace Active Server Lock & Build Picker:** Automatic locking to active server loader/version, visual build cards with release channels (Release/Beta/Alpha), compatibility warnings, and content category filters.
5. **World Map Caching & Multi-Version Terrain:** In-memory explored chunk caching with `mtime` invalidation for smooth panning, plus support for legacy 1.12, 1.16, and modern 1.18+ negative Y terrain and modded biomes.

For full release notes, please see [docs/release-6.1.5.md](docs/release-6.1.5.md).
