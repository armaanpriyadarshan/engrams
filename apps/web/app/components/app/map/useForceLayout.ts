/* eslint-disable react-hooks/refs -- this hook deliberately uses refs as
   cross-render caches for force-layout positions and scale so that new
   data doesn't retrigger the full simulation. The React 19 rule is aware
   that ref access inside useMemo is unusual but here it's the intended
   behavior. */
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

export function useForceLayout(data: GraphData | null, width: number, height: number) {
  // Cache previous positions (in normalized world space, pre-scale) by slug
  // so existing nodes don't jump on refresh.
  const prevPositions = useRef<Map<string, { x: number; y: number }>>(new Map())
  // Cache the scale from the FIRST layout. Reusing it means adding a node
  // never rescales the whole graph — existing nodes stay exactly where they
  // were, and new nodes slot in at the same world-space density.
  const scaleRef = useRef<LayoutScale | null>(null)

  return useMemo(() => {
    if (!data || data.nodes.length === 0) return null

    const prev = prevPositions.current
    const isRefresh = prev.size > 0

    const nodes: ForceNode[] = data.nodes.map((n, i) => {
      const cached = prev.get(n.slug)
      if (isRefresh && cached) {
        // Pin existing nodes hard (fx/fy) so the simulation only moves new
        // ones. Without this, every tick nudges the whole layout around
        // the new node's repulsion and the entire map drifts.
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

    // Establish the scale on first layout and never change it. A new source
    // with heavily-connected articles could reach outside the initial radius
    // but that's fine — it just drifts slightly past the edge rather than
    // forcing everything to rescale inward.
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
      // Store the UN-scaled position in the cache so the next refresh can
      // reseed at the simulation-space coordinate. The rendered position is
      // the scaled one.
      const rawX = nodes[i].x ?? 0
      const rawY = nodes[i].y ?? 0
      positions[i * 2] = (rawX / maxR) * targetRadius
      positions[i * 2 + 1] = (rawY / maxR) * targetRadius + yOffset
      newCache.set(nodes[i].slug, { x: rawX, y: rawY })
    }

    prevPositions.current = newCache
    return positions
  }, [data, width, height])
}
