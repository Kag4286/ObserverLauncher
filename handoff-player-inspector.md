# Handoff — Player Inspector (v6.0.0 Track B)

**Date:** 2026-10-19
**Branch:** main · **Base commit:** `51da309`
**Working tree:** 6 modified, 3 new test files — **nothing committed yet**

Read this first, then `git diff`. Everything below is verified against the live
PrismarineJS mirror or executed — do not "fix" anything already marked fixed.

---

## 1. Task origin

User asked to compare this repo against `CalaKuad1/Minecraft-Local-Server-GUI` ("Cubi") and
borrow its Player Inspector. Repo cloned read-only to
`%TEMP%\opencode\mlsg` (do **not** vendor it; note the licence asymmetry in §7).

Cubi's inspector has four things this repo lacked. Three are now done (§2), one is not (§6).

---

## 2. Fixed — verified, tested, NOT committed

### 2.1 3D model was not a humanoid (the reported bug)

User supplied a screenshot showing the model as a melted blob. Root cause: every part was
placed at an invented Y with no relation to the vanilla model.

| part | before | correct (Minecraft) |
|---|---|---|
| legs | `y=0..12` | `y=0..12` |
| body | `y=6..18` ❌ | `y=12..24` |
| arms | `y=5..17` ❌ | `y=12..24` |
| head | `y=14..22` ❌ | `y=24..32` |

The head sank 10 units into the torso; the torso overlapped the legs by 6. The camera also
hard-coded `z=-35` assuming a "~22 unit" model.

Fix — `src/renderer/js/03b-player-3d.js`:
- Extracted `PLAYER_PARTS`, `MODEL_HEIGHT=32`, `HIP_Y=12`, `SHOULDER_Y=24`, `ARM_X=6`,
  `LEG_X=2`, `TORSO_HALF_W=4` to **module scope** (not inside the function) so
  `tests/player-model-geometry.test.js` can assert on them via `vm`.
- Camera distance is now solved from the FOV: `dist = (32/2) / (0.78 * tan(fov/2))` ≈ 49.5.
  Model fills 78% of the frame; verified `max|NDC| = 0.849 < 1` (no clipping).
- Torso depth corrected to **4**, not 8 (depth 8 made the body swallow the arms).
- `draw()` now looks positions up via `partPos('head')` etc. instead of inline literals.

### 2.2 Side faces mirrored against the face (user found this — it was real)

`buildCube` put the face it called `right` at **+X**. But the model faces +Z toward the
camera, so **+X is the character's LEFT**. Skin regions are named from the *character's*
perspective, so the mapping was inverted — the character's right ear appeared on the viewer's
right.

Fix — renamed the keys so the ambiguity cannot come back:

```js
east: map(uv.left),   // +X — viewer's right = character's left
west: map(uv.right),  // -X
```

Applied to every part (head, body, hat, jacket, arm, leg, sleeve, pants). `buildCube` now
consumes `faces.east` / `faces.west`.

### 2.3 Armor sampled the wrong half of its texture

Worn-armor textures are **64×32**, not 64×64. Verified by downloading
`data/1.21.4/entity/equipment/humanoid/diamond.png`: size 64×32, head occupies rows 0–15,
body/arms/legs rows 16–31. The old code computed `v` against a 64-row grid, so the torso
rendered the helmet's pixels.

Fix — `uvc(uv, texW, texH)`; armor cubes pass `SKIN=64, ARMOR_TEX=32`, skin cubes pass
`64, 64`.

### 2.4 Armor textures 404'd on every modern server

`03b-player-3d.js` requested `models/armor/<mat>_layer_1.png`. Mojang moved the humanoid armor
textures in **1.21.2** to `entity/equipment/humanoid/<mat>.png`. Verified with HEAD requests:

```
1.21.4/entity/equipment/humanoid/diamond.png   200
1.21.4/models/armor/diamond_layer_1.png        404
1.21.1/models/armor/diamond_layer_1.png        200
1.21.1/entity/equipment/humanoid/diamond.png   404
```

**Armor has never rendered in 3D on 1.21.2+.** Fixed in `src/main/textures.js`:

- New `tex://` kinds `armor` (layer 1) and `armorlegs` (layer 2).
- `newArmorLayout(version)` picks the layout. Compares `(major, minor, patch)` **numerically**
  — a string compare makes `1.9.4` sort above `1.21.2`.
- `armorCandidates(version, legs)` returns this version's layout first, the other second, so a
  renamed/custom jar still resolves (one reload later).
- `golden` armour now maps to material `gold` — the item is `golden_helmet`, the texture file
  is `gold.png`. Old mapping 404'd.
