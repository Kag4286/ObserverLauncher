# ObserverLauncher 3.0.0

ObserverLauncher can now run **without its window**. That sounds strange for a desktop app, but it is the point: the same launcher that runs your server from the GUI can now run as a plain background program — started from a command line, or driven entirely by an AI assistant over the Model Context Protocol (MCP).

If you only ever use the window, **nothing changes**. Same screens, same buttons, same look. The new power sits underneath, and the window uses the exact same machinery.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](../CHANGELOG.md#300--2026-09-28).

---

## You can now run a server from the command line

There is a new `observer` command. It gives you the everyday actions without opening the app:

```
observer status      # is the server running, where is the folder, which Java
observer start       # start the server
observer stop        # stop it gracefully
observer logs        # the last lines of the console
observer players     # who is online / whitelisted / banned
observer backup      # make a world backup
observer doctor      # a full health report
observer list        # all your server instances
observer install ... # install a plugin or mod from a marketplace
```

Add `--json` to any of them and the output becomes machine-readable, so you can script it. Add `--instance <id>` to target one specific server.

## You can set a server up from a template

Instead of walking through the wizard and picking plugins by hand, you can start from a ready-made recipe:

```
observer templates                          # list the recipes
observer init --template survival-5         # show the steps to build it
```

Three ship today:

- **survival-5** — a Paper survival server, tuned for up to 5 players.
- **creative-build** — a Paper creative world with WorldEdit for fast building.
- **modded-performance** — a Fabric server with a performance mod set (lithium, ferritecore, krypton).

`init` prints the exact steps it would run; the same steps are the same actions the app already knows how to do, so nothing is magic.

## The app can run with no window at all

A new background mode starts the whole backend — the server manager, metrics, backups, the scheduler and the MCP server — with no window. It is the same code the window uses, so your settings, your server folders and your instances all carry over. Close it with Ctrl+C and it shuts down cleanly.

This is what makes the next part possible.

## An AI can now manage a headless server

The app has spoken MCP for a while. Until now that always meant the app was open. Now the MCP server can run in the background with no window, so an assistant can connect and manage a server on a machine that has no desktop at all.

The safety rules are unchanged and now *explicit*: with no one to click a confirmation box, write and destructive actions are **refused by default** (and recorded in the audit log). If you want to allow specific ones for automation, you can opt in.

## A health check for unattended setups

When the MCP server is running, it answers a simple `GET /health` with “yes, I’m alive” plus the version — no password needed. That is what a container or a monitoring tool asks. Everything that can *do* something still needs the secret token.

## A better record of what an assistant did

The audit log — the list of write and destructive actions an assistant performed — is now stored as structured entries and **keeps its history**: instead of throwing everything away when it gets large, it rolls over to older files, so you can still see what happened days ago.

## Linux is now officially verified

For a long time the Linux build came with a caveat: it was written and reasoned about on Windows, but nobody had actually run it on a real Linux machine. That caveat is gone.

Every change is now checked on a real Linux kernel automatically — the unit tests, the full app test, and, for the first time, a test that **downloads a real Paper server, boots it, waits for it to finish starting, and shuts it down cleanly**. The Linux-specific parts (finding the server process, reading its memory and CPU, making and restoring a backup) are exercised for real rather than assumed. If a Linux-only problem ever slips in, the build turns red before it reaches you.

---

## What did *not* change

- **The window.** No new buttons, no moved screens, no colour or layout changes. If 3.0.0 looks identical to 2.6.0, that is on purpose.
- **Your settings and servers.** They carry straight over; there is no migration and nothing to re-configure.
- **The confirmation rules.** Write and destructive actions still need approval wherever a person is present.

## What is coming next

3.0.0 is the foundation. On top of it:

- **3.1.0 — Docker:** package a headless server as a container.
- **3.2.0 — CI/CD for modpacks:** verify and boot-test a modpack automatically.
- **3.3.0 — Remote management:** check on your server from elsewhere, designed to be safe by default.

---

*Developer notes: `npm test` (68 files) passes. New: a headless entry point, an `observer` CLI, server templates, an MCP `/health` endpoint, JSONL audit with rotation, an explicit headless confirm policy, and Linux verified on a real kernel (unit + E2E + a real server boot in CI). The GUI shares every line of backend code with the headless mode.*
