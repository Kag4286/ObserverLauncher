# ObserverLauncher 8.0.0

Welcome to **ObserverLauncher 8.0.0**!

This major release makes managing and hosting your Minecraft servers simpler, lighter, and more visual. Highlights include **Player Inspector 2.0** with real-time 3D character preview, native **Pumpkin** and **Horizon** server support (ultra-low memory, zero Java needed), a smoother **World Map** with structure discovery, and refined controls throughout the app.

For technical details, developers and power users can read the [developer changelog](CHANGELOG.md).

---

## 🎮 Player Inspector 2.0: Real-Time 3D Previews & Easy Management

Managing the players on your server is now visual and intuitive:

- **Live 3D Skin & Armor View:** See an authentic 3D model of any player wearing their current armor. Skin layers and outer jackets render smoothly without graphical glitches.
- **Inspect Online Players Instantly:** Click any player who is currently playing to check their live health, food, position, and dimension in real-time. Works across all server types, including native Rust servers (Pumpkin and Horizon) and newly joined players.
- **1-Click Quick Actions:** Give or remove Operator status, edit the whitelist, teleport to a player (`/tp`), kick, or ban with a single click from the top toolbar.
- **Full Inventory & Ender Chest:** Browse every item a player is carrying in a familiar 9×4 grid. Switch between their backpack and Ender Chest with one click, or search items by name.
- **Health & Hunger Meters:** Clear 10-segment gauges show exactly how much health, saturation, and experience a player has.
- **Jump to Map:** Click the map button next to a player's coordinates to jump straight to their location on the World Map.

---

## ⚡ Super-Lightweight Rust Servers (Pumpkin & Horizon)

ObserverLauncher now supports modern, high-performance Minecraft servers written in Rust:

- **No Java Required:** Pumpkin and Horizon run as native programs directly on Windows and Linux. You don't need to install or configure Java runtimes.
- **Ultra-Low Memory:** While traditional servers often need 2 GB to 4 GB of RAM, Pumpkin and Horizon run smoothly with only ~100 MB to ~250 MB of memory. Perfect for older PCs, laptops, or background hosting.
- **Instant Start:** Servers launch in less than a second.
- **Simple Settings:** Adjust server port, max players, difficulty, PVP, game mode, and whitelist directly in the launcher interface without manually opening config files.

---

## 🗺️ World Map: Structure Finder & Low-Resource Mode

The built-in World Map gives you a live overview of your Minecraft world:

- **Structure Discovery:** Locate villages, pillager outposts, desert temples, ancient cities, ocean monuments, nether fortresses, and trial chambers directly on the map.
- **1-Click Low-Resource Mode:** If your world is very large or you are on a laptop, click the **Low-Resource Mode** button to reduce CPU and memory usage while keeping terrain fast and responsive.
- **Readable Player Cards:** Player names in the map sidebar are spaced cleanly so they are never cut off by health badges.
- **Nether Portal Link Calculator:** Click any spot on the map to see the exact matching coordinates in the Nether, with a 16-block safe link circle.
- **Custom Waypoints:** Drop waypoints for your base, mines, or portals and jump to them anytime.

---

## 🌐 Play with Friends Without Port Forwarding

Playing with friends shouldn't require messing with your home Wi-Fi router:

- **Local Network:** If friends are in the same house or on the same Wi-Fi, copy your local IP address in 1 click.
- **Internet Play (Built-in Tunnels):** Turn on the built-in Playit.gg or Pinggy tunnel to get a shareable internet link. Your friends can connect from anywhere in the world—**no router port forwarding or public IP setup required**.

---

## 🛠️ Smarter Setup Wizard & Conflict Checks

- **Accurate Software Guides:** The new server wizard clearly highlights what makes each software special (Vanilla, Paper, Purpur, Fabric, Forge, Horizon, Pumpkin).
- **Clean Version Selection:** Switching between different software types resets version pickers cleanly without leftover messages.
- **Mod Conflict Scanner:** If you install mods, the launcher checks for missing dependencies, wrong mod loaders, or duplicate files before you press Start.

---

## 🌍 Available in 7 Languages

Every screen, button, and help text in ObserverLauncher is fully translated:

- 🇬🇧 **English**
- 🇻🇳 **Tiếng Việt**
- 🇪🇸 **Español**
- 🇧🇷 **Português (Brasil)**
- 🇩🇪 **Deutsch**
- 🇷🇺 **Русский**
- 🇨🇳 **简体中文**

You can change your language anytime in **Launcher settings &rarr; Personal &rarr; Language**.

---

### Getting Started & Support
- [Download ObserverLauncher 8.0.0](https://github.com/Kag4286/ObserverLauncher/releases/latest)
- [Report an issue or suggest a feature](https://github.com/Kag4286/ObserverLauncher/issues)
- [Browse project documentation](docs/)
