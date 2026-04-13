# Continuous Force Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-shot force layout with a persistent, continuously-ticking d3-force-3d simulation so organic growth (feeding sources one at a time) produces smooth, well-clustered graphs.

**Architecture:** The simulation lives as a ref in `useForceLayout`, which returns a handle instead of positions. `EngineGraph`'s animation loop ticks the simulation each frame and reads positions directly into the Three.js buffers. When data changes (new articles/edges via Realtime), the simulation is patched and reheated.

**Tech Stack:** d3-force-3d (existing), Three.js (existing), React refs + useEffect

---

### Task 1: Rewrite useForceLayout as a simulation manager

**Files:**
- Modify: `apps/web/app/components/app/map/useForceLayout.ts` (full rewrite, keep persistence)

This is the core change. The hook creates a persistent simulation on first load and patches it on data changes instead of recomputing from scratch.

- [ ] **Step 1: Define the new interfaces**

Replace the `LayoutResult` export and add `SimulationHandle`. Keep `LayoutMeta` (still used for fade/attention in reconcile).

```ts
// Remove: export interface LayoutResult { positions: Float32Array; meta: LayoutMeta }

// Add:
export interface SimulationHandle {
  /** Call in the animation loop — ticks the simulation if alpha > threshold */
  tick: () => boolean  // returns true if the simulation is still warm (alpha > 0.001)
  /** Read the current position of node at graph-data index i, scaled to world space */
  readPosition: (i: number, out: { x: number; y: number; z: number }) => void
  /** Number of nodes the simulation knows about */
  count: number
  /** Latest diff metadata (which slugs are new) for fade/attention */
  meta: LayoutMeta
}
```

- [ ] **Step 2: Rewrite the hook body**

The new hook:
1. Maintains a simulation ref (`useRef<Simulation3D | null>`)
2. Maintains a nodes array ref and a slug→index map ref
3. On `[data, engramId]` change: diffs nodes/edges, patches the simulation, reheats alpha
4. Returns a `SimulationHandle` (stable ref object, not recreated each render)
5. Persistence: saves to localStorage + DB when simulation cools

Key code structure (pseudocode — the actual implementation will fill in every line):

```ts
export function useForceLayout(
  data: GraphData | null,
  width: number,
  height: number,
  engramId: string | null = null,
): SimulationHandle | null {
  const simRef = useRef<Simulation3D<SimNode, SimLink> | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const linksRef = useRef<SimLink[]>([])
  const scaleRef = useRef<LayoutScale | null>(null)
  const metaRef = useRef<LayoutMeta>({ newSlugs: new Set(), rippleSlugs: new Set() })
  const prevSlugsRef = useRef<Set<string>>(new Set())
  const handleRef = useRef<SimulationHandle | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [dbSyncTick, setDbSyncTick] = useState(0)

  // ... DB fetch useEffect for cross-browser persistence (keep existing logic)

  // Main effect: create/patch simulation when data changes
  useEffect(() => {
    if (!data || data.nodes.length === 0) {
      handleRef.current = null
      return
    }

    const prevSlugs = prevSlugsRef.current
    const nextSlugs = new Set(data.nodes.map(n => n.slug))
    const added = new Set([...nextSlugs].filter(s => !prevSlugs.has(s)))
    const removed = new Set([...prevSlugs].filter(s => !nextSlugs.has(s)))
    const isFirstLoad = prevSlugs.size === 0

    // ... compute centroid of existing nodes for seeding new ones
    // ... create or patch simulation
    // ... set alpha reheat based on event type
    // ... update prevSlugsRef, metaRef
    // ... build/update the SimulationHandle

    prevSlugsRef.current = nextSlugs
  }, [data, engramId, dbSyncTick])

  return handleRef.current
}
```

- [ ] **Step 3: Implement the simulation creation (first load)**

When `simRef.current` is null and data arrives:

```ts
// Load cached positions
const stored = readStoredLayout(engramId)
const cachedPositions = stored ? new Map(stored.positions) : new Map()

// Build nodes
const nodes: SimNode[] = data.nodes.map((n, i) => {
  const cached = cachedPositions.get(n.slug)
  return {
    index: i,
    slug: n.slug,
    x: cached?.x ?? (Math.random() - 0.5) * 30,
    y: cached?.y ?? (Math.random() - 0.5) * 30,
    z: cached?.z ?? (Math.random() - 0.5) * 30,
  }
})

// Build links
const links: SimLink[] = data.edges.map(e => ({
  source: e.sourceIdx,
  target: e.targetIdx,
  weight: e.weight,
}))

// Create simulation
const sim = forceSimulation<SimNode>()
  .numDimensions(3)
  .nodes(nodes)
  .force("link", forceLink<SimNode, SimLink>(links)
    .distance(l => 52 - 10 * (l.weight ?? 1.0))
    .strength(l => 0.45 + 0.15 * (l.weight ?? 1.0)))
  .force("charge", forceManyBody<SimNode>().strength(-6 - Math.min(nodes.length, 8)))
  .force("center", forceCenter<SimNode>(0, 0, 0).strength(0.85))
  .force("collide", forceCollide<SimNode>()
    .radius((_, i) => 19 + data.nodes[i].depth * 7).strength(1))
  .alpha(cached ? 0.05 : 0.8)
  .alphaDecay(0.0228)
  .stop()  // we tick manually in the animation loop

simRef.current = sim
nodesRef.current = nodes
linksRef.current = links
```

