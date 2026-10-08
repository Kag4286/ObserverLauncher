# ObserverLauncher 4.2.0

4.2.0 is a small **security and fix** release. Nothing about your servers or settings changes — this
one hardens the AI/MCP integration so your private data stays on your PC, and fixes a few World Map
papercuts.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](../CHANGELOG.md#420--2026-10-08).

---

## Your data stays on your PC (AI / MCP)

If you let an AI assistant (Claude Desktop, Codex, Cursor, …) control your server through ObserverLauncher,
this release closes a gap in what that assistant can see:

- **Player IP addresses, e-mail addresses and similar personal data are now hidden** from *every* piece
  of information sent to the AI — not just the console, but also the server log file and crash
  reports. (They were already hidden from the console; now it is consistent everywhere.)
- **Config secrets are hidden too.** If you run a **Velocity** proxy, its `forwarding-secret` (the key
  that authenticates the proxy) is no longer readable by the AI. The same goes for your RCON password.
  The AI sees `[redacted]` instead of the value.
- **A little more input checking.** If the AI (or a script) tries to set an obviously wrong value in
  `server.properties` — a port of `99999`, a gamemode of `flying` — it is now refused with a clear
  message instead of being written.

None of this changes what *you* can do; it only limits what can leave the machine through the AI
integration.

## World Map fixes

- **"Last seen" time now shows.** Click a player dot on the World Map and the popup now tells you
  when that position was last saved, so you can tell a fresh location from an old one. (The feature
  was there but never actually displayed.)
- **Biomes reload after a hiccup.** If the biome data failed to load once (slow disk, busy PC), the
  area no longer stays blank until you pan away — it retries on the next move.
- **Waypoints always visible.** A waypoint file with a missing colour used to draw an invisible dot;
  it now falls back to a neutral colour.

## Under the hood

- Documentation (README / CONTRIBUTING) was brought up to date with the current module layout.
- Two event handlers that lived in the wrong file were moved to where they belong (no visible change).

## What is NOT in this release

- No new screens, no new settings, no migration. Your servers, worlds and settings are untouched.
- The interface is identical to 4.1.0.

## Upgrading

Just install 4.2.0 over your current version. If you use the AI/MCP features, no client changes are
needed — but a restart of your AI client is fine to pick up the new tool behaviour.
