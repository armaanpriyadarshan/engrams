/* eslint-disable react-hooks/refs -- this hook deliberately uses refs as
   cross-render caches for the persistent force simulation, scale, and
   position data. The simulation lives in a ref so it survives re-renders
   and can be ticked externally by the animation loop. */
import { useRef, useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force-3d"
import type { GraphData } from "./useGraphData"
import { getSafeViewport } from "@/lib/map-viewport-bounds"

// ── Public interfaces ──────────────────────────────────────────────

export interface SimNode extends SimulationNodeDatum {
  index: number
  slug: string
  z?: number
  vz?: number
  fz?: number | null
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  weight: number
}

interface LayoutScale {
  maxR: number
  targetRadius: number
  yOffset: number
}

export interface LayoutMeta {
  newSlugs: Set<string>
  rippleSlugs: Set<string>
}

export interface SimulationHandle {
  /** Tick simulation if warm. Returns true if alpha > 0.001. */
  tick: () => boolean
  /** Read scaled world position for node i into `out`. */
  readPosition: (i: number, out: { x: number; y: number; z: number }) => void
  /** Current node count. */
  count: number
  /** Layout metadata for fade/attention effects. */
  meta: LayoutMeta
}

// ── Persistence ────────────────────────────────────────────────────

const STORAGE_KEY_PREFIX = "engrams-map-layout-v10-"

interface StoredLayout {
  positions: Array<[string, { x: number; y: number; z: number }]>
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
  positions: Map<string, { x: number; y: number; z: number }>,
  maxR: number,
) {
  if (!engramId || typeof window === "undefined") return
  const payload: StoredLayout = {
    positions: Array.from(positions.entries()),
    maxR,
  }
  try {
    window.localStorage.setItem(STORAGE_KEY_PREFIX + engramId, JSON.stringify(payload))
  } catch {
    // Quota exceeded — localStorage write failed, DB write below
    // still provides cross-browser persistence.
  }
  // Fire-and-forget write to Supabase so positions sync across
  // browsers/devices. The DB is the source of truth for cross-browser;
  // localStorage is the fast cache for same-browser.
  try {
    const supabase = createClient()
    Promise.resolve(
      supabase.from("engrams").update({ layout_positions: payload }).eq("id", engramId),
    ).catch(() => {})
  } catch {
    // Supabase client construction failed — skip silently.
  }
}

// ── Debounce timer for persistence on cooldown ─────────────────────

const PERSIST_DELAY_MS = 2000

// ── Hook ───────────────────────────────────────────────────────────

export function useForceLayout(
  data: GraphData | null,
  width: number,
  height: number,
  engramId: string | null = null,
): SimulationHandle | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const simRef = useRef<ReturnType<typeof forceSimulation<SimNode>> | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const prevSlugsRef = useRef<Set<string>>(new Set())
  const scaleRef = useRef<LayoutScale | null>(null)
  const seededEngramId = useRef<string | null>(null)
  const prevPositions = useRef<Map<string, { x: number; y: number; z: number }>>(new Map())
  const metaRef = useRef<LayoutMeta>({ newSlugs: new Set(), rippleSlugs: new Set() })
  const dataRef = useRef<GraphData | null>(null)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasCooledRef = useRef(false)

  // Stable handle ref — never recreated.
  const handleRef = useRef<SimulationHandle | null>(null)

  // Counter that bumps when server-side layout arrives, forcing the
  // effect to re-run with the DB-seeded positions.
  const [dbSyncTick, setDbSyncTick] = useState(0)
  // Counter that bumps when the handle is created/updated, forcing
  // the component to re-render and return the new handle. Refs don't
  // trigger re-renders, so without this the parent stays stuck on null.
  const [handleTick, setHandleTick] = useState(0)

  // Fetch layout from Supabase when localStorage is empty. This is what
  // makes positions persist across browsers/devices — the first browser
  // to compute a layout writes it to the DB, and every other browser
  // reads it here instead of recomputing from scratch.
  useEffect(() => {
    if (!engramId || typeof window === "undefined") return
    const localStored = readStoredLayout(engramId)
    if (localStored) return // localStorage has it, skip DB fetch

    const supabase = createClient()
    Promise.resolve(
      supabase.from("engrams").select("layout_positions").eq("id", engramId).single(),
    )
      .then(({ data: row }) => {
        if (!row?.layout_positions) return
        const serverLayout = row.layout_positions as StoredLayout
        if (!serverLayout || !Array.isArray(serverLayout.positions)) return
        try {
          window.localStorage.setItem(
            STORAGE_KEY_PREFIX + engramId,
            JSON.stringify(serverLayout),
          )
        } catch {}
        prevPositions.current = new Map(serverLayout.positions)
        scaleRef.current = null
        seededEngramId.current = engramId
        setDbSyncTick((c) => c + 1)
      })
      .catch(() => {})
  }, [engramId])

  // ── Schedule persistence on cooldown ──────────────────────────────

  const schedulePersist = useCallback(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      const nodes = nodesRef.current
      if (nodes.length === 0 || !scaleRef.current) return
      const posMap = new Map<string, { x: number; y: number; z: number }>()
      for (const n of nodes) {
        posMap.set(n.slug, { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 })
      }
      prevPositions.current = posMap
      writeStoredLayout(engramId, posMap, scaleRef.current.maxR)
    }, PERSIST_DELAY_MS)
  }, [engramId])

  // ── Create / patch simulation when data changes ───────────────────

  useEffect(() => {
    if (!data || data.nodes.length === 0) {
      // No data — tear down any existing simulation.
      simRef.current = null
      nodesRef.current = []
      prevSlugsRef.current = new Set()
      metaRef.current = { newSlugs: new Set(), rippleSlugs: new Set() }
      if (handleRef.current) handleRef.current.count = 0
      return
    }

    // Seed caches from localStorage on first call per engram, or
    // whenever the engram changes.
    if (engramId !== seededEngramId.current) {
      seededEngramId.current = engramId
      const stored = readStoredLayout(engramId)
      if (stored) {
        prevPositions.current = new Map(stored.positions)
        scaleRef.current = null
      } else {
        prevPositions.current = new Map()
        scaleRef.current = null
      }
      prevSlugsRef.current = new Set()
      simRef.current = null // force full rebuild for new engram
    }

    dataRef.current = data
    const prev = prevPositions.current
    const prevSlugs = prevSlugsRef.current
    const isRefresh = prevSlugs.size > 0

    // ── Diff ────────────────────────────────────────────────────────
    const currentSlugs = new Set(data.nodes.map((n) => n.slug))
    const newSlugs = new Set<string>()
    const removedSlugs = new Set<string>()

    for (const slug of currentSlugs) {
      if (isRefresh && !prevSlugs.has(slug)) newSlugs.add(slug)
    }
    if (isRefresh) {
      for (const slug of prevSlugs) {
        if (!currentSlugs.has(slug)) removedSlugs.add(slug)
      }
    }

    metaRef.current = { newSlugs, rippleSlugs: new Set() }
    prevSlugsRef.current = currentSlugs

    // ── Centroid of existing nodes for seeding new arrivals ──────────
    let cx = 0, cy = 0, cz = 0, cn = 0
    for (const [, pos] of prev) {
      cx += pos.x; cy += pos.y; cz += pos.z; cn++
    }
    if (cn > 0) { cx /= cn; cy /= cn; cz /= cn }

    // ── Build / patch node array ────────────────────────────────────
    const nodes: SimNode[] = data.nodes.map((n, i) => {
      const cached = prev.get(n.slug)
      // Existing sim node — preserve its live position if the simulation
      // is already running, otherwise fall back to cached position.
      const existingSimNode = simRef.current
        ? nodesRef.current.find((sn) => sn.slug === n.slug)
        : null
      if (existingSimNode) {
        return {
          index: i,
          slug: n.slug,
          x: existingSimNode.x,
          y: existingSimNode.y,
          z: existingSimNode.z,
          vx: existingSimNode.vx,
          vy: existingSimNode.vy,
          vz: existingSimNode.vz,
        }
      }
      return {
        index: i,
        slug: n.slug,
        x: cached?.x ?? cx + (Math.random() - 0.5) * 30,
        y: cached?.y ?? cy + (Math.random() - 0.5) * 30,
        z: cached?.z ?? cz + (Math.random() - 0.5) * 30,
      }
    })

    nodesRef.current = nodes

    // ── Build links ─────────────────────────────────────────────────
    const links: SimLink[] = data.edges.map((e) => ({
      source: e.sourceIdx,
      target: e.targetIdx,
      weight: e.weight,
    }))

    const nodeCount = nodes.length
    const repulsion = -4 - Math.min(nodeCount, 6)

    // ── Create or reconfigure simulation ────────────────────────────
    // d3-force-3d requires numDimensions(3) to be set BEFORE nodes are
    // attached — otherwise it initializes nodes using its default 2D
    // phyllotactic seed and z stays undefined, which NaNs the whole
    // position buffer downstream.
    const sim = forceSimulation<SimNode>()
      .numDimensions(3)
      .nodes(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .distance((l: SimLink) => 40 - 10 * (l.weight ?? 1.0))
          .strength((l: SimLink) => 0.55 + 0.2 * (l.weight ?? 1.0)),
      )
      .force("charge", forceManyBody<SimNode>().strength(repulsion))
      .force("center", forceCenter<SimNode>(0, 0, 0).strength(1.0))
      .force(
        "collide",
        forceCollide<SimNode>()
          .radius((_: SimNode, i: number) => 12 + (data.nodes[i]?.depth ?? 0) * 5)
          .strength(1),
      )
      .stop() // We tick manually in the animation loop

    simRef.current = sim
    hasCooledRef.current = false

    // ── Reheat based on what changed ────────────────────────────────
    if (!isRefresh) {
      // First layout — let the simulation run from default alpha (1).
      // No reheat needed.
    } else if (newSlugs.size > 0) {
      sim.alpha(0.3).alphaTarget(0)
    } else if (removedSlugs.size > 0) {
      sim.alpha(0.15).alphaTarget(0)
    } else {
      // Edge-only change (new edges arrived for existing nodes).
      sim.alpha(0.2).alphaTarget(0)
    }

    // ── Compute scale on first layout ───────────────────────────────
    // For a fresh simulation (no stored layout), run a batch of ticks
    // to establish initial positions so we can compute a meaningful maxR.
    if (!scaleRef.current) {
      const stored = readStoredLayout(engramId)
      if (stored && stored.maxR > 0) {
        scaleRef.current = buildScale(stored.maxR)
      } else {
        // Warm up the simulation to get initial positions.
        const warmupTicks = Math.min(300, 100 + nodeCount)
        for (let i = 0; i < warmupTicks; i++) sim.tick()
        let maxR = 1
        for (const node of nodes) {
          const r = Math.sqrt((node.x ?? 0) ** 2 + (node.y ?? 0) ** 2 + (node.z ?? 0) ** 2)
          if (r > maxR) maxR = r
        }
        scaleRef.current = buildScale(maxR)
        // Save initial positions after warmup.
        const posMap = new Map<string, { x: number; y: number; z: number }>()
        for (const n of nodes) {
          posMap.set(n.slug, { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 })
        }
        prevPositions.current = posMap
        writeStoredLayout(engramId, posMap, maxR)
      }
    }

    // ── Build / update the stable handle ────────────────────────────
    if (!handleRef.current) {
      setHandleTick(t => t + 1)
      handleRef.current = {
        tick: () => tickFn(),
        readPosition: (i, out) => readPositionFn(i, out),
        count: nodeCount,
        meta: metaRef.current,
      }
    } else {
      handleRef.current.count = nodeCount
      handleRef.current.meta = metaRef.current
      setHandleTick(t => t + 1)
    }

    function tickFn(): boolean {
      const s = simRef.current
      if (!s) return false
      const alpha = s.alpha()
      if (alpha <= 0.001) {
        // Simulation has cooled — schedule persistence once.
        if (!hasCooledRef.current) {
          hasCooledRef.current = true
          schedulePersist()
        }
        return false
      }
      s.tick()
      // Dynamically update maxR so the scale tracks the actual graph
      // extent. Without this, nodes added after the initial warmup can
      // exceed the frozen maxR and project way off screen.
      const scale = scaleRef.current
      if (scale) {
        let currentMaxR = 1
        for (const n of nodesRef.current) {
          const r = Math.sqrt((n.x ?? 0) ** 2 + (n.y ?? 0) ** 2 + (n.z ?? 0) ** 2)
          if (r > currentMaxR) currentMaxR = r
        }
        if (currentMaxR > scale.maxR) {
          scale.maxR = currentMaxR
        }
      }
      return true
    }

    function readPositionFn(i: number, out: { x: number; y: number; z: number }) {
      const n = nodesRef.current[i]
      const scale = scaleRef.current
      if (!n || !scale) {
        out.x = 0; out.y = 0; out.z = 0
        return
      }
      const { maxR, targetRadius, yOffset } = scale
      out.x = ((n.x ?? 0) / maxR) * targetRadius
      out.y = ((n.y ?? 0) / maxR) * targetRadius + yOffset
      out.z = ((n.z ?? 0) / maxR) * targetRadius
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- dbSyncTick forces
  // re-layout when server-side positions arrive after the initial render.
  }, [data, engramId, dbSyncTick, schedulePersist])

  // Cleanup persist timer on unmount.
  useEffect(() => {
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    }
  }, [])

  if (!data || data.nodes.length === 0) return null
  return handleRef.current
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildScale(maxR: number): LayoutScale {
  const safe =
    typeof window !== "undefined"
      ? getSafeViewport(window.innerWidth, window.innerHeight)
      : { width: 800, height: 600, left: 0, right: 800, top: 0, bottom: 600, centerX: 400, centerY: 300 }
  return {
    maxR,
    targetRadius: Math.min(safe.width, safe.height) * 0.2,
    yOffset: 15,
  }
}
