# Running ObserverLauncher in Docker

ObserverLauncher can run **headless** (no window) inside a container, so you can host a Minecraft
server on a VPS, a NAS or any machine with Docker — and drive it from the command line or an AI
assistant over MCP.

This is the same backend the desktop app uses: the launcher is PID 1 and spawns the JVM as a child,
exactly as it does on Windows/Linux.

## Quick start

Generate a Docker setup for the server type you want:

```bash
# from the project root
node src/cli.js docker create --type fabric --ram 4 --port 25565 --out my-server
# (or, once installed: observer docker create --type paper --ram 6)
```

That writes four files into `my-server/`:

- `Dockerfile` — a `eclipse-temurin:21-jre` image with Node + the app, running `node src/headless.js`
- `docker-compose.yml` — the service, port mapping, volumes and healthcheck
- `.dockerignore`
- `README.docker.md` — short host-side notes

Then:

```bash
cd my-server
mkdir -p server data          # the two volumes
# put a server jar / run.sh in ./server (the container downloads nothing on first boot)
docker compose up -d
docker compose logs -f
```

## How it is wired

| Concern | How |
|---|---|
| Window | None — `src/headless.js` runs the whole backend with no Electron. |
| Java | **Baked into the image** (`eclipse-temurin:21-jre`). The in-app Java auto-installer is bypassed in-container. |
| Server files | Bind-mounted volume `./server` → `/server` (world, plugins, mods, `server.properties`). |
| Launcher data | Bind-mounted volume `./data` → `/data`, via `OBSERVER_DATA_DIR=/data` (holds `settings.json`, backups state, MCP config). |
| Port | `EXPOSE`d and published (`"<port>:<port>"`). Keep `server.properties`' `server-port` in sync. |
| Health | `docker compose` healthcheck runs `node src/cli.js status`. The MCP server also exposes an unauthenticated `GET /health` when MCP is enabled. |
| Restart | `restart: unless-stopped` — the container comes back after a reboot. |
| Shutdown | `SIGTERM` is caught by `src/headless.js`, which gracefully stops the server (up to 15s, then force-kills the tree), then the tunnel and MCP, and only then exits. A **second** signal exits immediately. |

## Options

```
observer docker create
  --type <paper|vanilla|purpur|leaf|fabric|forge|neoforge|spigot>   (default: paper)
  --version <mc version|latest>                                     (default: latest)
  --ram <GB>                                                        (default: 4, clamped 1..64)
  --port <port>                                                     (default: 25565)
  --java <major>                                                    (default: 21)
  --mods <a,b,c>                                                    (recorded in the README; install the jars yourself)
  --out <dir>                                                       (default: docker-<type>)
  --json                                                            (machine-readable output)
```

## Notes and limits

- **The container does not download a server jar on first boot.** Put one in `./server`, or create it
  from the desktop app's wizard first, then mount that folder.
- **MCP stays loopback-only.** The MCP HTTP server binds `127.0.0.1` inside the container. To let an
  AI client reach it, run the client on the same host and point it at the published port, or run the
  bridge inside the same Docker network. Do **not** expose the MCP port to the internet — the
  per-launch bearer token is the only gate, and it grants the full tool set (including destructive
  tools).
- **Mods/plugins** are best installed with `observer install <id>` (or the desktop app) before
  packaging, since the generated compose file only records the requested list.
- Memory: set `--ram` to leave headroom for the OS/container. `docker stats` shows real usage.

## Troubleshooting

- **Container exits immediately.** Check `docker compose logs`. A missing server jar means the
  launcher has nothing to start — that is expected until you add one.
- **Port already in use.** Change `--port` and the compose mapping, and update `server-port` in
  `./server/server.properties` to match.
- **Permission errors on the volumes.** On Linux, the container user may not own the bind-mounted
  `./server` / `./data`; `chown` them to the container's user or run with a matching UID.
- **Healthcheck stays unhealthy.** It runs `observer status`; if the launcher booted but has no server
  folder set, that is still healthy. An unhealthy state means the headless process itself failed —
  read the logs.
