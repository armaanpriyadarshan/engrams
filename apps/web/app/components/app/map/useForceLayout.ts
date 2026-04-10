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
    // removedSlugs is only ever non-empty when isRefresh is true — see
    // the population guard above. This block is safe on the first render
    // because removedSlugs stays empty; future edits should preserve
    // that invariant.
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
        // NOTE: Task 6 will exempt rippleSlugs from pinning so they can
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
