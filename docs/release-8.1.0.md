# ObserverLauncher 8.1.0 — Remote Access 2.0

ObserverLauncher 8.1.0 is a major upgrade to **Remote Access**, turning the remote web dashboard into a fast, live-streaming control panel that works cleanly behind Tailscale Serve or a reverse proxy while tightening security.

## What's New

### 1. Live Streaming Dashboard (No More Laggy Polling)
- The Remote Web Dashboard now connects over **Server-Sent Events (`GET /events`)** so console logs, server state changes, and TPS/CPU/RAM metrics appear in real time.
- If a proxy or network drops the stream, the dashboard automatically falls back to polling and reconnects cleanly.

### 2. Metrics, Backups & Player Moderation from Anywhere
- **Live Metrics Bar:** View live TPS, CPU usage, server uptime, and RAM utilization directly in the browser.
- **Backups Card:** Browse existing server backups and trigger a new backup remotely with one click (when not in Read-Only mode).
- **Player & Whitelist Controls:** Add/remove players from the whitelist, kick, ban, unban, or **Force Stop** a hung server directly from the Remote Dashboard, with an accessible in-page confirmation dialog instead of browser popups.
- **DESIGN.md & Mobile Polish:** Updated the Remote Dashboard to match the app's emerald theme, spatial layout, custom controls (no OS-default dropdowns/checkboxes), and mobile-friendly 2×2 action grid with 44px touch targets.
- **Console Upgrades:** Filter console output in real time, see color-coded log levels, clear the view, and cycle through previous commands with `↑` / `↓`.

### 3. Reverse Proxy & Tailscale MagicDNS Support + Stronger Security
- **Allowed Proxy Hosts:** A new **Allowed proxy hosts** setting under *Remote Access → Advanced network* lets you safely allow reverse-proxy or Tailscale hostnames (such as `*.ts.net`) without disabling Host-header protection.
- **Brute-Force Protection:** Repeated invalid token attempts (15 failures within 5 minutes from an IP) are temporarily rate-limited with `429 Too Many Requests`.
- **Open Dashboard Button:** When Remote Access is running, click **Open Dashboard ↗** right in ObserverLauncher Settings to launch the web UI in your browser.
- **Language Persistence:** Switching languages in the Remote Dashboard now updates every section immediately and remembers your choice.
