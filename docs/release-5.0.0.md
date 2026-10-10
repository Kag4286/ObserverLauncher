# ObserverLauncher 5.0.0

5.0.0 is a big step for the **AI integration** (MCP). The launcher already let an AI read and control
your server; now an AI client understands *what is safe* and *what to do*, without you explaining.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#500--2026-10-10).

---

## What changed

The tool count is the same (75). What changed is how an AI client sees them.

### It knows which actions are safe
Every tool now tells the AI client whether it only reads, whether it can destroy something, and
whether it reaches the internet. That means a well-behaved client can **run read-only checks on its
own** and only stop to ask you before a change — instead of asking permission for every glance at your
server status.

### It has ready-made workflows
If your AI client shows a menu of prompts, you now get six of them, ready to run:

- **Diagnose my server** — full health check, explained in plain language.
- **Tune RAM and performance** — looks at your memory, JVM flags and metrics, suggests a setup.
- **Explain the last crash** — finds the newest crash report and tells you why, in plain words.
- **Set up a Paper server** — recommends version, memory and key settings for your player count.
- **Audit installed mods/plugins** — finds wrong-loader jars, missing dependencies and conflicts.
- **Install a modpack safely** — searches, shows you the plan, then installs only after you say yes.

### It can pull the right context by itself
Besides the fixed resources (status, console, players…), an AI can now build a resource address for
**one specific server** (`instance/<id>/...`) or **a file** — so it reads exactly what it needs without
extra back-and-forth, and without switching the server you are looking at.

## Why it matters

Before: you told the AI what to do, step by step.
Now: you pick a workflow, and the AI already knows the safe path — read freely, ask before writing,
and follow a proven order (diagnose -> plan -> confirm -> act).

## Upgrading

Install 5.0.0 over your current version. No settings change, no migration. If you use the MCP / AI
integration, restart the app and reconnect your AI client — the new capabilities are advertised at
connect time.
