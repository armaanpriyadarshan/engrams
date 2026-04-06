"use client"

import { useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import Link from "next/link"

interface Source {
  id: string
  title: string | null
  sourceType: string
  sourceUrl: string | null
  contentPreview: string
  status: string
  createdAt: string
  metadata: Record<string, string> | null
}

interface ArticleRef {
  slug: string
  title: string
  sourceIds: string[]
}

type SortBy = "date" | "articles" | "type"
type FilterStatus = "all" | "compiled" | "pending" | "failed"

function timeAgo(d: string): string {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function SourcesList({ sources, articles, engramId, engramSlug }: {
  sources: Source[]
  articles: ArticleRef[]
  engramId: string
  engramSlug: string
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<FilterStatus>("all")
  const [sort, setSort] = useState<SortBy>("date")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [recompiling, setRecompiling] = useState<string | null>(null)

  const getArticlesForSource = (sid: string) =>
    articles.filter(a => a.sourceIds.includes(sid))

  const handleRecompile = useCallback(async (sourceId: string) => {
    setRecompiling(sourceId)
    const supabase = createClient()
    await supabase.functions.invoke("compile-source", { body: { source_id: sourceId } })
    supabase.functions.invoke("generate-embedding", { body: { engram_id: engramId } })
    supabase.functions.invoke("detect-gaps", { body: { engram_id: engramId, trigger_source_id: sourceId } })
    supabase.functions.invoke("lint-engram", { body: { engram_id: engramId } })
    setRecompiling(null)
    router.refresh()
  }, [engramId, router])

  const filtered = filter === "all" ? sources : sources.filter(s => s.status === filter)

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "articles") {
      return getArticlesForSource(b.id).length - getArticlesForSource(a.id).length
    }
    if (sort === "type") {
      return a.sourceType.localeCompare(b.sourceType)
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  const statusColor = (s: string) =>
    s === "compiled" ? "bg-confidence-high" : s === "running" || s === "pending" ? "bg-agent-active" : s === "failed" ? "bg-danger" : "bg-text-ghost"

  const filters: { id: FilterStatus; label: string }[] = [
    { id: "all", label: "All" },
    { id: "compiled", label: "Compiled" },
    { id: "pending", label: "Pending" },
    { id: "failed", label: "Failed" },
  ]

  const sorts: { id: SortBy; label: string }[] = [
    { id: "date", label: "Recent" },
    { id: "articles", label: "Articles" },
    { id: "type", label: "Type" },
  ]

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-lg text-text-emphasis">Sources</h1>
        <span className="text-[10px] font-mono text-text-ghost">{sources.length}</span>
      </div>

      {/* Filter + sort bar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-1">
          {filters.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 transition-colors duration-120 cursor-pointer ${
                filter === f.id ? "text-text-emphasis bg-surface-raised" : "text-text-ghost hover:text-text-tertiary"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {sorts.map(s => (
            <button
              key={s.id}
              onClick={() => setSort(s.id)}
              className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 transition-colors duration-120 cursor-pointer ${
                sort === s.id ? "text-text-emphasis bg-surface-raised" : "text-text-ghost hover:text-text-tertiary"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-text-secondary">
          {filter === "all" ? "No sources yet." : `No ${filter} sources.`}
        </p>
      ) : (
        <div className="space-y-1">
          {sorted.map((s) => {
            const produced = getArticlesForSource(s.id)
            const isExpanded = expandedId === s.id
            return (
              <div
                key={s.id}
                className="border border-border hover:border-border-emphasis transition-colors duration-120"
              >
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : s.id)}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor(s.status)}`} />
                  <span className="text-sm text-text-primary truncate flex-1">{s.title ?? "Untitled"}</span>
                  <span className="text-[10px] font-mono text-text-ghost shrink-0">{s.sourceType}</span>
                  <span className="text-[10px] font-mono text-text-ghost shrink-0">{timeAgo(s.createdAt)}</span>
                  <span className="text-[10px] font-mono text-text-ghost shrink-0">{produced.length} article{produced.length !== 1 ? "s" : ""}</span>
                </div>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border/50">
                    {/* Content preview */}
                    {s.contentPreview && (
                      <p className="text-[11px] text-text-tertiary leading-relaxed mt-3 whitespace-pre-line">
                        {s.contentPreview}{s.contentPreview.length >= 300 ? "..." : ""}
                      </p>
                    )}

                    {/* Metadata */}
                    {s.metadata && Object.keys(s.metadata).length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                        {Object.entries(s.metadata).map(([k, v]) => (
                          <span key={k} className="text-[10px] font-mono text-text-ghost">{k}: {v}</span>
                        ))}
                      </div>
                    )}

                    {/* Source URL */}
                    {s.sourceUrl && (
                      <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-120 mt-2 block truncate">
                        {s.sourceUrl}
                      </a>
                    )}

                    {/* Produced articles */}
                    {produced.length > 0 && (
                      <div className="mt-3">
                        <span className="text-[9px] font-mono text-text-ghost uppercase">Articles</span>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {produced.map(a => (
                            <Link
                              key={a.slug}
                              href={`/app/${engramSlug}/article/${a.slug}`}
                              className="text-[10px] font-mono text-text-ghost hover:text-text-secondary border border-border/60 px-1.5 py-0.5 transition-colors duration-120"
                            >
                              {a.title}
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Recompile button */}
                    <div className="mt-3 pt-3 border-t border-border/50">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRecompile(s.id) }}
                        disabled={recompiling === s.id}
                        className="text-[10px] font-mono text-text-ghost hover:text-text-secondary transition-colors duration-120 cursor-pointer disabled:opacity-30"
                      >
                        {recompiling === s.id ? "Recompiling..." : "Recompile"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
