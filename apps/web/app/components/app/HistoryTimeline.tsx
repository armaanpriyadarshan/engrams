"use client"

import { useEffect, useState, useRef } from "react"
import { createClient } from "@/lib/supabase/client"

interface TimelineEvent {
  id: string
  type: "feed" | "compile" | "lint" | "query" | "freshen" | "discover"
  label: string
  timestamp: string
  branch?: boolean
}

function timeLabel(date: string): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60) return "now"
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

const TYPE_COLORS: Record<string, string> = {
  feed: "#76808F",
  compile: "#7A8F76",
  lint: "#8F8A76",
  query: "#8F767A",
  freshen: "#6E8F6E",
  discover: "#638F8E",
}

export default function HistoryTimeline({ engramId }: { engramId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [hovered, setHovered] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const supabase = createClient()

    Promise.all([
      supabase.from("compilation_runs")
        .select("id, trigger_type, status, articles_created, articles_updated, started_at")
        .eq("engram_id", engramId)
        .order("started_at", { ascending: false })
        .limit(20),
      supabase.from("sources")
        .select("id, title, source_type, created_at")
        .eq("engram_id", engramId)
        .order("created_at", { ascending: false })
        .limit(10),
    ]).then(([runsRes, sourcesRes]) => {
      const items: TimelineEvent[] = []

      if (sourcesRes.data) {
        sourcesRes.data.forEach(s => {
          items.push({
            id: `s-${s.id}`,
            type: "feed",
            label: s.title ?? s.source_type,
            timestamp: s.created_at,
          })
        })
      }

      if (runsRes.data) {
        runsRes.data.forEach(r => {
          const t = r.trigger_type as string
          items.push({
            id: `r-${r.id}`,
            type: (t === "feed" ? "compile" : t === "lint" ? "lint" : t === "freshen" ? "freshen" : t === "discover" ? "discover" : "compile") as TimelineEvent["type"],
            label: r.status === "completed"
              ? `${r.articles_created + r.articles_updated} articles`
              : r.status === "running" ? "compiling" : r.status,
            timestamp: r.started_at,
            branch: t === "lint" || t === "freshen" || t === "discover",
          })
        })
      }

      items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      setEvents(items)
    })
  }, [engramId])

  // Placeholder when empty
  const items = events.length > 0 ? events : [
    { id: "p1", type: "feed" as const, label: "arxiv.org/abs/2312", timestamp: new Date(Date.now() - 60000).toISOString() },
    { id: "p2", type: "compile" as const, label: "4 articles", timestamp: new Date(Date.now() - 120000).toISOString() },
    { id: "p3", type: "lint" as const, label: "1 gap found", timestamp: new Date(Date.now() - 3600000).toISOString(), branch: true },
    { id: "p4", type: "feed" as const, label: "transformers.pdf", timestamp: new Date(Date.now() - 7200000).toISOString() },
    { id: "p5", type: "compile" as const, label: "6 articles", timestamp: new Date(Date.now() - 7260000).toISOString() },
    { id: "p6", type: "freshen" as const, label: "2 refreshed", timestamp: new Date(Date.now() - 86400000).toISOString(), branch: true },
    { id: "p7", type: "feed" as const, label: "notes.md", timestamp: new Date(Date.now() - 172800000).toISOString() },
    { id: "p8", type: "compile" as const, label: "3 articles", timestamp: new Date(Date.now() - 172860000).toISOString() },
    { id: "p9", type: "discover" as const, label: "2 connections", timestamp: new Date(Date.now() - 259200000).toISOString(), branch: true },
    { id: "p10", type: "feed" as const, label: "rl-intro.txt", timestamp: new Date(Date.now() - 345600000).toISOString() },
  ]

  return (
    <div className="absolute bottom-14 left-0 right-0 z-20 pointer-events-auto px-6 animate-slide-in-down" style={{ animationDelay: "350ms" }}>
        {/* Horizontal scrolling timeline — no box */}
        <div ref={scrollRef} className="overflow-x-auto overflow-y-visible mx-auto max-w-2xl" style={{ scrollbarWidth: "none" }}>
          <svg width={items.length * 36 + 20} height="40" className="block">
            {/* Main trunk line */}
            <line x1="10" y1="20" x2={items.length * 36 + 10} y2="20" stroke="#333" strokeWidth="1" />

            {items.map((e, i) => {
              const x = i * 36 + 10
              const color = TYPE_COLORS[e.type] ?? "#555"
              const isHovered = hovered === e.id

              return (
                <g key={e.id}
                  onMouseEnter={() => setHovered(e.id)}
                  onMouseLeave={() => setHovered(null)}
                  className="cursor-pointer"
                >
                  {/* Branch line for agent events */}
                  {e.branch && (
                    <line x1={x} y1="20" x2={x} y2="6" stroke={color} strokeWidth="0.75" strokeOpacity="0.5" />
                  )}

                  {/* Node on the line */}
                  <circle
                    cx={x}
                    cy={e.branch ? 6 : 20}
                    r={isHovered ? 4 : 2.5}
                    fill={color}
                    opacity={isHovered ? 1 : 0.7}
                    style={{ transition: "r 150ms ease-out, opacity 150ms ease-out" }}
                  />

                  {/* Tooltip */}
                  {isHovered && (
                    <g>
                      <rect
                        x={x - 40} y={e.branch ? -16 : -8}
                        width="80" height="16" rx="1"
                        fill="#0A0A0A" fillOpacity="0.9" stroke="#333" strokeWidth="0.5"
                      />
                      <text x={x} y={e.branch ? -5 : 3} textAnchor="middle" fill="#888" fontSize="7" fontFamily="var(--font-mono)">
                        {e.label}
                      </text>
                    </g>
                  )}

                  {/* Time label below */}
                  <text x={x} y="34" textAnchor="middle" fill="#3A3A3A" fontSize="6" fontFamily="var(--font-mono)">
                    {timeLabel(e.timestamp)}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>
    </div>
  )
}
