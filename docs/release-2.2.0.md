# ObserverLauncher 2.2.0 — release summary (plain English)

> This is the user-facing summary for the GitHub Release. No jargon. The developer changelog is
> in CHANGELOG.md; the two are kept in sync.

## The big one: create a server without it landing in the wrong place

If you had more than one server, creating a new one could quietly target a *different* server's
folder — the wizard would complain the folder "already has a server jar" (showing another server's
jar) even though the new folder was empty. That's fixed. Each server now stays in its own folder.

Also: a server creation that failed used to leave an empty leftover instance behind. Now it doesn't
(a cancel still keeps your work so you can resume).

## Downloads that actually work

- **Paper and Folia** used to fail with "no stable build" right after a new Minecraft version came
  out, because the launcher was picking an early test build. It now picks the newest *stable* build
  automatically and tells you which one it chose.
- **NeoForge** used to install a test version for the wrong Minecraft version. Now you pick your
  Minecraft version first, then see that version's builds (newest stable first, test builds clearly
  marked).
- **Forge/NeoForge installer** now catches a corrupt download before running it, and if the install
  fails it shows the real reason instead of a blank error.

## A friendlier setup wizard

- Server software is now a card picker: pick Paper, Purpur, Fabric, Forge, NeoForge, Vanilla and
  more, each with a short description and what it needs. Vanilla is marked **Recommended** for
  beginners.
- You can step **back** to change the Minecraft version (before, NeoForge was a dead end).
- The review screen shows where the download comes from, which Java it needs, and warns you if your
  Java is too old.
- Downloads show speed and time remaining, with a Cancel button.
- Errors are now plain: network, checksum, missing Git/JDK, folder not empty, out of disk space,
  or "no stable build" (which jumps you back to pick a version).

## Java: the right version, automatically

- The launcher now installs the Java the server actually needs. Old servers (Minecraft 1.16.5 and
  older) need Java 8 — before, they got Java 21 and wouldn't start.
- **Servers launched by `run.bat`** (NeoForge/Forge with no `.jar`) now get the right Java too: the
  launcher reads the server's files to figure out which Minecraft version it is, so an old 1.16.5
  Forge server gets Java 8, not Java 21.
- Overview shows "needs Java 21, have 25" and gives you a one-click **Install** button when your
  Java is missing, too old, **or too new** (so you can drop Java 25 to 21 if a mod needs it).
- If you have several Java versions installed, a new **Installed runtimes** dropdown lets you switch
  between them per server.

## Smaller fixes

- Renaming an instance no longer crashes (the old browser prompt isn't supported in the app — it now
  uses an in-app dialog).
- The console no longer spams "Unknown or incomplete command" from `forge tps` on servers that
  reject it.

## What to watch out for

- Java is usually backward-compatible, so Java 25 often runs a 1.21.1 server fine. You only need to
  switch to the exact version if a mod or plugin (mixin/ASM) breaks on the newer Java.
- Existing empty leftover instances from earlier versions are not cleaned up automatically — remove
  them with the X button in the sidebar.
