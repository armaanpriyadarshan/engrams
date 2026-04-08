"use client"

import { useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"

interface CompilationPulseProps {
  engramSlug: string | undefined
}

// Listens to agent_runs and lights up the top bar whenever ANY agent is
// running for this engram — not just compile-source. The sweep appears on
// compile, lint, gap detection, embedding, integration sync, parse_file,
// and user edits.
export default function CompilationPulse({ engramSlug }: CompilationPulseProps) {
  const [running, setRunning] = useState(false)
  const [engramId, setEngramId] = useState<string | null>(null)
  const runningSetRef = useRef<Set<string>>(new Set())

  const refresh = () => setRunning(runningSetRef.current.size > 0)

  // Resolve slug to ID
  useEffect(() => {
    if (!engramSlug) return
    const supabase = createClient()
    supabase
      .from("engrams")
      .select("id")
      .eq("slug", engramSlug)
      .single()
      .then(({ data }) => setEngramId(data?.id ?? null))
  }, [engramSlug])

  // Subscribe to agent_runs
  useEffect(() => {
    if (!engramId) return
    const supabase = createClient()

    // Seed with any currently-running runs so the pulse shows immediately
    // on page reload during long-running work.
    supabase
      .from("agent_runs")
      .select("id")
      .eq("engram_id", engramId)
      .eq("status", "running")
      .then(({ data }) => {
        if (data) {
          runningSetRef.current = new Set(data.map((r) => r.id as string))
          refresh()
        }
      })

    const channel = supabase
      .channel(`pulse-${engramId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agent_runs",
          filter: `engram_id=eq.${engramId}`,
        },
        (payload) => {
          const row = payload.new as { id: string; status?: string }
          if (row.status === "running") {
            runningSetRef.current.add(row.id)
            refresh()
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "agent_runs",
          filter: `engram_id=eq.${engramId}`,
        },
        (payload) => {
          const row = payload.new as { id: string; status?: string }
          if (row.status === "completed" || row.status === "failed") {
            runningSetRef.current.delete(row.id)
            refresh()
          } else if (row.status === "running") {
            runningSetRef.current.add(row.id)
            refresh()
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      runningSetRef.current.clear()
    }
  }, [engramId])

  return (
    <div
      className={`fixed top-0 left-0 w-full h-[2px] z-50 transition-opacity duration-300 ease-out ${
        running ? "opacity-100" : "opacity-0"
      }`}
      style={{
        background: "linear-gradient(90deg, transparent, var(--color-agent-active), transparent)",
        backgroundSize: "200% 100%",
        animation: running ? "compilation-sweep 3s ease-in-out infinite" : "none",
      }}
    />
  )
}
