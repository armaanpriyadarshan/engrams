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

export default function SourceTree({ engramId }: { engramId: string }) {
  const [sources, setSources] = useState<Source[]>([])

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from("sources")
      .select("id, title, source_type, source_url, status, created_at")
      .eq("engram_id", engramId)
      .order("created_at", { ascending: false })
      .limit(12)
      .then(({ data }) => { if (data) setSources(data) })
  }, [engramId])

  // Placeholder data when empty
  const items = sources.length > 0 ? sources : [
    { id: "p1", title: "arxiv.org/abs/2312.07413", source_type: "url", source_url: null, status: "compiled", created_at: "" },
    { id: "p2", title: "The History of Deep Learning.pdf", source_type: "pdf", source_url: null, status: "compiled", created_at: "" },
    { id: "p3", title: "notes-on-transformers.md", source_type: "text", source_url: null, status: "compiled", created_at: "" },
    { id: "p4", title: "github.com/openai/gpt-4", source_type: "url", source_url: null, status: "pending", created_at: "" },
    { id: "p5", title: "reinforcement-learning-intro.txt", source_type: "text", source_url: null, status: "compiled", created_at: "" },
    { id: "p6", title: "attention-is-all-you-need.pdf", source_type: "pdf", source_url: null, status: "compiled", created_at: "" },
  ]

  const statusDot = (status: string) => {
    if (status === "compiled") return "bg-confidence-high"
    if (status === "processing") return "bg-agent-active"
    if (status === "failed") return "bg-danger"
    return "bg-text-ghost"
  }

  return (
    <div className="absolute top-3 left-3 z-30 max-w-[240px] pointer-events-auto animate-slide-in-left" style={{ animationDelay: "200ms" }}>
      <div className="bg-surface/80 backdrop-blur-md border border-border rounded-sm px-3 py-2.5">
        <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Sources</span>
        <div className="mt-2 space-y-0.5">
          {items.map((s, i) => {
            const isLast = i === items.length - 1
            const prefix = isLast ? "└" : "├"
            return (
              <div key={s.id} className="flex items-center gap-1.5 group">
                <span className="font-mono text-[10px] text-text-ghost leading-none select-none">{prefix}</span>
                <div className={`w-1 h-1 rounded-full shrink-0 ${statusDot(s.status)}`} />
                <span className="font-mono text-[10px] text-text-tertiary truncate group-hover:text-text-secondary transition-colors duration-150">
                  {s.title ?? s.source_type}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
