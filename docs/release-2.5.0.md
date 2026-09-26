# ObserverLauncher 2.5.0

A two-way AI integration release, plus a new Autonomous Doctor and a license change. If you use the MCP / AI tools, or you want an assistant that can *watch* your server instead of only being asked, this one is for you.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](CHANGELOG.md#250--2026-09-26).

---

## The AI can now watch your server, not just answer questions

Before, the AI could only ask your launcher for something and get one answer. Now it can **subscribe** to live parts of your server and be told when they change:

- **Metrics history** (TPS, MSPT, CPU, RAM, players over time)
- **The newest console lines**
- **The player list**
- **All of your server instances**

This means an assistant can react to a lag spike or a crash as it happens, instead of you having to ask it to check again and again.

## A doctor that proposes fixes (you still say yes)

The Server Doctor could already tell you *what* was wrong. It can now build a **repair plan** you can review before anything happens:

- **Port already in use** → proposes a free port and a restart.
- **A mod is missing a required dependency** → proposes installing it from the marketplace.
- **Memory climbing / running hot** → proposes lowering view distance (and suggests more RAM if it looks like a leak).
- **Crash loop** (several crashes in an hour) → proposes rolling back to your newest backup.

Nothing changes on its own. The assistant shows you the plan, and each fix needs your confirmation. Destructive fixes (a rollback) always ask, even if you turned on auto-allow.

## License changed to Apache-2.0

ObserverLauncher is now under the **Apache License 2.0** instead of MIT. For you as a user, nothing changes — it is still free and open. The difference is legal: Apache 2.0 includes an explicit patent grant and a patent-retaliation clause, which MIT does not. A new NOTICE file lists third-party components.

## Bug fixes

- **The doctor can now actually install a mod it finds missing.** Modrinth search does not match a run-together name like `alexsmobs` against the real project name (`Alex Mobs`), so the doctor used to propose a dependency it then could not install. It now tries name variations, looks up the project directly, and — if more than one mod matches — shows you the list instead of silently installing the wrong one.
- **Installing a mod no longer picks the wrong loader.** A NeoForge server can no longer receive a Forge-only build.
- **Installing an update while a server is running now works.** Before, the launcher could fail to apply an update if a server was running (the update install and the "let the world save first" logic fought each other). It now stops the server first, waits for it to save, then installs.
- **Downloads from the mod registries are more reliable.** A brief network hiccup no longer fails a search or version lookup — it retries a couple of times.

## Smaller improvements

- The AI approval pop-up now shows a short, readable summary of what the assistant wants to do (for example "Install Sodium (mod)" or "3 fixes: change_port, restore_backup") instead of a wall of raw JSON.
- The server list in the sidebar no longer replays its animation every time you switch tabs.
- Removed some leftover code tied to an old chart that no longer exists.

## What to watch out for

- The two-way subscription and the Autonomous Doctor need a client that supports MCP resources and notifications. If your client does not, everything still works the old way — the tools are unchanged.
- `apply_fix` is a destructive-tier tool: it always asks for confirmation and is written to the audit log.
- Updates are not code-signed yet, so Windows may show a SmartScreen prompt when installing one.
- Nothing else changed for normal server hosting.
