# ObserverLauncher — Design System (v4.0.0)

> **Theme:** LIVING CONSOLE — WORLDS, NOT WIDGETS
> **Mood:** warm / spatial / technical / approachable
> **Source of truth:** `src/renderer/css/01-tokens.css`
> **Status:** v4.0.0 foundation. This document is the contract every screen and component follows.

v4.0.0 is a visual and UX reset. Do not extend the old Field Station / Signal Lab language
(black/cyan, 2–4px radii, instrument density). The app should feel like a place where worlds live,
not like a monitoring console.

---

## 0. Scope of this document

This file is the foundation for the v4.0.0 GUI/UX rework. It defines:

1. Design philosophy + principles (sections 1–2)
2. The token system: color, type, shape, depth, spacing (sections 3–8)
3. A **migration map** from the old tokens so the 9 existing CSS files do not break at once (section 9)
4. The motion contract, tied to the existing `--dur-*` tokens + the ratchet test (section 10)
5. The i18n contract (7 locales, every new string) (section 11)
6. The component catalogue: the shared building blocks (section 12)
7. App shell + per-tab specifications for ALL 10 tabs, including modals and the wizard (sections 13–17)
8. A split between what is pure CSS work and what needs backend work (section 18)

Guiding rule for the rework: **layering, not deletion.** Beginner sees a calm summary; advanced and
expert information is moved to the correct layer (a details panel, a subtab, the Performance tab),
never removed.

---

## 1. Design philosophy

ObserverLauncher manages Minecraft worlds. The UI communicates:

- **World** — this is the place the server represents.
- **Life** — running servers feel active; stopped servers feel dormant, not broken.
- **Clarity** — advanced capability is present without overwhelming beginners.
- **Personality** — the app has an identifiable visual character.
- **Control** — actions stay obvious and trustworthy.

The visual language is: **soft machinery + living worlds + editorial composition.**

It is NOT: a generic SaaS dashboard, a terminal skin, a glassmorphism demo, a cyberpunk control
room, or a Minecraft-themed toy.

---

## 2. Visual principles

### 2.1 Spatial, not boxed

Do not wrap every element in a bordered card. A container earns its border only when it groups or
is interactive. If a container exists only because "everything needs a border", remove it and use
spacing + background difference instead.

### 2.2 Hierarchy before decoration

Every screen has, in order: one dominant element, one obvious primary action, supporting
information, then optional advanced information. Never let five elements compete.

### 2.3 Friendly does not mean childish

Use generous spacing, readable language, rounded controls, expressive type, subtle motion, clear
empty states, warm neutral surfaces. Avoid giant cartoon icons, emoji spam, fake Minecraft blocks,
and bounce animations.

### 2.4 Information is layered

- **Beginner:** "Server is ready."
- **Advanced:** `Paper 26.3 · Java 25 · 4.0 GB · 19.8 TPS`
- **Expert:** MSPT distribution, JVM memory, process state, logs, diagnostics.

Move information into the right layer; never delete it.

---

## 3. Color system

The old system is black/cyan. The new system is a **warm near-black canvas with an aurora accent
system**. Cyan is no longer the identity color; the primary brand is **acid-lime / electric leaf**.

### 3.1 Base surfaces

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#0C0D0F` | application canvas |
| `--bg-elev` | `#111317` | floating regions |
| `--surface` | `#15171B` | primary surfaces |
| `--surface-2` | `#1B1E23` | raised surfaces |
| `--surface-3` | `#23272E` | hover / selected |
| `--field` | `#101216` | inputs / editors / console |
| `--border` | `#2A2E35` | subtle boundaries |
| `--border-strong` | `#3A4049` | active / focus boundaries |

### 3.2 Text

| Token | Value | Usage |
|---|---|---|
| `--text` | `#F4F1EA` | primary text |
| `--text-2` | `#D7D3CA` | secondary text |
| `--text-muted` | `#A39F97` | supporting text |
| `--text-dim` | `#76736D` | labels / metadata |
| `--text-disabled` | `#4F4D49` | disabled content |

