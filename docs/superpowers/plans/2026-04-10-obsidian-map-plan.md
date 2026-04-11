# Obsidian-Inspired Map Behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the animated map so it feels like Obsidian's graph view — adds cause a local soft ripple, deletes cause a local soft collapse, clusters are balanced and readable, and new nodes glow and draw the camera if they'd otherwise be hidden.

**Architecture:** All changes layer on top of the reconciler we shipped in PR #1 (2026-04-10). `useForceLayout` becomes change-aware (diffs against cache, marks direct neighbors for ripple), `reconcileGraph` gains an attention buffer, `EngineGraph` gets a shader attribute for glow and a pan state machine for off-screen attention, and a new `lib/map-viewport-bounds.ts` becomes the single source of truth for the safe viewport rectangle.

**Tech Stack:** Next.js 16 App Router, TypeScript, Three.js r183 (custom shader), d3-force 3.

**Spec:** [2026-04-10-obsidian-map-design.md](../specs/2026-04-10-obsidian-map-design.md)

---

## File Structure

**Create:**
- `apps/web/lib/map-viewport-bounds.ts` — safe viewport constants + pure helpers

**Modify:**
- `apps/web/app/components/app/map/useForceLayout.ts` — neighbor detection, ripple/collapse, cluster tuning, safe-viewport scale, return `{ positions, meta }`
- `apps/web/app/components/app/map/reconcileGraph.ts` — accept `meta`, add `attention` to `GraphBuffers`
- `apps/web/app/components/app/map/EngineGraph.tsx` — `aAttention` shader attribute, decay in animation loop, pan state machine, `container` field in `SceneState`
- `apps/web/app/app/[engram]/page.tsx` — destructure `layoutResult`, pass `layoutMeta` to `EngineGraph`
- `apps/web/app/app/[engram]/map/page.tsx` — same destructure + prop pass
- `apps/web/app/components/app/NodeCard.tsx` — import constants from `map-viewport-bounds.ts`

**Testing approach:** No unit test runner in the repo. Verification is (a) `npx tsc --noEmit` clean per task, (b) final `npm run build`, (c) Playwright smoke tests against the dev server at `http://localhost:3000/app/coffee/map`, (d) manual user QA for the subjective "feel" bits (cluster spacing, ripple intensity, glow brightness, pan dwell).

---

### Task 1: Extract shared viewport bounds helper

**Files:**
- Create: `apps/web/lib/map-viewport-bounds.ts`
- Modify: `apps/web/app/components/app/NodeCard.tsx`

This is a pure refactor — no behavior change. `NodeCard` currently hard-codes the widget-layout constants inline; we move them to a shared module so `useForceLayout` (Task 5) and `EngineGraph` (Task 6) can import from the same source of truth.

- [ ] **Step 1: Create the new file with constants and helpers**

Create `apps/web/lib/map-viewport-bounds.ts`:

```ts
// Widget layout constants matched to the current engram view.
// SourceTree sits top-left (~260px wide + gutter), AgentTimeline sits
// top-right (~200px wide + gutter), ViewToggle pill is ~60px tall at
// the top, AskBar is ~160px tall at the bottom. Any layout/camera
// work that cares about "what's actually visible to the user" should
// import from this file.

export const SOURCE_TREE_RIGHT_EDGE = 296
export const AGENT_TIMELINE_LEFT_EDGE = 224
export const TOP_RESERVED = 60
export const BOTTOM_RESERVED = 160

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

export function getSafeViewport(windowWidth: number, windowHeight: number): SafeViewport {
  const left = SOURCE_TREE_RIGHT_EDGE
  const right = Math.max(left, windowWidth - AGENT_TIMELINE_LEFT_EDGE)
  const top = TOP_RESERVED
  const bottom = Math.max(top, windowHeight - BOTTOM_RESERVED)
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  }
}

export function isInSafeViewport(
  screenX: number,
  screenY: number,
  safe: SafeViewport,
): boolean {
  return (
    screenX >= safe.left &&
    screenX <= safe.right &&
    screenY >= safe.top &&
    screenY <= safe.bottom
  )
}
```

- [ ] **Step 2: Refactor NodeCard to import the constants**

Edit `apps/web/app/components/app/NodeCard.tsx`. Replace the block at the top that defines `SOURCE_TREE_RIGHT_EDGE`, `AGENT_TIMELINE_LEFT_EDGE`, `TOP_RESERVED`, `BOTTOM_RESERVED` with an import, and delete those four `const` declarations. Keep `CARD_WIDTH`, `CARD_HEIGHT`, and `ANCHOR_GAP` — those are NodeCard-specific and stay.

Find the existing imports near the top (around lines 1–7):

```ts
"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { deleteArticle } from "@/lib/delete-article"
import ArticleContent from "./ArticleContent"
```

Add this import after the `deleteArticle` import:

```ts
import {
  SOURCE_TREE_RIGHT_EDGE,
  AGENT_TIMELINE_LEFT_EDGE,
  TOP_RESERVED,
  BOTTOM_RESERVED,
} from "@/lib/map-viewport-bounds"
```

