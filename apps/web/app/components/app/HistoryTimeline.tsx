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

const TRUNK_COLOR = "#76808F"
const BRANCH_COLOR = "#7A8F76"

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
      runsRes.data?.forEach(r => all.push({ id: `r-${r.id}`, type: "compile", label: `${r.articles_created + r.articles_updated} articles`, time: r.started_at, count: r.articles_created }))
      all.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      setEvents(all.slice(0, 10))
    })
  }, [engramId])

  const items = events.length > 0 ? events : [
    { id: "p1", type: "feed" as const, label: "arxiv.org/abs/2312.07413", time: new Date(Date.now() - 300000).toISOString() },
    { id: "p2", type: "compile" as const, label: "4 articles", time: new Date(Date.now() - 280000).toISOString(), count: 4 },
    { id: "p3", type: "feed" as const, label: "transformers.pdf", time: new Date(Date.now() - 900000).toISOString() },
    { id: "p4", type: "compile" as const, label: "2 articles", time: new Date(Date.now() - 880000).toISOString(), count: 2 },
    { id: "p5", type: "feed" as const, label: "notes-on-rl.md", time: new Date(Date.now() - 3600000).toISOString() },
    { id: "p6", type: "compile" as const, label: "3 articles", time: new Date(Date.now() - 3500000).toISOString(), count: 3 },
    { id: "p7", type: "feed" as const, label: "attention.pdf", time: new Date(Date.now() - 7200000).toISOString() },
  ]

  const rowH = 24
  const trunkX = 12
  const branchX = 30
  const totalH = items.length * rowH + 8

  return (
    <div className="animate-slide-in-left mt-2" style={{ animationDelay: "400ms" }}>
      <div className="relative" style={{ height: totalH }}>
        <svg
          width="100%"
          height={totalH}
          viewBox={`0 0 220 ${totalH}`}
          className="overflow-visible"
        >
          {/* Trunk line — vertical */}
          <line x1={trunkX} y1="0" x2={trunkX} y2={totalH} stroke={TRUNK_COLOR} strokeWidth="1.5" opacity="0.25" />

          {items.map((ev, i) => {
            const y = i * rowH + rowH / 2 + 4
            const isFeed = ev.type === "feed"
            const color = isFeed ? TRUNK_COLOR : BRANCH_COLOR
            const nodeX = isFeed ? trunkX : branchX

            // Find the previous feed above this compile to draw branch-off curve
            const prevFeedIdx = !isFeed ? items.slice(0, i).findLastIndex(e => e.type === "feed") : -1
            const prevFeedY = prevFeedIdx >= 0 ? prevFeedIdx * rowH + rowH / 2 + 4 : -1

            // Find the next feed below this compile to draw merge-back curve
            const nextFeedIdx = !isFeed ? items.slice(i + 1).findIndex(e => e.type === "feed") : -1
            const nextFeedY = nextFeedIdx >= 0 ? (i + 1 + nextFeedIdx) * rowH + rowH / 2 + 4 : -1

            return (
              <g key={ev.id} className="group">
                {/* Branch-off curve: trunk → branch lane */}
                {!isFeed && prevFeedY >= 0 && (
                  <path
                    d={`M${trunkX},${prevFeedY} C${trunkX},${(prevFeedY + y) / 2} ${branchX},${(prevFeedY + y) / 2} ${branchX},${y}`}
                    fill="none" stroke={BRANCH_COLOR} strokeWidth="1.5" opacity="0.3"
                  />
                )}

                {/* Merge-back curve: branch lane → trunk */}
                {!isFeed && nextFeedY >= 0 && (
                  <path
                    d={`M${branchX},${y} C${branchX},${(y + nextFeedY) / 2} ${trunkX},${(y + nextFeedY) / 2} ${trunkX},${nextFeedY}`}
                    fill="none" stroke={BRANCH_COLOR} strokeWidth="1.5" opacity="0.3"
                  />
                )}

                {/* Node */}
                <circle cx={nodeX} cy={y} r="3.5" fill="none" stroke={color} strokeWidth="1.5" opacity="0.9" />
                <circle cx={nodeX} cy={y} r="1.5" fill={color} />

                {/* Label */}
                <text
                  x={isFeed ? trunkX + 14 : branchX + 14}
                  y={y + 3}
                  fill="#555"
                  fontSize="8"
                  fontFamily="var(--font-mono)"
                  className="group-hover:fill-[#888] transition-colors duration-150"
                >
                  <tspan className="truncate">{ev.label.length > 22 ? ev.label.slice(0, 22) + "…" : ev.label}</tspan>
                </text>

                {/* Timestamp */}
                <text
                  x="210"
                  y={y + 3}
                  textAnchor="end"
                  fill="#3A3A3A"
                  fontSize="7"
                  fontFamily="var(--font-mono)"
                >
                  {timeAgo(ev.time)}
                </text>

                {/* Hover tooltip */}
                <foreignObject
                  x={nodeX + 10} y={y - 22} width="180" height="18"
                  className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none"
                >
                  <div className="inline-block bg-surface/95 backdrop-blur-sm border border-border rounded-sm px-2 py-0.5 whitespace-nowrap">
                    <span className="font-mono text-[8px] text-text-secondary">{ev.label}</span>
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
