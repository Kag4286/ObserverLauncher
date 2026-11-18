# ObserverLauncher 9.0.2 — Discord Rich Presence, Webhook 2.0 & Dedicated Discord Settings

ObserverLauncher 9.0.2 upgrades Discord integration with rich, structured server notifications, a live **"Playing" status (Discord Rich Presence)** on your Discord profile, and a clean dedicated **Discord** settings tab.

## What's New
- **Live Discord "Playing" Status (Rich Presence):**
  - Show your active Minecraft server, software & version, live player count (`4/20 players`), TPS, and session timer right on your Discord profile over a local desktop connection (zero external network telemetry).
  - Includes privacy toggles to hide your server folder name, hide player/TPS counts, or keep showing an **Idle** status when no server is running.
  - Built-in **live profile preview card**, real-time connection status pill, one-click **Developer Portal ↗** button, **Reconnect** action, and clear error reporting if an Application ID is rejected by Discord.
- **Discord Webhook 2.0 (Rich Embeds & More Events):**
  - Upgraded Discord alerts to color-coded **Rich Embeds** with software/version, player count, uptime, Crash Doctor diagnosis hints, backup sizes, and TPS/MSPT health—alongside **Compact text** and **Generic JSON** options.
  - Added **Player leaves**, **Backups**, **Low TPS**, and **Tunnel address** alerts alongside Start, Stop, and Crash.
  - Added optional **Bot display name**, **Crash alert mention** (role ID, `here`, or `everyone` only on crashes), **Player head thumbnails**, automatic `429` rate-limit retry, and encrypted webhook storage at rest.
- **Dedicated Discord Settings Tab & Beginner Mode Cleanup:**
  - Moved Discord Rich Presence and Webhook Notifications out of **Advanced** into a dedicated **Discord** tab in **Launcher settings**, fixing cramped event chip layouts.
  - Hidden automatically when **Beginner mode** is active so new hosts keep a minimal workspace.
