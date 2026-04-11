/* eslint-disable react-hooks/refs -- this hook deliberately uses refs as
   cross-render caches for force-layout positions, adjacency, and scale
   so that new data doesn't retrigger the full simulation. The React 19
   rule is aware that ref access inside useMemo is unusual but here it's
   the intended behavior. */
import { useMemo, useRef } from "react"
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type SimulationNodeDatum, type SimulationLinkDatum } from "d3-force"
import type { GraphData } from "./useGraphData"
import { getSafeViewport } from "@/lib/map-viewport-bounds"

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

const STORAGE_KEY_PREFIX = "engrams-map-layout-"

interface StoredLayout {
  positions: Array<[string, { x: number; y: number }]>
  maxR: number
}

function readStoredLayout(engramId: string | null): StoredLayout | null {
  if (!engramId || typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + engramId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredLayout
    if (!parsed || !Array.isArray(parsed.positions) || typeof parsed.maxR !== "number") {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeStoredLayout(
  engramId: string | null,
  positions: Map<string, { x: number; y: number }>,
  maxR: number,
) {
  if (!engramId || typeof window === "undefined") return
  try {
    const payload: StoredLayout = {
      positions: Array.from(positions.entries()),
      maxR,
    }
    window.localStorage.setItem(STORAGE_KEY_PREFIX + engramId, JSON.stringify(payload))
  } catch {
    // Quota exceeded or other storage failure — silently drop. Layout
    // still works in memory; only the cross-refresh continuity is lost.
  }
}

export function useForceLayout(
  data: GraphData | null,
  width: number,
  height: number,
  engramId: string | null = null,
): LayoutResult | null {
  // Cache previous positions (in normalized simulation space, pre-scale)
  // by slug so existing nodes don't jump on refresh. Seeded lazily from
  // localStorage inside the useMemo so that a page refresh produces the
  // same constellation the user was looking at — incremental updates and
  // fresh loads stay visually consistent.
  const prevPositions = useRef<Map<string, { x: number; y: number }>>(new Map())
  // Cache the adjacency of the PREVIOUS layout so we can compute the
  // direct neighbors of nodes that were just removed — those are gone
  // from the new data.edges by the time we run this diff.
  const prevAdjacency = useRef<Map<string, Set<string>>>(new Map())
  // Cache the scale from the FIRST layout. Reusing it means adding a node
  // never rescales the whole graph — existing nodes stay exactly where they
  // were, and new nodes slot in at the same world-space density.
  const scaleRef = useRef<LayoutScale | null>(null)
  // Track which engram we last seeded from storage so we re-seed when the
  // user switches engrams within the same browser session.
  const seededEngramId = useRef<string | null>(null)

  return useMemo(() => {
    if (!data || data.nodes.length === 0) return null

    // Seed caches from localStorage on first useMemo call per engram, or
    // whenever the engram changes. Can't do this in the useRef initializer
    // because engramId is loaded asynchronously and is null on first
    // render — the initializer runs before the id is known.
    if (engramId !== seededEngramId.current) {
      seededEngramId.current = engramId
      const stored = readStoredLayout(engramId)
      if (stored) {
        prevPositions.current = new Map(stored.positions)
        scaleRef.current = null // will be re-initialized below using stored maxR
      } else {
        prevPositions.current = new Map()
        scaleRef.current = null
      }
      prevAdjacency.current = new Map()
    }

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

    const links: SimulationLinkDatum<ForceNode>[] = data.edges.map((e) => ({
      source: e.sourceIdx,
      target: e.targetIdx,
    }))

    const nodeCount = nodes.length
    // Moderated repulsion so outlier nodes don't drift way past the edge.
    const repulsion = -30 - Math.min(nodeCount, 40)

    const simulation = forceSimulation(nodes)
      // Looser link distance (was 25) makes linked clusters more readable
      // without making them fly apart. Link strength weakened from 0.7 to
      // 0.5 so ripple neighbors travel further before the link force pulls
      // them back — makes the soft ripple on add/delete more visible.
      .force("link", forceLink(links).distance(40).strength(0.5))
      .force("charge", forceManyBody().strength(repulsion))
      // Stronger center force (was 0.4) pulls distant outliers back in.
      .force("center", forceCenter(0, 0).strength(0.6))
      // Larger collide radius (was 18 + depth*10) enforces a minimum
      // spacing so "extremely close" pairs can't form.
      .force("collide", forceCollide().radius((_, i) => 22 + data.nodes[i].depth * 8).strength(1))
      .stop()

    // On refresh, only new nodes + ripple neighbors move. Bumped from 40
    // to 60 so neighbors accumulate enough displacement to be visible as
    // a motion rather than an imperceptible nudge.
    const ticks = isRefresh ? 60 : Math.min(300, 100 + nodeCount * 2)
    for (let i = 0; i < ticks; i++) {
      simulation.tick()
    }

    // Establish the scale on first layout and never change it.
    // targetRadius is derived from the safe viewport (the visible
    // rectangle not covered by widgets) so the constellation naturally
    // fits what the user can actually see.
    if (!scaleRef.current) {
      // Prefer the stored maxR from localStorage when available — that
      // way the rendered coordinates match exactly across refresh, not
      // just the raw simulation coordinates. Without this, a fresh
      // recompute from the loaded positions could produce a slightly
      // different maxR (e.g. if a node had drifted to a new radius
      // between sessions) and the whole graph would look rescaled.
      const stored = readStoredLayout(engramId)
      let maxR = 1
      if (stored && stored.maxR > 0) {
        maxR = stored.maxR
      } else {
        for (const node of nodes) {
          const r = Math.sqrt((node.x ?? 0) ** 2 + (node.y ?? 0) ** 2)
          if (r > maxR) maxR = r
        }
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
    writeStoredLayout(engramId, newCache, scaleRef.current.maxR)

    return {
      positions,
      meta: { newSlugs, rippleSlugs },
    }
  }, [data, width, height, engramId])
}