- Armor left-arm/left-leg cubes sample the **right-side** UVs. Armor textures are 64×32 and
  contain only one arm/leg's pixels; `UV.leftArm`/`UV.leftLeg` live at y=48–64, outside the
  texture, so `CLAMP_TO_EDGE` smeared the border texel.
- `upload()` refuses textures with `naturalWidth <= 1` — `tex://` answers a miss with a 1×1
  PNG and HTTP 200, so binding it made the alpha test discard every fragment.

### 2.5 The placeholder PNG was a solid blue square

The screenshot showed ~11 flat blue icons. Decoding the hard-coded constant:

```
RGBA = [0, 0, 255, 127]   ← opaque blue, NOT transparent
```

`src/main/textures.js` now uses a genuinely transparent 1×1 PNG
(`iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=`).
`tests/armor-textures.test.js` inflates the IDAT and asserts alpha === 0 so this cannot regress.

### 2.6 Minecraft 26.3 broke every icon (user flagged 26.3 is current)

26.3 is the live release, but PrismarineJS has only extracted to **26.1**. Verified:
`data/26.3/items/diamond_sword.png` → 404. A 26.3 server rendered **no icons at all**.

Fix — `mirrorVersion(wanted)` returns the exact version if the mirror has it, otherwise the
**nearest** one (same `major.minor` line preferred). `MIRROR_VERSIONS` is ordered newest-first
and is the single source of truth. `queueRemote` tries `[wanted, fallback] × both armor
layouts`, then caches under the **requested** version so the next request hits `resolveLocal`.

```
26.3 -> 26.1     1.21.12 -> 1.21.11     1.21.2 -> 1.21.1     1.20.1 -> 1.20.2
```

### 2.7 Modded items rendered blank

`03-players.js` did `x.id.replace('minecraft:','')` then requested a URL that can never exist
for a namespaced item. Now: vanilla keeps its icon; a mod item renders its label with
`class="inv-cell no-tex"`. `itemLabel()` keeps the namespace for non-minecraft ids so
`create:wrench` never reads as the vanilla `Wrench`.

Placeholder detection is `onload="if(this.naturalWidth<=1)..."` — **`onerror` does not fire**,
`tex://` returns HTTP 200 with a 1×1 PNG.

### 2.8 Item metadata (durability / enchantments / custom name)

`stackOf()` in `src/main/server-files.js` flattened every stack to `{id, count}`. Now returns
`durability`, `enchantments`, `storedEnchantments`, `customName`, reading **both** the 1.20.5+
`components` compound and the older `tag`. Max durability is derived from the id because
vanilla only stores *overridden* damage.

**Trap:** armor and tool durability tables must stay **separate**. A single `diamond` key
collides (528 chestplate vs 1561 sword) and the later literal silently wins — this shipped as a
real bug during this work and is now covered by tests.

Also fixed: a text component serialized as a JSON **string** (`'{"text":"Rock"}'`) is now
parsed; nested `extra[]` trees resolve.

Renderer: durability bar (green/yellow/red), enchantments in roman numerals, richer tooltip.
New CSS `.inv-cell.no-tex`.

### 2.9 Stale reads while the server was running

A running server only flushes player `.dat` on autosave/logout, so the inspector showed data
up to 15 minutes old. `readPlayer()` in `src/main/players.js` now runs `save-all flush` first,
throttled to once per 5 s with a single-flight guard.

### 2.10 Armor that arrives late now shows up

`renderPlayer3D()` was extracted from `openPlayerInspector()` so the `icons:update` handler can
rebuild the model — the first `<img>` had already fired `onload` on the 1×1 placeholder, so the
armor stayed invisible for the session. Also added `#hotbarList` to the re-render (it was
missing).

---

## 3. Files changed

| File | Change |
|---|---|
| `src/renderer/js/03b-player-3d.js` | geometry table, camera fit, `uvc(uv,texW,texH)`, east/west swap, armor layout, `upload()` guard, `getMaterial` gold |
| `src/main/textures.js` | `armor`/`armorlegs` kinds, `newArmorLayout`, `armorCandidates`, `mirrorVersion`/`MIRROR_VERSIONS`, transparent placeholder |
| `src/main/server-files.js` | `stackOf` + `ARMOR_MAX`/`TOOL_MAX`/`MISC_MAX`, `textOf`, `enchantmentsOf`; exports `stackOf`, `maxDamageFor` |
| `src/renderer/js/03-players.js` | `renderPlayer3D` extraction, namespace-aware icons, `itemTooltip`, `durColor`, roman numerals, `no-tex` fallback |
| `src/renderer/css/04-players.css` | `.inv-cell.no-tex` |
| `src/main/players.js` | throttled `save-all flush` |

