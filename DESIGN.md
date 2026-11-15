# ObserverLauncher — Architectural Design System (v9.0.0)

> **Identity:** ARCHITECTURAL INSTRUMENT — PRECISION OVER ORNAMENT
> **Source of truth:** `src/renderer/css/01-tokens.css` & `src/remote-ui/style.css`
> **Motion layer:** `src/renderer/css/08-motion.css`
> **Status:** v9.0.0. Contract enforced by `tests/design-system-v9.test.js`, `tests/motion-tokens.test.js`, and `tests/no-dup.test.js`.

ObserverLauncher 9.0.0 replaces boxed "bento card" clutter and stacked overrides with a flat, disciplined architectural interface. Structure comes from alignment, negative space, crisp `1px` hairlines, and typographic contrast (`Manrope` + `IBM Plex Mono`) — never from wrapping every widget in a bordered card.

---

## 1. Visual Principles

1. **Flat Canvas, Hairline Structure:** The navigation rail and main workspace share `#0C0D0F`. Divide sections using `1px solid var(--border)` rules and whitespace rather than floating dark-gray boxes.
2. **Surface Budget (Anti-Card Rules):**
   - **Never boxed/carded:** Overview hero, telemetry KPIs, Connect LAN/Tunnel rows, Performance metric strip, Console toolbar, Launcher Settings groups, Server Properties groups, and Wizard review summaries. These MUST render flat with `.arch-section` / `.arch-row` / `.arch-strip` hairlines.
   - **Permitted entity containers:** Discrete selectable or inspectable entities — Marketplace grid items (`1px` border, `8px` radius, zero shadow), Players roster rows, and unified Hairline Row Lists (Content Library, Worlds & Backups).
   - **No nesting:** Never nest a bordered card inside another bordered card. Never wrap a 1–3 item setting group in a card.
3. **Disciplined Brand Green (`#22C55E`):** Emerald is preserved as ObserverLauncher's signature signal, stripped of neon glow, `drop-shadow` halos, and background `linear-gradient`/`radial-gradient` washes. `--brand` appears strictly on:
   - Primary CTA fill
   - Active left-rail gliding indicator (`2px`) & active segmented tab underline
   - Live server running indicator dot
   - Input focus hairline trace
   - Primary telemetry chart line
4. **Honest Typography Hierarchy:** Four deliberate text warmth tiers prevent "everything bright white" fatigue. Body/labels use `Manrope`; live numbers, ports, versions, TPS, memory, and eyebrows use `IBM Plex Mono` (`tabular-nums`).

---

## 2. Token Contract (`01-tokens.css` & `src/remote-ui/style.css`)

Legacy v3/v4 aliases (`--panel*`, `--bg-2`, `--field-border`, `--accent*`, `--text-muted`, `--text-dim`, `--s1`..`--s5`, `--fs-*`) are **banned** and must remain at count `0`.

### 2.1 Surfaces & Borders
| Token | Value | Role |
|---|---|---|
| `--bg` | `#0C0D0F` | Primary canvas (rail, workspace, remote body) |
| `--bg-elev` | `#111317` | Modal sheets, popovers, dropdown menus |
| `--surface` | `#15171B` | Unified list containers, console/code wells, control tracks |
| `--surface-2` | `#1B1E23` | Row hover, active seg thumb, secondary button fill |
| `--surface-3` | `#23272E` | Pressed state |
| `--field` | `#101216` | Inputs, search boxes, selects |
| `--border` | `#242830` | `1px` architectural hairlines & structural dividers |
| `--border-strong` | `#383E48` | Interactive hover border, modal/dropdown outline |

### 2.2 Text Tiers
| Token | Value | Role |
|---|---|---|
| `--text` | `#F4F1EA` | Headings, server names, primary metric figures, active items |
| `--text-2` | `#C8C4BC` | Primary labels, setting titles, body copy |
| `--text-3` | `#8F8B83` | Hints, secondary metadata, inactive nav text |
| `--text-4` | `#5E5B55` | Micro eyebrows, timestamps, subtle units |
| `--text-disabled` | `#4A4843` | Disabled controls |

### 2.3 Brand, Accents & Semantic Status
- **Brand:** `--brand: #22C55E`, `--brand-soft: rgba(34, 197, 94, .10)`, `--brand-ink: #04160A`.
- **Instance accents:** `--violet: #9B8CFF`, `--orange: #FFB86B`, `--pink: #FF7AA8`, `--blue: #6EA8FE`.
- **Semantic:** `--success: #72E6A6`, `--warning: #FFC857`, `--danger: #FF667D`, `--info: #8FB8FF` (plus `*-weak` at `12%`). Never use `--danger` for decorative UI or semantic tokens outside their meaning.

