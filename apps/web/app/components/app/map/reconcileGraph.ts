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
  currentPos: Float32Array // count * 3 (rendered each frame; written by animation loop from simulation)

  // Tweened fade state
  fadeCurrent: Float32Array // count (rendered each frame via aFade attribute)
  fadeTarget: Float32Array // count

  // Attention state for glow pulse on new nodes. Starts at 1.0 when a
  // node is freshly added, decays linearly toward 0 in the animation loop.
  attention: Float32Array // count (rendered each frame via aAttention attribute)

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
  newSlugs: Set<string>,
): GraphBuffers {
  const count = data.nodes.length
  const edgeCount = data.edges.length

  const nodeColors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const phases = new Float32Array(count)
  const depthArr = new Float32Array(count)
  const currentPos = new Float32Array(count * 3)
  const fadeCurrent = new Float32Array(count)
  const fadeTarget = new Float32Array(count)
  const attention = new Float32Array(count)

  const slugs: string[] = new Array(count)
  const slugToIndex = new Map<string, number>()

  for (let i = 0; i < count; i++) {
    const node = data.nodes[i]
    const d = node.depth
    const i3 = i * 3

    // If this slug existed before, copy its rendered position so the
    // animation loop can continue from where it left off.
    // For new nodes, initialize to (0, 0, 0) — the animation loop will
    // write the real position from the simulation on the next frame.
    const prevIdx = prev?.slugToIndex.get(node.slug)
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
      currentPos[i3] = 0
      currentPos[i3 + 1] = 0
      currentPos[i3 + 2] = 0
      fadeCurrent[i] = 0 // new node: start invisible, fade in
      // newSlugs is empty on the very first layout pass, so the initial
      // load gets attention 0 for every node — no spurious pulse.
      attention[i] = newSlugs.has(node.slug) ? 1.0 : 0
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
    // Edges are rendered with uniform color regardless of relation type
    // or weight. Both signals exist in the database but flow into
    // semantic clustering (forceLink distance/strength in
    // useForceLayout) instead of visual edge styling — the user wants
    // the layout to encode meaning, not the wires themselves.
    const col = DEFAULT_EDGE_COLOR
    const i6 = ei * 6
    edgeColors[i6] = col[0]
    edgeColors[i6 + 1] = col[1]
    edgeColors[i6 + 2] = col[2]
    edgeColors[i6 + 3] = col[0]
    edgeColors[i6 + 4] = col[1]
    edgeColors[i6 + 5] = col[2]
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
