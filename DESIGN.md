# ObserverLauncher — Design System

> **Theme:** MIX A+B — FIELD STATION + SIGNAL LAB — black / cyan
> Source of truth: `src/renderer/style.css:1`

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
- Shell grid: `260px rail + 1fr workspace` `src/renderer/style.css:26`, content gaps `10-16px`, panel padding `16px`

## Shell

- Left `rail` `260px` with `rail-head` + `rail-nav` + `rail-foot` `src/renderer/style.css:27`
- Top `command-bar` is the ` -webkit-app-region:drag` handle on Windows `src/renderer/style.css:42` (fixes `titleBarStyle:'hidden'` drag)
- `Window Controls Overlay` reserved via `.wco-app .command-bar` `src/renderer/style.css:47`

## Components

- **Metrics bento** `src/renderer/style.css:111` — `grid: hero | players tps / hero cpu ram limit`, hero 32px mono, status-dot 4 states (`st-offline/running/starting/stopping` `src/renderer/style.css:64`)
- **Perf KPIs** `src/renderer/style.css:199` — 4 columns, top border accent per KPI, `kpi-bar` 4px, badges `ok/warn/bad`
- **Charts** `src/renderer/style.css:213` — `canvas 100%×200px` on `var(--field)` + `tickChartEmpty/resourceChartEmpty` overlay `hidden` when `samples` has data
- **Player inspector** `src/renderer/style.css:1058` — `player-modal 780px/88vh`, `inspect-header/avatar/badge`, `text-list` with `inv-row` + search/sort toolbar, staggered animations `modalIn/sectionIn/rowIn`
- **Marketplace** `src/renderer/style.css:418` — `market-item 48px icon + 1fr + auto`, `skeletonPulse`, `marketIn` stagger

## Motion

- `fadeIn .16s var(--ease)` for tabs `src/renderer/style.css:148`
- `sdPulse 1.8s` for `st-running` dot, `sdSpin .8s` for `st-starting/stopping`
- `itemIn .18s` + `itemFloat .9s` for inventory cells `src/renderer/style.css:311`
- Respects `prefers-reduced-motion` `src/renderer/style.css:82`