### 2.4 Sharp Architectural Geometry & Minimal Elevation
```css
--r-xs: 4px;   /* micro tags, code chips, shortcut keys */
--r-sm: 6px;   /* buttons, inputs, nav rows, filter chips */
--r:    8px;   /* entity grid tiles, unified list wells, crash strip */
--r-lg: 10px;  /* dropdowns, floating worldmap toolbar */
--r-xl: 12px;  /* modals, dialogs */
```
Shadows are reserved exclusively for floating elevation (`dropdown`, `tooltip`, `modal`), never on resting cards:
- `--shadow-sm: 0 2px 8px rgba(0, 0, 0, .24);`
- `--shadow: 0 10px 28px rgba(0, 0, 0, .36);`
- `--shadow-lg: 0 20px 52px rgba(0, 0, 0, .48);`

### 2.5 Spacing (8px Rhythm)
`--space-1: 4px` · `--space-2: 8px` · `--space-3: 12px` · `--space-4: 16px` · `--space-5: 20px` · `--space-6: 24px` · `--space-7: 32px` · `--space-8: 40px`.

---

## 3. Architectural Primitives

- `.arch-section`: Borderless vertical block with an `.eyebrow` / `.arch-section-head` title bar (`1px solid var(--border)` bottom hairline) and stacked `.arch-row` items.
- `.arch-row`: Horizontal setting/info row (`padding: 12px 0`, `border-bottom: 1px solid var(--border)`) pairing left-aligned label + hint with right-aligned value/control. Last row omits divider when cleanly bounded.
- `.arch-strip`: Borderless multi-column KPI/telemetry strip separated by bottom hairline or subtle column dividers — never individual boxed cards.
- `.btn`: Crisp `--r-sm: 6px`, height `34px` (`28px` `.sm`), `.primary` (`--brand` / `--brand-ink`), `.secondary` / default (`transparent` or `--surface-2` + `--border`), `.danger` (muted red outline/fill). Zero glow on hover.
- `.field`, `.launcher-select`, `.ol-select`: `--field` fill, `1px solid var(--border)`, `--r-sm: 6px`, bottom hairline focus trace.

---

## 4. Motion 2.0 Contract (`08-motion.css`)

All UI motion obeys three rules: **GPU compositor priority** (`transform`, `opacity`, pseudo-element rings, plus Chromium `interpolate-size: allow-keywords` / `::details-content` for `<details>` disclosures and `2px` trace-beam `clip-path` on `.log-line.sweep::before`), **zero bounce/overshoot** (no `cubic-bezier` control point `> 1.0`), and **no slide-only transitions**.

### 4.1 Curves & Timing Tokens
| Token | Value | Purpose |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Exponential brake — curtain reveals, modals, rail indicator |
| `--ease-crisp` | `cubic-bezier(0.22, 1, 0.36, 1)` | Quint brake — row stagger, segmented glides |
| `--ease-snap` | `cubic-bezier(0.2, 0, 0, 1)` | Fast micro-feedback — focus trace, hover, press |
| `--dur-micro` | `90ms` | Press / hover state shifts |
| `--dur-fast` | `130ms` | Content swaps, focus trace |
| `--dur-tab` | `190ms` | Tab curtain transition & rail glide |
| `--dur-modal` | `210ms` | Modal depth settle & backdrop blur |
| `--dur-slow` | `260ms` | First-6 row curtain stagger |
| `--dur-pulse` | `1400ms` | Calm live status dot breathing |
| `--stagger` | `22ms` | Per-row reveal offset (capped at 6 rows) |

