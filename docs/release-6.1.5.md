# ObserverLauncher 6.1.5

ObserverLauncher 6.1.5 brings a major overhaul to the Player Inspector with full cross-version support (from legacy 1.12.2 up to modern 1.21+), a new hybrid texture pipeline that cleanly loads vanilla and modded item textures without EULA violations, visual enchantment and durability indicators, inventory layout fixes, and active server locking in the Marketplace.

For technical details, see the [developer changelog](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#615--2026-10-25).

## Player Inspector overhaul across all Minecraft versions

The Player Inspector now reliably parses and displays player saves across modern and legacy Minecraft versions:

- **Legacy versions (1.12.2 and older):** Correctly translates numeric item IDs, numeric enchantment IDs, and legacy dimension codes (`0`, `-1`, `1`) to modern item names and enchantment descriptions.
- **Modern releases (1.20.5 to 1.21+):** Full support for data-driven item components, modern enchantment compounds, and damage calculation.
- **Enchantment & durability indicators:** Worn armor and held items now showcase dynamic durability bars, Roman numeral enchantment badges (e.g., `Unbreaking II`), and a subtle enchanted glint animation.
- **Interactive item inspection:** Click any item in the inventory to open the item detail inspection card with exact counts, slot indices, durability percentages, and full enchantment lists.

## Fast, EULA-compliant hybrid texture pipeline

Items without 2D icons (such as buttons, pumpkins, crafting tables, stairs, slabs, and beds) as well as modded items now render properly:

- **4-Tier texture resolver:** Seamlessly resolves textures across local disk cache, installed mod jar archives, local client Minecraft installations, and ultra-fast Cloudflare CDN mirrors.
- **Zero EULA violations:** Vanilla textures are never bundled directly into the application installer, maintaining 100% compliance with Mojang's Minecraft EULA.
- **Instant cache busting:** When background texture downloads complete, icons update live without requiring a launcher restart.

## Inventory and equipment layout fixes

- **Equipment slots:** Fixed an issue where equipment slots in the Overview tab became elongated and caused armor labels and enchantment badges to overlap or clip horizontally. All slots now render as crisp, square tiles with comfortable text spacing.
- **Empty slots:** Fixed an issue where empty inventory slots grew abnormally tall due to CSS padding inheritance. All inventory and Ender Chest slots now maintain a uniform 9-column grid.

## Marketplace active server locking & categories

- **Active server locking:** The Marketplace automatically detects your current server's Minecraft version and mod loader (Forge, Fabric, NeoForge, Paper, Purpur, Velocity) to prevent accidental installations of incompatible content.
- **Content categories:** Filter mods and plugins by specialized categories, including Performance, Quality of Life, Administration, Security, Economy, and World Generation.
