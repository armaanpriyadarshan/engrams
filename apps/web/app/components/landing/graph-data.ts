export interface GraphNode {
  x: number
  y: number
  size: number
  label?: string
}

export interface GraphEdge {
  source: number
  target: number
  weight: number
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const AI_CONCEPTS = [
  "neural networks", "deep learning", "transformers", "attention",
  "backpropagation", "gradient descent", "embeddings", "tokenization",
  "language models", "reinforcement learning", "policy gradient",
  "computer vision", "object detection", "generative models", "diffusion",
  "alignment", "interpretability", "scaling laws", "emergence",
  "knowledge graphs", "reasoning", "planning", "robotics",
  "optimization", "self-supervised", "transfer learning",
  "few-shot learning", "chain of thought", "retrieval augmented",
  "multimodal", "world models", "agents", "fine-tuning",
  "representation learning", "contrastive learning", "normalization",
]

function generateGraphData(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const rand = mulberry32(42)
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  const seeds = [
    { cx: -280, cy: -120, r: 280, count: 32 },
    { cx: 160, cy: -220, r: 260, count: 30 },
    { cx: 420, cy: 80, r: 240, count: 26 },
    { cx: -40, cy: 180, r: 270, count: 30 },
    { cx: -480, cy: 60, r: 250, count: 24 },
    { cx: 650, cy: -280, r: 300, count: 28 },
    { cx: -650, cy: -280, r: 280, count: 26 },
    { cx: 500, cy: 350, r: 260, count: 24 },
    { cx: -550, cy: 380, r: 270, count: 26 },
    { cx: 80, cy: -480, r: 240, count: 22 },
    { cx: -180, cy: 500, r: 250, count: 22 },
    { cx: 880, cy: 80, r: 220, count: 16 },
    { cx: -830, cy: -60, r: 210, count: 14 },
    { cx: 260, cy: 620, r: 200, count: 14 },
    { cx: -340, cy: -620, r: 210, count: 14 },
  ]

  let id = 0

  for (const seed of seeds) {
    const startId = id
    for (let i = 0; i < seed.count; i++) {
      const angle = rand() * Math.PI * 2
      const r = Math.pow(rand(), 0.55) * seed.r

      nodes.push({
        x: seed.cx + Math.cos(angle) * r,
        y: seed.cy + Math.sin(angle) * r,
        size: 0.06 + rand() * 0.94,
      })

      if (i > 0) {
        const count = 1 + Math.floor(rand() * 2)
        for (let e = 0; e < count; e++) {
          const target = startId + Math.floor(rand() * i)
          edges.push({ source: id, target, weight: 0.2 + rand() * 0.8 })
        }
      }
      id++
    }
  }

  for (let i = 0; i < 120; i++) {
    const x = (rand() - 0.5) * 2400
    const y = (rand() - 0.5) * 1800
    nodes.push({ x, y, size: 0.03 + rand() * 0.18 })
    id++
  }

  // Proximity edges
  const totalNodes = nodes.length
  for (let i = 0; i < totalNodes; i++) {
    const ni = nodes[i]
    const candidates: { idx: number; dist: number }[] = []
    for (let s = 0; s < 20; s++) {
      const j = Math.floor(rand() * totalNodes)
      if (j === i) continue
      const nj = nodes[j]
      const d = Math.sqrt((ni.x - nj.x) ** 2 + (ni.y - nj.y) ** 2)
      candidates.push({ idx: j, dist: d })
    }
    candidates.sort((a, b) => a.dist - b.dist)

    const connectCount = 2 + Math.floor(rand() * 2)
    for (let c = 0; c < Math.min(connectCount, candidates.length); c++) {
      const cand = candidates[c]
      if (cand.dist < 350) {
        edges.push({
          source: i,
          target: cand.idx,
          weight: Math.max(0.03, 0.3 - cand.dist / 1200),
        })
      }
    }
  }

  // Assign concept labels to the largest nodes
  let labelIdx = 0
  const sorted = nodes.map((n, i) => ({ n, i })).sort((a, b) => b.n.size - a.n.size)
  for (const { n } of sorted) {
    if (labelIdx >= AI_CONCEPTS.length) break
    n.label = AI_CONCEPTS[labelIdx++]
  }

  return { nodes, edges }
}

export const graphData = generateGraphData()
