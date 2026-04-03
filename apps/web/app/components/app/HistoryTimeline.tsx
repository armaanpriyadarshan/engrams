"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

interface TimelineEvent {
  id: string
  type: "feed" | "compile" | "query"
  label: string
  detail: string
  time: string
  children?: number
}

function timeAgo(date: string): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60) return "now"
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function HistoryTimeline({ engramId }: { engramId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([])

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from("sources").select("id, title, source_type, created_at").eq("engram_id", engramId).order("created_at", { ascending: false }).limit(6),
      supabase.from("compilation_runs").select("id, trigger_type, articles_created, articles_updated, started_at, status").eq("engram_id", engramId).order("started_at", { ascending: false }).limit(6),
    ]).then(([sourcesRes, runsRes]) => {
      const all: TimelineEvent[] = []
      sourcesRes.data?.forEach(s => {
        all.push({ id: `s-${s.id}`, type: "feed", label: "fed", detail: s.title ?? s.source_type, time: s.created_at })
      })
      runsRes.data?.forEach(r => {
        const total = r.articles_created + r.articles_updated
        all.push({ id: `r-${r.id}`, type: "compile", label: "compiled", detail: `${total} article${total !== 1 ? "s" : ""}`, time: r.started_at, children: r.articles_created })
      })
      all.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      setEvents(all.slice(0, 10))
    })
  }, [engramId])

  const items = events.length > 0 ? events : [
    { id: "p1", type: "feed" as const, label: "fed", detail: "arxiv.org/abs/2312.07413", time: new Date(Date.now() - 300000).toISOString() },
    { id: "p2", type: "compile" as const, label: "compiled", detail: "4 articles", time: new Date(Date.now() - 280000).toISOString(), children: 4 },
    { id: "p3", type: "feed" as const, label: "fed", detail: "transformers.pdf", time: new Date(Date.now() - 900000).toISOString() },
    { id: "p4", type: "compile" as const, label: "compiled", detail: "2 articles", time: new Date(Date.now() - 880000).toISOString(), children: 2 },
    { id: "p5", type: "feed" as const, label: "fed", detail: "notes-on-rl.md", time: new Date(Date.now() - 3600000).toISOString() },
    { id: "p6", type: "compile" as const, label: "compiled", detail: "3 articles", time: new Date(Date.now() - 3500000).toISOString(), children: 3 },
    { id: "p7", type: "feed" as const, label: "fed", detail: "attention.pdf", time: new Date(Date.now() - 7200000).toISOString() },
  ]

  return (
    <div className="animate-slide-in-down w-full" style={{ animationDelay: "350ms" }}>
      {/* Git-style horizontal commit graph */}
      <svg viewBox={`0 0 ${items.length * 40 + 20} 40`} className="w-full h-8" preserveAspectRatio="xMidYMid meet">
        {/* Main trunk line */}
        <line x1="8" y1="20" x2={items.length * 40 + 12} y2="20" stroke="#333" strokeWidth="1" />

        {items.map((ev, i) => {
          const x = i * 40 + 20
          const isFeed = ev.type === "feed"
          const color = isFeed ? "#888" : "#7A8F76"
          const hasBranch = ev.children && ev.children > 1

          return (
            <g key={ev.id}>
              {/* Branch line going up for multi-article compilations */}
              {hasBranch && (
                <>
                  <line x1={x} y1="20" x2={x} y2="8" stroke={color} strokeWidth="0.75" opacity="0.5" />
                  {/* Small branch dots */}
                  {Array.from({ length: Math.min(ev.children!, 3) }, (_, j) => (
                    <circle key={j} cx={x - 4 + j * 4} cy="6" r="1.5" fill={color} opacity="0.4" />
                  ))}
                  {/* Merge line back */}
                  <path d={`M${x} 8 Q${x + 8} 8 ${x + 8} 14`} fill="none" stroke={color} strokeWidth="0.5" opacity="0.3" />
                </>
              )}

              {/* Commit node */}
              <circle cx={x} cy="20" r={isFeed ? 3 : 3.5} fill="none" stroke={color} strokeWidth="1.5" />
              <circle cx={x} cy="20" r="1" fill={color} />

              {/* Time label below */}
              <text x={x} y="34" textAnchor="middle" fill="#3A3A3A" fontSize="5" fontFamily="var(--font-mono)">
                {timeAgo(ev.time).replace(" ago", "")}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Hover labels rendered as HTML for better text rendering */}
      <div className="relative flex" style={{ marginTop: -32, height: 32 }}>
        {items.map((ev, i) => (
          <div key={ev.id} className="group relative flex justify-center" style={{ width: 40 }}>
            <div className="absolute bottom-full mb-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none whitespace-nowrap z-50">
              <div className="bg-surface/95 backdrop-blur-sm border border-border rounded-sm px-2 py-1">
                <p className="font-mono text-[9px] text-text-secondary">
                  <span className={ev.type === "feed" ? "text-text-tertiary" : "text-confidence-high"}>{ev.label}</span>
                  {" "}{ev.detail}
                </p>
                <p className="font-mono text-[8px] text-text-ghost">{timeAgo(ev.time)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
