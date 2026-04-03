"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

interface TimelineEvent {
  id: string
  type: "feed" | "compile"
  label: string
  time: string
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
      supabase.from("sources").select("id, title, source_type, created_at").eq("engram_id", engramId).order("created_at", { ascending: false }).limit(10),
      supabase.from("compilation_runs").select("id, trigger_type, articles_created, articles_updated, started_at").eq("engram_id", engramId).order("started_at", { ascending: false }).limit(10),
    ]).then(([sourcesRes, runsRes]) => {
      const all: TimelineEvent[] = []
      sourcesRes.data?.forEach(s => all.push({ id: `s-${s.id}`, type: "feed", label: s.title ?? s.source_type, time: s.created_at }))
      runsRes.data?.forEach(r => all.push({ id: `r-${r.id}`, type: "compile", label: `${r.articles_created + r.articles_updated} articles`, time: r.started_at }))
      all.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      setEvents(all.slice(0, 10))
    })
  }, [engramId])

  const items = events.length > 0 ? events : [
    { id: "p1", type: "feed" as const, label: "arxiv.org/abs/2312.07413", time: new Date(Date.now() - 300000).toISOString() },
    { id: "p2", type: "compile" as const, label: "4 articles", time: new Date(Date.now() - 280000).toISOString() },
    { id: "p3", type: "feed" as const, label: "transformers.pdf", time: new Date(Date.now() - 900000).toISOString() },
    { id: "p4", type: "compile" as const, label: "2 articles", time: new Date(Date.now() - 880000).toISOString() },
    { id: "p5", type: "feed" as const, label: "notes-on-rl.md", time: new Date(Date.now() - 3600000).toISOString() },
    { id: "p6", type: "compile" as const, label: "3 articles", time: new Date(Date.now() - 3500000).toISOString() },
  ]

  return (
    <div className="absolute top-3 right-[215px] z-30 pointer-events-auto animate-slide-in-right" style={{ animationDelay: "250ms" }}>
      <div className="relative pl-3">
        {/* Vertical line */}
        <div className="absolute left-[2px] top-1 bottom-1 w-px" style={{
          background: "linear-gradient(to bottom, transparent, #333 10%, #333 90%, transparent)",
        }} />

        <div className="space-y-2.5">
          {items.map((ev) => (
            <div key={ev.id} className="relative flex items-center gap-2 group">
              {/* Dot on the line */}
              <div
                className="absolute left-[-11px] w-[5px] h-[5px] rounded-full z-10"
                style={{ backgroundColor: ev.type === "compile" ? "#7A8F76" : "#555" }}
              />
              {/* Label */}
              <span className="font-mono text-[9px] text-text-ghost truncate max-w-[100px] group-hover:text-text-tertiary transition-colors duration-150">
                {ev.label}
              </span>
              <span className="font-mono text-[8px] text-text-ghost shrink-0">{timeAgo(ev.time)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
