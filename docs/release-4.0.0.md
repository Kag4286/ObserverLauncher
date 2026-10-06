# ObserverLauncher 4.0.0

4.0.0 is a **major release**: the whole launcher got a fresh look and feel, built on a new design
system. Everything you could do before is still here — it is just clearer, calmer and nicer to use.
Your existing setup is untouched: **no migration, your settings and servers stay exactly as they are.**

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](../CHANGELOG.md#400--2026-10-06).

---

## A whole new look

We redesigned the interface from the ground up. The goal: less clutter, clearer priorities, and a
look that feels like one product instead of a patchwork.

- **New colour identity** — a warm, dark canvas with an **emerald green** accent (the old cyan is gone).
- **Softer, friendlier shapes** — rounded buttons and cards, more breathing room, fewer boxes.
- **Bigger, clearer headings** and a calmer, roomier layout overall.
- **Smoother motion** — panels gently rise into place when you switch tabs, lists ease in, and menus
  animate open. (You can reduce or disable motion in Settings if your PC is slow.)

## Every tab, cleaned up

- **Overview** is now a proper "home" for your server: the server's name is the star, the **Start /
  Stop** action sits right there with it, and the essentials are one glance away. A collapsible
  **Memory & JVM** panel keeps the launch settings handy without cluttering the page.
- **Players** looks like a roster of people, not a spreadsheet — each player is a card with a round
  avatar that lights up when they're online.
- **Performance** is calmer: the four key numbers share one clean strip, and the two charts sit in one
  panel instead of a pile of separate cards.
- **Content** is tidier: one **+ Add** menu instead of scattered buttons, a clear **Edit files** button,
  and a collapsed **Modpack tools** section.
- **Marketplace** shows real icons for every source (including Hangar and Spigot), with the author's
  name shown where we can get it.
- **Worlds & backups** now lists your worlds as clean cards and your backups as a simple timeline, with
  the newest one clearly marked.
- **World Map** keeps everything you had; the small "this map is heavy" note is now a gentle hint.
- **Settings** is no longer one giant scroll: it is split into clear categories (Setup, Personal,
  Automation, Integrations, **AI**, Advanced), so you go straight to what you need. Switching tabs
  animates smoothly. When you change something, a **"Unsaved changes"** reminder appears next to a
  gently pulsing **Apply** button, so you never lose an edit by forgetting to save.
- **RAM & JVM arguments** are back on the **Overview** in one tidy "Memory & JVM" panel — they decide
  how your server starts, so they belong front and centre.
- **AI / MCP** now has its own Settings page. It walks you through connecting an AI assistant in three
  steps, shows the exact config to copy, and explains what the assistant is allowed to do (read,
  write, or destructive actions — the last one always asks first).

## The Player Inspector, rebuilt

The player detail window is now much more useful — it has **five tabs**:

- **Overview** — profile, equipment, and the player's **active potion effects**.
- **Inventory** — hotbar, main inventory and ender chest, each with search and sort.
- **Stats** — blocks mined, distance walked, playtime, deaths, kills and more, read straight from the
  world save (no server command needed).
- **Live actions** — heal, feed, give items, set XP, change gamemode, **teleport to any coordinates**,
  or kick.
- **Saved data (edit)** — the careful, server-stopped editing from before.

The header shows the player's role at a glance (OP / whitelisted / banned) and their current
coordinates, and every control matches the new look (no more plain system checkboxes or dropdowns).

## The in-app file editor is friendlier

When you edit config files, the file list now shows a **small coloured tag** for each file type
(JSON, YAML, config, log, …) and a folder icon, so you can tell at a glance what is what instead of
reading a wall of text.

## Easier file management (Content)

- **Double-click a plugin/mod/datapack file** to open the folder it lives in, with that file highlighted.
- **Right-click a file** for a quick menu: show in folder, update, enable/disable, delete.

## The New Server wizard is easier to understand

Picking what kind of server to run used to mean reading a flat list of ten names. Now the server
choices are **grouped** (Start here / Plugin servers / Modded servers / Proxy), and every card has an
**ⓘ button** that explains — in plain language — what that software is, who it is for, and links
straight to its **official page**. No more guessing what "Leaf", "Folia" or "NeoForge" means.

## Dropdowns feel alive

Every dropdown (Type, Version, Sort, language, …) now opens with a smooth animation and matches the
new look, instead of the plain system pop-up.

## Under the hood (but you'll feel it)

- **Installing from the Marketplace is safer**: the app now refuses to install a plugin/mod that is
  meant for a different server type (loader) or Minecraft version, or one that is **older** than what
  you already have — unless you deliberately allow it. This prevents the "why did my server break after
  an install" surprises.
- **Spigot icons** now load correctly.
- **AI tools (MCP)** got cleaner, smaller responses and the same safety checks, so an assistant driving
  your server wastes less of its memory and is less likely to do something wrong.

## What is NOT in this release

- Nothing major: every tab, the **Player Inspector**, the **New Server wizard** and the small pop-up
  dialogs are all redesigned in this release. The app still bundles its fonts from Google for now (a
  small follow-up will make it fully offline-safe).

## Upgrading

Just install 4.0.0 over your current version. Your servers, settings and worlds are not touched. If you
use the AI/MCP features, no client changes are needed.
