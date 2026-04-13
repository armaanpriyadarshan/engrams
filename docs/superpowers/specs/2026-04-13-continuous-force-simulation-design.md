# Continuous Force Simulation — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-shot force layout (`useMemo` with fixed ticks) with a persistent, continuously-ticking d3-force-3d simulation in the animation loop. New nodes stream in smoothly during organic growth instead of being placed once and pinned forever.

**Architecture:** The simulation lives as a persistent ref managed by `useForceLayout`. The Three.js animation loop in `EngineGraph` ticks it each frame and reads positions directly. When data changes (new articles/edges via Realtime), nodes/edges are diffed and patched into the live simulation with an alpha reheat.

**Tech Stack:** d3-force-3d (already installed), Three.js (existing), React refs (existing)

---

## 1. Current Architecture (what we're replacing)

```
useGraphData → GraphData {nodes, edges}
     ↓ (useMemo dependency)
useForceLayout → positions: Float32Array (stride-3, one-shot)
     ↓ (prop)
EngineGraph.applyReconcile()
     ↓ calls
reconcileGraph(prev, data, positions, meta) → GraphBuffers {currentPos, targetPos, ...}
     ↓ animation loop
lerp currentPos → targetPos each frame (step = delta * 3)
```

**Problems:**
- Layout runs once per data change in useMemo (50 ticks on refresh, 300 on initial)
- New nodes placed in those N ticks, then hard-pinned forever via fx/fy/fz
- Articles arrive before edges — nodes placed with no connections, pinned at bad positions
- When edges arrive later, nodes DON'T move because they're already pinned
- Result: organic growth scatters nodes; only bulk-loaded engrams look good

## 2. New Architecture

```
useGraphData → GraphData {nodes, edges}  (unchanged)
     ↓
useForceLayout → { simulationRef, nodesRef, slugToSimIdx }
     ↓ manages
Persistent d3-force-3d simulation (ref, survives re-renders)
     ↓ ticked by
EngineGraph animation loop:
  1. if (simulation.alpha() > 0.001) simulation.tick()
  2. read node.x/y/z → write to currentPos buffer
  3. render
```

### 2.1 useForceLayout.ts — Simulation Manager

**Returns:** `SimulationHandle` instead of `LayoutResult`

```ts
interface SimulationHandle {
  // The live simulation — EngineGraph ticks this
  simulation: Simulation3D<SimNode, SimLink>
  // Current nodes array — EngineGraph reads x/y/z from these
  nodes: SimNode[]
  // Slug → node-array-index mapping for reconciliation
  slugToIdx: Map<string, number>
  // Scale info for world-space conversion
  scale: { maxR: number; targetRadius: number; yOffset: number }
}
```

**Lifecycle:**

- **useRef** holds the simulation (persists across renders)
- **useEffect** on `[data, engramId]` diffs the incoming GraphData against the simulation's current nodes/edges and patches:
  - New nodes: add to simulation at centroid + jitter, reheat alpha 0.3
  - Removed nodes: remove from simulation, reheat alpha 0.15
  - New edges: add as links, reheat alpha 0.2
  - Removed edges: remove links, reheat alpha 0.1
  - No changes: don't reheat
- **First creation** (no simulation yet): build from scratch with all nodes + edges, alpha 0.8 (or 0.05 if loading from cache)
- **Scale** computed once on first layout and stored in a ref (same as current)

**Diff algorithm:**

```
prevSlugs = set of slugs in the simulation
nextSlugs = set of slugs in data.nodes
added = nextSlugs - prevSlugs
removed = prevSlugs - nextSlugs

For each added: create SimNode at centroid, add to simulation.nodes()
For each removed: splice from simulation.nodes()
Rebuild links from data.edges (cheap — just index mapping)
```

**Persistence:**

- Save positions to localStorage + Supabase when the simulation cools (alpha < 0.005)
- Use a debounce: don't save more than once every 5 seconds
- On load: seed from localStorage first, then DB fallback (existing logic)

### 2.2 EngineGraph.tsx — Animation Loop Changes

**Current loop (simplified):**
```ts
// Lerp currentPos → targetPos
for (let i = 0; i < count * 3; i++) {
  currentPos[i] += (targetPos[i] - currentPos[i]) * step
}
nodeGeo.attributes.position.needsUpdate = true
```

**New loop:**
```ts
// Tick the simulation (if still settling)
const sim = simulationHandle.simulation
if (sim.alpha() > 0.001) {
  sim.tick()
}

// Read positions from simulation nodes → currentPos buffer
const simNodes = simulationHandle.nodes
const scale = simulationHandle.scale
for (let i = 0; i < count; i++) {
  const node = simNodes[i]
  if (!node) continue
  const i3 = i * 3
  currentPos[i3] = ((node.x ?? 0) / scale.maxR) * scale.targetRadius
  currentPos[i3 + 1] = ((node.y ?? 0) / scale.maxR) * scale.targetRadius + scale.yOffset
  currentPos[i3 + 2] = ((node.z ?? 0) / scale.maxR) * scale.targetRadius
}
nodeGeo.attributes.position.needsUpdate = true
```