## 4. Tests added

| File | Assertions | Covers |
|---|---|---|
| `tests/player-model-geometry.test.js` | 55 | part extents, **zero interpenetration**, east/west orientation, `texH=32` armor, `buildCube` winding |
| `tests/item-metadata.test.js` | 36 | durability table, both NBT layouts, enchantments, custom names, edge cases |
| `tests/armor-textures.test.js` | 50 | layout boundary 1.21.2, numeric version compare, candidate order, mirror fallback, placeholder alpha |

`tests/player-model-geometry.test.js` runs the renderer through `vm.createContext` and pulls the
layout constants back out — `createPlayerRenderer` is never called, so no WebGL context is
needed. Keep it that way; do not move those constants back inside the function.

## 5. Verification status

```
node tests/run.js     ->  All test files passed.   (133 files, exit 0)
```

New tests must be named `*.test.js` in `tests/` — `run.js` auto-discovers.

**Not verified:** nothing was rendered on a real GPU. The geometry is asserted numerically
(AABB non-interpenetration + camera projection) and the mirror URLs were confirmed with real
HTTP HEAD requests, but **the user should open the Inspector once and confirm the 3D model and
the icons look right.**

---

## 6. NOT done — the remaining gap

**Modded item icons.** Still unresolved, and this is the main thing Cubi does that we don't.

- The mirror (`PrismarineJS/minecraft-assets`) is **vanilla-only**. Verified:
  `data/1.21.4/items/wrench.png` → 404.
- So every mod item falls back to a text label. Acceptable, but a Fabric/NeoForge server's
  inventory is mostly `create:`, `ae2:`, etc.

Cubi solves this by extracting the mod's own jar:

```python
def mod_namespaces(server_path):     # mods/*.jar -> {namespace: [jar paths]}
def _mod_root(app_data_dir, jar, ns): # extract assets/<ns>/... once, keyed by jar mtime+size
```

Their pipeline: download the client jar from `piston-meta` (verify SHA1), keep only
`textures/ models/ items/ lang/`, **delete the jar**, then render icons locally with PIL —
flat items composited per layer, blocks as an isometric cube (`_cube()`: 45° yaw, 30° tilt,
vertical edge 0.6124 × width, slab height 0.5), grass/leaf/leather tinting, chest/shield/head
with bespoke UVs.

**Recommendation for this repo:** do *not* download a 30 MB client jar. Extend the existing
`tex://` protocol with a mod namespace instead:

1. Index `mods/*.jar` → `{namespace: [jar]}`, cached by a signature of name+size+mtime.
2. Add kind `itemmod`; on a miss, extract `assets/<ns>/textures/item/*.png` from the owning jar
   into `<dataDir>/textures/mod/<ns>/`, keyed by the mods signature so updating a mod re-renders.
3. Extend `_mod_root` with a zip-slip guard — there is already a hardened extractor pattern in
   the Cubi backend and in `src/main/fs-utils.js`.

Cube/isometric block rendering is a separate, optional nicety. Flat texture icons are enough.

---

## 7. Licensing — read before copying any code

This repo is **Apache-2.0**. Cubi is **MIT**.

- Apache-2.0 is compatible with incorporating MIT code, **but** the NOTICE file must retain
  the MIT attribution. `NOTICE` already exists in this repo — check it before adding anything.
- Everything in §2 was **written from scratch** using the *behaviour* as the spec. No Cubi code
  was copied. Keep it that way unless you deliberately import something, in which case add the
  attribution.
- `CLAUDE.md`/`CONTRIBUTING.md` conventions: comment **why**, not **what**; every bugfix carries
  a comment naming the symptom. Match that style.

## 8. Repo conventions to follow

- Renderer is **classic scripts** (no modules), loaded in numeric order from `index.html`:
  `00-core.js`, `03-players.js`, `03b-player-3d.js`… Globals are shared, no imports.
- Renderer has **no `require()`**. Anything needing Node lives in `src/main/` behind IPC.
- Main-process modules are lazy-`require`d so headless/CLI works — `src/main/textures.js`
  requires `electron.net` *inside* `fetchInto()`, never at module top.
- Tests mock `electron` by patching `Module._load`. Copy that preamble.
- i18n: `src/renderer/locales/*.js` (8 languages). New user-facing strings need entries in
  **all** of them; there is an `i18n.test.js` that will fail otherwise.