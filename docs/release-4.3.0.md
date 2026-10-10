# ObserverLauncher 4.3.0

4.3.0 is a **security release for Remote access**. If you never turned Remote access on, nothing
changes for you — but if you did, this release fixes a situation where a safety setting you changed
did not actually take effect.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](../CHANGELOG.md#430--2026-10-09).

---

## Remote access settings now apply the moment you Save

Remote access lets you check a running server from your phone or another PC. It has a few safety
switches: **Read-only**, **Allowed IPs**, **Bind address** and **Port**.

Before this release, those switches were only read when the remote server *started*. If you changed
one while it was already running, the change appeared to be saved — but the running server kept using
the old value until you fully restarted the app. That was a real risk:

- Turning **Read-only ON** did not immediately block the one command endpoint.
- Removing an IP from **Allowed IPs** did not immediately lock that IP out.
- Changing **Bind** or **Port** did nothing until a restart.

Now every one of those changes takes effect **immediately on Save**. Tightening a setting is never
left pending.

We also fixed a related bug where turning Remote access on for the very first time only actually
started it after an app restart.

## Easier token management

Remote access uses a secret **token** — the password a client must send. Until now you had to dig
into a settings file to see or change it. Now, in **Settings → Remote access**:

- **Reveal** — show the token (it stays hidden until you ask).
- **Copy** — copy it straight to your clipboard to paste into your client.
- **Regenerate** — create a brand-new token (with a confirmation). Any device still using the old
  token stops working right away, which is exactly what you want if the old one leaked.

## Under the hood

- The save path now returns the live remote status so the Settings screen reflects reality instantly.
- New regression tests cover live config apply, read-only enforcement, allowlist enforcement and
token rotation.

## What is NOT in this release

- No new screens beyond the three token buttons, no migration. Your servers, worlds and settings are
  untouched.

## Upgrading

Install 4.3.0 over your current version. If you use Remote access, open **Settings → Remote access**
and press **Copy** to grab your token for your client — it is unchanged, so your existing client
keeps working.
