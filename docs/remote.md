# Remote management (3.3.0)

Check on a running server from another device — your phone, a laptop, a VPS — without opening a
port on your router. **Off by default.** When you turn it on, the launcher starts a small
**loopback-only** HTTP server (`127.0.0.1`) that answers read-only questions (status, console,
players) and, if you allow it, a few safe actions (send a console command). **It never exposes
install or delete.**

## Quick start (friendly path)

1. **Settings → Remote access → Enable.** The launcher generates a long-lived token and shows the
   address(es) to use. Click **Copy** next to the one you need.
2. Pick how to reach it:
   - **Same PC** — `http://127.0.0.1:<port>` (for scripts/tools on the same machine).
   - **Same WiFi** — `http://<lan-ip>:<port>` (e.g. your phone on the couch).
   - **Anywhere** — use **Tailscale** (recommended, below).

## Recommended: Tailscale (no port, real identity)

Tailscale gives every device a private IP inside your own network, so the remote API is reachable
from anywhere **without** exposing a port to the public internet.

The remote server binds `127.0.0.1` by default, so a request to the Tailscale IP (`100.x`) is refused
unless you either (a) proxy it with `tailscale serve`, or (b) change **Bind** to that IP. Both work:

**Option A — `tailscale serve` (keeps the loopback bind, recommended):**

1. Install Tailscale on the PC running the server and on the device you want to use it from.
2. Sign in to the same Tailscale account on both.
3. On the server PC, proxy the tailnet to the launcher's loopback port:
   ```bash
   tailscale serve --bg http://127.0.0.1:8777
   ```
   (`8777` = the port shown in Settings; leave it on a fixed port so the URL stays stable.)
4. From the other device, use the `https://<machine>.<tailnet>.ts.net` URL that `tailscale serve`
   prints.

**Option B — bind the Tailscale IP directly:**

1. Same install/sign-in as above.
2. Find the PC's Tailscale IP (`100.x.y.z`) in the Tailscale app.
3. Settings → Remote → **Bind** = that `100.x` IP (Advanced), and add it to **Allowed IPs**.
4. From the other device, use `http://100.x.y.z:<port>` (plain HTTP — see the note below).

The launcher never opens a firewall port or ships TLS itself. With **Option A**, `tailscale serve`
adds HTTPS for you. With **Option B** the connection is plain HTTP inside the tailnet, so prefer
Option A when the traffic crosses untrusted networks. A classic tunnel (Playit) also works, but
Tailscale is the safer default because access is tied to real device identity, not a guessed URL.

## Advanced

| Setting | What it does |
| --- | --- |
| **Port** | Fixed TCP port for the remote server. `0` = pick a free one each launch. |
| **Allowed IPs** | Comma/space list. Each entry may be an exact IP (`10.0.0.5`), a wildcard (`192.168.1.*`), or CIDR (`100.64.0.0/10` for a Tailscale range). **Empty = allow any** (still loopback-only unless you expose it). |
| **Read-only** | **On by default.** Blocks `/command` (the only action endpoint) — the API can only read. |
| **Token** | A long-lived bearer token (48 hex chars). Use **Reveal** / **Copy** to configure a client, and **Regenerate** to mint a new one (existing clients must be updated). |

## API

All endpoints are on the loopback server. `/health` is unauthenticated (liveness only); everything
else needs `Authorization: Bearer <token>`.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/health` | — | `{ ok, uptime, version }` |
| GET | `/status` | — | server status (same shape as the MCP `get_status` tool) |
| GET | `/console?lines=N` | — | recent console lines (1–1000, default 200) |
| GET | `/players` | — | online/whitelist/ban/op players |
| GET | `/instances` | — | every instance (id, name, status) |
| POST | `/command` | `{ command, instance? }` | runs one console command (blocked when read-only) |

Add `?instance=<id>` to any read (`/status`, `/console`, `/players`) or `"instance"` to the
`/command` body to target a specific server. Omit it to use the active instance. `GET /instances`
lists the valid ids.

Example:

```bash
curl -H "Authorization: Bearer <token>" http://127.0.0.1:8777/status
curl -H "Authorization: Bearer <token>" "http://127.0.0.1:8777/console?lines=50"
curl -X POST -H "Authorization: Bearer <token>" -H "content-type: application/json" \
     -d '{"command":"list"}' http://127.0.0.1:8777/command
```

## Applying changes

Enabling remote access and every change to **Bind / Allowed IPs / Read-only / Port** take effect
**immediately on Save** — the running server is restarted with the new config, so tightening a
setting (e.g. turning Read-only on, or narrowing the allowlist) is never left pending. Rotating the
token also restarts the server and invalidates the old token at once.

## Security model

- The remote server binds **127.0.0.1 only** — it is never reachable from the LAN by itself.
- The token is stored **encrypted at rest** (OS keyring via safeStorage, same as the CurseForge key).
- The IP allowlist is checked **before** the token, and the token **before** any handler.
- **Only** the read-only subset + a single `command` action exist. There is **no** remote install,
  edit, delete, or restore — those stay in the desktop GUI.
- MCP (the AI integration) is a **separate** loopback server and is never exposed to the internet.
