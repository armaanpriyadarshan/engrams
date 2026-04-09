"use client"

// useRecompileQueue — subscribes to the recompile_queue for one engram
// via Supabase Realtime and exposes a predicate to answer "is this
// article being rewritten right now?"
//
// Used by the wiki list and the article reader to render the pulsing
// "updating" dot while propagation is in flight. Also exposes the slugs
// that were updated within the last RECENT_WINDOW_MS so callers can
// show a brief "rewritten" affordance that fades on its own.

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { RealtimeChannel } from "@supabase/supabase-js"

export type RecompileStatus = "pending" | "running" | "completed" | "failed" | "skipped"

export interface RecompileRow {
  id: string
  engram_id: string
  article_slug: string
  status: RecompileStatus
  attempts: number
  enqueued_at: string
  completed_at: string | null
}

const RECENT_WINDOW_MS = 8_000
const REFRESH_TICK_MS = 1_000

export interface UseRecompileQueueReturn {
  /** True when this article has a pending or running queue row. */
  isUpdating: (slug: string) => boolean
  /** True for ~8s after a rewrite completes — for the fade affordance. */
  wasJustRewritten: (slug: string) => boolean
  /** Count of slugs currently pending or running. */
  activeCount: number
}

export function useRecompileQueue(engramId: string | null): UseRecompileQueueReturn {
  // Slugs currently in flight (pending or running).
  const [active, setActive] = useState<Set<string>>(() => new Set())
  // Slug → ms-epoch when we saw the completion event. Entries expire
  // after RECENT_WINDOW_MS via the tick below.
  const [recentlyDone, setRecentlyDone] = useState<Map<string, number>>(
    () => new Map(),
  )
  // Tick to force re-render when recentlyDone entries expire so the UI
  // can drop the "rewritten" badge without each consumer setting its
  // own timer.
  const [, setTick] = useState(0)

  // Initial load: current pending + running rows for this engram.
  useEffect(() => {
    if (!engramId) return
    let cancelled = false
    const supabase = createClient()

    const load = async () => {
      const { data } = await supabase
        .from("recompile_queue")
        .select("article_slug, status")
        .eq("engram_id", engramId)
        .in("status", ["pending", "running"])
      if (cancelled) return
      const next = new Set<string>()
      for (const row of (data ?? []) as { article_slug: string; status: RecompileStatus }[]) {
        next.add(row.article_slug)
      }
      setActive(next)
    }
    load()
    return () => { cancelled = true }
  }, [engramId])

  // Realtime: react to every INSERT/UPDATE/DELETE on recompile_queue
  // scoped to this engram. INSERT+UPDATE adjust the active set; the
  // transition to "completed" flips the slug into recentlyDone.
  useEffect(() => {
    if (!engramId) return
    const supabase = createClient()
    let channel: RealtimeChannel | null = null

    const apply = (row: RecompileRow, op: "INSERT" | "UPDATE" | "DELETE") => {
      const slug = row.article_slug
      if (!slug) return

      setActive((prev) => {
        const next = new Set(prev)
        if (op === "DELETE") {
          next.delete(slug)
        } else if (row.status === "pending" || row.status === "running") {
          next.add(slug)
        } else {
          next.delete(slug)
        }
        return next
      })

      if (op !== "DELETE" && row.status === "completed") {
        setRecentlyDone((prev) => {
          const next = new Map(prev)
          next.set(slug, Date.now())
          return next
        })
      }
    }

    channel = supabase
      .channel(`recompile-queue-${engramId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "recompile_queue", filter: `engram_id=eq.${engramId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as RecompileRow
          if (!row) return
          apply(row, payload.eventType as "INSERT" | "UPDATE" | "DELETE")
        },
      )
      .subscribe()

    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [engramId])

  // Tick once a second while any recentlyDone entries exist, so expired
  // entries get swept out and the UI re-renders without a stale badge.
  useEffect(() => {
    if (recentlyDone.size === 0) return
    const interval = setInterval(() => {
      const now = Date.now()
      setRecentlyDone((prev) => {
        let changed = false
        const next = new Map(prev)
        for (const [slug, at] of next) {
          if (now - at > RECENT_WINDOW_MS) {
            next.delete(slug)
            changed = true
          }
        }
        return changed ? next : prev
      })
      setTick((t) => t + 1)
    }, REFRESH_TICK_MS)
    return () => clearInterval(interval)
  }, [recentlyDone.size])

  const isUpdating = useCallback(
    (slug: string) => active.has(slug),
    [active],
  )

  const wasJustRewritten = useCallback(
    (slug: string) => {
      const at = recentlyDone.get(slug)
      if (at === undefined) return false
      return Date.now() - at <= RECENT_WINDOW_MS
    },
    [recentlyDone],
  )

  const activeCount = useMemo(() => active.size, [active])

  return { isUpdating, wasJustRewritten, activeCount }
}
