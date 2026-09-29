# ObserverLauncher 3.1.0

3.1.0 puts the headless launcher into a **container**. If you want to run a Minecraft server on a VPS, a home server or a NAS — somewhere with no desktop — you can now generate a ready-made Docker setup in one command. This release also fixes a handful of command-line rough edges found in 3.0.0.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](../CHANGELOG.md#310--2026-09-29).

---

## Run your server in Docker

One command writes everything you need:

```
observer docker create --type fabric --ram 4 --port 25565 --out my-server
```

That produces a `Dockerfile`, a `docker-compose.yml`, a `.dockerignore` and a short README. Then:

```
cd my-server
mkdir -p server data
# put a server jar (or run.sh) in ./server
docker compose up -d
```

The image bakes its own Java, runs the launcher with no window, and keeps your **server folder** and your **launcher settings** in two separate volumes (`./server` and `./data`), so they survive rebuilds. The container restarts automatically after a reboot, and Docker can see whether it is healthy.

Supported server types: Paper, Vanilla, Purpur, Leaf, Folia, Fabric, Forge, NeoForge and Spigot.

## Your server folder is found automatically

A fresh container has no server folder configured, which used to leave the launcher reporting "no folder". Now it adopts the mounted `/server` folder by itself, and there is a `observer set-folder <path>` command to point it somewhere else. You never have to hand-edit `settings.json`.

## Stopping the container stops the server *properly*

When you stop the container (or press Ctrl+C), the launcher now shuts the Minecraft server down **first** — letting it save — then closes cleanly. Only if the server refuses to stop within 15 seconds does it force-kill it. Nothing is lost, and no orphaned server process is left behind.

## Command-line fixes

- **`--instance` now actually works.** Before, `observer <cmd> --instance <id>` was documented but quietly ran against whichever server was active. It now targets the instance you asked for.
- **`observer start` stays in the foreground.** The server runs attached to your terminal, so you can watch it and stop it with Ctrl+C. If the server crashes, the command returns instead of hanging silently.
- **Command-line actions are now recorded.** Starting, stopping and installing from the CLI appear in the audit log, just like actions taken through an AI.
- **`observer set-folder`** (new) sets the active server folder from the command line — useful for headless setups.

## A note on what did *not* change

- **The window.** The desktop app is unchanged.
- **Your settings and servers.** They carry straight over; there is no migration.

## What is coming next

- **3.2.0 — CI/CD for modpacks:** verify and boot-test a modpack automatically in GitHub Actions.
- **3.3.0 — Remote management:** check on your server from elsewhere, designed to be safe by default.

---

*Developer notes: `npm test` (70 files) passes. New: `src/main/docker.js` (a pure Dockerfile/compose generator), `observer docker create`, `observer set-folder`, container-aware shutdown, and a Docker guide in `docs/docker.md`. The generated image runs `node src/headless.js` as PID 1 with a baked JRE, a `./server`/`./data` volume split and a cheap PID-1 healthcheck.*
