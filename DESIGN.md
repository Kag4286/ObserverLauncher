# ObserverLauncher — Design System

> **Theme:** MIX A+B — FIELD STATION + SIGNAL LAB — black / cyan
> Source of truth: `src/renderer/css/01-tokens.css:1` (split from `style.css`; link `css/*.css` in numeric order)

## Concept

Field Station = rugged, utilitarian panels (dark surfaces, hairline borders, mono labels).  
Signal Lab = high-contrast cyan signal on black, glowing accents, live telemetry.  
Together: a launcher that feels like a local server appliance, not a marketing site.

## Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#05070A` | App background |
| `--bg-2` | `#0A0E13` | Secondary background / gradients |
| `--panel` | `#0F141A` | Cards, panels |
| `--panel-raised` | `#141B22` | Hover / header surfaces |
| `--panel-hover` | `#18202B` | Hover state |
| `--field` | `#080A0D` | Inputs, code blocks |
| `--border` | `#1A2735` | Default border |
| `--border-strong` | `#223449` | Active / focus border |
| `--text` | `#FFFFFF` | Primary text |
| `--text-muted` | `#E6EDF3` | Secondary text |
| `--text-dim` | `#B8C2CC` | Eyebrows, hints |
| `--accent` | `#00E5FF` | Primary signal — buttons, links, TPS line |
| `--accent-weak` | `rgba(0,229,255,.12)` | Accent backgrounds |
| `--accent-glow` | `rgba(0,229,255,.45)` | Focus glow |
| `--success` | `#00E5A0` | RAM, healthy state |
| `--warning` | `#FFD23F` | CPU, attention |
| `--danger` | `#FF3B5C` | MSPT danger, errors |
| `--chart-tps` | `var(--accent)` | TPS chart |
| `--chart-cpu` | `var(--warning)` | CPU chart |
| `--chart-ram` | `var(--success)` | RAM chart |

## Typography

- **UI:** `Inter 500/600/700` — `var(--font-ui)` — headings, buttons, body
- **Mono:** `JetBrains Mono 500/700` — `var(--font-mono)` — metrics (TPS/CPU/RAM), code, eyebrows
- Eyebrow: `700 10px mono, letter-spacing .14em, uppercase, color: --text-dim`
- Metric strong: `700 24-32px mono, letter-spacing -.02em`

## Radii / Ease / Spacing

- ` --r-sm:2px --r:3px --r-lg:4px`
- ` --ease:cubic-bezier(.16,.84,.44,1) --ease-spring:cubic-bezier(.34,1.56,.64,1)`
- Shell grid: `260px rail + 1fr workspace` `src/renderer/css/02-shell.css:4`, content gaps `10-16px`, panel padding `16px`

## Shell

- Left `rail` `260px` with `rail-head` + `rail-nav` + `rail-foot` `src/renderer/css/02-shell.css:5`
- Top `command-bar` is the ` -webkit-app-region:drag` handle on Windows `src/renderer/css/02-shell.css:20` (fixes `titleBarStyle:'hidden'` drag)
- `Window Controls Overlay` reserved via `.wco-app .command-bar` `src/renderer/css/02-shell.css:25`

## Components

- **Hero** `src/renderer/css/03-overview.css:3` — identity (name + pill with dot inside + plain sentence) over a problems-only checklist (`#setupSteps`, hidden when all green) over a 5-cell stats row (4 live numbers + RAM); meta line (EULA/uptime) visible only while running (`.is-running`)
- **Quick actions** — vertical `var(--row-h)` rows with `→` cue, hover shifts border/text only (no lift)
- **Perf KPIs** `src/renderer/css/03-overview.css:99` — 4 columns, top border accent per KPI, `kpi-bar` 4px, badges `ok/warn/bad`
- **Charts** `src/renderer/css/03-overview.css` — slim `canvas 100%×140px` on `var(--field)` + `tickChartEmpty/resourceChartEmpty` overlay `hidden` when `samples` has data
- **Player inspector** `src/renderer/css/07-polish.css:121` — `player-modal 780px/88vh`, `inspect-header/avatar/badge`, `text-list` with `inv-row` + search/sort toolbar, staggered animations `modalIn/sectionIn/rowIn`
- **Marketplace** `src/renderer/css/05-market.css:105` — `market-item 48px icon + 1fr + auto`, `skeletonPulse`, `marketIn` stagger

## Motion

- Direction-aware tab slide `tabFwd/tabBack var(--dur-tab) var(--ease-out)` (`css/08-motion.css`), 10px travel, retriggered per switch in `js/08-shell.js:switchTab`
- `sdPulse 1.8s` for `st-running` dot, `sdSpin .8s` for `st-starting/stopping`
- `itemIn .18s` + `itemFloat .9s` for inventory cells `src/renderer/css/04-players.css:73`
- Global `prefers-reduced-motion` kill-switch `src/renderer/css/08-motion.css` (all durations → 0)
