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
  metadata: Record<string, unknown> | null
}

function extractDomain(url: string | null): string | null {
  if (!url) return null
  try { return new URL(url).hostname.replace("www.", "") } catch { return url }
}

function timeAgo(date: string): string {
  if (!date) return ""
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60) return "now"
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function SourceTree({ engramId }: { engramId: string }) {
  const [sources, setSources] = useState<Source[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [articleCounts, setArticleCounts] = useState<Record<string, number>>({})
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from("sources").select("id, title, source_type, source_url, status, created_at, metadata").eq("engram_id", engramId).order("created_at", { ascending: false }).limit(6),
      supabase.from("sources").select("id", { count: "exact" }).eq("engram_id", engramId),
      supabase.from("articles").select("source_ids").eq("engram_id", engramId),
    ]).then(([sourcesRes, countRes, articlesRes]) => {
      if (sourcesRes.data) setSources(sourcesRes.data)
      if (countRes.count) setTotalCount(countRes.count)
      // Count how many articles each source contributed to
      if (articlesRes.data) {
        const counts: Record<string, number> = {}
        articlesRes.data.forEach(a => {
          (a.source_ids as string[] ?? []).forEach(sid => {
            counts[sid] = (counts[sid] ?? 0) + 1
          })
        })
        setArticleCounts(counts)
      }
    })
  }, [engramId])

  const items: Source[] = sources.length > 0 ? sources : [
    { id: "p1", title: "Attention Is All You Need", source_type: "url", source_url: "https://arxiv.org/abs/1706.03762", status: "compiled", created_at: new Date(Date.now() - 300000).toISOString(), metadata: { author: "Vaswani et al.", year: "2017", claim: "Self-attention can replace recurrence entirely for sequence transduction." } },
    { id: "p2", title: "The Illustrated Transformer", source_type: "url", source_url: "https://jalammar.github.io/illustrated-transformer", status: "compiled", created_at: new Date(Date.now() - 900000).toISOString(), metadata: { author: "Jay Alammar", year: "2018", claim: "Visual walkthrough of transformer architecture and attention mechanisms." } },
    { id: "p3", title: "Formal Algorithms for Transformers", source_type: "url", source_url: "https://arxiv.org/abs/2207.09238", status: "compiled", created_at: new Date(Date.now() - 3600000).toISOString(), metadata: { author: "Phuong & Hutter", year: "2022", claim: "Compact mathematical description of transformer variants." } },
    { id: "p4", title: "Language Models are Few-Shot Learners", source_type: "pdf", source_url: null, status: "compiled", created_at: new Date(Date.now() - 7200000).toISOString(), metadata: { author: "Brown et al.", year: "2020", claim: "Scaling language models enables few-shot task performance without fine-tuning." } },
    { id: "p5", title: "Scaling Language Models", source_type: "pdf", source_url: null, status: "compiled", created_at: new Date(Date.now() - 10800000).toISOString(), metadata: { author: "Kaplan et al.", year: "2020", claim: "Neural language model performance scales as a power-law with model size." } },
    { id: "p6", title: "The Bitter Lesson", source_type: "url", source_url: "https://incompleteideas.net", status: "pending", created_at: new Date(Date.now() - 86400000).toISOString(), metadata: { author: "Rich Sutton", year: "2019", claim: "General methods that leverage computation are ultimately the most effective." } },
  ]

  const displayCount = sources.length > 0 ? totalCount : 6
  const placeholderArticleCounts: Record<string, number> = { p1: 5, p2: 3, p3: 4, p4: 6, p5: 2, p6: 0 }
  const getCounts = (id: string) => Object.keys(articleCounts).length > 0 ? (articleCounts[id] ?? 0) : (placeholderArticleCounts[id] ?? 0)

  return (
    <div className="absolute top-3 left-3 z-30 max-w-[260px] pointer-events-auto animate-slide-in-left" style={{ animationDelay: "200ms" }}>
      <div className="bg-surface/80 backdrop-blur-md border border-border border-l-border-emphasis rounded-sm pr-3 py-2.5 pl-0">
        <div className="flex items-center justify-between pl-4 pr-1">
          <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Sources</span>
          <span className="text-[9px] font-mono text-text-ghost">{displayCount}</span>
        </div>
        <div className="mt-2">
          {items.map((s, i) => {
            const isLast = i === items.length - 1
            const domain = extractDomain(s.source_url)
            const typeLabel = s.source_type === "url" ? (domain?.includes("arxiv") ? "arxiv" : "url") : s.source_type
            const meta = s.metadata as Record<string, string> | null
            const artCount = getCounts(s.id)
            const isHovered = hoveredId === s.id

            return (
              <div
                key={s.id}
                className={`relative ${isLast ? "" : "pb-2"}`}
                onMouseEnter={() => setHoveredId(s.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div className="min-w-0 pl-4 cursor-default">
                  <p className="text-[11px] text-text-primary truncate leading-tight">
                    {s.title ?? s.source_type}
                  </p>
                  <p className="text-[9px] font-mono text-text-ghost mt-0.5 truncate">
                    {typeLabel}
                    {meta?.author && <span> · {meta.author}</span>}
                    {meta?.year && <span> · {meta.year}</span>}
                  </p>
                </div>

                {/* Hover detail card */}
                {isHovered && (
                  <div className="absolute left-full top-0 ml-2 z-50 w-56 bg-surface/95 backdrop-blur-md border border-border rounded-sm p-3 pointer-events-none">
                    <p className="text-[11px] text-text-emphasis leading-tight">{s.title}</p>
                    {meta?.author && <p className="text-[9px] font-mono text-text-tertiary mt-1">{meta.author}{meta?.year ? `, ${meta.year}` : ""}</p>}
                    {meta?.claim && <p className="text-[10px] text-text-secondary mt-1.5 leading-snug">{meta.claim as string}</p>}
                    {domain && <p className="text-[8px] font-mono text-text-ghost mt-1.5">{domain}</p>}
                    <div className="flex items-center gap-3 mt-2 pt-1.5 border-t border-border">
                      <span className="text-[8px] font-mono text-text-ghost">{artCount} article{artCount !== 1 ? "s" : ""} informed</span>
                      <span className="text-[8px] font-mono text-text-ghost">{timeAgo(s.created_at)}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
