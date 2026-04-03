# Design System

## Philosophy

**Dark monochrome is the entire identity.** There is no light mode. The product lives in darkness because darkness is where focus happens. The dark canvas is not a theme toggle — it is a commitment. Every component, every visualization, every micro-interaction is designed for dark ground first and only.

**Typography is the primary design material.** Where other products rely on color, illustration, and iconography, Engrams relies on type. The right font at the right weight at the right opacity communicates everything.

**Information density without clutter.** Use whitespace as structure. Use typographic hierarchy (weight, size, opacity) instead of boxes, borders, and background colors. Think Edward Tufte, not Material Design.

---

## Color Tokens

### Ground

| Token | Value | Usage |
|---|---|---|
| `void` | `#050505` | True background — nearly black |
| `surface` | `#0A0A0A` | Primary surface |
| `surface-raised` | `#111111` | Cards, panels, modals |
| `surface-elevated` | `#1A1A1A` | Hover states, active panels |
| `border` | `#222222` | Structural dividers — barely visible |
| `border-emphasis` | `#333333` | Interactive element borders |

### Type

| Token | Value | Usage |
|---|---|---|
| `text-ghost` | `#3A3A3A` | Disabled, decorative |
| `text-tertiary` | `#555555` | Metadata, timestamps, captions |
| `text-secondary` | `#888888` | Supporting copy, sidebar content |
| `text-primary` | `#D0D0D0` | Body text — warm enough to read for hours |
| `text-emphasis` | `#F0F0F0` | Headings, active states |
| `text-bright` | `#FFFFFF` | Sparingly — only for critical focus |

### Semantic Accents (used surgically)

| Token | Value | Usage |
|---|---|---|
| `confidence-high` | `#7A8F76` | Deep muted sage |
| `confidence-mid` | `#8F8A76` | Muted ochre |
| `confidence-low` | `#8F767A` | Muted rose |
| `stale` | `#8F8676` | Muted amber |
| `agent-active` | `#76808F` | Muted steel |
| `danger` | `#8F4040` | Muted, not screaming |

### Links & Accents

- Links: `#888888` default, `#F0F0F0` on hover. No blue, ever. No underlines by default — underlines appear on hover as a thin, animated reveal.
- Each engram gets a user-chosen accent color, rendered only as:
  - A 3px dot next to the engram name in the switcher
  - A thin top-border on the active engram's reader view
  - Node tint in the map when viewing cross-engram results
- No white backgrounds anywhere, including modals, tooltips, and dropdowns.

---

## Typography

| Role | Direction | Free Launch Fonts | Licensed Targets |
|---|---|---|---|
| Headings | Geometric/serif, sharp, unusual | Instrument Serif | GT Sectra, Canela, Sohne Breit |
| Body | Legible, distinctive at small sizes | DM Sans | Sohne, Untitled Sans, Tiempos Text |
| Mono | Code, metadata, logs | JetBrains Mono | Berkeley Mono, iA Writer Mono |
| Data | Compact, dashboards, labels | DM Sans 400/500 | Geist, ABC Diatype |

Self-host all typefaces via `@font-face`, subset for performance.

---

## Component Principles

**Geometry:** Sharp corners. 0px border-radius default. 2px max on buttons and inputs. No pills. No blobs.

**Borders over fills:** Sections separated by 1px lines at `border` color. Surface color differences are minimal — hierarchy comes from type and opacity, not background swaps.

**Opacity as depth:**
- Ghost: 20%
- Tertiary: 35%
- Secondary: 55%
- Primary: 82%
- Emphasis: 95%
- Bright: 100%

This creates a natural z-axis without drop shadows or elevation.

**Transitions:**
- Hover: 120ms ease-out
- Base: 180ms ease-out
- Slow: 300ms ease-out
- Cinematic (map): 500ms ease-out
- Nothing snaps. Nothing bounces.

**Icons:** Stroke-based, 1.5px weight, monochrome. Lucide library. No filled icons. No emoji. No illustration-style icons. Icons render at `text-secondary` opacity, brightening on hover.

**Empty states:** Typographic message in the heading font + a generative SVG pattern (thin-line topology, or a sparse dot field). No cartoons. No stock illustration. The empty state should feel like a blank canvas.

**Spinners:** Minimal thin ring. Not bouncing dots.

---

## Layout

### Reader View (default)
- Max content width: 660px
- Line-height: 1.65
- Paragraph spacing tuned for sustained reading
- Right sidebar (collapsible) for backlinks, provenance, metadata — rendered in the data typeface at `text-tertiary` opacity
- Should feel like reading a beautifully typeset book in a dark room

### Dashboard Views (health, settings, sources)
- Denser layout, same typographic hierarchy
- Data as tables and lists, not cards
- Careful alignment
- Monospaced numbers for tabular data

### Full-Bleed Views (map, heatmap, timeline)
- Entire viewport edge to edge
- Navigation overlays as a minimal translucent bar at the top (background: `void` at 80% opacity, backdrop-blur)
- The visualization is the experience

---

## Micro-Interactions

- **Concept link hover:** Thin underline animates in from left + inline tooltip fades up with the linked article's first sentence
- **Backlinks count click:** Panel expands inline, no navigation
- **File drag onto viewport:** Entire surface shifts from `surface` to `surface-raised` with 200ms transition — the whole app acknowledges the incoming knowledge
- **Map node hover:** Selected node and immediate neighborhood illuminate to full brightness. Everything else drops to ~8% opacity over 400ms ease-out. Article title + 1-line summary appear in floating tooltip using the heading typeface.
- **Map idle:** Extremely slow, almost imperceptible drift. The map breathes. Not bouncy physics — glacial, organic movement.
