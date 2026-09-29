# modpack.json — declarative modpacks + CI verification (v3.2.0)

A `modpack.json` is a version-controlled, declarative description of a modpack. CI can verify it on
**every pull request** with the PURE verifier — before anything is downloaded — so a wrong loader/MC
combo, a same-file collision or a missing declared dependency fails fast instead of at boot time.

## Schema

```json
{
  "name": "My Server Pack",
  "version": "1.0.0",
  "minecraft": "1.21.1",
  "loader": "neoforge",
  "items": [
    { "id": "jei", "kind": "mod", "source": "modrinth" },
    { "id": "luckperms", "kind": "plugin", "source": "hangar" }
  ]
}
```

| field | required | notes |
| --- | --- | --- |
| `name` | yes | non-empty string |
| `version` | yes | non-empty string |
| `minecraft` | no | e.g. `1.21.1`; used as the target when no live server is given |
| `loader` | no | one of `vanilla, paper, purpur, leaf, folia, spigot, fabric, quilt, forge, neoforge, proxy` |
| `items[]` | no | each `{ id, kind?, source? }`; `kind` is `mod|plugin|datapack|modpack`, `source` defaults to `modrinth` |

## Verify

```bash
# DEFAULT: resolve each item over the network, then run the hard loader/MC/conflict/dependency checks
observer modpack verify path/to/modpack.json

# schema-only (no network) - deterministic, but cannot catch a loader/MC mismatch
observer modpack verify modpack.json --offline

# with a pre-resolved array (offline + reproducible) and a pinned target server
observer modpack verify modpack.json --resolved resolved.json --server 1.21.1/neoforge

# CI: fail on any warning too, and emit machine-readable JSON
observer modpack verify modpack.json --strict --json
```

Exit code: `0` ok, `1` failed (a reject/conflict/missing dep, an item that could not be RESOLVED, or a
warning under `--strict`), `2` usage. An unresolvable item is a FAILURE - a pack we cannot prove
compatible must not verify.

## What is checked

- **Schema** — required fields, known loaders/kinds, item count cap.
- **HARD loader/MC gate** — an item whose `loaders`/`gameVersions` do not match the target server is
  REJECTED (the v2.3.0 crash chain). Only checked when BOTH sides are known, so an unresolved item is
  never a false reject.
- **Item-vs-item conflicts** — duplicate version, two projects writing the same file, declared
  `incompatible` relations.
- **Warnings** — Fabric/Quilt server with mods but no Fabric API; mods on a proxy; per-item Java
  requirement above the server's Java.
- **Missing declared dependencies** — jar-metadata deps (e.g. Kotlin for Forge) not present in the
  plan/present set.

## CI

`.github/workflows/modpack-ci.yml` runs `modpack verify --strict` on any PR/push that touches a
`modpack.json` or the verifier. The **build + boot-smoke + publish** half of 3.2.0 is a separate,
GATED job (label `e2e` / nightly) because a real Minecraft boot needs ~2-4 GB RAM and ~60s.
