# Motion system (9.0.0 — Motion 2.0)

ObserverLauncher's UI is an architectural operating tool, not a bouncy toy or generic card landing page. Motion 2.0 follows **Precision Hydraulics**: GPU-composited (`transform`, `opacity`, pseudo-element rings) physics plus native `<details>` `interpolate-size: allow-keywords` / `::details-content` transitions, with exponential deceleration and **zero overshoot/bounce**.

## Tokens (`css/01-tokens.css`)

Use the tokens, never literal `ms`/`s` durations in `transition`/`animation`. `tests/motion-tokens.test.js` enforces a ratchet at `0` literal durations, and `tests/design-system-v9.test.js` bans overshoot `cubic-bezier(...)` curves (`y > 1` or `y < 0`).

| Token | Value | Use for |
|---|---|---|
| `--dur-instant` | `0ms` | reduced-motion / Lite kill value |
| `--dur-micro` | `90ms` | hover / press ink+border snaps |
| `--dur-fast` | `130ms` | list item hover, toast, focus trace |
| `--dur-tab` | `190ms` | curtain tab reveal & rail glide indicator |
| `--dur-modal` | `210ms` | perspective depth modal & `0fr -> 1fr` accordion |
| `--dur-slow` | `260ms` | curtain row stagger reveal |
| `--dur-pulse` | `1400ms` | intentional live status dot ring (`starting`) |
| `--stagger` | `22ms` | step between list rows (capped at 6 rows) |
| `--ease-out` | `cubic-bezier(.16,1,.3,1)` | exponential deceleration — default for tabs, drawers, modals, accordions |
| `--ease-crisp` | `cubic-bezier(.22,1,.36,1)` | tactile micro-snaps & rail glide |
| `--ease-snap` | `cubic-bezier(.2,0,0,1)` | switches & immediate binary snaps |

## Approved Motion 2.0 Patterns

1. **Gliding Rail Indicator (`.rail-glide` in `#nav`):** `08-shell.js` (`positionChannelIndicator()`) glides a GPU-composited vertical emerald blade (`translate3d(0, var(--rail-y), 0) scaleY(var(--rail-sy))`) smoothly between active navigation items.
2. **Directional Tab Depth Reveal (`.tab-enter-fwd` / `.tab-enter-back`):** Pure GPU directional depth settle (`opacity` + `translate3d(±6px, 0, 0) scale(.994)`) driven by `--ease-crisp` over `--dur-tab` without container `clip-path` border clipping.
3. **Decoupled List Stagger (`.tab.tab-stagger`):** `switchTab()` manages `.tab-stagger` on its own timer independently of `.tab-enter-fwd` / `.tab-enter-back`. `.hero`, `.player-row`, `.market-item`, `.backup-row`, `.file-list li[data-name]`, `.worlds-list li`, `.wm-pcard`, `.wm-wprow`, and `.prop-group` enter with GPU `opacity` + `translate3d(0, 6px, 0) scale(.996)` over `--dur-slow` staggered by `--stagger` up to 6 items.
4. **Perspective Depth Modal & `.modal-overlay.closing`:** Modals enter via `@starting-style` (`scale(.982) translate3d(0, 8px, 0)`) with `--ease-out` (`--dur-modal`) and exit symmetrically via `.modal-overlay.closing` with zero bounce.
5. **Universal `<details>` Accordion & Focus Trace (`.field-trace`):** All `<details>` disclosures (Overview `#connectPanel`, `.crash-detail`, `.pd-more`, backup folds) animate smoothly via `details { interpolate-size: allow-keywords }` and `details::details-content` (`opacity` and `block-size` transitions) plus chevron rotation; `.field-trace` sweeps an emerald hairline highlight on focus.
6. **Telemetry & Utility Motion (`dirtyBeacon`, `setIndeterminate`, `logSweep`, `tweenNumber`):** Dirty save CTAs (`#saveSettings.dirty`, `#saveProperties.dirty`) pulse via a GPU `::after` opacity ring (`dirtyBeacon`); indeterminate bars slide via `translate3d` (`setIndeterminate`); `.log-line.sweep::before` runs a `2px` `clip-path: inset(...)` trace beam; `tweenNumber()` smoothly tweens numeric KPIs.

## Accessibility & Performance Guards

- **`@media (prefers-reduced-motion: reduce)`:** Zeroes all animation/transition durations (`--dur-instant`) and disables stagger, rail glide animations, `<details>` disclosure transitions, and live ring loops.
- **`html.motion-lite`:** Disables stagger reveals, rail glide transitions, tab depth transforms, `<details>` disclosure transitions, console sweep animations, and pulsing rings while keeping functional hover/focus state switches snappy (`<= --dur-fast`).
- **GPU Compositor Only:** Never transition `width`, `height`, `top`, `left`, `margin`, `padding`, or `box-shadow` glow blurs (`<details>::details-content` `block-size` via `interpolate-size: allow-keywords` is the sole sanctioned height disclosure mechanism).