- [ ] **Step 4: Implement the simulation patching (incremental update)**

When `simRef.current` exists and data changes:

```ts
const sim = simRef.current!
const oldNodes = nodesRef.current
const oldNodeMap = new Map(oldNodes.map(n => [n.slug, n]))

// Compute centroid for seeding new nodes
let cx = 0, cy = 0, cz = 0
for (const n of oldNodes) { cx += n.x ?? 0; cy += n.y ?? 0; cz += n.z ?? 0 }
if (oldNodes.length > 0) { cx /= oldNodes.length; cy /= oldNodes.length; cz /= oldNodes.length }

// Build new nodes array, preserving positions of existing nodes
const newNodes: SimNode[] = data.nodes.map((gn, i) => {
  const existing = oldNodeMap.get(gn.slug)
  if (existing) {
    existing.index = i  // re-index
    return existing
  }
  // New node — seed at centroid
  return {
    index: i, slug: gn.slug,
    x: cx + (Math.random() - 0.5) * 20,
    y: cy + (Math.random() - 0.5) * 20,
    z: cz + (Math.random() - 0.5) * 20,
  }
})

// Rebuild links
const newLinks: SimLink[] = data.edges.map(e => ({
  source: e.sourceIdx,
  target: e.targetIdx,
  weight: e.weight,
}))

// Patch the simulation
sim.nodes(newNodes)
sim.force("link", forceLink<SimNode, SimLink>(newLinks)
  .distance(l => 52 - 10 * (l.weight ?? 1.0))
  .strength(l => 0.45 + 0.15 * (l.weight ?? 1.0)))
sim.force("charge", forceManyBody<SimNode>()
  .strength(-6 - Math.min(newNodes.length, 8)))

// Reheat based on what changed
if (added.size > 0) sim.alpha(Math.max(sim.alpha(), 0.3))
else if (removed.size > 0) sim.alpha(Math.max(sim.alpha(), 0.15))
else sim.alpha(Math.max(sim.alpha(), 0.1))  // edge-only change

nodesRef.current = newNodes
linksRef.current = newLinks
```

- [ ] **Step 5: Build the SimulationHandle**

```ts
// Compute scale (once, on first layout)
if (!scaleRef.current) {
  let maxR = 1
  for (const n of nodesRef.current) {
    const r = Math.sqrt((n.x ?? 0) ** 2 + (n.y ?? 0) ** 2 + (n.z ?? 0) ** 2)
    if (r > maxR) maxR = r
  }
  // If loading from stored layout, prefer stored maxR
  if (stored?.maxR && stored.maxR > 0) maxR = stored.maxR
  const safe = typeof window !== "undefined"
    ? getSafeViewport(window.innerWidth, window.innerHeight)
    : { width: 800, height: 600 }
  scaleRef.current = {
    maxR: Math.max(maxR, 1),
    targetRadius: Math.min(safe.width, safe.height) * 0.35,
    yOffset: 15,
  }
}

const scale = scaleRef.current
const out = { x: 0, y: 0, z: 0 }

handleRef.current = {
  tick: () => {
    const sim = simRef.current
    if (!sim) return false
    const alpha = sim.alpha()
    if (alpha > 0.001) {
      sim.tick()
      // Schedule persistence save when simulation cools
      if (alpha < 0.005 && !saveTimerRef.current) {
        saveTimerRef.current = setTimeout(() => {
          const positions = new Map<string, { x: number; y: number; z: number }>()
          for (const n of nodesRef.current) {
            positions.set(n.slug, { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 })
          }
          writeStoredLayout(engramId, positions, scaleRef.current?.maxR ?? 1)
          saveTimerRef.current = null
        }, 1000)
      }
      return true
    }
    return false
  },
  readPosition: (i, target) => {
    const node = nodesRef.current[i]
    if (!node) { target.x = 0; target.y = 0; target.z = 0; return }
    target.x = ((node.x ?? 0) / scale.maxR) * scale.targetRadius
    target.y = ((node.y ?? 0) / scale.maxR) * scale.targetRadius + scale.yOffset
    target.z = ((node.z ?? 0) / scale.maxR) * scale.targetRadius
  },
  count: nodesRef.current.length,
  meta: metaRef.current,
}
```