Never use `#FFFFFF` for large body copy; the interface stays slightly warm.

### 3.3 Brand accents

| Token | Value | Usage |
|---|---|---|
| `--brand` | `#9CD32E` | primary action / active state |
| `--brand-soft` | `rgba(156,211,46,.12)` | selected background |
| `--brand-glow` | `rgba(156,211,46,.28)` | subtle emphasis |
| `--brand-ink` | `#0A1200` | text/icon ON a brand fill |
| `--violet` | `#9B8CFF` | secondary creative accent |
| `--orange` | `#FFB86B` | attention / activity |
| `--pink` | `#FF7AA8` | rare accent |

### 3.4 Semantic status

| Token | Value | Usage |
|---|---|---|
| `--success` | `#72E6A6` | healthy / ready |
| `--warning` | `#FFC857` | attention |
| `--danger` | `#FF667D` | error / destructive |
| `--info` | `#8FB8FF` | informational |

Semantic colors are never decorative. Decorative accents are never semantic.

### 3.5 Instance accents (multi-instance)

Each instance MAY carry an accent color. Default is `--brand`.

```css
--instance-accent: var(--brand);
```

Selectable set: `lime`, `violet`, `orange`, `pink`, `blue`.

Used ONLY for: instance avatar, active rail item, world-header decoration, chart highlight of the
active series, and selected state. An instance accent NEVER recolors the whole app.

**Scope note:** the accent is a CSS feature in v4.0.0. A per-instance color PICKER that persists is
a small settings feature (see section 18).

---

## 4. Background language

The background is not flat black. Use at most 1–2 large ambient gradients per screen:

```css
background:
  radial-gradient(circle at 70% 0%, rgba(183,243,74,.035), transparent 35%),
  var(--bg);
```

Rules: no constant moving gradients, no rainbow, no neon glow everywhere. The app must still look
excellent with gradients disabled.

---

## 5. Typography

### 5.1 UI font — BUNDLED (offline-safe)

Preferred: **Manrope**. Fallback: Inter, system-ui, sans-serif.

> The app is an offline desktop tool. Fonts are BUNDLED into the app (`@font-face` under
> `src/renderer/assets/fonts/`, loaded via CSS), NOT fetched from Google at runtime. A remote font
> that fails offline causes layout shift and an ugly fallback. The CSP already allows `self` for
> fonts; no `fonts.googleapis.com` link is added for the UI font.

Weights: 400 body, 500 UI, 600 labels/buttons, 700 headings, 800 hero display.

### 5.2 Technical font

Preferred: **IBM Plex Mono**. Fallback: JetBrains Mono, ui-monospace, monospace.

Use for: TPS, MSPT, RAM, CPU, ports, version strings, file paths, command output, code, timestamps.
Do NOT use mono for every label — only genuinely technical values.

### 5.3 Type scale

| Role | Size / weight |
|---|---|
| Display | 40–56px / 800 |
| Page title | 28–34px / 800 |
| Section | 18–22px / 700 |
| Card title | 14–16px / 700 |
| Body | 14px / 500 |
| Small | 12px / 500 |
| Technical | 12–14px mono |
| Micro | 10–11px mono |

Do not uppercase every small label. Uppercase is reserved for compact technical metadata (the
`.eyebrow` class).

---

## 6. Shape language

The old UI used 2–4px radii. v4.0.0 moves to softer geometry:

```text
--r-xs: 6px
--r-sm: 10px
--r: 14px
--r-lg: 18px
--r-xl: 24px
```

- Primary cards: `14–18px`
- Buttons: `10–12px`
- Inputs: `10–12px`
- Modal: `18–24px`
- Badges / status pills: `999px`

Pills communicate status. Cards communicate structure. Buttons communicate action. Do not round
everything to pills.

---

## 7. Shadows and depth

No strong black shadows. Layered, low-opacity depth:

