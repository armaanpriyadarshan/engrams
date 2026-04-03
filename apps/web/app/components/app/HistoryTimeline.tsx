"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

interface TimelineEvent {
  id: string
  type: "feed" | "compile" | "query"
  label: string
  time: string
  branch?: boolean
}

function timeAgo(date: string): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60) return "now"
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export default function HistoryTimeline({ engramId }: { engramId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([])

  useEffect(() => {
    const supabase = createClient()

    Promise.all([
      supabase.from("sources").select("id, title, source_type, created_at").eq("engram_id", engramId).order("created_at", { ascending: false }).limit(8),
      supabase.from("compilation_runs").select("id, trigger_type, articles_created, articles_updated, started_at").eq("engram_id", engramId).order("started_at", { ascending: false }).limit(8),
    ]).then(([sourcesRes, runsRes]) => {
      const all: TimelineEvent[] = []

      if (sourcesRes.data) {
        sourcesRes.data.forEach(s => {
          all.push({
            id: `s-${s.id}`,
            type: "feed",
            label: s.title ?? s.source_type,
            time: s.created_at,
          })
        })
      }

      if (runsRes.data) {
        runsRes.data.forEach(r => {
          all.push({
            id: `r-${r.id}`,
            type: "compile",
            label: `${r.articles_created + r.articles_updated} articles`,
            time: r.started_at,
            branch: r.articles_created > 1,
          })
        })
      }

      all.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      setEvents(all.slice(0, 12))
    })
  }, [engramId])

  const items = events.length > 0 ? events : [
    { id: "p1", type: "feed" as const, label: "arxiv.org/abs/2312.07413", time: new Date(Date.now() - 300000).toISOString() },
    { id: "p2", type: "compile" as const, label: "4 articles", time: new Date(Date.now() - 280000).toISOString(), branch: true },
    { id: "p3", type: "feed" as const, label: "transformers.pdf", time: new Date(Date.now() - 900000).toISOString() },
    { id: "p4", type: "compile" as const, label: "2 articles", time: new Date(Date.now() - 880000).toISOString() },
    { id: "p5", type: "feed" as const, label: "notes-on-rl.md", time: new Date(Date.now() - 3600000).toISOString() },
    { id: "p6", type: "compile" as const, label: "3 articles", time: new Date(Date.now() - 3500000).toISOString(), branch: true },
    { id: "p7", type: "feed" as const, label: "attention-paper.pdf", time: new Date(Date.now() - 7200000).toISOString() },
    { id: "p8", type: "compile" as const, label: "1 article", time: new Date(Date.now() - 7100000).toISOString() },
  ]

  const dotColor = (type: string) => {
    if (type === "feed") return "#888"
    if (type === "compile") return "#7A8F76"
    return "#76808F"
  }

  return (
    <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 pointer-events-auto animate-slide-in-down" style={{ animationDelay: "350ms" }}>
      <div className="flex items-center gap-0">
        {/* Main trunk line */}
        <div className="relative flex items-center">
          {/* Horizontal line */}
          <div className="absolute top-1/2 left-0 right-0 h-px" style={{
            background: "linear-gradient(to right, transparent, #333 8%, #333 92%, transparent)",
          }} />

          <div className="flex items-center gap-0 relative">
            {items.map((ev, i) => (
              <div key={ev.id} className="relative flex flex-col items-center group" style={{ width: 28 }}>
                {/* Branch arm for compilations */}
                {ev.branch && (
                  <div className="absolute bottom-[11px] w-px h-2" style={{ backgroundColor: dotColor(ev.type), opacity: 0.4 }} />
                )}

                {/* Dot on the line */}
                <div
                  className="w-[5px] h-[5px] rounded-full z-10 transition-transform duration-150 group-hover:scale-[1.8]"
                  style={{ backgroundColor: dotColor(ev.type) }}
                />

                {/* Tooltip on hover */}
                <div className="absolute bottom-5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none whitespace-nowrap">
                  <div className="bg-surface/95 backdrop-blur-sm border border-border rounded-sm px-2 py-1">
                    <p className="font-mono text-[9px] text-text-tertiary truncate max-w-[120px]">{ev.label}</p>
                    <p className="font-mono text-[8px] text-text-ghost">{timeAgo(ev.time)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
