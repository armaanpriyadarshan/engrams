"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

interface AgentRun {
  id: string
  agent_type: string
  status: string
  summary: string | null
  started_at: string
}

function timeAgo(date: string): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function AgentTimeline({ engramId }: { engramId: string }) {
  const [runs, setRuns] = useState<AgentRun[]>([])

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from("compilation_runs")
      .select("id, trigger_type, status, articles_created, articles_updated, started_at")
      .eq("engram_id", engramId)
      .order("started_at", { ascending: false })
      .limit(6)
      .then(({ data }) => {
        if (data) {
          setRuns(data.map(d => ({
            id: d.id,
            agent_type: d.trigger_type,
            status: d.status,
            summary: d.status === "completed"
              ? `${d.articles_created} created, ${d.articles_updated} updated`
              : d.status === "running" ? "Compiling..." : d.status,
            started_at: d.started_at,
          })))
        }
      })
  }, [engramId])

  // Placeholder when empty
  const items = runs.length > 0 ? runs : [
    { id: "p1", agent_type: "compiler", status: "completed", summary: "4 articles created", started_at: new Date(Date.now() - 120000).toISOString() },
    { id: "p2", agent_type: "linter", status: "completed", summary: "1 gap found", started_at: new Date(Date.now() - 3600000).toISOString() },
    { id: "p3", agent_type: "feed", status: "completed", summary: "2 sources ingested", started_at: new Date(Date.now() - 10800000).toISOString() },
    { id: "p4", agent_type: "freshener", status: "completed", summary: "3 articles refreshed", started_at: new Date(Date.now() - 86400000).toISOString() },
  ]

  const typeLabel: Record<string, string> = {
    feed: "Fed",
    compiler: "Compiled",
    linter: "Linted",
    freshener: "Freshened",
    discoverer: "Discovered",
    deep: "Deep compile",
    targeted: "Targeted",
    lint: "Linted",
  }

  const statusColor = (status: string) => {
    if (status === "completed") return "bg-confidence-high"
    if (status === "running") return "bg-agent-active"
    if (status === "failed") return "bg-danger"
    return "bg-text-ghost"
  }

  return (
    <div className="absolute top-3 right-3 z-30 max-w-[200px] pointer-events-auto">
      <div className="bg-surface/80 backdrop-blur-md border border-border rounded-sm px-3 py-2.5">
        <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Activity</span>
        <div className="mt-2 space-y-1.5">
          {items.map((r) => (
            <div key={r.id} className="flex items-start gap-2">
              <div className={`w-1 h-1 rounded-full mt-1 shrink-0 ${statusColor(r.status)}`} />
              <div className="min-w-0">
                <span className="font-mono text-[10px] text-text-tertiary block truncate">
                  {typeLabel[r.agent_type] ?? r.agent_type} &middot; {r.summary}
                </span>
                <span className="font-mono text-[9px] text-text-ghost">
                  {timeAgo(r.started_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
