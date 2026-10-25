# Release Notes

User-facing release notes for each version of ObserverLauncher are published with every release and archived under the `docs/` directory.

- Current Release: [ObserverLauncher 6.1.5](docs/release-6.1.5.md)
- Developer Changelog: [CHANGELOG.md](CHANGELOG.md)

---

## ObserverLauncher 6.1.5 (Latest)

ObserverLauncher 6.1.5 brings a major overhaul to the Player Inspector with full cross-version support (from legacy 1.12.2 up to modern 1.21+), a new hybrid texture pipeline that cleanly loads vanilla and modded item textures without EULA violations, visual enchantment and durability indicators, inventory layout fixes, and active server locking in the Marketplace.

### Key Highlights

1. **Player Inspector Across All Versions:** Full compatibility with 1.12.2 legacy numeric IDs and NBT compounds up to modern 1.20.5+ item components.
2. **EULA-Compliant Hybrid Texture Pipeline:** 4-tier resolution (local cache -> mod jars -> local client installation -> CDN fallback) with candidate mappings for blocks without 2D icons (pumpkins, buttons, crafting tables, stairs, etc.).
3. **Equipment & Inventory Layout Polish:** Clean square tiles (48x48px), zero text overlap, no clipped lines, uniform 9-column inventory grid.
4. **Enchantment & Durability Displays:** Durability meters, Roman numeral badges (`Unbreaking II`), and subtle animated glint overlays.
5. **Marketplace Active Server Lock:** Automatically detects active server loader and version to safeguard against incompatible mod installations.

For full release notes, please see [docs/release-6.1.5.md](docs/release-6.1.5.md).
