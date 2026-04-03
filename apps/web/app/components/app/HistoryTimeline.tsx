"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

interface TimelineEvent {
  id: string
  type: "feed" | "compile" | "lint" | "query"
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

// Three lanes: trunk (feeds), branch-1 (compile), branch-2 (agents/lint)
const LANE_X = [10, 26, 42]
const LANE_COLORS = ["#76808F", "#7A8F76", "#8F8A76"]

function laneFor(type: string): number {
  if (type === "feed") return 0
  if (type === "compile") return 1
  return 2
}

export default function HistoryTimeline({ engramId }: { engramId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([])

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from("sources").select("id, title, source_type, created_at").eq("engram_id", engramId).order("created_at", { ascending: false }).limit(5),
      supabase.from("compilation_runs").select("id, trigger_type, articles_created, articles_updated, started_at").eq("engram_id", engramId).order("started_at", { ascending: false }).limit(5),
    ]).then(([sourcesRes, runsRes]) => {
      const all: TimelineEvent[] = []
      sourcesRes.data?.forEach(s => all.push({ id: `s-${s.id}`, type: "feed", label: s.title ?? s.source_type, time: s.created_at }))
      runsRes.data?.forEach(r => {
        const t = r.trigger_type === "lint" ? "lint" : "compile"
        all.push({ id: `r-${r.id}`, type: t, label: t === "lint" ? "linted" : `${r.articles_created + r.articles_updated} compiled`, time: r.started_at })
      })
      all.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      setEvents(all.slice(0, 12))
    })
  }, [engramId])

  const items = events.length > 0 ? events : [
    { id: "p01", type: "feed" as const, label: "arxiv.org/abs/2312.07413", time: new Date(Date.now() - 120000).toISOString() },
    { id: "p02", type: "compile" as const, label: "4 compiled", time: new Date(Date.now() - 110000).toISOString() },
    { id: "p03", type: "lint" as const, label: "linted", time: new Date(Date.now() - 100000).toISOString() },
    { id: "p04", type: "feed" as const, label: "transformers.pdf", time: new Date(Date.now() - 600000).toISOString() },
    { id: "p05", type: "compile" as const, label: "2 compiled", time: new Date(Date.now() - 580000).toISOString() },
    { id: "p06", type: "feed" as const, label: "notes-on-rl.md", time: new Date(Date.now() - 1800000).toISOString() },
    { id: "p07", type: "compile" as const, label: "3 compiled", time: new Date(Date.now() - 1780000).toISOString() },
    { id: "p08", type: "lint" as const, label: "linted", time: new Date(Date.now() - 1700000).toISOString() },
    { id: "p09", type: "feed" as const, label: "attention.pdf", time: new Date(Date.now() - 3600000).toISOString() },
    { id: "p10", type: "compile" as const, label: "1 compiled", time: new Date(Date.now() - 3580000).toISOString() },
  ]

  const rowH = 20
  const totalH = items.length * rowH + 8

  return (
    <div className="animate-slide-in-left mt-2" style={{ animationDelay: "400ms" }}>
      <div style={{ height: totalH }}>
        <svg width="100%" height={totalH} viewBox={`0 0 220 ${totalH}`} className="overflow-visible">
          {/* Lane lines — continuous verticals */}
          {LANE_X.map((lx, li) => (
            <line key={li} x1={lx} y1="0" x2={lx} y2={totalH}
              stroke={LANE_COLORS[li]} strokeWidth="1.5" opacity="0.15" />
          ))}

          {/* Connection curves between consecutive nodes */}
          {items.map((ev, i) => {
            if (i === 0) return null
            const prev = items[i - 1]
            const prevLane = laneFor(prev.type)
            const currLane = laneFor(ev.type)
            const prevX = LANE_X[prevLane]
            const currX = LANE_X[currLane]
            const prevY = (i - 1) * rowH + rowH / 2 + 4
            const currY = i * rowH + rowH / 2 + 4
            const midY = (prevY + currY) / 2

            // Pick the color of the destination lane
            const color = LANE_COLORS[currLane]

            if (prevLane === currLane) {
              // Same lane — straight segment with full opacity
              return <line key={`c-${ev.id}`} x1={prevX} y1={prevY} x2={currX} y2={currY}
                stroke={color} strokeWidth="1.5" opacity="0.4" />
            }

            // Different lanes — smooth S-curve
            return <path key={`c-${ev.id}`}
              d={`M${prevX},${prevY} C${prevX},${midY} ${currX},${midY} ${currX},${currY}`}
              fill="none" stroke={color} strokeWidth="1.5" opacity="0.35" />
          })}

          {/* Nodes + labels */}
          {items.map((ev, i) => {
            const lane = laneFor(ev.type)
            const cx = LANE_X[lane]
            const y = i * rowH + rowH / 2 + 4
            const color = LANE_COLORS[lane]
            const isTrunk = lane === 0

            return (
              <g key={ev.id}>
                {/* Node */}
                <circle cx={cx} cy={y} r={isTrunk ? 4 : 3} fill="none" stroke={color} strokeWidth="1.5" />
                <circle cx={cx} cy={y} r={isTrunk ? 2 : 1.5} fill={color} />

                {/* Label */}
                <text x="54" y={y + 3} fill="#555" fontSize="8" fontFamily="var(--font-mono)">
                  {ev.label.length > 18 ? ev.label.slice(0, 18) + "…" : ev.label}
                </text>

                {/* Timestamp */}
                <text x="210" y={y + 3} textAnchor="end" fill="#3A3A3A" fontSize="7" fontFamily="var(--font-mono)">
                  {timeAgo(ev.time)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
