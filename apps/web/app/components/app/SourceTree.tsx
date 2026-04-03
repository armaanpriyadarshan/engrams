"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

interface Source {
  id: string
  title: string | null
  source_type: string
  source_url: string | null
  status: string
  created_at: string
}

function timeAgo(date: string): string {
  if (!date) return ""
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60) return "now"
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function typeIcon(type: string) {
  if (type === "url") return "↗"
  if (type === "pdf") return "◆"
  if (type === "text") return "≡"
  if (type === "file") return "□"
  return "·"
}

export default function SourceTree({ engramId }: { engramId: string }) {
  const [sources, setSources] = useState<Source[]>([])

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from("sources")
      .select("id, title, source_type, source_url, status, created_at")
      .eq("engram_id", engramId)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => { if (data) setSources(data) })
  }, [engramId])

  const items = sources.length > 0 ? sources : [
    { id: "p1", title: "arxiv.org/abs/2312.07413", source_type: "url", source_url: null, status: "compiled", created_at: new Date(Date.now() - 300000).toISOString() },
    { id: "p2", title: "The History of Deep Learning.pdf", source_type: "pdf", source_url: null, status: "compiled", created_at: new Date(Date.now() - 900000).toISOString() },
    { id: "p3", title: "notes-on-transformers.md", source_type: "text", source_url: null, status: "compiled", created_at: new Date(Date.now() - 3600000).toISOString() },
    { id: "p4", title: "github.com/openai/gpt-4", source_type: "url", source_url: null, status: "pending", created_at: new Date(Date.now() - 7200000).toISOString() },
    { id: "p5", title: "reinforcement-learning-intro.txt", source_type: "text", source_url: null, status: "compiled", created_at: new Date(Date.now() - 86400000).toISOString() },
    { id: "p6", title: "attention-is-all-you-need.pdf", source_type: "pdf", source_url: null, status: "compiled", created_at: new Date(Date.now() - 172800000).toISOString() },
  ]

  const statusColor = (status: string) => {
    if (status === "compiled") return "#7A8F76"
    if (status === "processing") return "#76808F"
    if (status === "failed") return "#8F4040"
    return "#555"
  }

  const total = items.length
  const compiled = items.filter(s => s.status === "compiled").length

  return (
    <div className="absolute top-3 left-3 z-30 max-w-[260px] pointer-events-auto animate-slide-in-left" style={{ animationDelay: "200ms" }}>
      <div className="bg-surface/80 backdrop-blur-md border border-border rounded-sm px-3 py-2.5">
        {/* Header with count */}
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Sources</span>
          <span className="text-[8px] font-mono text-text-ghost">{compiled}/{total}</span>
        </div>

        {/* Tree */}
        <div className="mt-2">
          {items.map((s, i) => {
            const isLast = i === items.length - 1
            return (
              <div key={s.id} className="flex items-stretch">
                {/* Tree connector — vertical line + branch */}
                <div className="flex flex-col items-center shrink-0" style={{ width: 12 }}>
                  {/* Top half of vertical line (connects to item above) */}
                  <div className="w-px flex-1" style={{ backgroundColor: i === 0 ? "transparent" : "#333" }} />
                  {/* Horizontal branch tick */}
                  <div className="flex items-center" style={{ height: 0 }}>
                    <div style={{ width: 6, height: 1, backgroundColor: "#333" }} />
                  </div>
                  {/* Bottom half of vertical line (connects to item below) */}
                  <div className="w-px flex-1" style={{ backgroundColor: isLast ? "transparent" : "#333" }} />
                </div>

                {/* Content row */}
                <div className="flex items-center gap-1.5 py-[3px] min-w-0 pl-1">
                  {/* Status dot */}
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: statusColor(s.status) }} />
                  {/* Type icon */}
                  <span className="font-mono text-[8px] text-text-ghost shrink-0 w-3 text-center">{typeIcon(s.source_type)}</span>
                  {/* Title */}
                  <span className="font-mono text-[10px] text-text-tertiary truncate">
                    {s.title ?? s.source_type}
                  </span>
                  {/* Time */}
                  {s.created_at && (
                    <span className="font-mono text-[8px] text-text-ghost shrink-0 ml-auto pl-2">
                      {timeAgo(s.created_at)}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
