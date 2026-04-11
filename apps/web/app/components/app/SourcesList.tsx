"use client"

import { useState, useCallback, useMemo, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"

interface Source {
  id: string
  title: string | null
  sourceType: string
  sourceUrl: string | null
  contentMd: string
  status: string
  createdAt: string
  metadata: Record<string, string> | null
  unresolvedQuestions: string[]
}

interface ArticleRef {
  slug: string
  title: string
  summary: string | null
  confidence: number
  articleType: string
  tags: string[]
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

function formatDate(d: string): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  })
}

function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0
}

function confidenceColor(c: number): string {
  return c > 0.8 ? "var(--color-confidence-high)" : c > 0.5 ? "var(--color-confidence-mid)" : "var(--color-confidence-low)"
}

export default function SourcesList({ sources, articles, engramId, engramSlug }: {
  sources: Source[]
  articles: ArticleRef[]
  engramId: string
  engramSlug: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const focusParam = searchParams.get("source")
  const [filter, setFilter] = useState<FilterStatus>("all")
  const [sort, setSort] = useState<SortBy>("date")
  const [selectedId, setSelectedId] = useState<string | null>(focusParam)
  const [recompiling, setRecompiling] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [showFullContent, setShowFullContent] = useState(false)

  // Sync selectedId with the ?source= query param
  useEffect(() => {
    setSelectedId(focusParam)
  }, [focusParam])

  const articlesBySource = useMemo(() => {
    const map = new Map<string, ArticleRef[]>()
    for (const a of articles) {
      for (const sid of a.sourceIds) {
        if (!map.has(sid)) map.set(sid, [])
        map.get(sid)!.push(a)
      }
    }
    return map
  }, [articles])

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

  const handleDelete = useCallback(async (sourceId: string) => {
    setDeleting(sourceId)
    const supabase = createClient()

    // Remove this source from any articles that reference it
    const { data: linkedArticles } = await supabase
      .from("articles")
      .select("id, source_ids")
      .eq("engram_id", engramId)
      .contains("source_ids", [sourceId])

    for (const article of linkedArticles ?? []) {
      const newSourceIds = (article.source_ids as string[]).filter(id => id !== sourceId)
      await supabase.from("articles").update({ source_ids: newSourceIds }).eq("id", article.id)
    }

    // Delete the source (compilation_runs cascade, knowledge_gaps set null via FK)
    await supabase.from("sources").delete().eq("id", sourceId)

    // Recount sources — all of them, regardless of status. Kept in
    // sync with the delete handler in SourceTree and the compile-source
    // edge function so source_count always reflects the actual row count.
    const { count } = await supabase
      .from("sources")
      .select("id", { count: "exact", head: true })
      .eq("engram_id", engramId)

    await supabase.from("engrams").update({ source_count: count ?? 0 }).eq("id", engramId)

    setDeleting(null)
    setSelectedId(null)
    router.refresh()
  }, [engramId, router])

  const filtered = filter === "all" ? sources : sources.filter(s => s.status === filter)

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "articles") {
      return (articlesBySource.get(b.id)?.length ?? 0) - (articlesBySource.get(a.id)?.length ?? 0)
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

  const selected = selectedId ? sources.find(s => s.id === selectedId) : null
  const selectedArticles = selected ? (articlesBySource.get(selected.id) ?? []) : []
  const selectedWordCount = selected ? wordCount(selected.contentMd) : 0
  const selectedCharCount = selected ? selected.contentMd.length : 0

  // Detail view
  if (selected) {
    return (
      <div style={{ animation: "fade-in 200ms ease-out both" }}>
        {/* Back */}
        <button
          onClick={() => {
            setSelectedId(null)
            setShowFullContent(false)
            router.replace(`/app/${engramSlug}/sources`)
          }}
          className="mb-6 text-[10px] font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-120 cursor-pointer flex items-center gap-1.5"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to sources
        </button>

        {/* Title + status */}
        <div className="mb-1 flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor(selected.status)}`} />
          <span className="text-[10px] font-mono text-text-ghost uppercase tracking-wider">{selected.status}</span>
        </div>
        <h1 className="font-heading text-xl text-text-emphasis tracking-tight">{selected.title ?? "Untitled"}</h1>

        {/* Meta row */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono text-text-ghost">
          <span>{selected.sourceType}</span>
          <span>{formatDate(selected.createdAt)}</span>
          <span>{selectedWordCount.toLocaleString()} words</span>
          <span>{selectedCharCount.toLocaleString()} chars</span>
          <span>{selectedArticles.length} article{selectedArticles.length !== 1 ? "s" : ""}</span>
        </div>

        {selected.sourceUrl && (
          <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block text-[10px] font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-120 truncate">
            {selected.sourceUrl}
          </a>
        )}

        {/* Action bar */}
        <div className="mt-6 pt-4 border-t border-border flex items-center gap-4">
          <button
            onClick={() => handleRecompile(selected.id)}
            disabled={recompiling === selected.id}
            className="text-[10px] font-mono text-text-secondary hover:text-text-emphasis transition-colors duration-120 cursor-pointer disabled:opacity-30"
          >
            {recompiling === selected.id ? "Recompiling..." : "Recompile"}
          </button>
          <button
            onClick={() => handleDelete(selected.id)}
            disabled={deleting === selected.id}
            className="text-[10px] font-mono text-text-ghost hover:text-danger transition-colors duration-120 cursor-pointer disabled:opacity-30"
          >
            {deleting === selected.id ? "Deleting..." : "Delete"}
          </button>
        </div>

        {/* Generated articles */}
        <div className="mt-10">
          <h2 className="font-heading text-xs text-text-ghost uppercase tracking-widest mb-4">Generated articles</h2>
          {selectedArticles.length === 0 ? (
            <p className="text-xs text-text-tertiary">
              {selected.status === "compiled" ? "Compilation produced no articles." : "Not yet compiled."}
            </p>
          ) : (
            <div className="space-y-1">
              {selectedArticles.map(a => (
                <Link
                  key={a.slug}
                  href={`/app/${engramSlug}/article/${a.slug}`}
                  className="group block py-3 -mx-3 px-3 hover:bg-surface-raised/50 transition-colors duration-120"
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className="font-heading text-sm text-text-emphasis group-hover:text-text-bright transition-colors duration-120">
                      {a.title}
                    </h3>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] font-mono text-text-ghost">{a.articleType}</span>
                      <div className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: confidenceColor(a.confidence) }} />
                      <span className="text-[10px] font-mono text-text-ghost">{Math.round(a.confidence * 100)}%</span>
                    </div>
                  </div>
                  {a.summary && (
                    <p className="mt-1 text-xs text-text-tertiary leading-[1.6] line-clamp-2">{a.summary}</p>
                  )}
                  {a.tags.length > 0 && (
                    <div className="mt-1.5 flex gap-1.5 flex-wrap">
                      {a.tags.map(t => (
                        <span key={t} className="font-mono text-[10px] text-text-ghost border border-border px-2 py-0.5">{t}</span>
                      ))}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Unresolved questions */}
        {selected.unresolvedQuestions.length > 0 && (
          <div className="mt-10">
            <h2 className="font-heading text-xs text-text-ghost uppercase tracking-widest mb-4">Unresolved questions</h2>
            <ul className="space-y-2">
              {selected.unresolvedQuestions.map((q, i) => (
                <li key={i} className="text-sm text-text-tertiary leading-[1.65] flex gap-3">
                  <span className="text-text-ghost shrink-0">—</span>
                  <span>{q}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Metadata */}
        {selected.metadata && Object.keys(selected.metadata).length > 0 && (
          <div className="mt-10">
            <h2 className="font-heading text-xs text-text-ghost uppercase tracking-widest mb-4">Metadata</h2>
            <dl className="space-y-1.5">
              {Object.entries(selected.metadata).map(([k, v]) => (
                <div key={k} className="flex gap-3 text-[11px] font-mono">
                  <dt className="text-text-ghost min-w-[100px]">{k}</dt>
                  <dd className="text-text-tertiary break-all">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Original content */}
        <div className="mt-10 mb-20">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-heading text-xs text-text-ghost uppercase tracking-widest">Original content</h2>
            {selectedWordCount > 200 && (
              <button
                onClick={() => setShowFullContent(v => !v)}
                className="text-[10px] font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-120 cursor-pointer"
              >
                {showFullContent ? "Collapse" : "Expand"}
              </button>
            )}
          </div>
          {selected.contentMd ? (
            <div className="border-l-2 border-border pl-5 py-2">
              <p
                className="text-xs text-text-tertiary leading-[1.7] whitespace-pre-line font-mono"
                style={{
                  maxHeight: showFullContent ? "none" : "320px",
                  overflow: showFullContent ? "visible" : "hidden",
                  maskImage: showFullContent || selectedWordCount <= 200 ? "none" : "linear-gradient(to bottom, black 70%, transparent)",
                  WebkitMaskImage: showFullContent || selectedWordCount <= 200 ? "none" : "linear-gradient(to bottom, black 70%, transparent)",
                }}
              >
                {selected.contentMd}
              </p>
            </div>
          ) : (
            <p className="text-xs text-text-ghost">No content stored.</p>
          )}
        </div>
      </div>
    )
  }

  // List view
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
            const produced = articlesBySource.get(s.id) ?? []
            return (
              <button
                key={s.id}
                onClick={() => {
                  setSelectedId(s.id)
                  router.replace(`/app/${engramSlug}/sources?source=${s.id}`)
                }}
                className="w-full text-left group block py-3 -mx-3 px-3 hover:bg-surface-raised/50 transition-colors duration-120 cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor(s.status)}`} />
                  <span className="text-sm text-text-emphasis truncate flex-1 group-hover:text-text-bright transition-colors duration-120">{s.title ?? "Untitled"}</span>
                  <span className="text-[10px] font-mono text-text-ghost shrink-0">{s.sourceType}</span>
                  <span className="text-[10px] font-mono text-text-ghost shrink-0">{timeAgo(s.createdAt)}</span>
                  <span className="text-[10px] font-mono text-text-ghost shrink-0">{produced.length} article{produced.length !== 1 ? "s" : ""}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}