```css
--shadow-sm: 0 2px 8px rgba(0,0,0,.18);
--shadow:    0 8px 24px rgba(0,0,0,.22);
--shadow-lg: 0 18px 50px rgba(0,0,0,.30);
```

A surface is distinguished by background difference, shadow, spacing, contrast OR accent. A border
is optional — never required around every surface.

---

## 8. Spacing

8px rhythm:

```text
--space-1: 4px   --space-6: 24px
--space-2: 8px   --space-7: 32px
--space-3: 12px  --space-8: 40px
--space-4: 16px  --space-9: 48px
--space-5: 20px  --space-10: 64px
```

The app should feel less dense than 3.3. Prefer whitespace over separator lines.

---

## 9. Token migration map (HOW the old CSS keeps working)

This is the part a pure "vision" document omits. The 9 CSS files reference the OLD token names. We do
NOT rename every call site in one commit. Instead:

1. `01-tokens.css` defines the NEW primitive tokens (section 3–8).
2. It KEEPS the old names as **legacy aliases** pointing at the new primitives, so nothing breaks.
3. Each screen is rewritten tab-by-tab to use the new names (section 17).
4. When the last file stops using a legacy alias, the alias is deleted (tracked as a checklist item).

### 9.1 Alias table

| Old token | New alias | Note |
|---|---|---|
| `--bg-2` | `var(--bg-elev)` | |
| `--panel` | `var(--surface)` | |
| `--panel-raised` | `var(--surface-2)` | |
| `--panel-hover` | `var(--surface-3)` | |
| `--field-border` | `var(--border)` | |
| `--accent` | `var(--brand)` | accent color changes cyan→lime |
| `--accent-dim` | color-mix of brand | |
| `--accent-weak` | `var(--brand-soft)` | |
| `--accent-glow` | `var(--brand-glow)` | |
| `--accent-ink` | `var(--brand-ink)` | |
| `--success` `--warning` `--danger` | same names, new values | |
| `--chart-*` | brand / warning / success | |
| `--r-sm` `--r` `--r-lg` | same names, new values (10/14/18) | audit each use |
| `--s1`..`--s5` | `var(--space-N)` (nearest) | see 9.3 |
| `--fs-tab` `--fs-sec` `--fs-sub` `--fs-label` | mapped to section 5.3 scale | |

### 9.2 ⚠️ The `--text-muted` TRAP

The old `--text-muted` was `#E6EDF3` (near-white, used as SECONDARY text). The new `--text-muted` is
`#A39F97` (a dimmer tertiary tone). These are NOT the same role.

- Old `--text-muted` (near-white secondary) usage → migrate to **`--text-2`**, NOT new `--text-muted`.
- New `--text-muted` is for the tertiary "supporting text" tone only.

A blind value swap would dim every secondary paragraph. Every `var(--text-muted)` call site must be
reviewed during its tab rework.

### 9.3 Spacing migration

The old scale was `--s1:6 --s2:10 --s3:14 --s4:20 --s5:28`. The new scale is `--space-1..10`. During
migration both exist; the old five are marked deprecated and each tab rewrites to `--space-*`. The
two scales MUST NOT survive into the shipped 4.0.0 build (the `no-dup` test and readability both
suffer from two spacing systems).

### 9.4 Deletion checklist (must reach zero before 4.0.0 ships)

- [ ] All `--s1`..`--s5` uses rewritten to `--space-*`
- [ ] All `--panel*`, `--field-border`, `--bg-2` uses rewritten
- [ ] All `--accent*` uses rewritten to `--brand*`
- [ ] Legacy alias block removed from `01-tokens.css`

---

## 10. Motion contract

Motion points at what changed without making the user wait. The existing tokens in `01-tokens.css`
are the only allowed durations/easings — never a raw ms/px value.

