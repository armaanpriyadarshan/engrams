"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

interface TimelineEvent {
  id: string
  type: "feed" | "compile"
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
      supabase.from("sources").select("id, title, source_type, created_at").eq("engram_id", engramId).order("created_at", { ascending: false }).limit(6),
      supabase.from("compilation_runs").select("id, trigger_type, articles_created, articles_updated, started_at").eq("engram_id", engramId).order("started_at", { ascending: false }).limit(6),
    ]).then(([sourcesRes, runsRes]) => {
      const all: TimelineEvent[] = []
      sourcesRes.data?.forEach(s => all.push({ id: `s-${s.id}`, type: "feed", label: s.title ?? s.source_type, time: s.created_at }))
      runsRes.data?.forEach(r => all.push({ id: `r-${r.id}`, type: "compile", label: `${r.articles_created + r.articles_updated} articles`, time: r.started_at, branch: r.articles_created > 1 }))
      all.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      setEvents(all.slice(0, 10))
    })
  }, [engramId])

  const items = events.length > 0 ? events : [
    { id: "p1", type: "feed" as const, label: "arxiv.org/abs/2312.07413", time: new Date(Date.now() - 300000).toISOString() },
    { id: "p2", type: "compile" as const, label: "4 articles", time: new Date(Date.now() - 280000).toISOString(), branch: true },
    { id: "p3", type: "feed" as const, label: "transformers.pdf", time: new Date(Date.now() - 900000).toISOString() },
    { id: "p4", type: "compile" as const, label: "2 articles", time: new Date(Date.now() - 880000).toISOString() },
    { id: "p5", type: "feed" as const, label: "notes-on-rl.md", time: new Date(Date.now() - 3600000).toISOString() },
    { id: "p6", type: "compile" as const, label: "3 articles", time: new Date(Date.now() - 3500000).toISOString(), branch: true },
    { id: "p7", type: "feed" as const, label: "attention.pdf", time: new Date(Date.now() - 7200000).toISOString() },
    { id: "p8", type: "compile" as const, label: "1 article", time: new Date(Date.now() - 7100000).toISOString() },
  ]

  const dotColor = (type: string) => type === "compile" ? "#7A8F76" : "#888"

  return (
    <div className="animate-slide-in-down w-full" style={{ animationDelay: "350ms" }}>
      <div className="relative flex items-center justify-center">
        {/* Trunk line */}
        <div className="absolute top-1/2 left-0 right-0 h-px" style={{
          background: "linear-gradient(to right, transparent, #333 10%, #333 90%, transparent)",
        }} />

        <div className="flex items-center relative">
          {items.map((ev, i) => (
            <div key={ev.id} className="relative flex flex-col items-center group" style={{ width: 32 }}>
              {/* Branch — vertical line + fork dots above */}
              {ev.branch && (
                <>
                  <div className="absolute bottom-[12px] w-px h-3" style={{ backgroundColor: dotColor(ev.type), opacity: 0.35 }} />
                  <div className="absolute bottom-[22px] flex gap-[3px]">
                    {Array.from({ length: Math.min(ev.branch ? 3 : 0, 3) }, (_, j) => (
                      <div key={j} className="w-[3px] h-[3px] rounded-full" style={{ backgroundColor: dotColor(ev.type), opacity: 0.4 }} />
                    ))}
                  </div>
                </>
              )}

              {/* Commit dot */}
              <div
                className="w-[5px] h-[5px] rounded-full z-10 transition-all duration-150 group-hover:scale-[2] group-hover:shadow-[0_0_6px_rgba(255,255,255,0.15)]"
                style={{ backgroundColor: dotColor(ev.type) }}
              />

              {/* Hover tooltip */}
              <div className="absolute bottom-6 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none whitespace-nowrap z-50">
                <div className="bg-surface/95 backdrop-blur-sm border border-border rounded-sm px-2 py-1">
                  <p className="font-mono text-[9px] text-text-tertiary truncate max-w-[140px]">{ev.label}</p>
                  <p className="font-mono text-[8px] text-text-ghost">{timeAgo(ev.time)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
