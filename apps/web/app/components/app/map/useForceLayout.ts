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

    // Normalize positions to fit a safe bounding box in the center
    // Avoid side panels (~40% from left, ~25% from right) and bottom UI (~20% from bottom)
    const safeW = width * 0.35
    const safeH = height * 0.4
    const safeCenterY = height * 0.05 // shift up slightly

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const node of nodes) {
      const x = node.x ?? 0, y = node.y ?? 0
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const rangeX = Math.max(maxX - minX, 1)
    const rangeY = Math.max(maxY - minY, 1)
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    const positions = new Float32Array(nodeCount * 2)
    const newCache = new Map<string, { x: number; y: number }>()

    for (let i = 0; i < nodeCount; i++) {
      // Map to -1..1 range centered on graph center, then scale to safe area
      const nx = ((nodes[i].x ?? 0) - centerX) / rangeX
      const ny = ((nodes[i].y ?? 0) - centerY) / rangeY
      const px = nx * safeW
      const py = ny * safeH + safeCenterY
      positions[i * 2] = px
      positions[i * 2 + 1] = py
      newCache.set(nodes[i].slug, { x: nodes[i].x ?? 0, y: nodes[i].y ?? 0 })
    }

    prevPositions.current = newCache
    return positions
  }, [data, width, height])
}
