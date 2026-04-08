"use client"

import { useEffect, useState, useRef } from "react"
import { createClient } from "@/lib/supabase/client"

interface AgentRun {
  id: string
  agent_type: string
  status: string
  summary: string | null
  detail: Record<string, unknown> | null
  started_at: string
}

const RUNNING_COPY: Record<string, (run: AgentRun) => string> = {
  compile: (r) => {
    const title = (r.detail as { source_title?: string } | null)?.source_title
    return title ? `Compiling ${title}...` : "Compiling..."
  },
  lint: () => "Linting...",
  gaps: () => "Checking for gaps...",
  embed: () => "Indexing...",
  sync: (r) => {
    const service = (r.detail as { service_name?: string } | null)?.service_name
    return service ? `Syncing ${service}...` : "Syncing..."
  },
  parse_file: (r) => {
    const filename = (r.detail as { filename?: string } | null)?.filename
    return filename ? `Parsing ${filename}...` : "Parsing..."
  },
  ask: () => "Asking...",
}

// Shows a single quiet line in the top bar whenever one or more agents are
// running for the current engram. Renders null everywhere else (and when
// nothing is running). Designed to be mounted inside the shared TopBar.
export default function CurrentActivityLine({ engramSlug }: { engramSlug?: string }) {
  const [engramId, setEngramId] = useState<string | null>(null)
  const [runningRuns, setRunningRuns] = useState<AgentRun[]>([])
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Resolve the engram slug → id (only on engram pages)
  useEffect(() => {
    if (!engramSlug) {
      setEngramId(null)
      setRunningRuns([])
      return
    }
    const supabase = createClient()
    supabase
      .from("engrams")
      .select("id")
      .eq("slug", engramSlug)
      .limit(1)
      .then(({ data }) => {
        if (mountedRef.current) setEngramId(data?.[0]?.id ?? null)
      })
  }, [engramSlug])

  // Seed + live subscription
  useEffect(() => {
    if (!engramId) return
    const supabase = createClient()

    supabase
      .from("agent_runs")
      .select("id, agent_type, status, summary, detail, started_at")
      .eq("engram_id", engramId)
      .eq("status", "running")
      .order("started_at", { ascending: false })
      .then(({ data }) => {
        if (mountedRef.current && data) setRunningRuns(data as AgentRun[])
      })

    const channel = supabase
      .channel(`current-activity-${engramId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agent_runs", filter: `engram_id=eq.${engramId}` },
        (payload) => {
          const row = payload.new as AgentRun
          if (row.status === "running") {
            setRunningRuns((prev) => [row, ...prev.filter((r) => r.id !== row.id)])
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "agent_runs", filter: `engram_id=eq.${engramId}` },
        (payload) => {
          const row = payload.new as AgentRun
          setRunningRuns((prev) => {
            if (row.status === "running") {
              const existing = prev.find((r) => r.id === row.id)
              if (existing) return prev.map((r) => r.id === row.id ? row : r)
              return [row, ...prev]
            }
            return prev.filter((r) => r.id !== row.id)
          })
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [engramId])

  // Pick the most-recently-started run to display; instantaneous
  // user_edit rows are skipped since they're never in a running state.
  const visibleRun = runningRuns
    .filter((r) => r.agent_type !== "user_edit")
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0]

  if (!engramSlug) return null

  const copy = visibleRun ? (RUNNING_COPY[visibleRun.agent_type]?.(visibleRun) ?? `${visibleRun.agent_type}...`) : ""
  const isVisible = !!visibleRun

  return (
    <span
      className="text-[10px] font-mono text-text-ghost truncate"
      style={{
        opacity: isVisible ? 1 : 0,
        transition: "opacity 180ms ease-out",
      }}
      aria-live="polite"
    >
      {copy}
    </span>
  )
}
