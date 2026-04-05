"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"
import { WidgetPanel, usePanelContext } from "./WidgetPanel"

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

export default function SourceTree({ engramId, engramSlug }: { engramId: string; engramSlug: string }) {
  const [sources, setSources] = useState<Source[]>([])
  const [allSources, setAllSources] = useState<Source[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [articleCounts, setArticleCounts] = useState<Record<string, number>>({})
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const { toggle } = usePanelContext()

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from("sources").select("id, title, source_type, source_url, status, created_at, metadata").eq("engram_id", engramId).order("created_at", { ascending: false }).limit(6),
      supabase.from("sources").select("id, title, source_type, source_url, status, created_at, metadata").eq("engram_id", engramId).order("created_at", { ascending: false }),
      supabase.from("sources").select("id", { count: "exact" }).eq("engram_id", engramId),
      supabase.from("articles").select("source_ids").eq("engram_id", engramId),
    ]).then(([sourcesRes, allSourcesRes, countRes, articlesRes]) => {
      if (sourcesRes.data) setSources(sourcesRes.data)
      if (allSourcesRes.data) setAllSources(allSourcesRes.data)
      if (countRes.count) setTotalCount(countRes.count)
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

  const getCounts = (id: string) => articleCounts[id] ?? 0

  function SourceItem({ s, compact }: { s: Source; compact?: boolean }) {
    const domain = extractDomain(s.source_url)
    const typeLabel = s.source_type === "url" ? (domain?.includes("arxiv") ? "arxiv" : "url") : s.source_type
    const meta = s.metadata as Record<string, string> | null
    const artCount = getCounts(s.id)

    return (
      <div className={compact ? "" : "py-2"}>
        <div className="min-w-0">
          {s.source_url ? (
            <a href={s.source_url} target="_blank" rel="noopener noreferrer" className={`${compact ? "text-[11px]" : "text-xs"} text-text-primary hover:text-text-emphasis truncate leading-tight block transition-colors duration-150`}>
              {s.title ?? s.source_type}
            </a>
          ) : (
            <p className={`${compact ? "text-[11px]" : "text-xs"} text-text-primary truncate leading-tight`}>
              {s.title ?? s.source_type}
            </p>
          )}
          <p className={`${compact ? "text-[9px]" : "text-[10px]"} font-mono text-text-ghost mt-0.5 truncate`}>
            {typeLabel}
            {meta?.author && <span> · {meta.author}</span>}
            {meta?.year && <span> · {meta.year}</span>}
            {!compact && <span> · {artCount} article{artCount !== 1 ? "s" : ""}</span>}
            {!compact && <span> · {timeAgo(s.created_at)}</span>}
          </p>
        </div>
      </div>
    )
  }

  const preview = (
    <div className="bg-surface/80 backdrop-blur-md border border-border border-l-border-emphasis rounded-sm pr-3 py-2.5 pl-0">
      <button onClick={() => toggle("sources")} className="w-full flex items-center justify-between pl-4 pr-1 cursor-pointer hover:text-text-tertiary transition-colors duration-120">
        <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Sources</span>
        <span className="text-[9px] font-mono text-text-ghost">{totalCount}</span>
      </button>
      <div className="mt-2">
        {sources.length === 0 ? (
          <p className="pl-4 font-mono text-[10px] text-text-ghost">No sources yet.</p>
        ) : sources.map((s) => (
          <div key={s.id} className="pl-4">
            <SourceItem s={s} compact />
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <WidgetPanel
      id="sources"
      side="left"
      previewClassName="absolute top-3 left-3 z-30 max-w-[260px] pointer-events-auto animate-slide-in-left"
      preview={preview}
    >
      <h2 className="font-heading text-lg text-text-emphasis mb-1">Sources</h2>
      <p className="text-[10px] font-mono text-text-ghost mb-6">{totalCount} total</p>
      {allSources.length === 0 ? (
        <p className="text-sm text-text-secondary">No sources yet. <Link href={`/app/${engramSlug}/feed`} className="hover:text-text-emphasis transition-colors duration-120">Feed one.</Link></p>
      ) : (
        <div className="space-y-0.5">
          {allSources.map((s) => (
            <div key={s.id} className="border-b border-border/50 last:border-0">
              <SourceItem s={s} />
            </div>
          ))}
        </div>
      )}
    </WidgetPanel>
  )
}