Then find and delete these four lines (they're in the block around lines 22–27):

```ts
const SOURCE_TREE_RIGHT_EDGE = 296   // SourceTree widget at top-3 left-3, ~260px wide + gutter
const AGENT_TIMELINE_LEFT_EDGE = 224 // AgentTimeline widget at top-3 right-3, ~200px wide + gutter
const TOP_RESERVED = 60              // ViewToggle pill area
const BOTTOM_RESERVED = 160          // AskBar at bottom-10
```

The `CARD_WIDTH`, `CARD_HEIGHT`, and `ANCHOR_GAP` constants in the same block stay in `NodeCard.tsx` untouched.

- [ ] **Step 3: Verify the file compiles**

Run from `/Users/ethan/Documents/Projects/engrams/.worktrees/obsidian-map-plan/apps/web` (or the plan's worktree root):

```bash
npx tsc --noEmit
```

Expected: exit 0. No errors in `NodeCard.tsx` or `map-viewport-bounds.ts`. Pre-existing warnings in other files are out of scope.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/map-viewport-bounds.ts apps/web/app/components/app/NodeCard.tsx
git commit -m "$(cat <<'EOF'
refactor(map): extract safe viewport constants into shared helper

NodeCard had the widget layout constants inline. Move them to
lib/map-viewport-bounds.ts so the force layout scale and the camera
off-screen detection logic (upcoming tasks) can read from one source.
Pure refactor — NodeCard behavior is unchanged.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add `LayoutMeta` type and neighbor detection to `useForceLayout`

**Files:**
- Modify: `apps/web/app/components/app/map/useForceLayout.ts`

This task introduces the `LayoutMeta` type, computes `newSlugs`/`rippleSlugs`/`removedSlugs` from the cache diff, and updates the return type. **It does NOT yet use the ripple detection to change pinning behavior and does NOT apply cluster tuning.** Those come in Task 5 so we can land the plumbing first, verify compile, then add the visible behavior.

- [ ] **Step 1: Add the `LayoutMeta` type + `prevAdjacency` ref + neighbor computation**

Replace the entire contents of `apps/web/app/components/app/map/useForceLayout.ts` with:

```ts
/* eslint-disable react-hooks/refs -- this hook deliberately uses refs as
   cross-render caches for force-layout positions, adjacency, and scale
   so that new data doesn't retrigger the full simulation. The React 19
   rule is aware that ref access inside useMemo is unusual but here it's
   the intended behavior. */
import { useMemo, useRef } from "react"
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type SimulationNodeDatum, type SimulationLinkDatum } from "d3-force"
import type { GraphData } from "./useGraphData"

interface ForceNode extends SimulationNodeDatum {
  index: number
  slug: string
}

interface LayoutScale {
  maxR: number
  targetRadius: number
  yOffset: number
}

// Metadata about what changed from the previous layout pass. The animation
// layer uses this to drive attention effects (glow on new nodes, pan on
// off-screen new nodes) and to decide which existing nodes should be
// temporarily un-pinned so a ripple motion can play out.
export interface LayoutMeta {
  newSlugs: Set<string>
  rippleSlugs: Set<string>
}

export interface LayoutResult {
  positions: Float32Array
  meta: LayoutMeta
}

export function useForceLayout(
  data: GraphData | null,
  width: number,
  height: number,
): LayoutResult | null {
  // Cache previous positions (in normalized simulation space, pre-scale)
  // by slug so existing nodes don't jump on refresh.
  const prevPositions = useRef<Map<string, { x: number; y: number }>>(new Map())
  // Cache the adjacency of the PREVIOUS layout so we can compute the
  // direct neighbors of nodes that were just removed — those are gone
  // from the new data.edges by the time we run this diff.
  const prevAdjacency = useRef<Map<string, Set<string>>>(new Map())
  // Cache the scale from the FIRST layout. Reusing it means adding a node
  // never rescales the whole graph — existing nodes stay exactly where they
  // were, and new nodes slot in at the same world-space density.
  const scaleRef = useRef<LayoutScale | null>(null)

  return useMemo(() => {
    if (!data || data.nodes.length === 0) return null

    const prev = prevPositions.current
    const prevAdj = prevAdjacency.current
    const isRefresh = prev.size > 0

    // ── Diff against the cached layout to identify what changed ──
    const newSlugs = new Set<string>()
    const removedSlugs = new Set<string>()
    const currentSlugs = new Set<string>()
    for (const n of data.nodes) {
      currentSlugs.add(n.slug)
      if (isRefresh && !prev.has(n.slug)) newSlugs.add(n.slug)
    }
    if (isRefresh) {
      for (const slug of prev.keys()) {
        if (!currentSlugs.has(slug)) removedSlugs.add(slug)
      }
    }

    // rippleSlugs = direct neighbors of anything that was just added or
    // removed. For new nodes we look at the NEW edges; for removed nodes
    // we look at the cached adjacency (their edges are gone from data).
    const rippleSlugs = new Set<string>()
    if (newSlugs.size > 0) {
      for (const e of data.edges) {
        const fromSlug = data.nodes[e.sourceIdx]?.slug
        const toSlug = data.nodes[e.targetIdx]?.slug
        if (!fromSlug || !toSlug) continue
        if (newSlugs.has(fromSlug) && !newSlugs.has(toSlug)) rippleSlugs.add(toSlug)
        if (newSlugs.has(toSlug) && !newSlugs.has(fromSlug)) rippleSlugs.add(fromSlug)
      }
    }
    if (removedSlugs.size > 0) {
      for (const slug of removedSlugs) {
        const neighbors = prevAdj.get(slug)
        if (!neighbors) continue
        for (const neighbor of neighbors) {
          if (currentSlugs.has(neighbor)) rippleSlugs.add(neighbor)
        }
      }
    }

    const nodes: ForceNode[] = data.nodes.map((n, i) => {
      const cached = prev.get(n.slug)
      if (isRefresh && cached) {
        // Pin existing nodes hard (fx/fy) so the simulation only moves new
        // ones. Without this, every tick nudges the whole layout around
        // the new node's repulsion and the entire map drifts.
        // NOTE: Task 5 will exempt rippleSlugs from pinning so they can
        // react to adds/deletes. For now everyone except new nodes is
        // still pinned — metadata is computed but not yet consumed.
        return {
          index: i,
          slug: n.slug,
          x: cached.x,
          y: cached.y,
          fx: cached.x,
          fy: cached.y,
        }
      }
      return {
        index: i,
        slug: n.slug,
        x: cached?.x,
        y: cached?.y,
      }
    })

    const links: SimulationLinkDatum<ForceNode>[] = data.edges.map((e) => ({
      source: e.sourceIdx,
      target: e.targetIdx,
    }))

    const nodeCount = nodes.length
    const repulsion = -20 - Math.min(nodeCount, 60)

    const simulation = forceSimulation(nodes)
      .force("link", forceLink(links).distance(25).strength(0.7))
      .force("charge", forceManyBody().strength(repulsion))
      .force("center", forceCenter(0, 0).strength(0.4))
      .force("collide", forceCollide().radius((_, i) => 18 + data.nodes[i].depth * 10).strength(1))
      .stop()

    // On refresh, only new nodes can move (existing are pinned), so fewer
    // ticks are plenty. On initial build, run the full simulation.
    const ticks = isRefresh ? 40 : Math.min(300, 100 + nodeCount * 2)
    for (let i = 0; i < ticks; i++) {
      simulation.tick()
    }

    // Establish the scale on first layout and never change it.
    if (!scaleRef.current) {
      let maxR = 1
      for (const node of nodes) {
        const r = Math.sqrt((node.x ?? 0) ** 2 + (node.y ?? 0) ** 2)
        if (r > maxR) maxR = r
      }
      scaleRef.current = {
        maxR,
        targetRadius: 100 + Math.min(nodeCount * 3, 150),
        yOffset: 15,
      }
    }

    const { maxR, targetRadius, yOffset } = scaleRef.current

    const positions = new Float32Array(nodeCount * 2)
    const newCache = new Map<string, { x: number; y: number }>()

    for (let i = 0; i < nodeCount; i++) {
      const rawX = nodes[i].x ?? 0
      const rawY = nodes[i].y ?? 0
      positions[i * 2] = (rawX / maxR) * targetRadius
      positions[i * 2 + 1] = (rawY / maxR) * targetRadius + yOffset
      newCache.set(nodes[i].slug, { x: rawX, y: rawY })
    }

    // Rebuild adjacency cache from the NEW edges so the next layout pass
    // can compute rippleSlugs for any nodes deleted in the future.
    const newAdjacency = new Map<string, Set<string>>()
    for (const n of data.nodes) newAdjacency.set(n.slug, new Set())
    for (const e of data.edges) {
      const fromSlug = data.nodes[e.sourceIdx]?.slug
      const toSlug = data.nodes[e.targetIdx]?.slug
      if (!fromSlug || !toSlug) continue
      newAdjacency.get(fromSlug)?.add(toSlug)
      newAdjacency.get(toSlug)?.add(fromSlug)
    }

    prevPositions.current = newCache
    prevAdjacency.current = newAdjacency

    return {
      positions,
      meta: { newSlugs, rippleSlugs },
    }
  }, [data, width, height])
}
```

- [ ] **Step 2: Verify the file compiles on its own**

```bash
npx tsc --noEmit
```

Expected: errors pointing at `useForceLayout` call sites in `page.tsx` files (because they expect the old `Float32Array | null` return type). That's intended — Task 3 fixes the call sites.

- [ ] **Do NOT commit yet.** The tree is in a broken state between Task 2 and Task 3. Commit at the end of Task 3.

---

### Task 3: Update call sites to use `LayoutResult`

**Files:**
- Modify: `apps/web/app/app/[engram]/page.tsx`
- Modify: `apps/web/app/app/[engram]/map/page.tsx`
- Modify: `apps/web/app/components/app/map/EngineGraph.tsx`

Teach every consumer of `useForceLayout` how to destructure the new return type, and add the `layoutMeta` prop to `EngineGraph`. **The prop is accepted but not yet consumed** — Task 4 initializes attention from it; Task 5 uses it for ripple unpinning.

- [ ] **Step 1: Update the dashboard page**

Open `apps/web/app/app/[engram]/page.tsx`. Find the existing call site around line 218:

```ts
const { data: graphData, loading, error: graphError } = useGraphData(engramId)
```

(and shortly below that, the `useForceLayout` call). Locate the line:

```ts
const positions = useForceLayout(graphData, 1200, 800)
```

Replace it with:

```ts
const layoutResult = useForceLayout(graphData, 1200, 800)
const positions = layoutResult?.positions
const layoutMeta = layoutResult?.meta
```

Then find the `<EngineGraph ... />` call (around line 364) and add the `layoutMeta` prop. The current JSX looks like:

```tsx
{view === "graph" && (
  graphData && positions ? (
    <div className="w-full h-full" style={{ animation: "graph-ignite 1.2s ease-out both" }}>
      <EngineGraph
        data={graphData}
        positions={positions}
        engramSlug={engramSlug}
        onNodeClick={handleNodeClick}
        nodeVisible={nodeVisible}
      />
      ...
```

Change the condition to also guard on `layoutMeta`, and add the prop:

```tsx
{view === "graph" && (
  graphData && positions && layoutMeta ? (
    <div className="w-full h-full" style={{ animation: "graph-ignite 1.2s ease-out both" }}>
      <EngineGraph
        data={graphData}
        positions={positions}
        layoutMeta={layoutMeta}
        engramSlug={engramSlug}
        onNodeClick={handleNodeClick}
        nodeVisible={nodeVisible}
      />
      ...
```

Leave the rest of the JSX untouched.

- [ ] **Step 2: Update the standalone map page**

Open `apps/web/app/app/[engram]/map/page.tsx`. Find and replace:

```ts
const positions = useForceLayout(data, 1200, 800)

if (loading || !data || !positions) {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <p className="text-xs font-mono text-text-ghost">
        {loading ? "Loading graph..." : "No articles yet. Feed sources to see the map."}
      </p>
    </div>
  )
}
```

with:

```ts
const layoutResult = useForceLayout(data, 1200, 800)

if (loading || !data || !layoutResult) {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <p className="text-xs font-mono text-text-ghost">
        {loading ? "Loading graph..." : "No articles yet. Feed sources to see the map."}
      </p>
    </div>
  )
}

const { positions, meta: layoutMeta } = layoutResult
```

Then update the `<EngineGraph ... />` call at the bottom of the file. Find:

```tsx
<EngineGraph data={data} positions={positions} engramSlug={engramSlug} />
```

Replace with:

```tsx
<EngineGraph data={data} positions={positions} layoutMeta={layoutMeta} engramSlug={engramSlug} />
```

- [ ] **Step 3: Add the `layoutMeta` prop to `EngineGraph`**

Open `apps/web/app/components/app/map/EngineGraph.tsx`. Update the import from `./reconcileGraph` to also bring in `LayoutMeta` from `./useForceLayout`:

Find the imports at the top (around lines 1–13):

```ts
"use client"

import { useRef, useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import * as THREE from "three"
import type { GraphData } from "./useGraphData"
import { ARTICLE_TYPE_META, type ArticleType } from "@/lib/article-types"
import type { GraphBuffers } from "./reconcileGraph"
import { reconcileGraph } from "./reconcileGraph"
```

Add the import immediately after the `GraphData` type import:

```ts
import type { GraphData } from "./useGraphData"
import type { LayoutMeta } from "./useForceLayout"
```

Then update the `EngineGraphProps` interface (around line 15):

```ts
interface EngineGraphProps {
  data: GraphData
  positions: Float32Array
  engramSlug: string
  onNodeClick?: (slug: string, x: number, y: number) => void
  nodeVisible?: Uint8Array | null
}
```

to:

```ts
interface EngineGraphProps {
  data: GraphData
  positions: Float32Array
  layoutMeta: LayoutMeta
  engramSlug: string
  onNodeClick?: (slug: string, x: number, y: number) => void
  nodeVisible?: Uint8Array | null
}
```

And update the default function signature (around line 686):

```ts
export default function EngineGraph({ data, positions, engramSlug, onNodeClick, nodeVisible }: EngineGraphProps) {
```

to:

```ts
export default function EngineGraph({ data, positions, layoutMeta, engramSlug, onNodeClick, nodeVisible }: EngineGraphProps) {
```

**Suppress the unused-variable warning for `layoutMeta` in this task.** The variable is destructured but not consumed until Task 4. Immediately after the refs block (after the `useEffect(() => { positionsRef.current = positions }, [positions])` line around line 697), add a placeholder reference:

```ts
  // Temporarily reference layoutMeta so TypeScript's noUnusedLocals stays
  // quiet between this task and Task 4, which actually consumes it.
  void layoutMeta
```

This is identical to the scaffolding pattern we used in the Task 2 of the previous plan — `void` is the cheapest disable. Task 4 removes the `void` when it starts reading `layoutMeta`.

- [ ] **Step 4: Verify everything compiles**

```bash
npx tsc --noEmit
```

Expected: exit 0. All call sites pass the new prop; `EngineGraph` destructures it; `useForceLayout` returns the new shape. Nothing is yet using `layoutMeta` beyond the `void` reference.

- [ ] **Step 5: Commit Tasks 2 and 3 together**

```bash
git add apps/web/app/components/app/map/useForceLayout.ts apps/web/app/components/app/map/EngineGraph.tsx "apps/web/app/app/[engram]/page.tsx" "apps/web/app/app/[engram]/map/page.tsx"
git commit -m "$(cat <<'EOF'
feat(map): add LayoutMeta with newSlugs/rippleSlugs neighbor detection

useForceLayout now diffs against its cached positions each refresh and
emits which slugs are new and which are direct neighbors of adds or
deletes. No visible behavior change yet — ripple/collapse consumes this
metadata in upcoming tasks. Prop plumbing added to EngineGraph, dashboard,
and standalone map page.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Add `attention` buffer + initialize on new nodes

**Files:**
- Modify: `apps/web/app/components/app/map/reconcileGraph.ts`
- Modify: `apps/web/app/components/app/map/EngineGraph.tsx`

This task adds the `attention: Float32Array` field to `GraphBuffers`, updates `reconcileGraph` to accept `meta` and initialize attention for new slugs, and plumbs the meta through `applyReconcile`. **The attention buffer is populated but not yet rendered or decayed** — Task 5 wires it into the shader.

- [ ] **Step 1: Update `reconcileGraph.ts` to accept `meta` and include attention**

Open `apps/web/app/components/app/map/reconcileGraph.ts`. Update the imports at the top:

```ts
import type { GraphData } from "./useGraphData"
import { getArticleTypeMeta } from "@/lib/article-types"
```

to include the `LayoutMeta` type:

```ts
import type { GraphData } from "./useGraphData"
import type { LayoutMeta } from "./useForceLayout"
import { getArticleTypeMeta } from "@/lib/article-types"
```

Add `attention` to the `GraphBuffers` interface. Find:

```ts
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
```

Add an `attention: Float32Array` field near the fade state block. Insert it right after `fadeTarget`:

```ts
  // Tweened fade state
  fadeCurrent: Float32Array // count (rendered each frame via aFade attribute)
  fadeTarget: Float32Array // count

  // Attention state for glow pulse on new nodes. Starts at 1.0 when a
  // node is freshly added, decays linearly toward 0 in the animation loop.
  attention: Float32Array // count (rendered each frame via aAttention attribute)
```

Update the `reconcileGraph` function signature to accept `meta`:

```ts
export function reconcileGraph(
  prev: GraphBuffers | null,
  data: GraphData,
  positions: Float32Array,
): GraphBuffers {
```

becomes:

```ts
export function reconcileGraph(
  prev: GraphBuffers | null,
  data: GraphData,
  positions: Float32Array,
  meta: LayoutMeta,
): GraphBuffers {
```

Inside the function, add a new `attention` allocation near the other Float32Array allocations. Find this block:

```ts
  const nodeColors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const phases = new Float32Array(count)
  const depthArr = new Float32Array(count)
  const currentPos = new Float32Array(count * 3)
  const targetPos = new Float32Array(count * 3)
  const fadeCurrent = new Float32Array(count)
  const fadeTarget = new Float32Array(count)
```

Add `attention`:

```ts
  const nodeColors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const phases = new Float32Array(count)
  const depthArr = new Float32Array(count)
  const currentPos = new Float32Array(count * 3)
  const targetPos = new Float32Array(count * 3)
  const fadeCurrent = new Float32Array(count)
  const fadeTarget = new Float32Array(count)
  const attention = new Float32Array(count)
```

Inside the main per-node loop, after the `fadeCurrent[i] = ...` / `fadeCurrent[i] = 0` block, initialize `attention[i]`. Find:

```ts
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
```

Replace with:

```ts
    if (prev && prevIdx !== undefined) {
      const p3 = prevIdx * 3
      currentPos[i3] = prev.currentPos[p3]
      currentPos[i3 + 1] = prev.currentPos[p3 + 1]
      currentPos[i3 + 2] = prev.currentPos[p3 + 2]
      fadeCurrent[i] = prev.fadeCurrent[prevIdx]
      // Inherit any in-flight attention from the previous reconcile so a
      // pulse that's still decaying doesn't get clobbered by a second
      // reconcile (e.g. two source feeds in quick succession).
      attention[i] = prev.attention[prevIdx]
    } else {
      currentPos[i3] = x
      currentPos[i3 + 1] = y
      currentPos[i3 + 2] = z
      fadeCurrent[i] = 0 // new node: start invisible, fade in
      attention[i] = meta.newSlugs.has(node.slug) ? 1.0 : 0
    }
    fadeTarget[i] = 1
```

Note: for the `prev && prevIdx !== undefined` branch, we inherit from prev. For the "no prev" branch, we check `meta.newSlugs` to decide whether this is a genuine new node (attention 1.0) or the very first layout pass where EVERY slug is technically new but no pulse should play (attention 0). The `meta.newSlugs` set is empty on the first layout (see `useForceLayout` Task 2) so initial load gets attention 0 for everyone.

At the bottom of the function, add `attention` to the returned object. Find:

```ts
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

Update to:

```ts
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
    attention,
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

- [ ] **Step 2: Update `EngineGraph.tsx` to pass `meta` through to `reconcileGraph`**

Open `apps/web/app/components/app/map/EngineGraph.tsx`.

**Delete the `void layoutMeta` placeholder** from Task 3 — `layoutMeta` is now consumed.

Update the `applyReconcile` function signature (around line 591) and body. Find:

```ts
function applyReconcile(state: SceneState, data: GraphData, positions: Float32Array) {
  const next = reconcileGraph(state.buffers, data, positions)
  state.buffers = next
```

Replace with:

```ts
function applyReconcile(state: SceneState, data: GraphData, positions: Float32Array, meta: LayoutMeta) {
  const next = reconcileGraph(state.buffers, data, positions, meta)
  state.buffers = next
```

This requires `LayoutMeta` to be in scope inside `applyReconcile`'s file-level. It's already imported at the top thanks to Task 3.

Also update the initial `SceneState` construction in `buildMountScene` so the empty buffers include `attention`. Find this block (around line 222, inside `buildMountScene`):

```ts
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
```

Add `attention: new Float32Array(0)` between `fadeTarget` and `eSrc`:

```ts
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
        attention: new Float32Array(0),
        eSrc: new Uint16Array(0),
        eTgt: new Uint16Array(0),
        edgeColors: new Float32Array(0),
        edgePositions: new Float32Array(0),
        slugs: [],
        slugToIndex: new Map(),
        neighbors: new Map(),
      },
```

Update the reconcile-phase `useEffect` to pass `layoutMeta`. Find (around line 728):

```ts
  // ── Reconcile-phase: update buffers in place when data/positions change ──
  useEffect(() => {
    const state = sceneRef.current
    if (!sceneReady || !state || data.nodes.length === 0) return
    applyReconcile(state, data, positions)
  }, [sceneReady, data, positions])
```

Replace with:

```ts
  // ── Reconcile-phase: update buffers in place when data/positions change ──
  useEffect(() => {
    const state = sceneRef.current
    if (!sceneReady || !state || data.nodes.length === 0) return
    applyReconcile(state, data, positions, layoutMeta)
  }, [sceneReady, data, positions, layoutMeta])
```

- [ ] **Step 3: Verify everything compiles**

```bash
npx tsc --noEmit
```

Expected: exit 0. The attention buffer is in place but no shader or animation loop code reads it yet; that's Task 5.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/app/map/reconcileGraph.ts apps/web/app/components/app/map/EngineGraph.tsx
git commit -m "$(cat <<'EOF'
feat(map): initialize attention buffer for newly added nodes

GraphBuffers gains an attention: Float32Array field. reconcileGraph now
accepts LayoutMeta and seeds attention to 1.0 for any slug in
meta.newSlugs. Existing surviving nodes inherit their previous attention
value so an in-flight pulse doesn't get reset by a follow-up reconcile.

Not yet rendered — the shader attribute and decay loop land in Task 5.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire attention into the shader + animation loop

**Files:**
- Modify: `apps/web/app/components/app/map/EngineGraph.tsx`

This task adds the `aAttention` shader attribute, multiplies brightness and point size by the attention boost, sets the attribute on the geometry during reconcile, and adds a per-frame decay pass. This is the first task with a visible user-facing change.

- [ ] **Step 1: Add the shader attribute**

Open `apps/web/app/components/app/map/EngineGraph.tsx`. Find the vertex shader inside `buildMountScene` (around line 170):

```ts
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
```

Replace with (changes: declare `aAttention`, declare `vAttention`, pass it to fragment, grow gl_PointSize with attention boost):

```ts
      vertexShader: `
        attribute float aSize, aPhase, aFade, aAttention;
        attribute vec3 aColor;
        uniform float uTime;
        uniform vec2 uMouse, uRippleOrigin;
        uniform float uRippleTime;
        varying float vPulse, vMouseProx, vDepth, vFade, vAttention;
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
          vAttention = aAttention;
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDepth = smoothstep(-1400.0, -700.0, mv.z);
          gl_PointSize = aSize * (0.85 + vPulse * 0.3 + vAttention * 0.25) * (500.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
```

Find the fragment shader immediately below:

```ts
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
```

Replace with (changes: declare `vAttention`, multiply alpha by `(1.0 + vAttention * 0.6)`):

```ts
      fragmentShader: `
        varying float vPulse, vMouseProx, vDepth, vFade, vAttention;
        varying vec3 vColor;

        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float core = exp(-d * 30.0);
          float a = (exp(-d * 2.5) * 0.06 + exp(-d * 5.0) * 0.18 + exp(-d * 12.0) * 0.5 + core) * vPulse * vDepth * vFade * (1.0 + vAttention * 0.6);
          vec3 col = mix(vColor * 0.7, vColor, core);
          col = mix(col, vec3(1.0, 0.98, 0.96), vMouseProx * 0.4);
          gl_FragColor = vec4(col, a);
        }
      `,
```

- [ ] **Step 2: Bind the `aAttention` attribute in `applyReconcile`**

Inside `applyReconcile`, find the node geometry rebuild (around line 598):

```ts
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
```

Add an `aAttention` setAttribute call between `aFade` and `aColor`:

```ts
  // ── Rebuild node geometry with the new buffers ──
  state.scene.remove(state.nodeMesh)
  state.nodeGeo.dispose()
  const nodeGeo = new THREE.BufferGeometry()
  nodeGeo.setAttribute("position", new THREE.BufferAttribute(next.currentPos, 3))
  nodeGeo.setAttribute("aSize", new THREE.BufferAttribute(next.sizes, 1))
  nodeGeo.setAttribute("aPhase", new THREE.BufferAttribute(next.phases, 1))
  nodeGeo.setAttribute("aFade", new THREE.BufferAttribute(next.fadeCurrent, 1))
  nodeGeo.setAttribute("aAttention", new THREE.BufferAttribute(next.attention, 1))
  nodeGeo.setAttribute("aColor", new THREE.BufferAttribute(next.nodeColors, 3))
  const nodeMesh = new THREE.Points(nodeGeo, state.nodeMat)
  state.scene.add(nodeMesh)
  state.nodeGeo = nodeGeo
  state.nodeMesh = nodeMesh
```

- [ ] **Step 3: Decay attention each frame in the animation loop**

Inside `buildMountScene`'s `animate` function, find the fade lerp block (around line 517):

```ts
      // Lerp fade values
      for (let i = 0; i < count; i++) {
        buffers.fadeCurrent[i] += (buffers.fadeTarget[i] - buffers.fadeCurrent[i]) * Math.min(delta * 6, 1)
      }
      if (count > 0) state.nodeGeo.attributes.aFade.needsUpdate = true
```

Add an attention decay pass immediately after:

```ts
      // Lerp fade values
      for (let i = 0; i < count; i++) {
        buffers.fadeCurrent[i] += (buffers.fadeTarget[i] - buffers.fadeCurrent[i]) * Math.min(delta * 6, 1)
      }
      if (count > 0) state.nodeGeo.attributes.aFade.needsUpdate = true

      // Decay attention toward 0 at ~1/sec. Only mark the attribute as
      // needing a GPU upload when something actually changed, to avoid
      // gratuitous buffer transfers on an idle graph.
      let attentionDirty = false
      for (let i = 0; i < count; i++) {
        if (buffers.attention[i] > 0) {
          buffers.attention[i] = Math.max(0, buffers.attention[i] - delta)
          attentionDirty = true
        }
      }
      if (attentionDirty && count > 0) state.nodeGeo.attributes.aAttention.needsUpdate = true
```

- [ ] **Step 4: Verify everything compiles**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/app/map/EngineGraph.tsx
git commit -m "$(cat <<'EOF'
feat(map): render glow pulse on new nodes via aAttention shader attribute

Vertex shader grows gl_PointSize by up to 1.25x and the fragment shader
multiplies alpha by up to 1.6x while a node's attention value is above
zero. The animation loop decays each value toward zero at 1/sec, and
applyReconcile binds the attention buffer as a Three.js attribute when
rebuilding the node geometry. Combined with the existing fadeCurrent
fade-in, new nodes now arrive with a warm pulse that settles naturally.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Enable soft ripple / collapse via `rippleSlugs` + tune clusters + safe viewport scale

**Files:**
- Modify: `apps/web/app/components/app/map/useForceLayout.ts`

Now that `useForceLayout` already computes `rippleSlugs` (from Task 2), actually USE it: exempt those slugs from hard pinning so d3-force can push them around during the scoped refresh simulation. At the same time, apply the cluster parameter tuning and switch to the safe-viewport-derived scale. All three of these changes affect visible layout behavior and should land together so we can judge the feel as a whole.

- [ ] **Step 1: Add the safe viewport import**

Open `apps/web/app/components/app/map/useForceLayout.ts`. Update the imports at the top to include `getSafeViewport`:

```ts
/* eslint-disable react-hooks/refs -- this hook deliberately uses refs as
   cross-render caches for force-layout positions, adjacency, and scale
   so that new data doesn't retrigger the full simulation. The React 19
   rule is aware that ref access inside useMemo is unusual but here it's
   the intended behavior. */
import { useMemo, useRef } from "react"
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type SimulationNodeDatum, type SimulationLinkDatum } from "d3-force"
import type { GraphData } from "./useGraphData"
```

Add the new import after `type { GraphData }`:

```ts
import type { GraphData } from "./useGraphData"
import { getSafeViewport } from "@/lib/map-viewport-bounds"
```

- [ ] **Step 2: Exempt rippleSlugs from hard pinning**

Find the node mapping block (the block that produces the `nodes` array that goes into `forceSimulation`):

```ts
    const nodes: ForceNode[] = data.nodes.map((n, i) => {
      const cached = prev.get(n.slug)
      if (isRefresh && cached) {
        // Pin existing nodes hard (fx/fy) so the simulation only moves new
        // ones. Without this, every tick nudges the whole layout around
        // the new node's repulsion and the entire map drifts.
        // NOTE: Task 5 will exempt rippleSlugs from pinning so they can
        // react to adds/deletes. For now everyone except new nodes is
        // still pinned — metadata is computed but not yet consumed.
        return {
          index: i,
          slug: n.slug,
          x: cached.x,
          y: cached.y,
          fx: cached.x,
          fy: cached.y,
        }
      }
      return {
        index: i,
        slug: n.slug,
        x: cached?.x,
        y: cached?.y,
      }
    })
```

Replace the whole block with:

```ts
    const nodes: ForceNode[] = data.nodes.map((n, i) => {
      const cached = prev.get(n.slug)
      const isRipple = rippleSlugs.has(n.slug)
      if (isRefresh && cached && !isRipple) {
        // Pin non-ripple existing nodes hard (fx/fy) so the simulation
        // only moves new ones + direct neighbors of changes.
        return {
          index: i,
          slug: n.slug,
          x: cached.x,
          y: cached.y,
          fx: cached.x,
          fy: cached.y,
        }
      }
      // New nodes and ripple neighbors are mobile. Ripple neighbors start
      // at their cached position and get pushed around by the new node's
      // repulsion (add case) or settle into the void (delete case).
      return {
        index: i,
        slug: n.slug,
        x: cached?.x,
        y: cached?.y,
      }
    })
```

- [ ] **Step 3: Apply balanced cluster parameters**

Find the force simulation setup:

```ts
    const nodeCount = nodes.length
    const repulsion = -20 - Math.min(nodeCount, 60)

    const simulation = forceSimulation(nodes)
      .force("link", forceLink(links).distance(25).strength(0.7))
      .force("charge", forceManyBody().strength(repulsion))
      .force("center", forceCenter(0, 0).strength(0.4))
      .force("collide", forceCollide().radius((_, i) => 18 + data.nodes[i].depth * 10).strength(1))
      .stop()
```

Replace with the tuned parameters from the spec:

```ts
    const nodeCount = nodes.length
    // Moderated repulsion so outlier nodes don't drift way past the edge.
    const repulsion = -30 - Math.min(nodeCount, 40)

    const simulation = forceSimulation(nodes)
      // Looser link distance (was 25) makes linked clusters more readable
      // without making them fly apart.
      .force("link", forceLink(links).distance(40).strength(0.7))
      .force("charge", forceManyBody().strength(repulsion))
      // Stronger center force (was 0.4) pulls distant outliers back in.
      .force("center", forceCenter(0, 0).strength(0.6))
      // Larger collide radius (was 18 + depth*10) enforces a minimum
      // spacing so "extremely close" pairs can't form.
      .force("collide", forceCollide().radius((_, i) => 22 + data.nodes[i].depth * 8).strength(1))
      .stop()
```

- [ ] **Step 4: Replace the layout scale with a safe-viewport-derived radius**

Find the scale cache block:

```ts
    // Establish the scale on first layout and never change it.
    if (!scaleRef.current) {
      let maxR = 1
      for (const node of nodes) {
        const r = Math.sqrt((node.x ?? 0) ** 2 + (node.y ?? 0) ** 2)
        if (r > maxR) maxR = r
      }
      scaleRef.current = {
        maxR,
        targetRadius: 100 + Math.min(nodeCount * 3, 150),
        yOffset: 15,
      }
    }
```

Replace with:

```ts
    // Establish the scale on first layout and never change it.
    // targetRadius is derived from the safe viewport (the visible
    // rectangle not covered by widgets) so the constellation naturally
    // fits what the user can actually see.
    if (!scaleRef.current) {
      let maxR = 1
      for (const node of nodes) {
        const r = Math.sqrt((node.x ?? 0) ** 2 + (node.y ?? 0) ** 2)
        if (r > maxR) maxR = r
      }
      const safe =
        typeof window !== "undefined"
          ? getSafeViewport(window.innerWidth, window.innerHeight)
          : { width: 800, height: 600, left: 0, right: 800, top: 0, bottom: 600, centerX: 400, centerY: 300 }
      scaleRef.current = {
        maxR,
        targetRadius: Math.min(safe.width, safe.height) * 0.35,
        yOffset: 15,
      }
    }
```

The fallback object handles SSR (where `window` is undefined during the first module eval). In practice this hook is client-only via `"use client"` so the fallback should never fire, but the guard keeps TypeScript and any accidental server invocations happy.

- [ ] **Step 5: Verify everything compiles**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/app/map/useForceLayout.ts
git commit -m "$(cat <<'EOF'
feat(map): soft ripple/collapse + balanced clusters + safe viewport scale

Three changes that together deliver the Obsidian-like feel:

- rippleSlugs (direct neighbors of adds or deletes) are no longer hard-
  pinned, so the scoped force simulation can push them out on add or
  settle them into the void on delete. The existing animation-loop lerp
  turns the simulated displacement into a smooth visible motion.

- Cluster force tuning: link distance 25 -> 40, charge -20..-80 ->
  -30..-70, center 0.4 -> 0.6, collide radius 18+depth*10 -> 22+depth*8.
  Starting values from the spec; expect to iterate live.

- Layout scale is derived from the safe viewport rectangle (derived via
  getSafeViewport from lib/map-viewport-bounds) instead of an arbitrary
  node-count formula. Cached on first layout so adds don't rescale.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Add attention pan state machine for off-screen new nodes

**Files:**
- Modify: `apps/web/app/components/app/map/EngineGraph.tsx`

The final new behavior: when a new node lands outside the safe viewport rectangle, the camera gently pans to bring it in, holds, and drifts back. Manual panning cancels the drift.

- [ ] **Step 1: Add the imports and `container` field to `SceneState`**

Open `apps/web/app/components/app/map/EngineGraph.tsx`. Update the imports at the top to bring in the safe viewport helpers. Find:

```ts
import type { GraphData } from "./useGraphData"
import type { LayoutMeta } from "./useForceLayout"
import { ARTICLE_TYPE_META, type ArticleType } from "@/lib/article-types"
```

Add:

```ts
import type { GraphData } from "./useGraphData"
import type { LayoutMeta } from "./useForceLayout"
import { getSafeViewport, isInSafeViewport } from "@/lib/map-viewport-bounds"
import { ARTICLE_TYPE_META, type ArticleType } from "@/lib/article-types"
```

Now extend the `SceneState` interface. Find (around line 52):

```ts
interface SceneState {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
```

Add a `container` field at the top of the interface so `applyReconcile` can query bounding-rect info:

```ts
interface SceneState {
  container: HTMLDivElement
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
```

And at the bottom of the interface (before `frameHandle`), add the pan state field:

```ts
  // Lifecycle
  frameHandle: number
  disposed: boolean
```

becomes:

```ts
  // Attention pan — when a new node lands outside the safe viewport, the
  // camera gently drifts to bring it in, holds for a beat, and drifts
  // back. Manual panning cancels this.
  attentionPan: {
    target: { x: number; y: number }
    returnTo: { x: number; y: number }
    startMs: number
  } | null

  // Lifecycle
  frameHandle: number
  disposed: boolean
```

- [ ] **Step 2: Initialize `container` and `attentionPan` in `buildMountScene`**

Find the `SceneState` object literal inside `buildMountScene` (around line 200). The current state construction starts with `scene, camera, renderer`. Update it to include `container` and `attentionPan`:

Current (the first few lines):

```ts
    const state: SceneState = {
      scene,
      camera,
      renderer,
      nodeMat,
```

Replace with:

```ts
    const state: SceneState = {
      container,
      scene,
      camera,
      renderer,
      nodeMat,
```

And at the end of the object literal, before `frameHandle: 0`, add `attentionPan: null`. Current:

```ts
      orbitStart: { x: 0, y: 0 },
      frameHandle: 0,
      disposed: false,
    }
```

Replace with:

```ts
      orbitStart: { x: 0, y: 0 },
      attentionPan: null,
      frameHandle: 0,
      disposed: false,
    }
```

- [ ] **Step 3: Detect off-screen new nodes in `applyReconcile`**

Find the end of `applyReconcile` right before the hover-state reset (around line 673):

```ts
  // ── Reset hover state if the hovered node no longer exists ──
  state.currentHovered = -1
  state.currentHoveredEdge = -1
}
```

(If the comment reads "Force hover recompute on next frame" instead, that's the same block — the reset of the two hover indices.)

Insert the off-screen detection block BEFORE the hover reset. The function already receives `meta` via the parameter added in Task 4.

Between the hover reset and the previous block (the pan/zoom recompute), add:

```ts
  // ── Start an attention pan if any new node would land outside the
  // safe viewport. Only REPLACE an in-flight pan if there's a new target
  // to drive toward — otherwise leave the existing drift alone so it can
  // finish its phase. ──
  if (meta.newSlugs.size > 0) {
    const safe =
      typeof window !== "undefined"
        ? getSafeViewport(window.innerWidth, window.innerHeight)
        : null
    if (safe) {
      const rect = state.container.getBoundingClientRect()
      const projVec = new THREE.Vector3()
      let offScreenCount = 0
      let centroidX = 0
      let centroidY = 0
      for (let i = 0; i < next.count; i++) {
        if (!meta.newSlugs.has(next.slugs[i])) continue
        const i3 = i * 3
        projVec
          .set(next.targetPos[i3], next.targetPos[i3 + 1], next.targetPos[i3 + 2])
          .project(state.camera)
        const sx = (projVec.x * 0.5 + 0.5) * rect.width + rect.left
        const sy = (-projVec.y * 0.5 + 0.5) * rect.height + rect.top
        if (!isInSafeViewport(sx, sy, safe)) {
          offScreenCount += 1
          centroidX += next.targetPos[i3]
          centroidY += next.targetPos[i3 + 1]
        }
      }
      if (offScreenCount > 0) {
        // Use the CURRENT returnTo if a pan is already in-flight — don't
        // trap the user at a mid-drift position when a second reconcile
        // lands. Otherwise capture the current resting panOffset.
        const returnTo = state.attentionPan
          ? state.attentionPan.returnTo
          : { x: state.panOffset.x, y: state.panOffset.y }
        state.attentionPan = {
          target: { x: centroidX / offScreenCount, y: centroidY / offScreenCount },
          returnTo,
          startMs: performance.now(),
        }
      }
      // If offScreenCount is 0, leave any in-flight attentionPan alone so
      // it can finish its three-phase drift. A new reconcile without
      // off-screen nodes doesn't need to steal the camera.
    }
  }
```

This block sits inside `applyReconcile`. It's called after `state.buffers = next` and after the geometry rebuilds, so `next` is the fresh buffer set and `state.panOffset` is the current user-visible pan.

- [ ] **Step 4: Add the pan phases to the animation loop**

Find the camera orbit + drift section in the `animate` function (around line 420):

```ts
      // Camera orbit + drift
      const driftScale = Math.min(Math.max((count - 5) / 10, 0), 1)
      state.currentZoom += (state.targetZ - state.currentZoom) * 0.1
      state.orbitTheta += (state.targetTheta - state.orbitTheta) * 0.08
      state.orbitPhi += (state.targetPhi - state.orbitPhi) * 0.08
```

Insert the attention pan state machine BEFORE the `state.currentZoom` lerp:

```ts
      // Camera orbit + drift
      const driftScale = Math.min(Math.max((count - 5) / 10, 0), 1)

      // ── Attention pan state machine ──
      if (state.attentionPan) {
        const t = performance.now() - state.attentionPan.startMs
        const { target, returnTo } = state.attentionPan
        if (t < 600) {
          // Phase 1: ease-out toward target (600ms)
          const p = t / 600
          const k = 1 - Math.pow(1 - p, 3) // ease-out cubic
          state.panOffset.x = returnTo.x + (target.x - returnTo.x) * k
          state.panOffset.y = returnTo.y + (target.y - returnTo.y) * k
        } else if (t < 1600) {
          // Phase 2: hold at target (1000ms)
          state.panOffset.x = target.x
          state.panOffset.y = target.y
        } else if (t < 2400) {
          // Phase 3: ease-out back to returnTo (800ms)
          const p = (t - 1600) / 800
          const k = 1 - Math.pow(1 - p, 3)
          state.panOffset.x = target.x + (returnTo.x - target.x) * k
          state.panOffset.y = target.y + (returnTo.y - target.y) * k
        } else {
          // Done
          state.panOffset.x = returnTo.x
          state.panOffset.y = returnTo.y
          state.attentionPan = null
        }
      }

      state.currentZoom += (state.targetZ - state.currentZoom) * 0.1
      state.orbitTheta += (state.targetTheta - state.orbitTheta) * 0.08
      state.orbitPhi += (state.targetPhi - state.orbitPhi) * 0.08
```

- [ ] **Step 5: Cancel attention pan on manual pan**

Find the `onMouseDown` handler inside `buildMountScene` (around line 259):

```ts
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0 && state.currentHovered < 0) {
        state.isPanning = true
        state.panStart = { x: e.clientX, y: e.clientY }
      } else if (e.button === 2) {
        state.isOrbiting = true
        state.orbitStart = { x: e.clientX, y: e.clientY }
      }
    }
```

Replace with:

```ts
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0 && state.currentHovered < 0) {
        // Manual pan cancels any in-flight attention drift — user input wins.
        state.attentionPan = null
        state.isPanning = true
        state.panStart = { x: e.clientX, y: e.clientY }
      } else if (e.button === 2) {
        state.attentionPan = null
        state.isOrbiting = true
        state.orbitStart = { x: e.clientX, y: e.clientY }
      }
    }
```

- [ ] **Step 6: Verify everything compiles**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/components/app/map/EngineGraph.tsx
git commit -m "$(cat <<'EOF'
feat(map): pan camera to off-screen new nodes, return after a beat

applyReconcile now projects every new node's target position through
the current camera and checks it against the safe viewport rectangle
from map-viewport-bounds. If any new nodes fall outside (e.g. would
land under the SourceTree or AgentTimeline widgets), it starts a
three-phase pan state machine: 600ms ease-out toward the centroid,
1000ms hold, 800ms ease-out back to the user's previous pan offset.
Manual pan or orbit input cancels an in-flight drift immediately.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Verification + smoke tests

**Files:**
- No file changes. This task exercises the implementation against the dev server.

- [ ] **Step 1: Start the Next.js dev server from the worktree**

From the worktree's `apps/web` directory:

```bash
npm run dev
```

(Use `run_in_background: true` if driving this from the Bash tool so the conversation can continue.)

Expected: server ready on `http://localhost:3000`.

- [ ] **Step 2: Run a full build to confirm no runtime/SSR issues**

In a separate terminal or after the dev server is stable:

```bash
npm run build
```

Expected: build completes without errors. Pre-existing warnings in other files are acceptable.

- [ ] **Step 3: Playwright — verify initial map render**

Using the Playwright MCP tools available in this session:

- `mcp__plugin_playwright_playwright__browser_navigate` to `http://localhost:3000/app/coffee/map`
- `mcp__plugin_playwright_playwright__browser_snapshot` to confirm the main element contains an article count pill and no "No articles yet" message
- `mcp__plugin_playwright_playwright__browser_console_messages` with `level: "error"` to confirm zero errors

Expected: the map renders, the article count matches the engram, no console errors.

- [ ] **Step 4: Playwright — verify glow pulse on an inserted article**

Use `mcp__claude_ai_Supabase__execute_sql` to insert a throwaway article into the coffee engram:

```sql
INSERT INTO articles (engram_id, slug, title, summary, content_md, confidence, article_type, tags, source_ids)
VALUES (
  '63e961ea-81ee-4c05-adaa-41161d78f9b3',
  'zz-obsidian-plan-probe',
  'Obsidian Plan Probe',
  'Temporary article for testing glow pulse',
  'test content for the probe',
  0.5,
  'concept',
  ARRAY[]::text[],
  ARRAY[]::uuid[]
)
RETURNING id, slug;
```

Capture the returned `id` for the cleanup step. Wait ~2 seconds for the realtime event to propagate, then:

- `mcp__plugin_playwright_playwright__browser_take_screenshot` with filename `glow-pulse-new-node.png`
- Inspect the screenshot visually: a new node should be present. The glow effect is subtle at rest but the node should be fully opaque (post-fade).
- `mcp__plugin_playwright_playwright__browser_console_messages` — no errors

- [ ] **Step 5: Playwright — verify collapse on delete**

Delete the probe article:

```sql
DELETE FROM articles WHERE id = '<id-captured-in-step-4>' RETURNING slug;
```

Wait ~1 second, then:

- `mcp__plugin_playwright_playwright__browser_take_screenshot` with filename `after-delete-collapse.png`
- Inspect: the probe node should be gone. Neighbors may have shifted slightly; that's the soft collapse.
- `mcp__plugin_playwright_playwright__browser_console_messages` — no errors

- [ ] **Step 6: Hand off to user for manual QA**

Write this message (verbatim) to the user:

> Implementation complete. Please do manual QA on the dashboard at `http://localhost:3000/app/<your-slug>`:
>
> 1. **Add feel:** Feed a source. Watch the map during compilation. New articles should appear with a warm pulse and direct neighbors should shift subtly while non-neighbors stay still.
> 2. **Delete feel:** Delete a source or individual article. Remaining neighbors should glide slightly inward.
> 3. **Cluster feel:** Does the graph look less "some too close, some too far" than before? (Starting params: link 40, charge -30..-70, center 0.6, collide 22+depth*8. We can iterate if not.)
> 4. **Off-screen pan:** If possible, feed a source that adds articles at the edges of the graph such that they'd land under the SourceTree or AgentTimeline widgets. Confirm the map drifts to reveal them and then drifts back.
> 5. **Manual pan cancels:** Grab and drag the map while a new source is compiling. The drift should abort immediately.
>
> Let me know which, if any, of the five items need tuning. The known unknowns I expect to adjust live are: cluster params, pan dwell timing, glow magnitude, and ripple spring vs smooth-settle feel.

- [ ] **Step 7: Wait for user feedback before considering this task complete**

Do not mark this task done until the user reports the QA results. If the user requests adjustments, handle them inline (no new task) and recommit.

---

### Task 9: Cleanup pass + final build check

**Files:**
- Modify: any touched file where cleanup is warranted

- [ ] **Step 1: Re-read the four files modified in this plan**

Read:
- `apps/web/app/components/app/map/useForceLayout.ts`
- `apps/web/app/components/app/map/reconcileGraph.ts`
- `apps/web/app/components/app/map/EngineGraph.tsx`
- `apps/web/lib/map-viewport-bounds.ts`

Look for:
- Leftover `console.log` calls from any mid-task debugging
- Comments that reference "Task N" in ways that will confuse a future reader (the plan-specific comments should be removed or rewritten as normal code comments)
- Unused variables the compiler didn't catch

Apply targeted edits. After each edit, re-run `npx tsc --noEmit`.

- [ ] **Step 2: Final full build**

```bash
npm run build
```

Expected: clean build, no errors.

- [ ] **Step 3: Commit any cleanup changes**

```bash
git add <files>
git commit -m "$(cat <<'EOF'
chore(map): post-implementation cleanup

Removes task-specific comments and any stray debug logging from the
Obsidian-inspired map behavior implementation.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

If there's nothing to clean up, skip the commit.

---

## Rollback Strategy

Every task produces a focused commit. To roll back in order of increasing pain:

- **Revert just Task 7** → camera stops panning to off-screen new nodes, everything else intact
- **Revert Task 6 only** → cluster tuning and safe-viewport scale restored to current behavior, soft ripple disabled, glow + pan still work
- **Revert Task 5** → glow pulse disappears, ripple/tuning still active
- **Revert Task 4** → attention buffer removed, reconciler returns to current shape
- **Revert Tasks 2+3 together** → LayoutMeta plumbing removed, `useForceLayout` returns raw `Float32Array | null` as before
- **Revert Task 1** → safe viewport helper file deleted, `NodeCard` gets its inline constants back

## Performance Notes

- The neighbor computation in `useForceLayout` is `O(edges + nodes)` per layout pass — negligible.
- The animation loop's attention decay is `O(count)` per frame but early-exits when attention is zero, so an idle graph has zero extra work.
- The off-screen check in `applyReconcile` is `O(newSlugs)`, which is small.
- Three.js reallocates the `aAttention` BufferAttribute once per reconcile (same pattern as the existing position/aFade/aColor attrs). No per-frame allocations.