| Token | Value | Use for |
|---|---|---|
| `--dur-instant` | 0ms | reduced-motion / Lite kill value |
| `--dur-micro` | 90ms | hover / press |
| `--dur-fast` | 120ms | small fades |
| `--dur-tab` | 170ms | tab switch |
| `--dur-modal` | 210ms | modal / accordion |
| `--dur-slow` | 320ms | row stagger |
| `--dur-pulse` | 1100ms | slow breathing loops |
| `--ease-out` / `--ease-standard` | cubic-bezier(.2,.7,.3,1) | default |
| `--ease-emphasized` | cubic-bezier(.34,1.4,.64,1) | modal entrance ONLY |
| `--slide-x` | 10px | directional tab slide |
| `--stagger` | 28ms | list row step |

### 10.1 Ratchet

`tests/motion-tokens.test.js` counts literal durations in `transition`/`animation` and FAILS if the
count rises above baseline (122, cap 124). New animation MUST use a `var(--dur-*)` token, not a
literal. Adding a literal breaks CI.

### 10.2 "Alive ≠ loading"

A running server may have a subtle, STATIC-or-slowly-breathing glow — never a spinner. Use a
shadow ring, not a rotating element:

```css
.server-live {
  box-shadow: 0 0 0 1px var(--instance-accent), 0 0 28px rgba(183,243,74,.08);
}
```

### 10.3 Guards (mandatory)

Every animation adds:

1. A `@media (prefers-reduced-motion: reduce)` rule zeroing it.
2. A `html.motion-lite` kill rule for any AMBIENT/signature effect (functional hover/focus
   transitions stay on in Lite).

### 10.4 Never animate

The console (up to 2000 lines) and the world-map canvas. Only curated, small lists.

---

## 11. i18n contract

Every user-visible string lives in the 7 locales (`en, vi, es, pt-BR, de, ru, zh-CN`).

- Every new string introduced by this rework is added to ALL 7 files with matching keys. The `en`
  file is the reference shape; `tests/i18n.test.js` fails on a missing/extra key.
- No literal user-facing text in HTML/JS — use `data-i18n` / `t(key)`.
- An element whose text JS sets at runtime must NOT also carry `data-i18n` (applyLocale clobbers it).
- New visual states reuse existing keys where possible (`● Running` etc. already have status keys) to
  avoid string churn.

> The new status vocabulary ("Needs attention", "Backup created automatically", "✓ Compatible",
> "⚠ Update available") is a real cost: each is a new key × 7. Add them deliberately, batched per tab.

---

## 12. Component catalogue

The shared building blocks. Built ONCE in `01-tokens.css` / a new `02-components.css`, used by every
tab. This is what kills the "every tab invents its own layout" problem.

### 12.1 Buttons

- `.btn.primary` — brand fill, `--brand-ink` text, radius `--r-sm`.
- `.btn.secondary` — surface-2 fill, `--border`, text color.
- `.btn.danger` — danger fill/ghost.
- `.btn.sm` — compact.
- Sizes: default height 36px, `.sm` 30px. `:active` scales to `.985`. Focus: `--border-strong` ring.

### 12.2 Inputs & fields

- `.field` — `--field` background, `--border`, radius `--r-sm`, focus border `--brand`.
- `.launcher-select` — native select restyled.
- `.switch` — toggle (existing pattern kept).
- Labels use `--text-2`; hints use `--text-muted`; micro labels use `.eyebrow`.

### 12.3 Surfaces

- `.panel` — `--surface`, radius `--r`, optional `--shadow-sm`. Border optional.
- `.card` — interactive grouping; `--surface-2`, radius `--r`, hover background shift only (no lift).
- `.section` — NOT a box: a heading + spacing, per 2.1.

### 12.4 Chips / seg / pills

- `.filter-chip` — rounded rect (NOT pill), toggles.
- `.seg` — segmented control (existing).
- `.status-pill` — pill, semantic color, with a status dot.
- `.badge` — small pill for counts/versions.

### 12.5 Status dot

One component, states map to §11.2 vocabulary. `st-running` (breathing), `st-starting`/`st-stopping`
(animated), `st-stopped` (still), `st-error`. Reuses existing `status-dot` markup.

