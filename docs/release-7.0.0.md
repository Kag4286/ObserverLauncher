# ObserverLauncher 7.0.0

ObserverLauncher 7.0.0 introduces native support for the revolutionary **Horizon Dedicated Server**, a completely refreshed **New Server Wizard**, slot-independent armor textures in the **3D Player Inspector**, a new **custom icon mark**, and safer **world management tools**.

For developer-level details, see the [developer changelog](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#700z--2026-10-31).

---

## First Local Hosting App with Horizon Dedicated Server (Rust)

ObserverLauncher is the first desktop local hosting application in the world to support the [Horizon](https://github.com/horizon-rust/horizon) dedicated server out of the box.

### What is Horizon?
Every standard Minecraft server you have played before—Vanilla, Paper, Purpur, Fabric, or Forge—runs on top of Java. While Java is great, it can be heavy: it requires installing the right Java version, reserves several gigabytes of your computer's memory upfront, and occasionally freezes for a split second when clearing memory (known as garbage collection lag).

Horizon takes a completely new approach: it is a ground-up recreation of the Minecraft 26.3 server built with the **Rust** programming language. Instead of running inside Java, it runs directly on your computer as a fast, standalone program.

### Why this is a huge upgrade for local hosting:
- **Zero Java required:** You never need to install, update, or troubleshoot Java versions. Horizon starts immediately as an executable.
- **Micro-memory footprint (~600 MB):** Where a typical Java server needs 2 GB to 4 GB of RAM just to boot, Horizon runs smoothly using only about 600 MB of your computer's memory. It leaves the rest of your RAM free for your browser, Discord, or the game itself.
- **Smooth gameplay with no stuttering:** Horizon frees memory automatically as you play. Because there is no Java memory cleaner running in the background, your server maintains steady tick rates without random lag spikes.
- **1-Click setup in ObserverLauncher:** In the past, running Horizon required technical knowledge and terminal commands. In ObserverLauncher, you simply choose Horizon in the New Server Wizard. The launcher downloads the official files, configures your settings, and lets friends connect instantly over local Wi-Fi or with our built-in internet tunnels (Playit.gg / Pinggy).

---

## Fresh Look for the New Server Wizard

Creating a new server is now faster, clearer, and more intuitive:

- **Quick Category Filters:** Use the new filter chips at the top of the software list to instantly switch between **Featured**, **Plugins**, **Modded**, **Native & Proxy**, or **All** servers.
- **Spotlight for Top Software:** **Horizon** and **Leaf** are now featured front and center in the "Start here" group with glowing neon cards, making it easy to discover the most optimized choices for both native and plugin servers.
- **Automatic Server Subfolder:** When choosing where your server should live, you can type your server's name to automatically create a clean subfolder with dark-theme styling matching the app.
- **Clickable Rail Navigation:** You can now click on any completed step on the left-hand sidebar to jump directly back to it without having to click the "Back" button over and over.
- **Adaptive Memory Step:** When you select Horizon, the wizard automatically hides the Java RAM slider and shows a clean system memory card confirming that no Java setup is required.

---

## 3D Player Inspector: Accurate Armor & Full Item Names

- **Accurate Mixed Armor Sets:** Fixed an issue where wearing different armor types together (such as a Diamond helmet with a Netherite chestplate) caused all armor pieces to render with the cyan Diamond texture. Each piece of armor now renders with its true game texture.
- **No More Cut-Off Text:** Long equipment names (such as "Netherite Chestplate") now wrap neatly onto two lines instead of being truncated into ellipses.

---

## Custom Observer Icon (DMCA Safe)

ObserverLauncher now features an original, custom geometric cube logo across the app, window title bar, and desktop shortcuts. This replaces the old vanilla game block texture, ensuring the project remains 100% compliant with copyright rules and safe from DMCA issues.

---

## Safe World Tools & Custom Resource Packs

- **Safe World Renaming:** Rename your worlds with one click. The launcher updates your server settings and world files together while taking a safety backup.
- **Live World Seed Editor:** View or edit your world's seed directly inside the launcher without manual NBT editing.
- **Single-Dimension Reset:** Need a fresh Nether or End? Reset individual dimensions safely with an automatic backup saved to your `backups/` folder before anything is removed.
- **Waypoint Sharing:** Import and export your map waypoints with full support for both Xaero's Minimap and JourneyMap formats.
- **Custom Resource Packs:** You can now pick your favorite `.zip` Resource Pack in Launcher Settings under *Personal*. Custom item textures, blocks, and armor load dynamically throughout the launcher with zero disk duplication.