**Key difference:** No more `targetPos`. No more lerp. The simulation's own velocity damping provides smooth motion. Positions update continuously from the simulation's live state.

**applyReconcile changes:**
- Still called when data changes (for buffer resizing, fade-in, attention glow, edge buffers)
- No longer receives a `positions` array
- No longer sets `targetPos` — that concept is removed
- `currentPos` is initialized from the simulation's current node positions (for newly added buffer slots)
- Fade, attention, edge colors, neighbor map — all unchanged

### 2.3 reconcileGraph.ts — Simplified

**Removes:**
- `targetPos` buffer entirely
- Position assignment from the `positions` parameter
- The `positions` parameter itself

**Keeps:**
- `currentPos` — initialized for new nodes from their simulation position
- `fadeCurrent` / `fadeTarget` — unchanged
- `attention` — unchanged
- Edge buffers — unchanged
- Colors, sizes, phases — unchanged

### 2.4 Alpha Reheat Strategy

| Event | Alpha | Settle time (~60fps) | Feel |
|---|---|---|---|
| Initial load (no cache) | 0.8 | ~3 seconds | Full layout from scratch |
| Initial load (from cache) | 0.05 | ~0.3 seconds | Barely perceptible adjustment |
| New article (no edges yet) | 0.3 | ~1.5 seconds | Node drifts from centroid to equilibrium |
| New edge | 0.2 | ~1 second | Connected nodes pull together |
| Node deleted | 0.15 | ~0.8 seconds | Neighbors fill the gap |
| Edge deleted | 0.1 | ~0.5 seconds | Barely noticeable |

Alpha decay uses d3's default `alphaDecay(0.0228)`. At alpha 0.3, the simulation runs ~50 ticks before cooling — about 1 second of visible motion at 60fps.

### 2.5 Delete Settle

The manual delete-settle code (spatial proximity nudge toward deleted node's position) is **removed entirely**. The continuous simulation handles this naturally: when a node is removed, its repulsion disappears, and the center force + link forces pull neighbors inward to fill the gap. The alpha reheat of 0.15 gives just enough energy for this to happen smoothly.

### 2.6 Performance

- **Tick cost:** d3-force-3d tick on 200 nodes with 150 edges ≈ 0.2-0.5ms. Well within 16ms frame budget.
- **Idle cost:** When alpha < 0.001, skip the tick entirely. Zero CPU when the graph is settled.
- **Memory:** The simulation's internal state (node velocities, Barnes-Hut tree) is small. No concern.

### 2.7 Persistence

**Save trigger:** When alpha decays below 0.005, save positions to:
1. localStorage (sync, fast)
2. Supabase `engrams.layout_positions` (fire-and-forget async)

**Load priority:**
1. localStorage (immediate)
2. Supabase DB (async fallback for cross-browser)
3. Fresh computation (no cache)

Same as current, just triggered on simulation cooldown instead of after every useMemo.

## 3. Files Changed

| File | Change |
|---|---|
| `useForceLayout.ts` | Major rewrite — becomes simulation manager, returns SimulationHandle |
| `EngineGraph.tsx` | Animation loop reads from simulation; applyReconcile simplified |
| `reconcileGraph.ts` | Remove targetPos, remove positions parameter |
| `useGraphData.ts` | Unchanged |
| Shader / materials | Unchanged |

## 4. What Gets Removed

- One-shot `useMemo` layout with fixed ticks
- `targetPos` buffer in GraphBuffers
- `currentPos → targetPos` lerp in animation loop
- Hard-pinning (fx/fy/fz) on existing nodes
- Insert push code
- Delete settle nudge code
- Attention pan code (already removed)
- Ripple slugs / spatial ripple radius computation

## 5. What Gets Added

- Persistent simulation ref in useForceLayout
- Node/edge diff + patch on data change
- Alpha reheat per event type
- Simulation tick in animation loop
- Position read from simulation → currentPos buffer each frame
- Cooldown-triggered persistence save

## 6. Success Criteria

1. Feed a source to a fresh engram → nodes appear near the centroid and drift smoothly into position over ~2 seconds
2. Edges arrive 10-30 seconds later → connected nodes pull together over ~1 second
3. Feed a second source → new nodes appear, existing nodes barely shift
4. Delete a node → neighbors fill the gap naturally over ~1 second
5. Final layout quality matches bulk-loaded engrams (AI alignment, human cognition)
6. Camera stays still during all of the above — no attention pan
7. Performance: 200+ nodes at 60fps with no dropped frames