- [ ] **Step 6: Implement persistence save/load**

Keep the existing `readStoredLayout`, `writeStoredLayout` functions and the DB sync `useEffect`. The only change: saves are triggered by the `tick()` method when the simulation cools, not on every useMemo run.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/components/app/map/useForceLayout.ts
git commit -m "feat(map): rewrite useForceLayout as continuous simulation manager"
```

---

### Task 2: Simplify reconcileGraph

**Files:**
- Modify: `apps/web/app/components/app/map/reconcileGraph.ts`

Remove `targetPos` and the `positions` parameter. Positions are now written by the animation loop.

- [ ] **Step 1: Update the GraphBuffers interface**

```ts
export interface GraphBuffers {
  count: number
  edgeCount: number
  nodeColors: Float32Array
  sizes: Float32Array
  phases: Float32Array
  depthArr: Float32Array
  currentPos: Float32Array   // count * 3 — written by animation loop from simulation
  // REMOVED: targetPos
  fadeCurrent: Float32Array
  fadeTarget: Float32Array
  attention: Float32Array
  eSrc: Uint16Array
  eTgt: Uint16Array
  edgeColors: Float32Array
  edgePositions: Float32Array
  slugs: string[]
  slugToIndex: Map<string, number>
  neighbors: Map<number, Set<number>>
}
```

- [ ] **Step 2: Update the reconcileGraph function signature**

```ts
// Old: export function reconcileGraph(prev, data, positions, meta)
// New: no positions parameter, no LayoutMeta import needed for positions
export function reconcileGraph(
  prev: GraphBuffers | null,
  data: GraphData,
  newSlugs: Set<string>,
): GraphBuffers {
```

- [ ] **Step 3: Update the function body**

Remove all `targetPos` references. `currentPos` for NEW nodes is initialized to (0,0,0) — the animation loop will write the real position from the simulation on the next frame. For EXISTING nodes, copy `currentPos` from the previous buffers.

Key changes in the loop:
```ts
// OLD:
// const x = positions[i3]; const y = positions[i3+1]; const z = positions[i3+2]
// targetPos[i3] = x; targetPos[i3+1] = y; targetPos[i3+2] = z

// NEW: no targetPos assignment. currentPos handled below:
const prevIdx = prev?.slugToIndex.get(node.slug)
if (prev && prevIdx !== undefined) {
  const p3 = prevIdx * 3
  currentPos[i3] = prev.currentPos[p3]
  currentPos[i3 + 1] = prev.currentPos[p3 + 1]
  currentPos[i3 + 2] = prev.currentPos[p3 + 2]
  fadeCurrent[i] = prev.fadeCurrent[prevIdx]
  attention[i] = prev.attention[prevIdx]
} else {
  // New node — animation loop will write real position next frame
  currentPos[i3] = 0; currentPos[i3 + 1] = 0; currentPos[i3 + 2] = 0
  fadeCurrent[i] = 0
  attention[i] = newSlugs.has(node.slug) ? 1.0 : 0
}
```

Remove `targetPos` from the return object.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/app/map/reconcileGraph.ts
git commit -m "refactor(map): remove targetPos from reconcileGraph — positions come from simulation"
```

---

### Task 3: Update EngineGraph animation loop

**Files:**
- Modify: `apps/web/app/components/app/map/EngineGraph.tsx`

The animation loop reads positions from the simulation handle each frame. The `currentPos → targetPos` lerp is replaced. `applyReconcile` is simplified.

- [ ] **Step 1: Update EngineGraphProps**

```ts
interface EngineGraphProps {
  data: GraphData
  simulationHandle: SimulationHandle | null  // replaces positions + layoutMeta
  engramSlug: string
  onNodeClick?: (slug: string, x: number, y: number) => void
  nodeVisible?: Uint8Array | null
}
```

- [ ] **Step 2: Update the component signature and refs**

```ts
export default function EngineGraph({ data, simulationHandle, engramSlug, onNodeClick, nodeVisible }: EngineGraphProps) {
  // Remove: positionsRef
  // Add: simHandleRef
  const simHandleRef = useRef<SimulationHandle | null>(simulationHandle)
  useEffect(() => { simHandleRef.current = simulationHandle }, [simulationHandle])
```

- [ ] **Step 3: Update the animation loop — replace lerp with simulation read**

In `buildMountScene`'s `animate` function, replace the `currentPos → targetPos` lerp block:

```ts
// OLD:
// if (count > 0) {
//   const step = Math.min(delta * 3, 1)
//   const cp = buffers.currentPos
//   const tp = buffers.targetPos
//   for (let i = 0; i < count * 3; i++) {
//     cp[i] += (tp[i] - cp[i]) * step
//   }
//   state.nodeGeo.attributes.position.needsUpdate = true
// }

// NEW:
const handle = simHandleRef.current
if (handle && count > 0) {
  handle.tick()
  const cp = buffers.currentPos
  const pos = { x: 0, y: 0, z: 0 }
  for (let i = 0; i < count; i++) {
    handle.readPosition(i, pos)
    const i3 = i * 3
    cp[i3] = pos.x
    cp[i3 + 1] = pos.y
    cp[i3 + 2] = pos.z
  }
  state.nodeGeo.attributes.position.needsUpdate = true
}
```

Note: the `simHandleRef` is accessed via closure inside `buildMountScene`. The ref is set up in the component body and the animate closure reads `.current` each frame.

- [ ] **Step 4: Update applyReconcile**

Change the function signature — no more `positions` or `meta` parameters from the old layout:

```ts
// OLD: function applyReconcile(state, data, positions, meta)
// NEW:
function applyReconcile(state: SceneState, data: GraphData, newSlugs: Set<string>) {
  const next = reconcileGraph(state.buffers, data, newSlugs)
  state.buffers = next
  // ... rebuild geometries (same as before, but no targetPos references)
```

Update the graphRadius computation to use `currentPos` instead of `targetPos`:
```ts
let graphRadius = 1
for (let i = 0; i < next.count; i++) {
  const r = Math.sqrt(
    next.currentPos[i * 3] ** 2 +
    next.currentPos[i * 3 + 1] ** 2 +
    next.currentPos[i * 3 + 2] ** 2,
  )
  if (r > graphRadius) graphRadius = r
}
```

- [ ] **Step 5: Update the reconcile useEffect**

```ts
// OLD:
// useEffect(() => {
//   if (!sceneReady || !state || data.nodes.length === 0) return
//   applyReconcile(state, data, positions, layoutMeta)
// }, [sceneReady, data, positions, layoutMeta])

// NEW:
useEffect(() => {
  const state = sceneRef.current
  if (!sceneReady || !state || data.nodes.length === 0 || !simulationHandle) return
  applyReconcile(state, data, simulationHandle.meta.newSlugs)
}, [sceneReady, data, simulationHandle])
```

- [ ] **Step 6: Remove SceneState.targetPos references**

Search for any remaining `targetPos` in EngineGraph.tsx and remove them. The `buffers.targetPos` field no longer exists.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/components/app/map/EngineGraph.tsx
git commit -m "feat(map): animation loop reads from continuous simulation"
```

---

### Task 4: Update the engram page to pass SimulationHandle

**Files:**
- Modify: `apps/web/app/app/[engram]/page.tsx`

- [ ] **Step 1: Update the useForceLayout call and EngineGraph props**

```ts
// OLD:
// const layoutResult = useForceLayout(graphData, 1200, 800, engramId)
// const positions = layoutResult?.positions
// const layoutMeta = layoutResult?.meta

// NEW:
const simulationHandle = useForceLayout(graphData, 1200, 800, engramId)
```

Update the EngineGraph JSX:
```tsx
// OLD:
// graphData && positions && layoutMeta ? (
//   <EngineGraph data={graphData} positions={positions} layoutMeta={layoutMeta} ... />

// NEW:
graphData && simulationHandle ? (
  <EngineGraph data={graphData} simulationHandle={simulationHandle} ... />
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/app/[engram]/page.tsx
git commit -m "feat(map): wire SimulationHandle through to EngineGraph"
```

---

### Task 5: Type check + smoke test

- [ ] **Step 1: Run the type checker**

```bash
cd apps/web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "validator.ts\|health/page"
```

Fix any type errors. Common ones:
- References to `targetPos` that were missed
- `LayoutMeta` import changes in reconcileGraph
- `positions` prop removed from EngineGraphProps

- [ ] **Step 2: Clear all localStorage caches and reload**

In the browser console:
```js
Object.keys(localStorage).filter(k=>k.startsWith('engrams-map-layout-')).forEach(k=>localStorage.removeItem(k))
```

Hard refresh. The graph should render and settle within ~3 seconds.

- [ ] **Step 3: Feed a source and verify organic growth**

Feed a URL to any engram. Verify:
- New nodes appear near the centroid and drift into position
- When edges arrive, connected nodes pull together
- Camera stays still
- No nodes scatter to distant positions

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(map): type fixes and cleanup for continuous simulation"
```

- [ ] **Step 5: Push**

```bash
git push origin master
```