### 12.6 Tables / lists

- `.row-list` — dense rows for technical lists (files).
- `.entity-card` — card model for Players / Content / Marketplace (avatar/icon + title + meta + action).
- Empty state component (`.empty`) — icon + title + one-line help + optional action.

### 12.7 Feedback

- `.toast` — bottom, `--dur-fast`, optional undo action.
- `.modal` — radius `--r-lg`, `--shadow-lg`, rise entrance (`--ease-emphasized`).
- `.progress` — indeterminate + determinate bars (existing `set-progress`).

---

## 13. App shell

### 13.1 Structure

```text
236px rail  +  18px workspace outer margin  +  flexible content
```

The workspace should feel like a large canvas, not a bordered box. (Old: 260px rail + 1fr, no margin.)

### 13.2 Rail

Order (matches current IA — see 17.0):

```text
ObserverLauncher
────────────────
INSTANCES (when 2+)
[●] Survival
[○] Test
────────────────
Server      Overview · Console · Players · Performance
Content     Content · Marketplace · Worlds & backups · World Map
Config      Server properties · Launcher Settings
────────────────
(settings pinned at the bottom)
```

Instance selector and navigation are visually separated. The active instance uses: an accent mark, a
soft background, a status dot, an optional avatar — NOT a giant selected rectangle.

### 13.3 Instance avatar

Each server gets a compact identity: a rounded tile with 2-letter initials (e.g. "Survival" → `SV`)
tinted with the instance accent. The avatar is NOT required to be Minecraft art. (Seed-hash-generated
art is deferred — see 18.)

### 13.4 Top bar

```text
← current location                         server state   primary action
```

Examples:

```text
Overview    ● Running   [Stop]
Console     ● Stopped   [Start]
World Map                [Open Map]
```

Keep compatibility with the current window chrome. Do not sacrifice usability for visual purity.

---

## 14. Cross-cutting patterns

### 14.1 State language (ALL tabs)

- Running: `● Running`
- Starting: `◌ Starting`
- Stopping: `◌ Stopping`
- Stopped: `○ Stopped`
- Error: `● Needs attention`

Avoid technical strings like `PROCESS_ACTIVE` in the main UI.

### 14.2 Reversibility cue

Any destructive/near-destructive action states its safety net inline: "Backup created
automatically", "Old file kept for 10 updates". This reinforces the OBS safety philosophy.

### 14.3 Empty / loading / error

Every async region has all three: an empty state (what to do next), a loading state (skeleton or
spinner), and an error state with a recovery action. No blank panels.

---

## 15. Overview — the hero screen

### 15.1 World header

```text
┌─────────────────────────────────────────────────────┐
│  SURVIVAL WORLD                        ● RUNNING     │
│  Paper · Minecraft 26.3                              │
│                                                      │
│  Your world is ready.                                │
│                                    [ Open Console ]  │
└─────────────────────────────────────────────────────┘
```

The server NAME is visually dominant. Status feels alive without blinking aggressively.

### 15.2 Hero summary — max four facts

```text
19.8 TPS    4 players    3.2 GB RAM    2h 17m uptime
```

Large but not enormous. Everything else moves to Performance (layer 2/3).

### 15.3 Quick actions

Command-palette feel, icon + label, not tiny buttons. Primary `[Start Server]`; secondary
`Console / Players / Backups / World Map`. Hover = background + accent, 1–2px max translate.

### 15.4 Connect panel

Keep the two-channel (LAN / internet) model but present it as two calm rows, not a dashed "tuner"
box. Advanced (port-forwarding, firewall, tunnel) lives in the existing collapsible.

---

## 16. Technical tabs

### 16.1 Performance

Calm. One dominant chart, not four neon ones.

```text
TPS   19.8        MSPT   4.2ms
CPU   32%         RAM    3.2 GB
```

