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

// Two lanes: feeds (left/trunk), compilations (right/branch)
const TRUNK_X = 10
const BRANCH_X = 26
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
      runsRes.data?.forEach(r => all.push({ id: `r-${r.id}`, type: "compile", label: `${r.articles_created + r.articles_updated} articles`, time: r.started_at }))
      all.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      setEvents(all.slice(0, 10))
    })
  }, [engramId])

  const items = events.length > 0 ? events : [
    { id: "p1", type: "feed" as const, label: "arxiv.org/abs/2312.07413", time: new Date(Date.now() - 300000).toISOString() },
    { id: "p2", type: "compile" as const, label: "4 articles compiled", time: new Date(Date.now() - 280000).toISOString() },
    { id: "p3", type: "compile" as const, label: "linted", time: new Date(Date.now() - 260000).toISOString() },
    { id: "p4", type: "feed" as const, label: "transformers.pdf", time: new Date(Date.now() - 900000).toISOString() },
    { id: "p5", type: "compile" as const, label: "2 articles compiled", time: new Date(Date.now() - 880000).toISOString() },
    { id: "p6", type: "feed" as const, label: "notes-on-rl.md", time: new Date(Date.now() - 3600000).toISOString() },
    { id: "p7", type: "compile" as const, label: "3 articles compiled", time: new Date(Date.now() - 3500000).toISOString() },
    { id: "p8", type: "feed" as const, label: "attention.pdf", time: new Date(Date.now() - 7200000).toISOString() },
  ]

  const rowH = 22
  const totalH = items.length * rowH + 4

  // Track which lanes are active at each row to draw continuous lane lines
  const feedRows = items.map((_, i) => items[i].type === "feed")
  const compileRows = items.map((_, i) => items[i].type === "compile")

  // Find contiguous runs for branch lane segments
  const branchSegments: [number, number][] = []
  let segStart = -1
  for (let i = 0; i < items.length; i++) {
    if (compileRows[i] && segStart === -1) segStart = i
    if (!compileRows[i] && segStart !== -1) { branchSegments.push([segStart, i - 1]); segStart = -1 }
  }
  if (segStart !== -1) branchSegments.push([segStart, items.length - 1])

  return (
    <div className="animate-slide-in-left mt-2" style={{ animationDelay: "400ms" }}>
      <div style={{ height: totalH }}>
        <svg width="100%" height={totalH} viewBox={`0 0 220 ${totalH}`} className="overflow-visible">
          {/* Trunk line — continuous vertical */}
          <line x1={TRUNK_X} y1="0" x2={TRUNK_X} y2={totalH} stroke={TRUNK_COLOR} strokeWidth="1.5" opacity="0.3" />

          {/* Branch lane segments — only where compilations exist */}
          {branchSegments.map(([start, end], si) => {
            const y1 = start * rowH + rowH / 2 + 2
            const y2 = end * rowH + rowH / 2 + 2
            // Find nearest feed above to branch from
            const feedAbove = items.slice(0, start).findLastIndex(e => e.type === "feed")
            const branchFromY = feedAbove >= 0 ? feedAbove * rowH + rowH / 2 + 2 : y1 - rowH / 2
            // Find nearest feed below to merge to
            const feedBelow = items.slice(end + 1).findIndex(e => e.type === "feed")
            const mergeToY = feedBelow >= 0 ? (end + 1 + feedBelow) * rowH + rowH / 2 + 2 : y2 + rowH / 2

            return (
              <g key={`seg-${si}`}>
                {/* Branch-off curve from trunk to branch lane */}
                <path
                  d={`M${TRUNK_X},${branchFromY} C${TRUNK_X},${(branchFromY + y1) * 0.5} ${BRANCH_X},${(branchFromY + y1) * 0.5} ${BRANCH_X},${y1}`}
                  fill="none" stroke={BRANCH_COLOR} strokeWidth="1.5" opacity="0.3"
                />
                {/* Branch lane vertical line */}
                {y2 > y1 && (
                  <line x1={BRANCH_X} y1={y1} x2={BRANCH_X} y2={y2} stroke={BRANCH_COLOR} strokeWidth="1.5" opacity="0.3" />
                )}
                {/* Merge-back curve from branch lane to trunk */}
                <path
                  d={`M${BRANCH_X},${y2} C${BRANCH_X},${(y2 + mergeToY) * 0.5} ${TRUNK_X},${(y2 + mergeToY) * 0.5} ${TRUNK_X},${mergeToY}`}
                  fill="none" stroke={BRANCH_COLOR} strokeWidth="1.5" opacity="0.3"
                />
              </g>
            )
          })}

          {/* Nodes */}
          {items.map((ev, i) => {
            const y = i * rowH + rowH / 2 + 2
            const isFeed = ev.type === "feed"
            const cx = isFeed ? TRUNK_X : BRANCH_X
            const color = isFeed ? TRUNK_COLOR : BRANCH_COLOR

            return (
              <g key={ev.id} className="group">
                {/* Circle node */}
                <circle cx={cx} cy={y} r={isFeed ? 4 : 3.5} fill="none" stroke={color} strokeWidth="1.5" />
                <circle cx={cx} cy={y} r={isFeed ? 2 : 1.5} fill={color} />

                {/* Label */}
                <text x="42" y={y + 3} fill="#555" fontSize="8" fontFamily="var(--font-mono)"
                  className="group-hover:fill-[#888]" style={{ transition: "fill 150ms" }}>
                  {ev.label.length > 20 ? ev.label.slice(0, 20) + "…" : ev.label}
                </text>

                {/* Timestamp */}
                <text x="210" y={y + 3} textAnchor="end" fill="#3A3A3A" fontSize="7" fontFamily="var(--font-mono)">
                  {timeAgo(ev.time)}
                </text>

                {/* Hover tooltip */}
                <foreignObject x="38" y={y - 20} width="170" height="16"
                  className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none">
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
