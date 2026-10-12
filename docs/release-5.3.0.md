# ObserverLauncher 5.3.0

A small quality release. Three things get better: the Marketplace now names your server software
correctly and shows CurseForge dependencies, and the Performance graphs can look further back.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#530--2026-10-12).

---

## Fixed: the Marketplace called your server "Paper"

When you install a plugin or mod, the confirmation window shows a **YOUR SERVER** badge so you can
see at a glance whether the file matches. It was too vague: it lumped every Paper-style server
(Paper, Purpur, Leaf, Folia) under the single word **"Paper"**. If you run Leaf, it still said
"Paper" — confusing, and it looked like the app had not detected your setup.

Now it shows the **exact software** you are running: Leaf, Purpur, Folia or Paper. The compatibility
check itself is unchanged — a Leaf server still accepts Paper plugins, exactly as before.

## CurseForge projects now list their dependencies

When you picked a **CurseForge** project, its dependencies were never shown, even though the app
knew about them. They now appear in the install window, just like Modrinth projects.

One honest note: CurseForge does not publish an official table for how dependencies relate, so the
list is best-effort and the one-click "install all required" button is intentionally **not** shown for
CurseForge — install those by hand so nothing unexpected lands in your folder. Modrinth projects keep
their one-click button.

## Performance charts: 1 hour and 6 hours

The **Performance** tab used to show only the last 30 minutes. There are now three range buttons —
**15m / 1h / 6h** — so you can look further back when something felt slow an hour ago and you want to
see whether it was a one-off or a trend.

Note: this history lives in memory only, so it **resets when you close the app**. Long-term storage
across restarts is planned for a later release.

## A clearer note for Windows users

ObserverLauncher's Windows installer is not code-signed yet, so Windows sometimes shows a
"Windows protected your PC" warning. The install instructions now explain this plainly and tell you
to click **More info -> Run anyway**. The Linux AppImage is not affected. If you want to be sure a
download is intact, compare it against the SHA-256 printed in the release notes.

## Upgrading

Install 5.3.0 over your current version. No settings change, no migration — your servers, worlds and
settings are untouched.