- Time range control: `15m · 1h · 3h` (backend stores ~180 min — do NOT advertise 6h/24h, section 18).
- Muted grid, strong current line, soft area fill.
- Only the active metric uses the instance accent; alerts use warning/danger.

### 16.2 Console

Technical but not a dropped-in terminal emulator.

```text
CONSOLE
[ Search ] [INFO] [WARN] [ERR]                         Auto-scroll ●
─────────────────────────────────────────────────────
12:41:01  INF  Done (3.821s)! For help, type "help"
12:41:08  WRN  Can't keep up!
```

Subtle row grouping; errors may carry a left accent strip; never flood with color.

### 16.3 Players

Entities, not table rows. Roster = entity cards (avatar + name + state). The inspector is a focused
detail sheet with tabs Overview / Inventory / Ender Chest / Live / Saved-data. Actions grouped by
intention; dangerous actions visually isolated.

### 16.4 Content library

One visual model for mods/plugins/datapacks:

```text
icon  Skript
      2.17.0-pre1 · Compatible with 26.3
      ✓ Compatible        [ Update ]
```

Status near identity, compact (not a giant badge). Updates show reversibility.

### 16.5 Marketplace

Creative library, responsive grid of entity cards (image, title, author, downloads, install). Keep
the source seg + kind/version/sort controls but present them in a calm toolbar.

---

## 17. Per-tab specification & IA decision

### 17.0 IA — keep all 10 tabs (DECISION)

The nav example in early drafts dropped World Map / Server properties and promoted Editor. **We keep
the current 10-tab IA** (no feature loss, no user surprise). Editor stays inside Content (as now). The
rework is visual/structural, not a feature removal.

Order (rail groups unchanged):

1. Server: Overview, Console, Players, Performance
2. Content & world: Content, Marketplace, Worlds & backups, World Map
3. Configuration: Server properties, Launcher Settings

### 17.1 Overview — see section 15.
### 17.2 Console — see 16.2.
### 17.3 Players — see 16.3.
### 17.4 Performance — see 16.1.
### 17.5 Content — see 16.4. Editor (file browser + code editor) keeps its current flow, restyled.
### 17.6 Marketplace — see 16.5.

### 17.7 Worlds & backups

Two calm sections: World folders (entity rows) and Backups (timeline list). Keep the create-backup
primary action; show auto-backup status as a quiet badge. Empty state per 14.3.

### 17.8 World Map

Keep the canvas + toolbar + waypoint panel + biome legend + minimap. Restyle the toolbar as a calm
control strip; the perf warning stays but reads as a hint, not an alarm. NEVER animate the canvas.

### 17.9 Server properties

Keep search + category chips + grouped fields + Apply. Restyle fields with the new input component;
`velocity.toml` raw editor keeps its dedicated mode.

### 17.10 Launcher Settings — the heaviest tab

Keep the Basic / Advanced split (existing `seg-switch`). Each section is a calm `.section` (heading +
rows), not a bordered cell. MCP / Remote / CurseForge / Schedule / Updates stay, restyled. This tab
is the best candidate for the "one thing per place" rule during its rework pass.

### 17.11 Modals & wizard

- Confirm / prompt / blocked / install: restyle with `--r-lg`, `--shadow-lg`, rise entrance.
- Onboarding + New Server wizard: keep 5-step flow; restyle the step rail + cards. The review step
  keeps the plain-language summary.

---

## 18. CSS work vs backend work (scope split)

Pure CSS/HTML (no backend):

- Token swap + alias migration (section 9)
- Component catalogue (section 12)
- Per-tab restyle (section 17)
- Bundled fonts (section 5.1)
- Instance accent as a CSS variable + initials avatar (static)

Needs backend / larger scope (DECIDE per item, may defer past 4.0.0):

- Persisted per-instance accent COLOR picker (settings field + schema).
- Seed/software-generated instance art.
- Metrics retention beyond ~180 min (charts 6h/24h).
- Any new MCP tool or IPC channel (channel names are STABLE — never rename).

---