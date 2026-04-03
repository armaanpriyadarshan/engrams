"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

interface TimelineEvent {
  id: string
  type: "feed" | "compile"
  label: string
  time: string
  count?: number
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
      runsRes.data?.forEach(r => all.push({ id: `r-${r.id}`, type: "compile", label: `${r.articles_created + r.articles_updated} articles compiled`, time: r.started_at, count: r.articles_created }))
      all.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      setEvents(all.slice(0, 10))
    })
  }, [engramId])

  const items = events.length > 0 ? events : [
    { id: "p1", type: "feed" as const, label: "arxiv.org/abs/2312.07413", time: new Date(Date.now() - 300000).toISOString() },
    { id: "p2", type: "compile" as const, label: "4 articles compiled", time: new Date(Date.now() - 280000).toISOString(), count: 4 },
    { id: "p3", type: "feed" as const, label: "transformers.pdf", time: new Date(Date.now() - 900000).toISOString() },
    { id: "p4", type: "compile" as const, label: "2 articles compiled", time: new Date(Date.now() - 880000).toISOString(), count: 2 },
    { id: "p5", type: "feed" as const, label: "notes-on-rl.md", time: new Date(Date.now() - 3600000).toISOString() },
    { id: "p6", type: "compile" as const, label: "3 articles compiled", time: new Date(Date.now() - 3500000).toISOString(), count: 3 },
    { id: "p7", type: "feed" as const, label: "attention.pdf", time: new Date(Date.now() - 7200000).toISOString() },
    { id: "p8", type: "compile" as const, label: "1 article compiled", time: new Date(Date.now() - 7100000).toISOString(), count: 1 },
  ]

  const nodeW = 36
  const totalW = items.length * nodeW
  const trunkY = 40
  const branchUp = 14
  const branchDown = 14

  return (
    <div className="animate-slide-in-down w-full" style={{ animationDelay: "350ms" }}>
      <div className="flex justify-center">
        <svg
          width={totalW}
          height={80}
          viewBox={`0 0 ${totalW} 80`}
          className="overflow-visible"
        >
          {/* Trunk line */}
          <line x1="0" y1={trunkY} x2={totalW} y2={trunkY} stroke="#333" strokeWidth="1" />

          {items.map((ev, i) => {
            const x = i * nodeW + nodeW / 2
            const isCompile = ev.type === "compile"
            const color = isCompile ? "#7A8F76" : "#555"
            // Alternate branches up/down
            const goUp = i % 2 === 0

            const branchEndY = goUp ? trunkY - branchUp : trunkY + branchDown
            const textY = goUp ? branchEndY - 5 : branchEndY + 9
            const timeY = goUp ? branchEndY - 14 : branchEndY + 18

            return (
              <g key={ev.id} className="group">
                {/* Branch line from trunk */}
                <line x1={x} y1={trunkY} x2={x} y2={branchEndY} stroke={color} strokeWidth="0.75" opacity="0.5" />

                {/* Node at end of branch */}
                <rect x={x - 2.5} y={branchEndY - 2.5} width="5" height="5" fill={color} opacity="0.8" />

                {/* Timestamp */}
                <text x={x} y={timeY} textAnchor="middle" fill="#3A3A3A" fontSize="7" fontFamily="var(--font-mono)">
                  {timeAgo(ev.time)}
                </text>

                {/* Hover hitbox — invisible larger rect */}
                <rect x={x - nodeW / 2} y="0" width={nodeW} height="80" fill="transparent" className="cursor-pointer" />

                {/* Hover tooltip — uses foreignObject for proper text */}
                <foreignObject
                  x={x - 70}
                  y={goUp ? -8 : 62}
                  width="140"
                  height="24"
                  className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none"
                >
                  <div className="flex justify-center">
                    <div className="bg-surface/95 backdrop-blur-sm border border-border rounded-sm px-2 py-0.5 whitespace-nowrap">
                      <span className="font-mono text-[8px] text-text-tertiary">{ev.label}</span>
                    </div>
                  </div>
                </foreignObject>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
