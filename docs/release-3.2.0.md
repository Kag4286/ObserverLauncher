# ObserverLauncher 3.2.0

3.2.0 makes a Minecraft server setup **verifiable in CI**. You describe a modpack in a simple
`modpack.json`, and on every pull request a check proves the pack is consistent — correct game version,
correct loader, no two files fighting over the same name, no missing required mod — **before** anything is
downloaded. It also adds a one-command build and a persistent "is this server stable?" record.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](../CHANGELOG.md#320--2026-09-29).

---

## Describe your modpack in a file

Instead of clicking through the marketplace, you can keep a small text file next to your server:

```json
{
  "name": "My Server Pack",
  "version": "1.0.0",
  "minecraft": "1.21.1",
  "loader": "neoforge",
  "items": [
    { "id": "jei", "kind": "mod", "source": "modrinth" }
  ]
}
```

This file is now the single source of truth for what your pack contains. It lives in version control, so
you can see exactly what changed and when.

## Catch a broken pack before you download it

A new command checks the file:

```
observer modpack verify modpack.json
```

It looks each item up and reports problems it can see **without downloading anything**:

- a mod built for the wrong loader (a Fabric mod in a NeoForge pack),
- a mod for the wrong Minecraft version,
- two mods that would write the same file,
- a required mod that is missing.

If it cannot look an item up at all, that is treated as a failure too — a pack we cannot prove is
compatible should not quietly pass. Add `--offline` when you only want the file checked, with no network.

## Every pull request checks itself

A GitHub Action runs that check automatically whenever a `modpack.json` changes, so a broken pack can
never be merged by accident. There is also a heavier, **opt-in** job that actually builds the pack and
boots a real Minecraft server from it — because that needs a lot of memory and about a minute, it runs
only when you ask for it (a nightly run, a manual trigger, or a pull request labelled `e2e`).

## Build the pack in one command

```
observer modpack build modpack.json --out my-server
```

This downloads every item into a fresh server folder — with the same safety checks (allowed hosts only,
file hashes verified) the normal marketplace install uses. Refuses to build if anything could not be
resolved, so you never get half a pack.

## Ship the pack as a download

When you push a version tag, CI builds every `modpack.json` in the repository into a ready-to-run
archive (`.tar.gz`) and attaches it to that release on GitHub — next to the app installers. You can also
do it locally:

```
node scripts/modpack-publish.js --out dist
```

The archive contains the resolved jars and the install manifest, so a friend can download one file and
drop it into a server folder. Same safety checks as the build above: allowed hosts only, hashes verified.

## Did the server stay up?

ObserverLauncher now keeps a small persistent note of each server run: when it started and how it ended.
A run that survives a couple of minutes counts as **stable**; if a server crashes early several times in a
row, the Console recommends a rollback so a bad update cannot loop forever. This record lives on disk, so
it survives even a launcher crash — which the old in-memory counters did not.

---

**Under the hood:** a small code-health pass removed duplicated CSS and JavaScript, and two unused
translation keys were dropped. A new duplicate-code guard (`tests/no-dup.test.js`) runs as part of the
test suite, so a copy-pasted CSS rule or JavaScript block now fails the build. CI also builds the Docker
image on every change and loads the headless entry point inside it, closing the gap that once shipped a
container that could not start. **Note for old servers:** Minecraft **26.1 and newer requires Java 25** —
the launcher detects this and installs the right Java automatically, so 1.21.x and older still run on
their own Java. The settings file format is unchanged (still v4) — nothing to migrate.
