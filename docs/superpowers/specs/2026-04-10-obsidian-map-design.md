# Obsidian-Inspired Map Behavior

**Date:** 2026-04-10
**Status:** Approved for planning
**Context:** Follow-up to the animated-map-updates work (PR #1, merged 2026-04-10). That PR made the Three.js scene persist across data changes and animate additions via a pure reconciler. This spec refines the *feel* of those animations toward Obsidian's graph view, while retaining the existing constellation aesthetic (glowing depth, drift, ripple effects from click).

---

## Goals

1. **Adding a source barely disturbs the existing constellation.** Direct neighbors of a new node exhibit a brief outward "push" motion and return close to their original positions. Non-neighbors stay still. (Brainstorm Q2 = B — soft ripple.)

2. **Deleting a node causes a small local collapse.** Direct neighbors of the removed node glide to the new equilibrium (slightly closer to the void). Non-neighbors stay still. (Brainstorm Q3 = B — soft collapse.)

3. **Clusters read naturally.** Densely-linked groups form visibly tight clusters with readable space between them. Fewer "extremely close" pairs and fewer "way too far" stragglers than the current balanced-but-uneven layout. (Brainstorm Q5 = B — balanced clusters.)

4. **New nodes get quiet but perceptible attention.** Every new node glows warmly for ~1 second as it fades in. If a new node would otherwise appear outside the visible viewport (covered by the SourceTree or AgentTimeline widgets), the camera gently drifts to bring it into view and then drifts back to the user's previous position. Manual panning always overrides. (Brainstorm Q4 = A + D — glow always, pan only when off-screen.)

5. **Layout scale respects the safe viewport.** The graph sizes itself to fit the visible area (the center rectangle not covered by widgets), not the full container. This is also the rectangle the camera attention logic uses to decide "off-screen."

## Non-Goals

- Full Obsidian parity. We're keeping the current glow shader, camera drift, and ripple-on-click.
- Continuous ambient motion on existing nodes (brainstorm Q1 option A — lower priority, skip for now).
- Special routing or gravitational regions for disconnected nodes (brainstorm Q1 option E — lower priority, current origin-pull behavior is acceptable).
- Edge opacity/length varying with proximity (brainstorm Q1 option F — not called out as important).
- Velocity-based spring physics. Starting with a smooth-settle approach; can upgrade to velocity + damping in a follow-up if the settle feels too muted.
- Dynamic widget size measurement. Constants are hard-coded to match current widget layouts.

---

## Architecture Overview

The pipeline stays the same shape as today:

```
useGraphData (unchanged)
     ↓ data
useForceLayout (significantly updated)
     ↓ { positions, meta }
page.tsx (dashboard / map)
     ↓ props
EngineGraph (updated animation loop + new shader attribute)
     ↓ Three.js render
```

**Three focused changes layered on the existing reconciler:**

1. **`useForceLayout` becomes change-aware.** It diffs the new data against its cached positions to identify `newSlugs`, `removedSlugs`, and `rippleSlugs` (direct neighbors of either). All cached nodes are pinned via `fx`/`fy` *except* the ripple nodes, which stay mobile for the scoped simulation pass. The final positions reflect either "pushed out and settling back" (add case) or "collapsing into the void" (delete case), and the downstream tween handles the visual motion via the existing `currentPos → targetPos` lerp.

2. **`reconcileGraph` carries change metadata.** The layout's `LayoutMeta` flows through, and new nodes get `attention[i] = 1.0` initialized in the new buffers field. The animation loop reads this attention value to drive the glow pulse without any extra component-level state.

3. **`EngineGraph` adds two new behaviors to the animation loop.** A per-frame attention decay that powers the glow shader, and an off-screen pan state machine that checks new nodes against the safe viewport rectangle and smoothly eases the camera pan offset to bring them in (then back out).

**Shared helper:** `lib/map-viewport-bounds.ts` becomes the single source of truth for the safe viewport rectangle. Consumed by `NodeCard` (replaces inline constants), `useForceLayout` (layout scale), and `EngineGraph` (off-screen check).

---

## Detailed Design

### 1. Shared viewport bounds helper

**New file:** `apps/web/lib/map-viewport-bounds.ts`

**Constants** (moved verbatim from `NodeCard.tsx:22-27`):
- `SOURCE_TREE_RIGHT_EDGE = 296`
- `AGENT_TIMELINE_LEFT_EDGE = 224`
- `TOP_RESERVED = 60`
- `BOTTOM_RESERVED = 160`

**Exports:**

```ts
export interface SafeViewport {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
  centerX: number
  centerY: number
}

export function getSafeViewport(windowWidth: number, windowHeight: number): SafeViewport

export function isInSafeViewport(
  screenX: number,
  screenY: number,
  safe: SafeViewport,
): boolean
```

Semantics: both helpers are pure. `getSafeViewport` clamps edges so `right >= left` and `bottom >= top` even on tiny windows. `isInSafeViewport` is a rectangle containment check.

### 2. Force layout changes (`useForceLayout.ts`)

**Return type change:**

```ts
export interface LayoutMeta {
  newSlugs: Set<string>
  rippleSlugs: Set<string>
}

export function useForceLayout(
  data: GraphData | null,
  width: number,
  height: number,
): { positions: Float32Array; meta: LayoutMeta } | null
```

On the initial build (cache empty), `meta.newSlugs` contains every slug and `rippleSlugs` is empty. On refresh, both sets are populated from the diff against the cached positions.

**Ripple and collapse mechanism:**

```ts
// Pseudocode inside useMemo
const newSlugs = new Set<string>()
const rippleSlugs = new Set<string>()

// Populate newSlugs from cache diff
for (const n of data.nodes) {
  if (!prev.has(n.slug)) newSlugs.add(n.slug)
}

// Track removed slugs too (present in cache but absent in new data)
const removedSlugs = new Set<string>()
for (const slug of prev.keys()) {
  if (!data.nodes.some((n) => n.slug === slug)) removedSlugs.add(slug)
}

// rippleSlugs = direct neighbors of anything that changed
// Use data.edges for new-node neighbors (new structure)
// Use a cached adjacency map for removed-node neighbors (old structure)
// See "Cached adjacency" below.

// Build ForceNodes: pin cached except rippleSlugs
const nodes: ForceNode[] = data.nodes.map((n, i) => {
  const cached = prev.get(n.slug)
  const isRipple = rippleSlugs.has(n.slug)
  if (isRefresh && cached && !isRipple) {
    return { index: i, slug: n.slug, x: cached.x, y: cached.y, fx: cached.x, fy: cached.y }
  }
  return { index: i, slug: n.slug, x: cached?.x, y: cached?.y }
})
```

**Cached adjacency map:**

The ref that currently holds `prevPositions` is extended with a sibling ref holding the last observed adjacency so we can compute deleted-node neighbors without the deleted edges in the new data:

```ts
const prevAdjacency = useRef<Map<string, Set<string>>>(new Map())
```

Populated at the end of every layout pass from the new edges, in parallel with `prevPositions`. When computing `rippleSlugs` for delete, iterate `removedSlugs`, look up each removed slug's entry in `prevAdjacency`, and add any neighbor slug that still exists in the new data to `rippleSlugs`. Slugs are stable identifiers across layouts, so no index translation is needed.

**Cluster parameter tuning** (starting values, expect to iterate live):

```ts
.force("link",    forceLink(links).distance(40).strength(0.7))
.force("charge",  forceManyBody().strength(-30 - Math.min(nodeCount, 40)))
.force("center",  forceCenter(0, 0).strength(0.6))
.force("collide", forceCollide().radius((_, i) => 22 + data.nodes[i].depth * 8).strength(1))
```

**Tick count:** 30 on refresh (enough for new nodes to settle, short enough to keep the ripple localized), unchanged on initial build (100 + nodeCount * 2, capped at 300).

**Safe viewport scaling:**

```ts
if (!scaleRef.current) {
  // ... compute maxR from nodes ...
  const safe = getSafeViewport(window.innerWidth, window.innerHeight)
  const targetRadius = Math.min(safe.width, safe.height) * 0.35
  scaleRef.current = { maxR, targetRadius, yOffset: 15 }
}
```

Cached on first layout so subsequent refreshes don't rescale. Widget-relative sizing replaces the current `100 + min(nodeCount * 3, 150)` formula.

### 3. Reconciler changes (`reconcileGraph.ts`)

**`GraphBuffers` gains:**

```ts
export interface GraphBuffers {
  // ... existing fields ...
  attention: Float32Array // count, 0..1 per node, decays in animation loop
}
```

**`reconcileGraph` signature gains a `meta` parameter:**

```ts
export function reconcileGraph(
  prev: GraphBuffers | null,
  data: GraphData,
  positions: Float32Array,
  meta: LayoutMeta,
): GraphBuffers
```

**Initialization of `attention`:**

```ts
for (let i = 0; i < count; i++) {
  const slug = data.nodes[i].slug
  if (meta.newSlugs.has(slug)) {
    attention[i] = 1.0 // full glow, will decay
  } else if (prev) {
    const prevIdx = prev.slugToIndex.get(slug)
    attention[i] = prevIdx !== undefined ? prev.attention[prevIdx] : 0
  } else {
    attention[i] = 0
  }
}
```

Existing surviving nodes inherit any attention still in flight. This handles the edge case where two source feeds arrive in quick succession: the first batch of new nodes doesn't lose its pulse when the second batch triggers another reconcile.

### 4. Animation + shader changes (`EngineGraph.tsx`)

**New shader attribute `aAttention`:**

```glsl
// Vertex shader additions
attribute float aAttention;
varying float vAttention;
void main() {
  // ... existing ...
  vAttention = aAttention;
  // gl_PointSize grows slightly while attention is active
  gl_PointSize = aSize * (0.85 + vPulse * 0.3 + vAttention * 0.25) * (500.0 / -mv.z);
  // ... rest ...
}
```

```glsl
// Fragment shader additions
varying float vAttention;
void main() {
  // ... existing exp() calculations ...
  float a = (exp(-d * 2.5) * 0.06 + exp(-d * 5.0) * 0.18 + exp(-d * 12.0) * 0.5 + core)
            * vPulse * vDepth * vFade * (1.0 + vAttention * 0.6);
  // ... rest ...
}
```

The node gets both brighter (alpha multiplied by up to 1.6x) and slightly bigger (point size multiplied by up to 1.25x) during attention. Both decay linearly together.

**Geometry attribute wiring:**

In `applyReconcile`, set the new attribute when rebuilding node geometry:

```ts
nodeGeo.setAttribute("aAttention", new THREE.BufferAttribute(next.attention, 1))
```

**Animation loop decay:**

Inside the existing per-frame block where `fadeCurrent` is updated, add:

```ts
let attentionDirty = false
for (let i = 0; i < count; i++) {
  if (buffers.attention[i] > 0) {
    buffers.attention[i] = Math.max(0, buffers.attention[i] - delta) // ~1s full decay
    attentionDirty = true
  }
}
if (attentionDirty) state.nodeGeo.attributes.aAttention.needsUpdate = true
```

**Attention pan state machine:**

New `SceneState` field:

```ts
attentionPan: {
  target: { x: number; y: number }
  returnTo: { x: number; y: number }
  startMs: number
} | null
```

`applyReconcile` checks for off-screen new nodes and sets `attentionPan` if any are outside the safe rectangle:

```ts
if (meta.newSlugs.size > 0) {
  const safe = getSafeViewport(window.innerWidth, window.innerHeight)
  const offScreenNew: { x: number; y: number }[] = []
  // Project each new node's WORLD position to screen space via state.camera
  // ... for each new slug:
  //   projVec.set(targetX, targetY, targetZ).project(state.camera)
  //   sx = (projVec.x * 0.5 + 0.5) * rect.width + rect.left
  //   sy = (-projVec.y * 0.5 + 0.5) * rect.height + rect.top
  //   if (!isInSafeViewport(sx, sy, safe)) offScreenNew.push({ x: targetX, y: targetY })
  if (offScreenNew.length > 0) {
    // Centroid in WORLD coords
    const cx = offScreenNew.reduce((a, p) => a + p.x, 0) / offScreenNew.length
    const cy = offScreenNew.reduce((a, p) => a + p.y, 0) / offScreenNew.length
    state.attentionPan = {
      target: { x: cx, y: cy },
      returnTo: { x: state.panOffset.x, y: state.panOffset.y },
      startMs: performance.now(),
    }
  }
}
```

Animation loop additions, inserted before the existing `currentZoom` lerp:

```ts
if (state.attentionPan) {
  const t = now - state.attentionPan.startMs
  const { target, returnTo } = state.attentionPan
  if (t < 600) {
    // Phase 1: ease-out toward target
    const k = easeOutCubic(t / 600)
    state.panOffset.x = lerp(returnTo.x, target.x, k)
    state.panOffset.y = lerp(returnTo.y, target.y, k)
  } else if (t < 1600) {
    // Phase 2: hold at target
    state.panOffset.x = target.x
    state.panOffset.y = target.y
  } else if (t < 2400) {
    // Phase 3: ease-out back to returnTo
    const k = easeOutCubic((t - 1600) / 800)
    state.panOffset.x = lerp(target.x, returnTo.x, k)
    state.panOffset.y = lerp(target.y, returnTo.y, k)
  } else {
    // Done
    state.panOffset.x = returnTo.x
    state.panOffset.y = returnTo.y
    state.attentionPan = null
  }
}
```

**Manual pan cancels attention:** In the existing `onMouseDown` handler, if the user presses left mouse and isn't over a node, set `state.attentionPan = null` before the pan start logic runs. User input always wins.

### 5. Prop plumbing updates

**`apps/web/app/app/[engram]/page.tsx`:**

```ts
// Before:
const positions = useForceLayout(graphData, 1200, 800)
// ...
<EngineGraph data={graphData} positions={positions} engramSlug={engramSlug} ... />

// After:
const layoutResult = useForceLayout(graphData, 1200, 800)
const positions = layoutResult?.positions
const layoutMeta = layoutResult?.meta
// Loading gate: if (!positions || !layoutMeta) return <loading />
// ...
<EngineGraph
  data={graphData}
  positions={positions}
  layoutMeta={layoutMeta}
  engramSlug={engramSlug}
  ...
/>
```

Same change in `apps/web/app/app/[engram]/map/page.tsx` and any other `EngineGraph` call site.

**`EngineGraphProps` adds `layoutMeta: LayoutMeta`.** The `reconcile-phase` useEffect passes meta through to `applyReconcile`.

### 6. NodeCard refactor

Replace the inline constants at the top of `apps/web/app/components/app/NodeCard.tsx` with imports from `@/lib/map-viewport-bounds`. The inline `computeIntentionalPosition` function continues to work the same way, just reading from the shared module instead of local consts.

---

## File Summary

**Created:**
- `apps/web/lib/map-viewport-bounds.ts`

**Modified:**
- `apps/web/app/components/app/map/useForceLayout.ts` — neighbor detection, ripple/collapse, new cluster params, safe-viewport scale, return type change (~80 lines added, ~30 touched)
- `apps/web/app/components/app/map/reconcileGraph.ts` — `meta` parameter, `attention` buffer field, initialization logic (~30 lines changed)
- `apps/web/app/components/app/map/EngineGraph.tsx` — shader attribute, decay in animation loop, attention pan state machine, off-screen detection (~60 lines added)
- `apps/web/app/app/[engram]/page.tsx` — destructure layout result, pass `layoutMeta` (~3 lines)
- `apps/web/app/app/[engram]/map/page.tsx` — same destructuring change (~3 lines)
- `apps/web/app/components/app/NodeCard.tsx` — import constants from shared module (~5 lines cleanup)

**Not modified:**
- `apps/web/app/components/app/map/useGraphData.ts` — data layer unchanged

---

## Verification Strategy

No unit test runner exists in this repo. Verification is via type checking, build, Playwright smoke tests, and manual QA.

**Automated:**
1. `npx tsc --noEmit` exits 0 for all touched files
2. `npm run build` exits 0 (catches runtime issues the typechecker misses)
3. Playwright smoke test at `http://localhost:3000/app/coffee/map`:
   - Initial render clean, no console errors
   - SQL UPDATE of an article fires one reconcile with `sceneReady: true` (regression coverage)
   - SQL INSERT of an article produces a visibly highlighted new node in the page snapshot
   - SQL DELETE of an article removes the node from the snapshot within a frame

**Manual (user, in browser):**
4. Feed a real source on the dashboard (`/app/{slug}`), watch the map during compilation:
   - New nodes emit a warm pulse as they appear
   - Direct neighbors shift subtly; non-neighbors stay still
   - Pulse decays within ~1s
5. If new articles land under a widget card, confirm the camera drifts to reveal them and then drifts back
6. Manually pan while a drift is in progress — confirm the drift aborts immediately
7. Delete a source or article — confirm remaining neighbors glide inward slightly
8. Overall impression: does the graph feel more like Obsidian's natural constellation?

**What this verification can't check:**
- Cluster parameter quality. Those will need live iteration against real engram data.
- Whether the smooth-settle ripple is "springy enough." User subjective judgment only.

---

## Rollback Strategy

Every change is additive to the reconciler architecture we shipped this morning. If anything regresses, reverting the new commits restores the current behavior. The shared viewport helper (`map-viewport-bounds.ts`) is the only cross-cutting change; its impact on `NodeCard` is a pure refactor, so reverting it alongside is safe.

Granular rollback targets:
- Drop **cluster parameter tuning** by reverting just the `forceLink` / `forceManyBody` / `forceCenter` / `forceCollide` changes in `useForceLayout.ts`
- Drop **glow + pan attention** by reverting the shader + animation loop changes in `EngineGraph.tsx` plus the `attention` buffer field — the ripple/collapse work remains intact
- Drop **ripple/collapse** by removing the neighbor detection + un-pinning in `useForceLayout.ts` while keeping cluster tuning + attention

---

## Known Unknowns

Things I expect to tune during implementation, not pre-decide:

- **Exact cluster force parameters.** Starting values in Section 2 of the brainstorm. Will iterate live against real engram data.
- **Pan dwell timing.** Currently 600ms ease-in / 1000ms hold / 800ms ease-out. Total 2.4s may be too long or too short once we see it.
- **Glow pulse magnitude.** 0.6 alpha boost + 0.25 size boost. May be too loud or too quiet.
- **Ripple "feel."** The smooth-settle approach may feel too muted without a true spring. If so, upgrade path is a per-node velocity/damping model in the animation loop during ripple frames.
- **Whether `prevAdjacency` should also track depth information** for deleted-node neighbor weighting. Probably not needed for v1.

---

## Related

- PR #1 (merged 2026-04-10): `feat(map): animated realtime updates + delete from node click` — the reconciler foundation this spec builds on
- Brainstorm session transcript: terminal conversation on 2026-04-10, preserved in the visual companion artifacts at `.superpowers/brainstorm/17071-1775861013/content/`
