# ObserverLauncher 4.5.0

4.5.0 gives every server its own look, and makes the New Server wizard pick the right version and
Java for every server type. Two small, focused changes.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#450--2026-10-10).

---

## Give each server its own colour and avatar

When you run more than one server, the list on the left used to look the same for all of them. Now
each server has its own **accent colour** and a small **generated avatar**.

- **Pick a colour** in **Settings > Personal > Instance appearance**: six choices, from the default
green to violet, orange, pink and blue. The colour shows on that server's avatar and marks it as the
active one.
- **The avatar** is drawn automatically from the server's name — a small, unique pattern with the
server's initials (for example "Survival" shows **SU**).
- **Shuffle avatar art** gives you a different pattern if you do not like the first one.
- The avatar still shows the live status dot (running, stopped, starting), so you can see at a glance
which server is doing what.

Your choice is remembered per server and changes nothing else in the app.

## The New Server wizard now gets version and Java right

We checked the wizard against the real, current version lists of every server type and fixed several
things that could make it pick a wrong or missing version:

- **Forge / NeoForge (the big one).** These now use Minecraft's new calendar versions (like **26.3**).
The wizard was reading that number the old way and could tell you a server needed **Java 21** when it
really needs **Java 25** — so a server could start and then crash with a confusing error. It now shows
the correct Java requirement for these builds.
- **Paper / Folia.** The newest version is often only an early test build. "Latest" now always means
the newest **stable** build, so the default choice installs cleanly.
- **Purpur.** "Latest" now follows the version Purpur itself recommends, not just the last one listed.
- **Leaf.** Its version list arrives out of order; it is now sorted properly, newest first.
- **Velocity.** It is a proxy, not a world server — it now correctly shows that it needs **Java 17**.
- If a version list cannot be loaded, the wizard now says so plainly instead of showing an empty list.

## Upgrading

Install 4.5.0 over your current version. Your settings are kept; the update only adds the two new
appearance fields with safe defaults. Nothing else changes.
