# ObserverLauncher 5.6.0

More of the AI dashboard: server health and the player list now show as visual panels inside a supporting AI client, not just text.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#560--2026-10-14).

---

## Health checks as a visual list

When the assistant runs a server health check, or the full doctor report, the result now renders as a list of checks. Each row has a coloured badge (green for fine, amber for a warning, red for a problem), the check name, what it found, and the suggested fix when there is one. The header counts how many of each.

Before this, you got the same information as a long block of text. The list is quicker to scan.

## The player list as chips

Asking the assistant for the player list now shows the names as chips, grouped into online, whitelist, operators, banned and known, with a count for each group. Online players are highlighted.

## Same dashboard, three views

This builds on the metrics charts from 5.5.0. It is the same in-client dashboard, which now picks the right view for whatever the assistant asked: charts for performance, the check list for health, chips for players.

This is the MCP Apps standard, and it stays additive. A client that does not support it still shows the same data as text. Verified on Claude Desktop.

## A world map fix

Player markers could disappear under the terrain. Once a chunk's real terrain loaded, it was drawn on top of the player dot and the name label, so an active player became hard to spot. The markers now draw on top of the terrain, so a player is always visible.

## Upgrading

Install 5.6.0 over your current version. No settings change, no migration. Your servers, worlds and settings are untouched.
