# ObserverLauncher 4.4.0

4.4.0 makes **Remote access** friendlier — there is now a real page you can open in a browser — and
closes the last small security notes from the previous release. If you never turned Remote access on,
this is a quiet update.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](../CHANGELOG.md#440--2026-10-10).

---

## A real page for Remote access

Remote access lets you check a running server from your phone or another PC. Until now the address it
gave you only returned raw data — open it in a browser and you saw `{"ok":false,"error":"unauthorized"}`.

Now, open the same address (`http://127.0.0.1:<port>/`) and you get a small dashboard:

- **Status** — running or stopped, the server software, Java, and the folder.
- **Console** — the recent output, refreshed automatically.
- **Players** — who is online, the whitelist, bans and operators.
- **Instance picker** — if you run more than one server, choose which one to look at.
- **Actions** — Start, Stop and Restart buttons, plus a Kick link on each online player. They appear **only when Read-only is turned off**.
- **Command box** — send a single console command. It appears **only when Read-only is turned off**.

Paste your token once (use **Copy** in Settings → Remote access). The page remembers it in that
browser and never puts it in the address bar. The dashboard is available in all seven languages and
matches the app's look.

It works exactly the same from your phone over Tailscale — no port forwarding.

## Small security clean-ups (Remote)

- **Token checking is now constant-time** — a wrong token can no longer be narrowed down by how long
  the answer takes.
- **The remote server is rate-limited** (300 requests a minute) — a leaked token can't be used to
  hammer your server.
- **The IP allowlist now guards everything**, including the health check and the page's own files — not
  just the data endpoints.
- **Errors no longer leak internals** — a failure returns a plain "Internal error." and the detail is
  kept in the app's log.
- **Browser requests are allowed only from the page itself** (same address). Any other website trying
  to talk to your remote API is still refused.

None of this changes how the JSON API works for scripts; it is the same as before.

## What Remote access can and cannot do

Remote access is deliberately narrow. When **Read-only is off** you can read status/console/players
and run the four **safe actions** (start, stop, restart, kick). It can **never** install, delete, edit
files or restore backups — those stay in the desktop app only. Turn Read-only on and even the
actions are blocked; the dashboard becomes read-only.

## Fixed: a false "unstable server" warning

The launcher watches whether a server stays up long enough to be considered stable, to warn about a
crash loop. But a server you **started and then stopped yourself** within two minutes was counted as a
crash — so three quick start/stop tries could log a scary "unstable 3 runs in a row — rollback
recommended" with nothing actually wrong.

Now a **manual Stop is no longer treated as a crash**. Your real crash history is still kept: if a
server genuinely crash-loops, the warning still appears.

## Upgrading

Install 4.4.0 over your current version. No settings change, no migration. If you use Remote access,
open `http://127.0.0.1:<port>/` and paste your token to try the new dashboard.