### 4.2 Signature Motion Patterns
1. **Directional Depth Tab Switch:** Incoming tab (`.tab-enter-fwd` / `.tab-enter-back`) animates pure GPU `opacity` + `translate3d(±6px, 0, 0) scale(0.994)` -> crisp `none` with zero container `clip-path` border slicing.
2. **Gliding Active Rail Indicator:** `2px` brand bar inside `.rail-nav` glides smoothly between active items via `transform: translate3d(0, var(--rail-y), 0) scaleY(...)`.
3. **Decoupled List Stagger (`.tab.tab-stagger`):** `.tab-stagger` runs on a dedicated cleanup timer independent of the tab transition so `.hero`, `.player-row`, `.market-item`, `.backup-row`, `.file-list li[data-name]`, `.worlds-list li`, `.wm-pcard`, `.wm-wprow`, and `.prop-group` enter cleanly with GPU `opacity` + `translate3d(0, 6px, 0) scale(0.996)` capped at item 6. `#logOutput` bulk rows and World Map canvas are never staggered (`clip-path: inset(...)` is reserved for the `2px` `.log-line.sweep::before` trace beam).
4. **Perspective Depth Modal Settle & Symmetric Exit:** `.modal-overlay` uses `@starting-style` + `allow-discrete` to fade blurred backdrop on open while `.modal` settles from `translate3d(0, 8px, 0) scale(0.978)`, and `.modal-overlay.closing` mirrors the exit cleanly before DOM cleanup.
5. **Universal `<details>` Accordion & Trace Signals:** Structural `<details>` elements (including `#connectPanel` and `.crash-detail`) use `interpolate-size: allow-keywords` + `::details-content` (`opacity` and `block-size` transitions) with chevron rotation; dirty save buttons pulse via a composited `::after` pseudo-ring (`dirtyBeacon`), and indeterminate progress bars translate via `translate3d` (`setIndeterminate`).
6. **Hairline Focus Trace:** Focused fields reveal a left-to-right `scaleX(0 -> 1)` `--brand` underline.

### 4.3 Accessibility & Motion Lite
- `@media (prefers-reduced-motion: reduce)` collapses all durations to `--dur-instant` (`0ms`).
- `html.motion-lite` disables curtain reveals, staggers, gliding indicator, backdrop animations, and fades while keeping functional spinners alive.

---

## 5. Screen Standards (10 Tabs + Modals + Remote UI)

- **Shell:** Compact `220px` flat left rail (`--bg` canvas + `1px` right border), compact instance selector rows, hairline `48px` `.topbar` holding the single page title landmark (`#pageEyebrow` + `#pageTitle` synced via `syncTopbarHeader()`), live status, and action CTA.
- **Contextual Tab Strip (`.tab-head`):** Borderless architectural strip directly below `.topbar` carrying only the `<p class="sub">` summary and right-aligned actions (`.tab-head-actions` / `.settings-apply`) — never duplicating `.topbar` titles or eyebrows (`.console-panel` in `#console` retains its own `Server console` sub-header inside the Overview split).
- **Overview:** Pure typographic Hero + 4-column Telemetry Strip + inline sparkline + 2-row hairline Connect table + smooth `<details>` Advanced accordion + horizontal Quick Action strip.
- **Console:** Hairline filter bar + thin left-accent crash notice + pure monospace output (600-line DOM cap).
- **Performance:** 4-column metric strip directly above single calm chart + time-range `seg-switch`.
- **Marketplace & Install Modal:** Flat `1px` bordered entity grid (`8px` radius, zero shadow, max 2 metadata badges). `#installModal` renders compatibility as a borderless hairline telemetry strip (`im-compat-mc` wrapping multiple Minecraft versions cleanly without clipping or nested double frames).
- **Content Library / Worlds & Backups:** Unified Hairline Row Lists (`1px` dividers, right-aligned action group).
- **Players:** Compact entity roster + borderless Inspector sheet (vector SVG stats in `#pdStatsHero`).
- **World Map:** Static full-bleed canvas + crisp floating `10px`-radius toolbar + architectural `292px` right rail (`.wm-main` hairline `.wm-pcard` & `.wm-wprow` rows with explicit `9x9` ruby HP heart SVG and colored dimension badges).
- **Launcher Settings & Server Properties:** Single-column Architectural Form (`max-width: 780px`), `Basic / Advanced` `seg-switch` and category chips, `.arch-section` + `.arch-row` key-value pairs.
- **Modals & Wizard:** `--r-xl: 12px`, hairline header/body/footer separation, zero nested review cards in Wizard.
- **Remote Web UI (`src/remote-ui/`):** Exact token mirror of `01-tokens.css`, flat hairline sections replacing shadow cards/chips, mobile-first tap targets (`>= 36px`), horizontal overflow prevention (`overflow-x: hidden`).

---

## 6. Guardrails & Verification

1. `tests/design-system-v9.test.js`: 0 legacy tokens, 0 overshoot `cubic-bezier`, 0 deprecated `07-polish.css`/`09-pulse.css` files, Remote UI parity.
2. `tests/motion-tokens.test.js`: enforces `--dur-*` token usage (literal duration count kept at/below baseline).
3. `tests/motion-lite.test.js`: verifies `html.motion-lite` neutralizes tab/list/modal/curtain motion.
4. `tests/no-dup.test.js`: prevents duplicate CSS selectors across `src/renderer/css/` and `src/remote-ui/`.
5. `tests/i18n.test.js`: preserves 7-locale parity (`en, vi, es, pt-BR, de, ru, zh-CN`).
