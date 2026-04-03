"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

interface Source {
  id: string
  title: string | null
  source_type: string
  status: string
  created_at: string
}

interface CompileRun {
  id: string
  source_id: string | null
  articles_created: number
  articles_updated: number
  status: string
  started_at: string
}

function timeAgo(date: string): string {
  if (!date) return ""
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60) return "now"
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export default function SourceTree({ engramId }: { engramId: string }) {
  const [sources, setSources] = useState<Source[]>([])
  const [runs, setRuns] = useState<CompileRun[]>([])

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from("sources").select("id, title, source_type, status, created_at").eq("engram_id", engramId).order("created_at", { ascending: false }).limit(8),
      supabase.from("compilation_runs").select("id, source_id, articles_created, articles_updated, status, started_at").eq("engram_id", engramId).order("started_at", { ascending: false }).limit(12),
    ]).then(([srcRes, runRes]) => {
      if (srcRes.data) setSources(srcRes.data)
      if (runRes.data) setRuns(runRes.data)
    })
  }, [engramId])

  const placeholderSources: Source[] = [
    { id: "p1", title: "arxiv.org/abs/2312.07413", source_type: "url", status: "compiled", created_at: new Date(Date.now() - 300000).toISOString() },
    { id: "p2", title: "deep-learning-history.pdf", source_type: "pdf", status: "compiled", created_at: new Date(Date.now() - 900000).toISOString() },
    { id: "p3", title: "notes-on-transformers.md", source_type: "text", status: "compiled", created_at: new Date(Date.now() - 3600000).toISOString() },
    { id: "p4", title: "github.com/openai/gpt-4", source_type: "url", status: "pending", created_at: new Date(Date.now() - 7200000).toISOString() },
    { id: "p5", title: "rl-intro.txt", source_type: "text", status: "compiled", created_at: new Date(Date.now() - 86400000).toISOString() },
  ]

  const placeholderRuns: CompileRun[] = [
    { id: "r1", source_id: "p1", articles_created: 3, articles_updated: 1, status: "completed", started_at: new Date(Date.now() - 280000).toISOString() },
    { id: "r2", source_id: "p2", articles_created: 2, articles_updated: 0, status: "completed", started_at: new Date(Date.now() - 880000).toISOString() },
    { id: "r3", source_id: "p3", articles_created: 1, articles_updated: 2, status: "completed", started_at: new Date(Date.now() - 3500000).toISOString() },
  ]

  const items = sources.length > 0 ? sources : placeholderSources
  const compiles = runs.length > 0 ? runs : placeholderRuns

  const statusDot = (status: string) => {
    if (status === "compiled") return "#7A8F76"
    if (status === "processing") return "#76808F"
    if (status === "failed") return "#8F4040"
    return "#3A3A3A"
  }

  const runsForSource = (sourceId: string) => compiles.filter(r => r.source_id === sourceId)

  return (
    <div className="absolute top-3 left-3 z-30 max-w-[220px] pointer-events-auto animate-slide-in-left" style={{ animationDelay: "200ms" }}>
      <div className="bg-surface/80 backdrop-blur-md border border-border rounded-sm px-3 py-2.5">
        <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">History</span>

        <div className="mt-2 relative">
          {/* Trunk line */}
          <div className="absolute left-[2px] top-1 bottom-1 w-px" style={{
            background: "linear-gradient(to bottom, #444, #444 90%, transparent)",
          }} />

          <div className="space-y-0">
            {items.map((s, i) => {
              const branches = runsForSource(s.id)
              const isLast = i === items.length - 1
              return (
                <div key={s.id} className="relative">
                  {/* Source node on trunk */}
                  <div className="flex items-start gap-2 pl-3 py-[3px] group">
                    {/* Dot */}
                    <div className="absolute left-0 top-[7px] w-[5px] h-[5px] rounded-full z-10"
                      style={{ backgroundColor: statusDot(s.status) }} />
                    {/* Horizontal connector from trunk to label */}
                    <div className="absolute left-[5px] top-[9px] w-[6px] h-px bg-border" />

                    <span className="font-mono text-[9px] text-text-tertiary truncate group-hover:text-text-secondary transition-colors duration-150 pl-1.5">
                      {s.title ?? s.source_type}
                    </span>
                    <span className="font-mono text-[8px] text-text-ghost shrink-0 ml-auto">{timeAgo(s.created_at)}</span>
                  </div>

                  {/* Branch: compilation results */}
                  {branches.map((r) => {
                    const total = r.articles_created + r.articles_updated
                    return (
                      <div key={r.id} className="flex items-center gap-1.5 pl-6 py-[2px] relative">
                        {/* Branch connector: vertical stub + horizontal */}
                        <div className="absolute left-[2px] top-0 w-px h-[10px] bg-border" />
                        <div className="absolute left-[2px] top-[10px] w-[14px] h-px bg-border" />
                        <div className="absolute left-[16px] top-[7px] w-[4px] h-[4px] rounded-full"
                          style={{ backgroundColor: r.status === "completed" ? "#7A8F76" : "#76808F" }} />

                        <span className="font-mono text-[8px] text-text-ghost pl-2.5">
                          {r.articles_created > 0 && `+${r.articles_created}`}
                          {r.articles_updated > 0 && ` ~${r.articles_updated}`}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
