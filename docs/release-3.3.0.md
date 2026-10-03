# ObserverLauncher 3.3.0

3.3.0 is a **feature release**. You can now check on a server from another device, keep your
plugins/mods/datapacks up to date from inside the app, and the World Map is smoother to pan. Nothing
about your existing setup changes — no migration, same settings.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](../CHANGELOG.md#330--2026-10-03).

---

## Check on your server from another device

New in Settings → **Remote access** (off by default). Turn it on and you get a small, private web
address you can open from your phone or another PC to see a running server — **without opening any
port on your router**.

- It can **read**: server status, the console, who is online, and the list of your servers.
- It can **send one console command** — but only if you switch **Read-only OFF**. Read-only is ON by
default.
- It **can never** install, edit or delete anything. Those stay in the app.
- Access is protected by a long token (stored encrypted on your PC) and, if you want, a list of
  allowed IP addresses.

The safe way to reach it from outside your home is **Tailscale** (a free private network between your
own devices). The app links you to a short step-by-step guide. There is also an advanced **Bind**
option if you prefer to point it at a specific address yourself.

If you run more than one server, you can target any of them — the address accepts `?instance=<id>`,
and there is a `/instances` list to find the ids.

## Keep your content up to date

The **Content** tab now shows the **version** of each plugin/mod/datapack and a **Check updates**
button. When a newer build exists, that row gets an **Update** button — one click installs it over the
old file (the old file is backed up first).

You can also **Enable / Disable** a plugin or mod without deleting it: disabling renames the file to
`….disabled`, so it stays on disk and you can turn it back on anytime. (The server ignores disabled
files.)

The same three actions are available to an AI assistant over MCP (`check_updates`, `update_content`,
`toggle_content`) — so a whole batch can be checked and updated in one go.

## Datapacks are easier to manage

- **`.mcfunction` and `.snbt` files are now editable** in the built-in editor (most folder datapacks
  are made of these).
- **Extract a `.zip` datapack** into a folder in one step (folder datapacks are easier to edit).
- **Validate a datapack** before you start the server: the app reads its `pack.mcmeta` and warns you if
  the pack is built for a different Minecraft version (a common cause of a datapack that silently does
  nothing or crashes the world). If the version is too new to know, it says so honestly instead of
  guessing.
- Unzipped datapacks now **show up in the list** and can be deleted normally (before, a folder
datapack was invisible).

## The World Map is lighter

- **Panning is smoother** — the map no longer re-computes colours for every cell on every frame, and
  it draws large same-coloured areas in one go.
- The small overview map refreshes a few times a second instead of on every frame, and scales to big
  worlds.
- **Less memory**: the map releases its biome/colour caches when you leave the tab.

## Recovering from a mistake

When an AI assistant (over MCP) writes or edits a file for you, the app now keeps a **backup copy** of
the previous file first — so an unwanted change can be recovered, just like the player-data editor
already did.

## Smaller things

- The background status check asks the server for TPS **less often when everything is healthy**, and
  immediately when it is not — a little less work for a busy server.
- Cleaned up unused text strings (no visible change).

---

**Upgrade note:** your settings and servers are untouched — there is no migration in this release.
Just install 3.3.0 over 3.2.5 as usual.
