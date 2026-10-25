# ObserverLauncher 6.1.5

ObserverLauncher 6.1.5 brings a major overhaul to the Player Inspector with cross-version save parsing (from legacy 1.12.2 up to modern 1.21+), an EULA-compliant hybrid texture pipeline, visual enchantment and durability indicators, inventory layout fixes, smart active server locking with visual build cards in the Marketplace, and optimized multi-version chunk caching on the World Map.

For technical details, see the [developer changelog](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#615--2026-10-25).

## Player Inspector across all Minecraft versions

The Player Inspector reliably parses and displays player saves across modern and legacy Minecraft versions:

- **Legacy versions (1.12.2 and older):** Correctly translates numeric item IDs, numeric enchantment IDs (`tag.ench`), and legacy dimension codes (`0`, `-1`, `1`) to modern item names and enchantment descriptions.
- **Modern releases (1.20.5 to 1.21+):** Full support for data-driven item components, modern enchantment compounds, and damage calculation.
- **Enchantment & durability indicators:** Worn armor and held items showcase dynamic durability bars, Roman numeral enchantment badges (e.g., `Unbreaking II`), and a subtle enchanted glint animation.
- **Interactive item inspection:** Click any item in the inventory to open the item detail inspection card with exact counts, slot indices, durability percentages, and full enchantment lists.

## Fast, EULA-compliant hybrid texture pipeline

Items without 2D icons (such as buttons, pumpkins, crafting tables, stairs, slabs, and beds) as well as modded items now render properly:

- **4-Tier texture resolver:** Seamlessly resolves textures across local disk cache, installed mod jar archives, local client Minecraft installations, and ultra-fast Cloudflare CDN mirrors.
- **Zero EULA violations:** Vanilla textures are never bundled directly into the application installer, maintaining 100% compliance with Mojang's Minecraft EULA.
- **Instant cache busting:** When background texture downloads complete, icons update live without requiring a launcher restart.

## Inventory and equipment layout fixes

- **Equipment slots:** Fixed an issue where equipment slots in the Overview tab became elongated and caused armor labels and enchantment badges to overlap or clip horizontally. All slots now render as crisp, square tiles with comfortable text spacing.
- **Empty slots:** Fixed an issue where empty inventory slots grew abnormally tall due to CSS padding inheritance. All inventory and Ender Chest slots now maintain a uniform 9-column grid.

## Marketplace upgrade & active server locking

The Marketplace now actively protects your server from incompatible downloads while making content discovery much easier:

- **Active server locking:** The Marketplace automatically detects your current server's Minecraft version and mod loader (Forge, Fabric, NeoForge, Paper, Purpur, Velocity) to prevent accidental installations of incompatible content.
- **Visual build picker:** Replaces simple dropdowns with rich version cards showing release channels (Release, Beta, Alpha), recommended build badges, supported loaders, and release dates.
- **Compatibility warnings:** Displays clear warning alerts when a selected build was designed for a different loader or game version, with an option to proceed if needed.
- **Content category chips:** Quickly filter mods and plugins by specialized categories, including Optimization, QoL, Administration, Security, Economy, World Generation, and Libraries.
- **CurseForge & TOML dependency fixes:** Correctly parses inline comments in mod configs (such as JEI) and properly resolves loader metadata from CurseForge files.

## World map performance & multi-version terrain

The built-in World Map received major performance optimizations and broader format support:

- **Explored chunk caching:** Caches scanned chunk regions in memory with file-system `mtime` invalidation. Panning and zooming across large worlds is now smooth and eliminates repetitive disk scans.
- **Multi-version terrain parsing:** Seamlessly decodes legacy 1.12 chunk formats (legacy `HeightMap` arrays and block IDs), 1.16 formats, and modern 1.18+ negative Y coordinate sections (supporting world depths down to Y = -64, deepslate layers, and Deep Dark biomes).
- **Accurate surface detection:** Improved surface block scanning to penetrate non-solid foliage and identify true terrain, with custom biome mapping support for modded world generation like TerraForged.
