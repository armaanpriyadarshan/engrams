import { useMemo, useRef } from "react"
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type SimulationNodeDatum, type SimulationLinkDatum } from "d3-force"
import type { GraphData } from "./useGraphData"

interface ForceNode extends SimulationNodeDatum {
  index: number
  slug: string
}

export function useForceLayout(data: GraphData | null, width: number, height: number) {
  // Cache previous positions by slug so existing nodes don't jump on refresh
  const prevPositions = useRef<Map<string, { x: number; y: number }>>(new Map())

  return useMemo(() => {
    if (!data || data.nodes.length === 0) return null

    const prev = prevPositions.current
    const isRefresh = prev.size > 0

    const nodes: ForceNode[] = data.nodes.map((n, i) => {
      const cached = prev.get(n.slug)
      return {
        index: i,
        slug: n.slug,
        // Seed existing nodes at their previous positions
        x: cached?.x ?? undefined,
        y: cached?.y ?? undefined,
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

    // Fewer ticks on refresh — just settle the new nodes in
    const ticks = isRefresh ? 50 : Math.min(300, 100 + nodeCount * 2)
    for (let i = 0; i < ticks; i++) {
      simulation.tick()
    }

    // Normalize all positions to fit within a tight radius in world space
    // The camera handles the rest — this just ensures nodes stay in a compact cluster
    let maxR = 1
    for (const node of nodes) {
      const r = Math.sqrt((node.x ?? 0) ** 2 + (node.y ?? 0) ** 2)
      if (r > maxR) maxR = r
    }

    // Comfortable world-space radius — users can zoom in to explore
    const targetRadius = 100 + Math.min(nodeCount * 3, 150)
    const yOffset = 15 // shift up slightly to clear bottom UI

    const positions = new Float32Array(nodeCount * 2)
    const newCache = new Map<string, { x: number; y: number }>()

    for (let i = 0; i < nodeCount; i++) {
      const px = ((nodes[i].x ?? 0) / maxR) * targetRadius
      const py = ((nodes[i].y ?? 0) / maxR) * targetRadius + yOffset
      positions[i * 2] = px
      positions[i * 2 + 1] = py
      newCache.set(nodes[i].slug, { x: nodes[i].x ?? 0, y: nodes[i].y ?? 0 })
    }

    prevPositions.current = newCache
    return positions
  }, [data, width, height])
}
