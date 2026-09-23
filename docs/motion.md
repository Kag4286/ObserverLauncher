# Motion system (2.0.0)

ObserverLauncher's UI is an operating tool, not a landing page. Motion has one job: to point at
what changed without making the user wait. This document is the contract every new animation follows.

## Tokens (css/01-tokens.css)

Use the token, never a raw ms/px value. `tests/motion-tokens.test.js` is a ratchet: it counts literal
durations in `transition`/`animation` and fails if the number goes up.

| Token | Value | Use for |
|---|---|---|
| `--dur-instant` | 0ms | reduced-motion / Lite kill value |
| `--dur-micro` | 90ms | hover / press colour+border changes |
| `--dur-fast` | 120ms | small fades (list refresh, toast, numeric colour) |
| `--dur-tab` | 170ms | tab switch slide |
| `--dur-modal` | 210ms | modal entrance, accordion open/close |
| `--dur-slow` | 320ms | row stagger reveal |
| `--dur-pulse` | 1100ms | slow breathing loops (status dots) |
| `--stagger` | 28ms | step between list rows |
| `--ease-out` (`--ease-standard`) | cubic-bezier(.2,.7,.3,1) | the default for almost everything |
| `--ease-emphasized` | cubic-bezier(.34,1.4,.64,1) | modal/popover entrance ONLY |
| `--slide-x` | 10px | directional tab slide distance |

## Approved patterns

1. **Tab switch** — direction-aware slide (`--slide-x`, `--dur-tab`) plus a short fade-up.
   Implemented in `08-shell.js` (`.tab-enter-fwd`/`.tab-enter-back`) with keyframes in
   `08-motion.css`.
2. **List stagger reveal** — dense rows rise 4px and fade when a tab becomes active. The curated
   selector set is `.player-row`, `.market-item`, `.backup-row`, `.file-list li[data-name]`,
   `.worlds-list li` (in `08-motion.css`). Capped at 7 rows (`nth-child(n+7)` shares one delay) so a
   long list never takes a second to appear. CSS-only.
3. **Modal rise** — `translateY(10px) scale(.995)` to none, `--ease-emphasized`, `--dur-modal`.
   Overlays use discrete `display`/`overlay` transitions with `@starting-style`, so every modal
   fades both in and out with no per-call-site JS.
4. **Value tween** — `tweenNumber(el, to, fmt)` in `00-core.js` counts a readout toward its new
   value over 140-360ms (ease-out cubic). Used for CPU% and player count. Skips under reduced
   motion. One tween per element (WeakMap) so rapid updates never fight.
5. **Log line in** — 4px slide plus fade, `--dur-fast`, on each new console line only. A one-shot
   `.sweep` highlight scans across the line (a `::before` overlay, not a filter).
6. **Pulse wave** — the 5s poll heartbeat at the top of the command bar.
7. **Press** — every interactive surface scales to `.985` on `:active`, nothing more.
8. **Micro-interactions (2.0.0)** — a large set of hover/focus transitions in `09-pulse.css`:
   form controls (border+shadow on focus), filter chips, interactive rows and cards (border/ink
   only, no lift), icon/row/copy buttons, step chips and badges, numeric readouts (colour eases on
   a state flip), disclosure headers, checkboxes, and panel/card border warmth. Every value is a
   token; none exceed `--dur-fast`. Transitions are kept in Lite mode because they are functional,
   not ambient.
9. **Accordion open/close (2.0.0)** — `<details>` disclosures animate height via `::details-content`
   and `interpolate-size: allow-keywords` (Chromium 131+). Scoped to the known disclosures
   (`.set-advanced`, `.perf-details`, `.prop-group`, `.advanced-card`, `.connect-advanced`,
   `.tunnel-help`, `.tunnel-box`). Falls back to an instant toggle where the pseudo is unsupported.
10. **Scrollbar (2.0.0)** — thumb eases to `--border-strong` on hover; transparent track/corner.
11. **Magnetic primary button** and a **tab-header cursor spotlight** — both pointer-only and off
    under reduced motion.

## Ambient loops (the exceptions)

Ambient motion exists in a few places and is the only motion allowed to repeat:

- `pulse-wave` ticks (the 5s poll heartbeat).
- `.signal-field::after` `fieldBreath` (9s, faster while running/starting).
- Status dots `instPulse` / ring pulses while a server is starting.
- `bootGlow` / `bootScan` on the first-run boot screen.

Everything else is one-shot. New ambient loops are discouraged; if one is needed, put it behind
Lite mode.

## Rules

- **Direction cue, not decoration.** Slide distance stays small (≤10px). No rotate, no big bounce.
- **Short.** Nothing interactive exceeds `--dur-slow` (320ms), except the deliberate ambient loops
  above.
- **Data is the liveliness.** Prefer a tweening number, a sparkline or a stagger over a decorative
  loop.
- **Reduced motion wins.** `08-motion.css` and `09-pulse.css` zero out animation/transition
  durations under `prefers-reduced-motion:reduce`; new patterns MUST add a guard too.
- **Lite mode.** `html.motion-lite` (set from Settings > Interface animation) turns off the ambient
  and signature effects (signal field, boot screen, spotlight, stagger, log sweep). Fast functional
  transitions (hover/focus) stay on. Any new ambient effect needs a `html.motion-lite` kill rule.
- **Never animate the console (up to 2000 lines) or the world-map canvas** — only curated, small
  lists.

## Known gotchas (from memory.md)

- A canvas or measured element inside a `display:none` tab is 0-sized — redraw / re-measure on
  reveal (see the sparkline and the Settings seg-glider).
- Ending a keyframe on a non-`none` `filter` promotes an ancestor to its own GPU layer and kills
  subpixel text AA — end on `filter:none` (see `pulseScan`).
- Animated elements need a Lite-mode off switch and a `prefers-reduced-motion` guard, or the E2E
  motion-level test and the ratchet will flag them.
