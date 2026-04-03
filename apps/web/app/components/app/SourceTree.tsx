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

function extractDomain(url: string | null): string | null {
  if (!url) return null
  try { return new URL(url).hostname.replace("www.", "") } catch { return url }
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
      .limit(8)
      .then(({ data }) => { if (data) setSources(data) })
  }, [engramId])

  const items = sources.length > 0 ? sources : [
    { id: "p1", title: "Attention Is All You Need", source_type: "url", source_url: "https://arxiv.org/abs/1706.03762", status: "compiled", created_at: "" },
    { id: "p2", title: "The Illustrated Transformer", source_type: "url", source_url: "https://jalammar.github.io", status: "compiled", created_at: "" },
    { id: "p3", title: "Formal Algorithms for Transformers", source_type: "url", source_url: "https://arxiv.org/abs/2207.09238", status: "compiled", created_at: "" },
    { id: "p4", title: "Language Models are Few-Shot Learners", source_type: "pdf", source_url: null, status: "compiled", created_at: "" },
    { id: "p5", title: "Scaling Language Models", source_type: "pdf", source_url: null, status: "compiled", created_at: "" },
    { id: "p6", title: "The Bitter Lesson", source_type: "url", source_url: "https://incompleteideas.net", status: "pending", created_at: "" },
  ]

  const statusColor = (status: string) => {
    if (status === "compiled") return "#7A8F76"
    if (status === "processing") return "#76808F"
    if (status === "failed") return "#8F4040"
    return "#3A3A3A"
  }

  return (
    <div className="absolute top-3 left-3 z-30 max-w-[260px] pointer-events-auto animate-slide-in-left" style={{ animationDelay: "200ms" }}>
      <div className="bg-surface/80 backdrop-blur-md border border-border rounded-sm px-3 py-2.5">
        <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Sources</span>
        <div className="mt-2">
          {items.map((s, i) => {
            const isLast = i === items.length - 1
            const domain = extractDomain(s.source_url)
            const typeLabel = s.source_type === "url" ? (domain?.includes("arxiv") ? "arxiv" : "url") : s.source_type

            return (
              <div key={s.id} className="flex gap-2">
                {/* Tree connector */}
                <div className="flex flex-col items-center shrink-0 w-3">
                  {/* Horizontal branch */}
                  <div className="flex items-center h-3 mt-1.5">
                    <div className="w-3 h-px" style={{ backgroundColor: statusColor(s.status) }} />
                  </div>
                  {/* Vertical continuation */}
                  {!isLast && (
                    <div className="flex-1 w-px" style={{ backgroundColor: "#222" }} />
                  )}
                </div>

                {/* Content */}
                <div className={`flex-1 min-w-0 ${!isLast ? "pb-2 border-b border-border/50" : ""} mb-0.5`}>
                  <p className="text-[11px] text-text-primary truncate leading-tight">
                    {s.title ?? s.source_type}
                  </p>
                  <p className="text-[9px] font-mono text-text-ghost mt-0.5 truncate">
                    {typeLabel}
                    {domain && <span> · {domain}</span>}
                    {!domain && s.source_type === "pdf" && <span> · uploaded</span>}
                    {!domain && s.source_type === "text" && <span> · pasted</span>}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
