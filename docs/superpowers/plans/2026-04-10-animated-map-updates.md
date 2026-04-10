# Animated Map Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an engram's data changes in real-time (new articles, new edges, new sources), the map should animate those changes in place — existing nodes glide to their new force-layout positions, new nodes fade in at their target location, removed nodes disappear — instead of tearing down and rebuilding the entire WebGL scene.

**Architecture:** Split `EngineGraph.tsx`'s single monolithic `useEffect` into two phases: (1) a **mount phase** that creates the Three.js scene, camera, renderer, materials, event listeners, and animation loop exactly once and stashes everything in a `sceneRef`; (2) a **reconcile phase** that runs on every `data`/`positions` change, calls a pure `reconcileGraph` function to diff the old buffers against the new data, rebuilds just the geometry objects (not the scene), and updates the tween targets. The animation loop lerps `currentPos → targetPos` for position changes and `fadeCurrent → fadeTarget` for new-node fade-in (the fade machinery already exists and is reused).

**Tech Stack:** Three.js (r183), TypeScript, React 19 (App Router), d3-force (already computing layout in `useForceLayout.ts`).

**Out of scope for V1:** Fade-out animation for removed nodes (they disappear immediately — can be added later if it looks jarring). Smooth animation of edge color/weight changes (edges are rebuilt on data change; visual glide isn't needed since connections are derived from node positions each frame anyway).

---

## File Structure

- **Create:** `apps/web/app/components/app/map/reconcileGraph.ts` — pure function + `GraphBuffers` type. Zero Three.js dependency so it stays trivially readable and reusable.
- **Modify:** `apps/web/app/components/app/map/EngineGraph.tsx` — split into mount-phase and reconcile-phase effects; hoist scene state into a `sceneRef`; swap `basePos` → `currentPos`/`targetPos` tween; use `reconcileGraph` to produce new buffers.
- **No changes:** `useGraphData.ts` (already emits fresh data on Realtime events), `useForceLayout.ts` (already seeds survivors at previous positions and emits a new `Float32Array`).

**Testing approach:** No unit test runner exists in this repo (`apps/web/package.json` only ships `dev`, `build`, `lint`). Verification is via (a) `next build` + `eslint` for type/lint correctness, (b) Playwright MCP smoke tests against `http://localhost:3000` — navigate to a populated engram's `/map` route, take a snapshot, feed a source via the AddSourceButton, poll the map, confirm node count increases without a full scene flicker, and (c) manual visual QA by the user.

---

### Task 1: Create the `reconcileGraph` pure function and `GraphBuffers` type

**Files:**
- Create: `apps/web/app/components/app/map/reconcileGraph.ts`

The reconciler takes the previous frame's buffers (or `null` on first call), the new `GraphData`, and the new `Float32Array` of force-layout positions. It produces a fresh set of buffers where:
- Surviving nodes (identified by `slug`) keep their `currentPos` and `fadeCurrent` from the previous frame → this is what makes them *glide* rather than jump.
- New nodes have `currentPos = targetPos` (positioned at their final spot immediately) and `fadeCurrent = 0` (they'll fade in via the existing fade lerp).
- Removed nodes are dropped — no slot reserved for them.
- Edges are rebuilt from scratch with new source/target indices (edges are light; rebuilding every time is cheaper than diffing).

- [ ] **Step 1: Create the new file with the type definition and function skeleton**

Create `apps/web/app/components/app/map/reconcileGraph.ts`:

```ts
import type { GraphData } from "./useGraphData"
import { getArticleTypeMeta } from "@/lib/article-types"

export interface GraphBuffers {
  // Node counts
  count: number
  edgeCount: number

  // Stable per-node attributes (derived from data, not tweened)
  nodeColors: Float32Array // count * 3
  sizes: Float32Array // count
  phases: Float32Array // count
  depthArr: Float32Array // count

  // Tweened position state
  currentPos: Float32Array // count * 3 (rendered each frame)
  targetPos: Float32Array // count * 3 (lerp target)

  // Tweened fade state
  fadeCurrent: Float32Array // count (rendered each frame via aFade attribute)
  fadeTarget: Float32Array // count

  // Edge buffers
  eSrc: Uint16Array // edgeCount
  eTgt: Uint16Array // edgeCount
  edgeColors: Float32Array // edgeCount * 6 (2 verts per edge × 3 components)
  edgePositions: Float32Array // edgeCount * 6 (updated each frame from node currentPos)

  // Bookkeeping
  slugs: string[] // length = count
  slugToIndex: Map<string, number>
  neighbors: Map<number, Set<number>> // adjacency for hover highlight
}

// Hex → [0..1] RGB, memoized across calls so the same palette color only
// parses once per session.
const _hexCache = new Map<string, [number, number, number]>()
function hexToRgb01(hex: string): [number, number, number] {
  const cached = _hexCache.get(hex)
  if (cached) return cached
  const h = hex.replace("#", "")
  const rgb: [number, number, number] = [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ]
  _hexCache.set(hex, rgb)
  return rgb
}

const RELATION_COLORS: Record<string, [number, number, number]> = {
  related: [0.33, 0.33, 0.33],
  requires: [0.56, 0.35, 0.16],
  extends: [0.16, 0.45, 0.56],
  causation: [0.56, 0.16, 0.16],
  contradiction: [0.56, 0.45, 0.16],
  evolution: [0.16, 0.45, 0.56],
  supports: [0.30, 0.45, 0.30],
}
const DEFAULT_EDGE_COLOR: [number, number, number] = [0.33, 0.33, 0.33]

export function reconcileGraph(
  prev: GraphBuffers | null,
  data: GraphData,
  positions: Float32Array,
): GraphBuffers {
  const count = data.nodes.length
  const edgeCount = data.edges.length

  const nodeColors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const phases = new Float32Array(count)
  const depthArr = new Float32Array(count)
  const currentPos = new Float32Array(count * 3)
  const targetPos = new Float32Array(count * 3)
  const fadeCurrent = new Float32Array(count)
  const fadeTarget = new Float32Array(count)

  const slugs: string[] = new Array(count)
  const slugToIndex = new Map<string, number>()

  for (let i = 0; i < count; i++) {
    const node = data.nodes[i]
    const d = node.depth
    const i3 = i * 3
    const x = positions[i * 2]
    const y = positions[i * 2 + 1]
    const z = -300 + d * 500

    // Target position — where the force layout wants this node to be
    targetPos[i3] = x
    targetPos[i3 + 1] = y
    targetPos[i3 + 2] = z

    // If this slug existed before, copy its rendered position so it glides.
    // Otherwise place it at the target (it'll fade in from invisible).
    const prevIdx = prev?.slugToIndex.get(node.slug)
    if (prev && prevIdx !== undefined) {
      const p3 = prevIdx * 3
      currentPos[i3] = prev.currentPos[p3]
      currentPos[i3 + 1] = prev.currentPos[p3 + 1]
      currentPos[i3 + 2] = prev.currentPos[p3 + 2]
      fadeCurrent[i] = prev.fadeCurrent[prevIdx]
    } else {
      currentPos[i3] = x
      currentPos[i3 + 1] = y
      currentPos[i3 + 2] = z
      fadeCurrent[i] = 0 // new node: start invisible, fade in
    }
    fadeTarget[i] = 1

    // Stable derived attributes
    sizes[i] = 20 + d * 35
    phases[i] = i * 2.39996
    depthArr[i] = d
    const col = hexToRgb01(getArticleTypeMeta(node.articleType).colorHex)
    nodeColors[i3] = col[0]
    nodeColors[i3 + 1] = col[1]
    nodeColors[i3 + 2] = col[2]

    slugs[i] = node.slug
    slugToIndex.set(node.slug, i)
  }

  // Edges — rebuilt from scratch every time. Indices come from the new
  // slugToIndex, so they automatically point at the right slots.
  const eSrc = new Uint16Array(edgeCount)
  const eTgt = new Uint16Array(edgeCount)
  const edgeColors = new Float32Array(edgeCount * 6)
  const edgePositions = new Float32Array(edgeCount * 6)

  for (let ei = 0; ei < edgeCount; ei++) {
    const edge = data.edges[ei]
    eSrc[ei] = edge.sourceIdx
    eTgt[ei] = edge.targetIdx
    const col = RELATION_COLORS[edge.relation] ?? DEFAULT_EDGE_COLOR
    const w = Math.max(0.3, Math.min(1.0, edge.weight))
    const i6 = ei * 6
    edgeColors[i6] = col[0] * w
    edgeColors[i6 + 1] = col[1] * w
    edgeColors[i6 + 2] = col[2] * w
    edgeColors[i6 + 3] = col[0] * w
    edgeColors[i6 + 4] = col[1] * w
    edgeColors[i6 + 5] = col[2] * w
  }

  // Neighbor adjacency (used by EngineGraph's hover-highlight fade logic)
  const neighbors = new Map<number, Set<number>>()
  for (let i = 0; i < count; i++) neighbors.set(i, new Set())
  for (let ei = 0; ei < edgeCount; ei++) {
    neighbors.get(eSrc[ei])?.add(eTgt[ei])
    neighbors.get(eTgt[ei])?.add(eSrc[ei])
  }

  return {
    count,
    edgeCount,
    nodeColors,
    sizes,
    phases,
    depthArr,
    currentPos,
    targetPos,
    fadeCurrent,
    fadeTarget,
    eSrc,
    eTgt,
    edgeColors,
    edgePositions,
    slugs,
    slugToIndex,
    neighbors,
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd apps/web && npx tsc --noEmit` (or `npm run build` if tsc alone is slow)
Expected: No new errors in `reconcileGraph.ts`. Existing errors in other files are out of scope.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/app/map/reconcileGraph.ts
git commit -m "feat(map): add pure reconcileGraph for animated buffer diffs"
```

---

### Task 2: Hoist scene state into a `sceneRef` (no behavior change yet)

**Files:**
- Modify: `apps/web/app/components/app/map/EngineGraph.tsx`

Before splitting effects, move the objects that the animation loop references (scene, camera, renderer, geos, mats, buffers, mouse/hover/ripple/pan state) out of `setup()`'s function-local scope and into a ref-backed state object. This is a pure refactor — one large commit that changes structure without changing behavior. The setup function still builds everything and starts the loop; only the *storage* changes.

- [ ] **Step 1: Read the current file end-to-end to make sure you understand every closure variable the animation loop touches**

Run: `Read /Users/ethan/Documents/Projects/engrams/apps/web/app/components/app/map/EngineGraph.tsx`
Expected: Identify every local variable the `animate()` function reads or writes. Key ones: `scene`, `camera`, `renderer`, `nodeGeo`, `nodePositions`, `edgeGeo`, `edgePositions`, `eSrc`, `eTgt`, `edgeCount`, `sigGeo`, `sigPos`, `sigEdge`, `sigPhase`, `sigSpeed`, `sigCount`, `nodeMat`, `edgeMat`, `sigMat`, `fadeCurrent`, `fadeTarget`, `neighbors`, `currentHovered`, `currentHoveredEdge`, `mouse`, `smoothMouse`, `ripple`, `panOffset`, `orbitTheta`, `orbitPhi`, `targetTheta`, `targetPhi`, `targetZ`, `currentZoom`, `isPanning`, `isOrbiting`, `panStart`, `orbitStart`, `basePos`, `driftOff`, `driftSpd`, `depthArr`.

- [ ] **Step 2: Define the `SceneState` interface at the top of EngineGraph.tsx (below the imports)**

Add after the `edgeTypeDisplay` constant and before `GraphLegend`:

```ts
import type { GraphBuffers } from "./reconcileGraph"
import { reconcileGraph } from "./reconcileGraph"

interface SceneState {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer

  // Materials — stable across data changes
  nodeMat: THREE.ShaderMaterial
  edgeMat: THREE.LineBasicMaterial
  sigMat: THREE.PointsMaterial

  // Meshes + geometries — rebuilt when node/edge count changes
  nodeMesh: THREE.Points
  nodeGeo: THREE.BufferGeometry
  edgeMesh: THREE.LineSegments
  edgeGeo: THREE.BufferGeometry
  sigMesh: THREE.Points | null
  sigGeo: THREE.BufferGeometry | null

  // Data buffers (produced by reconcileGraph)
  buffers: GraphBuffers

  // Signal particles — count depends on edgeCount, so these live here too
  sigCount: number
  sigPos: Float32Array
  sigEdge: Uint16Array
  sigPhase: Float32Array
  sigSpeed: Float32Array

  // Hover / interaction state
  currentHovered: number
  currentHoveredEdge: number
  mouse: { x: number; y: number; screenX: number; screenY: number }
  smoothMouse: { x: number; y: number }
  ripple: { x: number; y: number; time: number }

  // Camera navigation state
  panOffset: { x: number; y: number }
  panLimit: number
  panStart: { x: number; y: number }
  orbitTheta: number
  orbitPhi: number
  targetTheta: number
  targetPhi: number
  targetZ: number
  currentZoom: number
  minZoom: number
  maxZoom: number
  isPanning: boolean
  isOrbiting: boolean
  orbitStart: { x: number; y: number }

  // Lifecycle
  frameHandle: number
  disposed: boolean
}
```

- [ ] **Step 3: Add a `sceneRef`, latest-value refs, and a `sceneReady` flag inside the `EngineGraph` component**

Find the component body (currently starts around line 75):

```ts
export default function EngineGraph({ data, positions, engramSlug, onNodeClick, nodeVisible }: EngineGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const nodeVisibleRef = useRef<Uint8Array | null>(null)
```

Add immediately after `nodeVisibleRef`:

```ts
  const sceneRef = useRef<SceneState | null>(null)
  const dataRef = useRef<GraphData>(data)
  const positionsRef = useRef<Float32Array>(positions)
  const [sceneReady, setSceneReady] = useState(false)
  useEffect(() => { dataRef.current = data }, [data])
  useEffect(() => { positionsRef.current = positions }, [positions])
```

Why each one:
- `sceneRef` — holds the mutable `SceneState` that the animation loop and the reconcile effect both read/write.
- `dataRef` — lets the animation loop read fresh `data.nodes[i].title/tags/confidence` for tooltip rendering each frame without re-running the loop.
- `positionsRef` — lets `mountScene` apply an initial reconcile against whatever positions were current when the scene finally finished mounting (`ResizeObserver` is async, so by the time it fires, `positions` may have been updated).
- `sceneReady` — a React state flag that flips to `true` after `mountScene` completes. Including it in the reconcile effect's deps guarantees the reconcile re-fires once the scene exists — otherwise there's a race where reconcile runs before the `ResizeObserver` callback, hits an early `!sceneRef.current` return, and never re-runs.

- [ ] **Step 4: Verify the file still compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No new errors. (`sceneRef` and `dataRef` are declared but not yet used — that's intentional for this task.)

- [ ] **Step 5: Commit the scaffolding**

```bash
git add apps/web/app/components/app/map/EngineGraph.tsx
git commit -m "refactor(map): scaffold SceneState ref for upcoming effect split"
```

---

### Task 3: Split the `useEffect` into mount-phase and reconcile-phase effects

**Files:**
- Modify: `apps/web/app/components/app/map/EngineGraph.tsx`

The current main `useEffect` (around lines 93–108) depends on `[data, positions, engramSlug, handleNodeClick]`, which causes a full teardown on any data change. Replace it with two effects:

1. **Mount-phase effect** — depends only on container size + `engramSlug`. Runs once per mount. Builds scene, camera, renderer, materials, empty geometries, event listeners, and starts the animation loop. Stores everything in `sceneRef.current`.
2. **Reconcile-phase effect** — depends on `[data, positions]`. Runs on every data change. Calls `reconcileGraph(prev, data, positions)`, updates `sceneRef.current.buffers`, rebuilds node/edge geometries in place when counts change.

This task does the structural split; the next task handles the actual reconcile logic and the one after fills in the animation loop's use of the new buffers.

- [ ] **Step 1: Delete the existing main `useEffect` and `setup` function entirely**

Remove lines 93–624 of the current file (the block from `useEffect(() => { const container = containerRef.current...` through the end of `setup()` and its `return` cleanup — up to and including the closing brace of the `setup` function). Keep:
- Everything above line 93 (imports, helpers, `GraphLegend`, component signature, refs)
- The `handleNodeClick` callback (around lines 85–91)
- The JSX return (currently around lines 626–637)

After deletion, the component body should have no `useEffect` that references `setup`. It will temporarily render nothing interactive — this is expected.

- [ ] **Step 2: Add the mount-phase `useEffect`**

Paste this immediately after the `handleNodeClick` callback (and after the `sceneRef`/`dataRef` declarations from Task 2):

```ts
  // ── Mount-phase: build the scene once ──
  useEffect(() => {
    const container = containerRef.current
    const tooltip = tooltipRef.current
    if (!container || !tooltip) return

    let cleanup: (() => void) | undefined
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0 && !cleanup) {
        cleanup = mountScene(container, tooltip, width, height)
        observer.disconnect()
      }
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      cleanup?.()
    }
    // Intentionally only depends on engramSlug — scene survives data updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engramSlug])
```

- [ ] **Step 3: Add the reconcile-phase `useEffect`**

Paste immediately after the mount-phase effect:

```ts
  // ── Reconcile-phase: update buffers in place when data/positions change ──
  useEffect(() => {
    const state = sceneRef.current
    if (!sceneReady || !state || data.nodes.length === 0) return
    applyReconcile(state, data, positions)
  }, [sceneReady, data, positions])
```

The `sceneReady` dep matters: if `data` arrives before the `ResizeObserver` callback fires, this effect runs once with `sceneReady === false` and early-returns, then re-runs the moment the mount effect flips `sceneReady` to `true`.

`mountScene` and `applyReconcile` don't exist yet — you'll add them in the next two tasks. The effect bodies will currently fail to compile. That's OK; commit after implementing the functions.

- [ ] **Step 4: Verify the compile error is only about missing `mountScene`/`applyReconcile`**

Run: `cd apps/web && npx tsc --noEmit`
Expected: Errors of the form `Cannot find name 'mountScene'` and `Cannot find name 'applyReconcile'`. No other new errors.

**Do not commit yet** — the file is in a broken state. Commit happens at the end of Task 5 once the functions exist.

---

### Task 4: Implement `mountScene` — the one-shot scene builder

**Files:**
- Modify: `apps/web/app/components/app/map/EngineGraph.tsx`

Port the existing `setup()` logic into a new top-level helper function (outside the component) named `mountScene`. Changes from the original:
- It builds a Three.js scene + renderer + camera + materials + **empty** geometries (0 verts) and starts the animation loop.
- It does **not** populate any node/edge data — that's Task 5's `applyReconcile`.
- It stores everything into the `sceneRef` passed in via a closure.
- The animation loop reads from `state.buffers` each frame instead of from closure-local arrays.

- [ ] **Step 1: Add the `mountScene` function definition immediately above the `EngineGraph` component**

Paste this as a top-level function in `EngineGraph.tsx` (above `export default function EngineGraph(...)`):

```ts
// Inline ref shapes keep this function independent of React's type exports,
// which shifted between 18 and 19.
type RefLike<T> = { current: T }

function buildMountScene(
  sceneRef: RefLike<SceneState | null>,
  dataRef: RefLike<GraphData>,
  nodeVisibleRef: RefLike<Uint8Array | null>,
  handleNodeClick: (slug: string, sx: number, sy: number) => void,
) {
  return function mountScene(
    container: HTMLDivElement,
    tooltip: HTMLDivElement,
    initW: number,
    initH: number,
  ): () => void {
    // ── Scene / camera / renderer ──
    const scene = new THREE.Scene()
    const camZ = 400
    const camera = new THREE.PerspectiveCamera(55, initW / initH, 1, 3000)
    camera.position.set(0, 0, camZ)
    const renderer = new THREE.WebGLRenderer({ alpha: true, powerPreference: "high-performance" })
    renderer.setSize(initW, initH)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    container.appendChild(renderer.domElement)

    // ── Materials (stable across data changes) ──
    const nodeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uRippleOrigin: { value: new THREE.Vector2(0, 0) },
        uRippleTime: { value: -100.0 },
      },
      vertexShader: `
        attribute float aSize, aPhase, aFade;
        attribute vec3 aColor;
        uniform float uTime;
        uniform vec2 uMouse, uRippleOrigin;
        uniform float uRippleTime;
        varying float vPulse, vMouseProx, vDepth, vFade;
        varying vec3 vColor;

        void main() {
          float pulse = 0.85 + 0.15 * sin(uTime * 0.6 + aPhase);
          float dm = distance(position.xy, uMouse);
          float mg = smoothstep(300.0, 0.0, dm);
          vMouseProx = mg;
          pulse += mg * 0.7;

          if (uRippleTime >= 0.0 && uRippleTime < 4.0) {
            float dr = distance(position.xy, uRippleOrigin);
            pulse += smoothstep(80.0, 0.0, abs(dr - uRippleTime * 500.0)) * exp(-uRippleTime) * 1.5;
          }

          vPulse = clamp(pulse, 0.0, 1.4);
          vFade = aFade;
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDepth = smoothstep(-1400.0, -700.0, mv.z);
          gl_PointSize = aSize * (0.85 + vPulse * 0.3) * (500.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vPulse, vMouseProx, vDepth, vFade;
        varying vec3 vColor;

        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float core = exp(-d * 30.0);
          float a = (exp(-d * 2.5) * 0.06 + exp(-d * 5.0) * 0.18 + exp(-d * 12.0) * 0.5 + core) * vPulse * vDepth * vFade;
          vec3 col = mix(vColor * 0.7, vColor, core);
          col = mix(col, vec3(1.0, 0.98, 0.96), vMouseProx * 0.4);
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    const edgeMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.18 })
    const sigMat = new THREE.PointsMaterial({
      color: 0x999999, size: 2, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    })

    // ── Empty geometries (populated by applyReconcile) ──
    const nodeGeo = new THREE.BufferGeometry()
    const nodeMesh = new THREE.Points(nodeGeo, nodeMat)
    scene.add(nodeMesh)

    const edgeGeo = new THREE.BufferGeometry()
    const edgeMesh = new THREE.LineSegments(edgeGeo, edgeMat)
    scene.add(edgeMesh)

    // ── Initial SceneState ──
    const state: SceneState = {
      scene,
      camera,
      renderer,
      nodeMat,
      edgeMat,
      sigMat,
      nodeMesh,
      nodeGeo,
      edgeMesh,
      edgeGeo,
      sigMesh: null,
      sigGeo: null,
      buffers: {
        count: 0,
        edgeCount: 0,
        nodeColors: new Float32Array(0),
        sizes: new Float32Array(0),
        phases: new Float32Array(0),
        depthArr: new Float32Array(0),
        currentPos: new Float32Array(0),
        targetPos: new Float32Array(0),
        fadeCurrent: new Float32Array(0),
        fadeTarget: new Float32Array(0),
        eSrc: new Uint16Array(0),
        eTgt: new Uint16Array(0),
        edgeColors: new Float32Array(0),
        edgePositions: new Float32Array(0),
        slugs: [],
        slugToIndex: new Map(),
        neighbors: new Map(),
      },
      sigCount: 0,
      sigPos: new Float32Array(0),
      sigEdge: new Uint16Array(0),
      sigPhase: new Float32Array(0),
      sigSpeed: new Float32Array(0),
      currentHovered: -1,
      currentHoveredEdge: -1,
      mouse: { x: 0, y: 0, screenX: 0, screenY: 0 },
      smoothMouse: { x: 0, y: 0 },
      ripple: { x: 0, y: 0, time: -100 },
      panOffset: { x: 0, y: 0 },
      panLimit: 200,
      panStart: { x: 0, y: 0 },
      orbitTheta: 0,
      orbitPhi: 0,
      targetTheta: 0,
      targetPhi: 0,
      targetZ: camZ,
      currentZoom: camZ,
      minZoom: 80,
      maxZoom: camZ * 1.5,
      isPanning: false,
      isOrbiting: false,
      orbitStart: { x: 0, y: 0 },
      frameHandle: 0,
      disposed: false,
    }
    sceneRef.current = state

    // ── Input helpers ──
    const unprojVec = new THREE.Vector3()
    const projVec = new THREE.Vector3()

    const screenToWorld = (cx: number, cy: number) => {
      const rect = container.getBoundingClientRect()
      unprojVec
        .set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1, 0.5)
        .unproject(camera)
      const dir = unprojVec.sub(camera.position).normalize()
      const t = -camera.position.z / dir.z
      return { x: camera.position.x + dir.x * t, y: camera.position.y + dir.y * t }
    }

    const onMouseMove = (e: MouseEvent) => {
      const w = screenToWorld(e.clientX, e.clientY)
      state.mouse.x = w.x
      state.mouse.y = w.y
      state.mouse.screenX = e.clientX
      state.mouse.screenY = e.clientY
    }
    const onClick = (e: MouseEvent) => {
      if (state.currentHovered >= 0 && state.currentHovered < state.buffers.slugs.length) {
        handleNodeClick(state.buffers.slugs[state.currentHovered], e.clientX, e.clientY)
      } else {
        const w = screenToWorld(e.clientX, e.clientY)
        state.ripple.x = w.x
        state.ripple.y = w.y
        state.ripple.time = 0
      }
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      state.targetZ = Math.max(state.minZoom, Math.min(state.maxZoom, state.targetZ + e.deltaY * 0.5))
    }
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0 && state.currentHovered < 0) {
        state.isPanning = true
        state.panStart = { x: e.clientX, y: e.clientY }
      } else if (e.button === 2) {
        state.isOrbiting = true
        state.orbitStart = { x: e.clientX, y: e.clientY }
      }
    }
    const onMouseUp = () => { state.isPanning = false; state.isOrbiting = false }
    const onPanMove = (e: MouseEvent) => {
      if (state.isPanning) {
        const scale = state.currentZoom * 0.002
        const dx = -(e.clientX - state.panStart.x) * scale
        const dy = (e.clientY - state.panStart.y) * scale
        const cosT = Math.cos(state.orbitTheta)
        state.panOffset.x = Math.max(-state.panLimit, Math.min(state.panLimit, state.panOffset.x + dx * cosT))
        state.panOffset.y = Math.max(-state.panLimit, Math.min(state.panLimit, state.panOffset.y + dy))
        state.panStart = { x: e.clientX, y: e.clientY }
      }
      if (state.isOrbiting) {
        state.targetTheta -= (e.clientX - state.orbitStart.x) * 0.004
        state.targetPhi = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, state.targetPhi + (e.clientY - state.orbitStart.y) * 0.004))
        state.orbitStart = { x: e.clientX, y: e.clientY }
      }
    }
    const onContextMenu = (e: MouseEvent) => { e.preventDefault() }

    window.addEventListener("mousemove", onMouseMove, { passive: true })
    window.addEventListener("mousemove", onPanMove, { passive: true })
    window.addEventListener("click", onClick)
    container.addEventListener("wheel", onWheel, { passive: false })
    container.addEventListener("mousedown", onMouseDown)
    container.addEventListener("contextmenu", onContextMenu)
    window.addEventListener("mouseup", onMouseUp)

    // ── Animation loop ──
    let lastTime = performance.now()
    let frameToggle = false

    const animate = () => {
      if (state.disposed) return
      state.frameHandle = requestAnimationFrame(animate)
      const now = performance.now()
      const delta = (now - lastTime) * 0.001
      lastTime = now
      const elapsed = now * 0.001

      const { buffers } = state
      const count = buffers.count
      const edgeCount = buffers.edgeCount

      state.smoothMouse.x += (state.mouse.x - state.smoothMouse.x) * 0.06
      state.smoothMouse.y += (state.mouse.y - state.smoothMouse.y) * 0.06

      state.nodeMat.uniforms.uTime.value = elapsed
      state.nodeMat.uniforms.uMouse.value.set(state.smoothMouse.x, state.smoothMouse.y)

      if (state.ripple.time >= 0) {
        state.ripple.time += delta
        state.nodeMat.uniforms.uRippleOrigin.value.set(state.ripple.x, state.ripple.y)
        state.nodeMat.uniforms.uRippleTime.value = state.ripple.time
        if (state.ripple.time > 5) state.ripple.time = -100
      }

      // Camera orbit + drift
      const driftScale = Math.min(Math.max((count - 5) / 10, 0), 1)
      state.currentZoom += (state.targetZ - state.currentZoom) * 0.1
      state.orbitTheta += (state.targetTheta - state.orbitTheta) * 0.08
      state.orbitPhi += (state.targetPhi - state.orbitPhi) * 0.08

      const driftX = Math.sin(elapsed * 0.015) * 20 * driftScale
      const driftY = Math.cos(elapsed * 0.01) * 15 * driftScale
      state.camera.position.x = state.panOffset.x + driftX + state.currentZoom * Math.sin(state.orbitTheta) * Math.cos(state.orbitPhi)
      state.camera.position.y = state.panOffset.y + driftY + state.currentZoom * Math.sin(state.orbitPhi)
      state.camera.position.z = state.currentZoom * Math.cos(state.orbitTheta) * Math.cos(state.orbitPhi)
      state.camera.lookAt(state.panOffset.x, state.panOffset.y, 0)

      // ── Lerp currentPos → targetPos ──
      // Rate 6 matches fade (400ms to settle). delta * 6 is lerp step.
      if (count > 0) {
        const step = Math.min(delta * 6, 1)
        const cp = buffers.currentPos
        const tp = buffers.targetPos
        for (let i = 0; i < count * 3; i++) {
          cp[i] += (tp[i] - cp[i]) * step
        }
        state.nodeGeo.attributes.position.needsUpdate = true
      }

      // ── Hover detection ──
      let closest = -1
      let closestDist = 25
      const rect = container.getBoundingClientRect()
      const cp = buffers.currentPos
      for (let i = 0; i < count; i++) {
        const i3 = i * 3
        projVec.set(cp[i3], cp[i3 + 1], cp[i3 + 2]).project(state.camera)
        const sx = (projVec.x * 0.5 + 0.5) * rect.width + rect.left
        const sy = (-projVec.y * 0.5 + 0.5) * rect.height + rect.top
        const dist = Math.hypot(sx - state.mouse.screenX, sy - state.mouse.screenY)
        if (dist < closestDist) { closestDist = dist; closest = i }
      }

      // Edge hover
      let hoveredEdge = -1
      if (closest < 0 && edgeCount > 0) {
        let bestEdgeDist = 8
        for (let ei = 0; ei < edgeCount; ei++) {
          const s3 = buffers.eSrc[ei] * 3, t3 = buffers.eTgt[ei] * 3
          projVec.set(cp[s3], cp[s3 + 1], cp[s3 + 2]).project(state.camera)
          const sx1 = (projVec.x * 0.5 + 0.5) * rect.width + rect.left
          const sy1 = (-projVec.y * 0.5 + 0.5) * rect.height + rect.top
          projVec.set(cp[t3], cp[t3 + 1], cp[t3 + 2]).project(state.camera)
          const sx2 = (projVec.x * 0.5 + 0.5) * rect.width + rect.left
          const sy2 = (-projVec.y * 0.5 + 0.5) * rect.height + rect.top
          const dx = sx2 - sx1, dy = sy2 - sy1
          const len2 = dx * dx + dy * dy
          if (len2 < 1) continue
          const t2 = Math.max(0, Math.min(1, ((state.mouse.screenX - sx1) * dx + (state.mouse.screenY - sy1) * dy) / len2))
          const px = sx1 + t2 * dx, py = sy1 + t2 * dy
          const d2 = Math.hypot(state.mouse.screenX - px, state.mouse.screenY - py)
          if (d2 < bestEdgeDist) { bestEdgeDist = d2; hoveredEdge = ei }
        }
      }

      // Update hover fade targets
      if (closest !== state.currentHovered || hoveredEdge !== state.currentHoveredEdge) {
        state.currentHoveredEdge = hoveredEdge
        state.currentHovered = closest
        if (closest >= 0) {
          const nbs = buffers.neighbors.get(closest) ?? new Set<number>()
          const vis = nodeVisibleRef.current
          for (let i = 0; i < count; i++) {
            const filterOk = !vis || vis[i] === 1
            buffers.fadeTarget[i] = (i === closest || nbs.has(i)) ? 1.0 : (filterOk ? 0.08 : 0.02)
          }
          const i3 = closest * 3
          projVec.set(cp[i3], cp[i3 + 1], cp[i3 + 2]).project(state.camera)
          const tx = (projVec.x * 0.5 + 0.5) * rect.width
          const ty = (-projVec.y * 0.5 + 0.5) * rect.height
          tooltip.style.left = `${tx}px`
          tooltip.style.top = `${ty - 12}px`
          tooltip.style.opacity = "1"
          const node = dataRef.current.nodes[closest]
          if (node) {
            const conf = Math.round(node.confidence * 100)
            const tags = node.tags.slice(0, 3).join(", ")
            tooltip.innerHTML = `<span style="color:var(--color-text-emphasis)">${node.title}</span><br/><span style="font-family:var(--font-mono);font-size:9px;color:var(--color-text-ghost)">${conf}%${node.articleType !== "concept" ? " · " + node.articleType : ""}${tags ? " · " + tags : ""}</span>`
          }
          container.style.cursor = "pointer"
        } else if (hoveredEdge >= 0) {
          const edge = dataRef.current.edges[hoveredEdge]
          const fromNode = edge ? dataRef.current.nodes[edge.sourceIdx] : null
          const toNode = edge ? dataRef.current.nodes[edge.targetIdx] : null
          const s3 = buffers.eSrc[hoveredEdge] * 3, t3 = buffers.eTgt[hoveredEdge] * 3
          projVec.set(
            (cp[s3] + cp[t3]) / 2,
            (cp[s3 + 1] + cp[t3 + 1]) / 2,
            (cp[s3 + 2] + cp[t3 + 2]) / 2,
          ).project(state.camera)
          const tx = (projVec.x * 0.5 + 0.5) * rect.width
          const ty = (-projVec.y * 0.5 + 0.5) * rect.height
          tooltip.style.left = `${tx}px`
          tooltip.style.top = `${ty - 12}px`
          tooltip.style.opacity = "1"
          if (fromNode && toNode && edge) {
            tooltip.innerHTML = `<span style="font-family:var(--font-mono);font-size:10px;color:var(--color-text-secondary)">${fromNode.title} <span style="color:var(--color-text-ghost)">&mdash; ${edge.relation} &mdash;</span> ${toNode.title}</span>`
          }
          container.style.cursor = "default"
          const vis = nodeVisibleRef.current
          for (let i = 0; i < count; i++) {
            const filterOk = !vis || vis[i] === 1
            buffers.fadeTarget[i] = (i === buffers.eSrc[hoveredEdge] || i === buffers.eTgt[hoveredEdge]) ? 1.0 : (filterOk ? 0.12 : 0.02)
          }
        } else {
          const vis = nodeVisibleRef.current
          for (let i = 0; i < count; i++) buffers.fadeTarget[i] = (!vis || vis[i] === 1) ? 1.0 : 0.04
          tooltip.style.opacity = "0"
          container.style.cursor = "default"
        }
      }

      // Filter update when not hovering
      if (state.currentHovered < 0) {
        const vis = nodeVisibleRef.current
        for (let i = 0; i < count; i++) buffers.fadeTarget[i] = (!vis || vis[i] === 1) ? 1.0 : 0.04
      }

      // Lerp fade values
      for (let i = 0; i < count; i++) {
        buffers.fadeCurrent[i] += (buffers.fadeTarget[i] - buffers.fadeCurrent[i]) * Math.min(delta * 6, 1)
      }
      if (count > 0) state.nodeGeo.attributes.aFade.needsUpdate = true

      // Update edge positions from currentPos (every other frame to save work)
      frameToggle = !frameToggle
      if (frameToggle && edgeCount > 0) {
        const ep = buffers.edgePositions
        for (let e = 0; e < edgeCount; e++) {
          const s3 = buffers.eSrc[e] * 3, t3 = buffers.eTgt[e] * 3, o = e * 6
          ep[o] = cp[s3]
          ep[o + 1] = cp[s3 + 1]
          ep[o + 2] = cp[s3 + 2]
          ep[o + 3] = cp[t3]
          ep[o + 4] = cp[t3 + 1]
          ep[o + 5] = cp[t3 + 2]
        }
        state.edgeGeo.attributes.position.needsUpdate = true
      }

      // Signal particles
      if (state.sigGeo && state.sigCount > 0 && edgeCount > 0) {
        for (let i = 0; i < state.sigCount; i++) {
          state.sigPhase[i] += delta * state.sigSpeed[i]
          if (state.sigPhase[i] > 1) {
            state.sigPhase[i] = 0
            state.sigEdge[i] = Math.floor(Math.random() * edgeCount)
          }
          const s3 = buffers.eSrc[state.sigEdge[i]] * 3, t3 = buffers.eTgt[state.sigEdge[i]] * 3
          const p = state.sigPhase[i], i3 = i * 3
          state.sigPos[i3] = cp[s3] + (cp[t3] - cp[s3]) * p
          state.sigPos[i3 + 1] = cp[s3 + 1] + (cp[t3 + 1] - cp[s3 + 1]) * p
          state.sigPos[i3 + 2] = cp[s3 + 2] + (cp[t3 + 2] - cp[s3 + 2]) * p
        }
        state.sigGeo.attributes.position.needsUpdate = true
      }

      state.edgeMat.opacity = 0.14 + Math.sin(elapsed * 0.5) * 0.06
      state.renderer.render(state.scene, state.camera)
    }
    animate()

    // ── Resize ──
    const onResize = () => {
      const w = container.clientWidth, h = container.clientHeight
      if (w === 0 || h === 0) return
      state.camera.aspect = w / h
      state.camera.updateProjectionMatrix()
      state.renderer.setSize(w, h)
    }
    window.addEventListener("resize", onResize)

    return () => {
      state.disposed = true
      cancelAnimationFrame(state.frameHandle)
      window.removeEventListener("resize", onResize)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mousemove", onPanMove)
      window.removeEventListener("click", onClick)
      window.removeEventListener("mouseup", onMouseUp)
      container.removeEventListener("wheel", onWheel)
      container.removeEventListener("mousedown", onMouseDown)
      container.removeEventListener("contextmenu", onContextMenu)
      state.edgeGeo.dispose(); state.edgeMat.dispose()
      state.nodeGeo.dispose(); state.nodeMat.dispose()
      state.sigGeo?.dispose(); state.sigMat.dispose()
      state.renderer.dispose()
      if (container.contains(state.renderer.domElement)) container.removeChild(state.renderer.domElement)
      sceneRef.current = null
    }
  }
}
```

- [ ] **Step 2: Wire `buildMountScene` into the mount-phase effect**

Replace the mount-phase effect body (from Task 3, Step 2) so it calls `buildMountScene` and flips `sceneReady` when mounting completes:

```ts
  // ── Mount-phase: build the scene once ──
  useEffect(() => {
    const container = containerRef.current
    const tooltip = tooltipRef.current
    if (!container || !tooltip) return

    const mountScene = buildMountScene(sceneRef, dataRef, nodeVisibleRef, handleNodeClick)
    let cleanup: (() => void) | undefined
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0 && !cleanup) {
        cleanup = mountScene(container, tooltip, width, height)
        setSceneReady(true)
        observer.disconnect()
      }
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      cleanup?.()
      setSceneReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engramSlug])
```

The `handleNodeClick` dep is intentionally ignored — it's a `useCallback` that depends on `router`/`engramSlug`/`onNodeClick`, so we'd tear down the scene whenever any of those change. For this map, `engramSlug` is the only one that matters; the others are stable within a given map page lifetime. The cleanup `setSceneReady(false)` ensures a remount cycle starts from a clean state.

- [ ] **Step 3: Verify TypeScript is only complaining about missing `applyReconcile`**

Run: `cd apps/web && npx tsc --noEmit`
Expected: Only error is `Cannot find name 'applyReconcile'`. No other new errors.

---

### Task 5: Implement `applyReconcile` — update buffers on data change

**Files:**
- Modify: `apps/web/app/components/app/map/EngineGraph.tsx`

`applyReconcile` is the bridge between `reconcileGraph` (pure) and Three.js. It:
1. Calls `reconcileGraph(state.buffers, data, positions)` to get the new buffers.
2. Replaces `state.buffers` with the result.
3. Tears down the old node/edge geometries and builds fresh ones backed by the new Float32Arrays — the new `Float32Array` instances aren't the same memory, so we can't just mark `needsUpdate = true`; we have to `setAttribute` fresh buffers.
4. Rebuilds the signal particles allocation if `edgeCount` changed.
5. Resets `currentHovered` if the hovered node is gone (prevents stale tooltips).

- [ ] **Step 1: Add `applyReconcile` as a top-level helper**

Paste this immediately above the `EngineGraph` component (next to `buildMountScene`):

```ts
function applyReconcile(state: SceneState, data: GraphData, positions: Float32Array) {
  const next = reconcileGraph(state.buffers, data, positions)
  state.buffers = next

  // ── Rebuild node geometry with the new buffers ──
  state.scene.remove(state.nodeMesh)
  state.nodeGeo.dispose()
  const nodeGeo = new THREE.BufferGeometry()
  nodeGeo.setAttribute("position", new THREE.BufferAttribute(next.currentPos, 3))
  nodeGeo.setAttribute("aSize", new THREE.BufferAttribute(next.sizes, 1))
  nodeGeo.setAttribute("aPhase", new THREE.BufferAttribute(next.phases, 1))
  nodeGeo.setAttribute("aFade", new THREE.BufferAttribute(next.fadeCurrent, 1))
  nodeGeo.setAttribute("aColor", new THREE.BufferAttribute(next.nodeColors, 3))
  const nodeMesh = new THREE.Points(nodeGeo, state.nodeMat)
  state.scene.add(nodeMesh)
  state.nodeGeo = nodeGeo
  state.nodeMesh = nodeMesh

  // ── Rebuild edge geometry ──
  state.scene.remove(state.edgeMesh)
  state.edgeGeo.dispose()
  const edgeGeo = new THREE.BufferGeometry()
  edgeGeo.setAttribute("position", new THREE.BufferAttribute(next.edgePositions, 3))
  edgeGeo.setAttribute("color", new THREE.BufferAttribute(next.edgeColors, 3))
  const edgeMesh = new THREE.LineSegments(edgeGeo, state.edgeMat)
  state.scene.add(edgeMesh)
  state.edgeGeo = edgeGeo
  state.edgeMesh = edgeMesh

  // ── Signal particles — allocate once, resize when edge count grows ──
  const desiredSigCount = Math.min(next.edgeCount * 2, 60)
  if (desiredSigCount !== state.sigCount) {
    if (state.sigMesh) {
      state.scene.remove(state.sigMesh)
      state.sigGeo?.dispose()
      state.sigMesh = null
      state.sigGeo = null
    }
    state.sigCount = desiredSigCount
    state.sigPos = new Float32Array(desiredSigCount * 3)
    state.sigEdge = new Uint16Array(desiredSigCount)
    state.sigPhase = new Float32Array(desiredSigCount)
    state.sigSpeed = new Float32Array(desiredSigCount)
    for (let i = 0; i < desiredSigCount; i++) {
      state.sigEdge[i] = Math.floor(Math.random() * Math.max(next.edgeCount, 1))
      state.sigPhase[i] = Math.random()
      state.sigSpeed[i] = 0.15 + Math.random() * 0.25
    }
    if (desiredSigCount > 0 && next.edgeCount > 0) {
      const sigGeo = new THREE.BufferGeometry()
      sigGeo.setAttribute("position", new THREE.BufferAttribute(state.sigPos, 3))
      const sigMesh = new THREE.Points(sigGeo, state.sigMat)
      state.scene.add(sigMesh)
      state.sigGeo = sigGeo
      state.sigMesh = sigMesh
    }
  }

  // ── Recompute pan limit + zoom extents based on new graph radius ──
  let graphRadius = 1
  for (let i = 0; i < next.count; i++) {
    const r = Math.sqrt(next.targetPos[i * 3] ** 2 + next.targetPos[i * 3 + 1] ** 2)
    if (r > graphRadius) graphRadius = r
  }
  state.panLimit = graphRadius * 1.2
  const camZ = 300 + Math.min(next.count * 5, 600)
  state.maxZoom = camZ * 1.5
  state.minZoom = Math.max(camZ * 0.15, 80)
  // Only clamp the live target — don't snap the current zoom (feels jarring).
  state.targetZ = Math.max(state.minZoom, Math.min(state.maxZoom, state.targetZ))

  // ── Reset hover state if the hovered node no longer exists ──
  if (state.currentHovered >= next.count) state.currentHovered = -1
  if (state.currentHoveredEdge >= next.edgeCount) state.currentHoveredEdge = -1
}
```

- [ ] **Step 2: Run tsc to confirm all errors are gone**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors in `EngineGraph.tsx` or `reconcileGraph.ts`. Existing unrelated errors elsewhere are out of scope.

- [ ] **Step 3: Run lint to catch any obvious issues**

Run: `cd apps/web && npm run lint -- apps/web/app/components/app/map/`
Expected: No errors in the map directory. Unused variable warnings are acceptable but should be resolved if trivial.

- [ ] **Step 4: Commit the refactor**

```bash
git add apps/web/app/components/app/map/EngineGraph.tsx apps/web/app/components/app/map/reconcileGraph.ts
git commit -m "feat(map): animate data changes via persistent scene + reconciler"
```

---

### Task 6: Playwright smoke test — verify nothing regressed

**Files:**
- No file changes. This task runs the dev server and exercises the map via Playwright MCP.

- [ ] **Step 1: Start the Next.js dev server in the background**

Run: `cd apps/web && npm run dev` (with `run_in_background: true`)
Expected: Server starts and listens on `http://localhost:3000`. No build errors.

- [ ] **Step 2: Navigate to an engram with existing articles and open the map**

Use the Playwright MCP tool `mcp__plugin_playwright_playwright__browser_navigate` to go to `http://localhost:3000/app/<slug>/map` where `<slug>` is an engram that already has a handful of articles. Ask the user for the slug if unsure.

- [ ] **Step 3: Take a snapshot of the initial map**

Use `mcp__plugin_playwright_playwright__browser_snapshot` and confirm the map canvas renders, the article-count pill at the top reads a plausible number, and no console errors are reported.

- [ ] **Step 4: Capture console messages**

Use `mcp__plugin_playwright_playwright__browser_console_messages` and verify no new errors.
Expected: No `three.js` warnings about disposed resources, no `attributes.position` errors.

- [ ] **Step 5: Take a screenshot for visual comparison**

Use `mcp__plugin_playwright_playwright__browser_take_screenshot` with a descriptive filename (e.g. `map-before-feed.png`).

- [ ] **Step 6: Report findings to the user**

Write a short paragraph summarizing: did the map load, did the node/edge counts match expectations, were there any console errors. Do NOT claim the animation works — that requires feeding a new source and visually comparing frames, which is a human QA step (Step 7).

- [ ] **Step 7: Ask the user to manually feed a source and report whether the map animates**

Give the user these instructions verbatim:
> "Please open `http://localhost:3000/app/<slug>` in your browser, go to the `/map` route, open a second tab with the same engram, and use AddSourceButton to feed a short URL (e.g. a Wikipedia article). Watch the map tab during compilation. You should see new nodes fade in at their positions and the existing nodes gently shift as the layout settles — no full flicker or black frame. Let me know what you see."

- [ ] **Step 8: If the user reports regressions, debug and iterate; otherwise commit anything outstanding**

If the animation doesn't work as expected, start by checking:
- Browser console for runtime errors
- Whether `applyReconcile` is being called (add a `console.log` at the top of the function)
- Whether `currentPos` and `targetPos` differ after reconcile (log their first 6 values)
- Whether the animation loop is still running (look for `state.disposed` being true unexpectedly)

If everything works, there's nothing to commit — Task 5 already committed the implementation.

---

### Task 7: Self-review and cleanup

**Files:**
- Modify: `apps/web/app/components/app/map/EngineGraph.tsx` (possibly)

- [ ] **Step 1: Re-read EngineGraph.tsx end-to-end**

Check for:
- Leftover references to `basePos`, `nodePositions` (the old local), or `setup` — these should all be gone.
- Unused `driftOff` / `driftSpd` arrays — if they're not referenced anywhere, delete them (they were dead code even before this refactor).
- Inconsistent use of `state.currentHovered` vs a local `currentHovered` variable.

- [ ] **Step 2: Remove any dead code found in Step 1**

Apply edits. Re-run `npx tsc --noEmit` after each edit.

- [ ] **Step 3: Final build check**

Run: `cd apps/web && npm run build`
Expected: Clean build. Production bundle succeeds.

- [ ] **Step 4: Commit cleanup if any was needed**

```bash
git add apps/web/app/components/app/map/EngineGraph.tsx
git commit -m "chore(map): remove dead code after reconciler refactor"
```

---

## Rollback Strategy

If the animation causes visual regressions or performance issues that can't be fixed in-session, `git revert <commit-range>` of the three feat/refactor commits restores the old scene-teardown behavior. The pure `reconcileGraph.ts` file can be kept (it's dormant without the EngineGraph changes).

## Performance Notes

Rebuilding node + edge `BufferGeometry` instances on every data change is a few allocations and `setAttribute` calls — microseconds even at 1000+ nodes. It happens once per Realtime event, not per frame. The per-frame cost stays the same as before: one `for (let i = 0; i < count * 3; i++)` position lerp (trivial), one fade lerp (unchanged), edge-position rebuild every other frame (unchanged). No measurable regression is expected up to ~2000 nodes; past that, we'd want to reuse geometry attributes with growable pools instead of rebuilding.
