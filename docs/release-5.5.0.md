# ObserverLauncher 5.5.0

When an AI client reads your server metrics, it can now draw them as charts instead of printing a wall of numbers.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#550--2026-10-13).

---

## Charts inside your AI client

ObserverLauncher can act as an MCP server, so an AI assistant can read your server and manage it. Until now, every answer was text: a list of numbers for TPS, memory, CPU and players.

There is now a small dashboard that a supporting AI client can show right beside the tool result. When the assistant asks for your server's recent performance, you get line charts for TPS, MSPT, CPU, RAM and players, over the last 30 minutes.

This is the MCP Apps standard (SEP-1865). It is additive: if your AI client does not support it, the assistant still gets the same data as text, exactly as before. Nothing breaks.

## Which clients show it

The dashboard was verified on Claude Desktop. Support depends on the client:

- Claude Desktop renders it.
- OpenCode Desktop does not render it yet, so there you see the text result only.
- Other clients vary. If a client supports MCP Apps, it will show the charts automatically.

You do not need to configure anything new. If your AI client already connects to ObserverLauncher's MCP server, the charts appear when that client supports them.

## Upgrading

Install 5.5.0 over your current version. No settings change, no migration. Your servers, worlds and settings are untouched.
