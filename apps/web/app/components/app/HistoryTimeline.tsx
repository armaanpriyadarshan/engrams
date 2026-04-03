"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

interface TimelineEvent {
  id: string
  type: "feed" | "compile"
  label: string
  time: string
  count?: number
  lane: number
}

function timeAgo(date: string): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60) return "now"
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// Lane colors like git graph
const LANE_COLORS = ["#76808F", "#7A8F76", "#8F767A", "#8F8A76"]

export default function HistoryTimeline({ engramId }: { engramId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([])

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from("sources").select("id, title, source_type, created_at").eq("engram_id", engramId).order("created_at", { ascending: false }).limit(6),
      supabase.from("compilation_runs").select("id, trigger_type, articles_created, articles_updated, started_at").eq("engram_id", engramId).order("started_at", { ascending: false }).limit(6),
    ]).then(([sourcesRes, runsRes]) => {
      const all: TimelineEvent[] = []
      sourcesRes.data?.forEach(s => all.push({ id: `s-${s.id}`, type: "feed", label: s.title ?? s.source_type, time: s.created_at, lane: 0 }))
      runsRes.data?.forEach(r => all.push({ id: `r-${r.id}`, type: "compile", label: `${r.articles_created + r.articles_updated} articles`, time: r.started_at, count: r.articles_created, lane: 1 }))
      all.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      setEvents(all.slice(0, 10))
    })
  }, [engramId])

  const items = events.length > 0 ? events : [
    { id: "p1", type: "feed" as const, label: "arxiv.org/abs/2312.07413", time: new Date(Date.now() - 300000).toISOString(), lane: 0 },
    { id: "p2", type: "compile" as const, label: "4 articles", time: new Date(Date.now() - 280000).toISOString(), count: 4, lane: 1 },
    { id: "p3", type: "feed" as const, label: "transformers.pdf", time: new Date(Date.now() - 900000).toISOString(), lane: 0 },
    { id: "p4", type: "compile" as const, label: "2 articles", time: new Date(Date.now() - 880000).toISOString(), count: 2, lane: 1 },
    { id: "p5", type: "feed" as const, label: "notes-on-rl.md", time: new Date(Date.now() - 3600000).toISOString(), lane: 0 },
    { id: "p6", type: "compile" as const, label: "3 articles", time: new Date(Date.now() - 3500000).toISOString(), count: 3, lane: 1 },
    { id: "p7", type: "feed" as const, label: "attention.pdf", time: new Date(Date.now() - 7200000).toISOString(), lane: 0 },
    { id: "p8", type: "compile" as const, label: "1 article", time: new Date(Date.now() - 7100000).toISOString(), count: 1, lane: 1 },
  ]

  const step = 34
  const totalW = items.length * step + 20
  const laneSpacing = 12
  const lanes = [24, 24 + laneSpacing] // y positions for 2 lanes

  return (
    <div className="animate-slide-in-down w-full" style={{ animationDelay: "350ms" }}>
      <div className="flex justify-center">
        <svg
          width={totalW}
          height={52}
          viewBox={`0 0 ${totalW} 52`}
          className="overflow-visible"
        >
          {/* Lane lines */}
          {lanes.map((ly, li) => (
            <line key={li} x1="4" y1={ly} x2={totalW - 4} y2={ly}
              stroke={LANE_COLORS[li]} strokeWidth="1.5" opacity="0.2" />
          ))}

          {/* Connections & nodes */}
          {items.map((ev, i) => {
            const x = i * step + step / 2 + 4
            const y = lanes[ev.lane]
            const color = LANE_COLORS[ev.lane]
            const prevEv = items[i - 1]

            // Curved connection to previous node if lane changes
            const prevX = prevEv ? (i - 1) * step + step / 2 + 4 : null
            const prevY = prevEv ? lanes[prevEv.lane] : null
            const laneChanged = prevEv && prevEv.lane !== ev.lane

            return (
              <g key={ev.id} className="group">
                {/* Connection line to previous */}
                {prevX !== null && prevY !== null && (
                  laneChanged ? (
                    // Curved path between lanes
                    <path
                      d={`M${prevX},${prevY} C${prevX + step * 0.4},${prevY} ${x - step * 0.4},${y} ${x},${y}`}
                      fill="none" stroke={color} strokeWidth="1.5" opacity="0.35"
                    />
                  ) : (
                    // Straight line same lane
                    <line x1={prevX} y1={prevY} x2={x} y2={y}
                      stroke={color} strokeWidth="1.5" opacity="0.35" />
                  )
                )}

                {/* Node circle */}
                <circle cx={x} cy={y} r="4" fill="none" stroke={color} strokeWidth="1.5" opacity="0.8" />
                <circle cx={x} cy={y} r="1.5" fill={color} />

                {/* Timestamp below */}
                <text x={x} y="48" textAnchor="middle" fill="#3A3A3A" fontSize="6" fontFamily="var(--font-mono)">
                  {timeAgo(ev.time)}
                </text>

                {/* Hover hitbox */}
                <rect x={x - step / 2} y="0" width={step} height="52" fill="transparent" className="cursor-pointer" />

                {/* Hover tooltip */}
                <foreignObject
                  x={x - 70} y="-20" width="140" height="20"
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
