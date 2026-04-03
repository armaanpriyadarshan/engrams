import { useMemo } from "react"
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type SimulationNodeDatum, type SimulationLinkDatum } from "d3-force"
import type { GraphData } from "./useGraphData"

interface ForceNode extends SimulationNodeDatum {
  index: number
}

export function useForceLayout(data: GraphData | null, width: number, height: number) {
  return useMemo(() => {
    if (!data || data.nodes.length === 0) return null

    const nodes: ForceNode[] = data.nodes.map((_, i) => ({ index: i }))
    const links: SimulationLinkDatum<ForceNode>[] = data.edges.map((e) => ({
      source: e.sourceIdx,
      target: e.targetIdx,
    }))

    const nodeCount = nodes.length
    const repulsion = -20 - Math.min(nodeCount, 60)

    const simulation = forceSimulation(nodes)
      .force("link", forceLink(links).distance(25).strength(0.7))
      .force("charge", forceManyBody().strength(repulsion))
      .force("center", forceCenter(0, -15).strength(0.4))
      .force("collide", forceCollide().radius((_, i) => 18 + data.nodes[i].depth * 10).strength(1))
      .stop()

    // Run synchronously
    const ticks = Math.min(300, 100 + nodeCount * 2)
    for (let i = 0; i < ticks; i++) {
      simulation.tick()
    }

    // Scale positions to fit within a reasonable range
    const scale = Math.min(width, height) * 0.18
    let maxR = 1
    for (const node of nodes) {
      const r = Math.sqrt((node.x ?? 0) ** 2 + (node.y ?? 0) ** 2)
      if (r > maxR) maxR = r
    }

    const positions = new Float32Array(nodeCount * 2)
    for (let i = 0; i < nodeCount; i++) {
      positions[i * 2] = ((nodes[i].x ?? 0) / maxR) * scale
      positions[i * 2 + 1] = ((nodes[i].y ?? 0) / maxR) * scale
    }

    return positions
  }, [data, width, height])
}
