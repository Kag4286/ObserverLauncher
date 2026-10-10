# ObserverLauncher 5.1.0

5.1.0 makes the AI integration more dependable and lets it do one more real thing: **create a new
server**.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#510--2026-10-10).

---

## Ask the AI to set up a new server

Until now an AI client could manage servers that already existed, but not create one. Now it can.

Ask your AI client to create a server (for example a Paper server for a certain version), and it will
**open the same folder picker you use in the app** so you choose where the new server lives. The AI
cannot pick a folder on its own — you always choose. Then it downloads the server software for you and
the new server appears in the list, ready to start.

This keeps the safety rule intact: only you choose folders; the AI just does the busywork.

## The AI can no longer get stuck on a frozen app

If the launcher ever became unresponsive while an AI was waiting for a reply, the AI client could wait
forever. Now every request has a sensible time limit:

- quick checks (status, console, lists) — 30 seconds
- changes (edits, backups, single installs) — 2 minutes
- long jobs (compiling Spigot, downloading a modpack, installing Java) — up to 10 minutes

If a request passes its limit, you get a clear "timed out" message instead of a frozen client. The
operation may still be finishing inside the app — check the Console tab.

## An early look at MCP Apps

We added the first, small piece of **MCP Apps** support — a tiny dashboard page that a compatible AI
client can show inside its own window. This is an early preview to test which clients support it; the
full in-client dashboard is planned for a later release.

## Upgrading

Install 5.1.0 over your current version. No settings change, no migration. If you use the AI
integration, restart the app and reconnect your AI client to pick up the new tool.
