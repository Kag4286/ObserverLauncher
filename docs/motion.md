# Motion system (1.3.0)

ObserverLauncher's UI is an operating tool, not a landing page. Motion here has ONE job: to
**point at what changed** without making the user wait or feel the app is bouncing around. This
document is the contract every future animation must follow.

## Tokens (css/01-tokens.css)

Use the token, never a raw ms/px value.

| Token | Value | Use for |
|---|---|---|
| `--dur-micro` | 90ms | hover / press colour+border changes |
| `--dur-fast` | 120ms | small fades (list refresh, toast) |
| `--dur-tab` | 170ms | tab switch slide |
| `--dur-modal` | 210ms | modal / popover entrance |
| `--dur-slow` | 320ms | row stagger reveal |
| `--stagger` | 28ms | step between list rows |
| `--ease-standard` | (== `--ease-out`) | the default for almost everything |
| `--ease-emphasized` | slight overshoot | modal/popover ONLY |
| `--slide-x` | 10px | directional tab slide distance |

## Approved patterns

1. **Tab switch** — direction-aware slide (`--slide-x`, `--dur-tab`) + short fade-up. Implemented
   in `08-shell.js` (`.tab-enter-fwd`/`.tab-enter-back`) with keyframes in `08-motion.css`.
2. **List stagger reveal** — dense rows (`.player-row`, `.market-item`, `.content-row`,
   `.backup-row`, `.world-row`) rise 4px + fade when a tab becomes active. Capped at 7 rows
   (`nth-child(n+7)` shares one delay) so a long list never takes a second to appear. CSS-only.
3. **Modal rise** — `translateY(10px) scale(.995)` → none, `--ease-emphasized`, `--dur-modal`.
4. **Value tween** — `tweenNumber(el, to, fmt)` in `00-core.js` counts a readout toward its new
   value over 140–360ms (ease-out cubic). Used for CPU% and player count. Skips under reduced
   motion. One tween per element (WeakMap) so rapid updates never fight.
5. **Log line in** — 4px slide + fade, `--dur-fast`, on each new console line only.
6. **Pulse wave** — the ONLY element allowed to repeat (~1Hz) — the 5s poll heartbeat.
7. **Press** — every interactive surface scales to `.985` on `:active`, nothing more.
8. **Micro-interactions** — magnetic primary button (≤3px cursor pull) and a tab-header cursor
   spotlight. Both are pointer-only and disabled under reduced motion.

## Rules

- **Direction cue, not decoration.** Slide distance stays small (≤10px). No rotate, no big bounce.
- **Short.** Nothing interactive exceeds `--dur-slow` (320ms).
- **Data is the liveliness.** Prefer a tweening number / sparkline / stagger over decorative loops.
- **No infinite animations** except the pulse heartbeat.
- **Reduced motion wins.** `08-motion.css` and `09-pulse.css` both zero out animation/transition
  durations under `prefers-reduced-motion:reduce`; new patterns MUST add a guard too.
- **Never animate the console (2000 lines) or the world-map canvas** — only curated, small lists.

## Known gotchas (from memory.md)

- A canvas or measured element inside a `display:none` tab is 0-sized — redraw / re-measure on
  reveal (see the sparkline and the Settings seg-glider).
- Ending a keyframe on a non-`none` `filter` promotes an ancestor to its own GPU layer and kills
  subpixel text AA — end on `filter:none` (see `pulseScan`).
