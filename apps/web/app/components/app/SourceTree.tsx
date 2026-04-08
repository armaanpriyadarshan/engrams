"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"
import { WidgetPanel } from "./WidgetPanel"

interface Source {
  id: string
  title: string | null
  source_type: string
  source_url: string | null
  status: string
  created_at: string
  metadata: Record<string, unknown> | null
  content_md: string | null
  unresolved_questions: string[] | null
}

interface ArticleRef {
  slug: string
  title: string
  summary: string | null
  confidence: number
  article_type: string
  tags: string[]
  source_ids: string[]
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

function statusBgColor(s: string): string {
  return s === "compiled" ? "bg-confidence-high" : s === "running" || s === "pending" ? "bg-agent-active" : s === "failed" ? "bg-danger" : "bg-text-ghost"
}

export default function SourceTree({ engramId, engramSlug }: { engramId: string; engramSlug: string }) {
  const [sources, setSources] = useState<Source[]>([])
  const [allSources, setAllSources] = useState<Source[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [articleRefs, setArticleRefs] = useState<ArticleRef[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showFullContent, setShowFullContent] = useState(false)
  const [recompiling, setRecompiling] = useState<string | null>(null)

  const fetchData = useCallback(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from("sources").select("id, title, source_type, source_url, status, created_at, metadata, content_md, unresolved_questions").eq("engram_id", engramId).order("created_at", { ascending: false }).limit(6),
      supabase.from("sources").select("id, title, source_type, source_url, status, created_at, metadata, content_md, unresolved_questions").eq("engram_id", engramId).order("created_at", { ascending: false }),
      supabase.from("sources").select("id", { count: "exact" }).eq("engram_id", engramId),
      supabase.from("articles").select("slug, title, summary, confidence, article_type, tags, source_ids").eq("engram_id", engramId),
    ]).then(([sourcesRes, allSourcesRes, countRes, articlesRes]) => {
      if (sourcesRes.data) setSources(sourcesRes.data as Source[])
      if (allSourcesRes.data) setAllSources(allSourcesRes.data as Source[])
      if (countRes.count) setTotalCount(countRes.count)
      if (articlesRes.data) setArticleRefs(articlesRes.data.map(a => ({
        slug: a.slug,
        title: a.title ?? a.slug,
        summary: a.summary,
        confidence: a.confidence ?? 0.5,
        article_type: a.article_type ?? "concept",
        tags: (a.tags as string[]) ?? [],
        source_ids: (a.source_ids as string[]) ?? [],
      })))
    })
  }, [engramId])

  useEffect(() => { fetchData() }, [fetchData])

  const articlesBySource = useMemo(() => {
    const map = new Map<string, ArticleRef[]>()
    for (const a of articleRefs) {
      for (const sid of a.source_ids) {
        if (!map.has(sid)) map.set(sid, [])
        map.get(sid)!.push(a)
      }
    }
    return map
  }, [articleRefs])

  const handleRecompile = useCallback(async (sourceId: string) => {
    setRecompiling(sourceId)
    const supabase = createClient()
    await supabase.functions.invoke("compile-source", { body: { source_id: sourceId } })
    supabase.functions.invoke("generate-embedding", { body: { engram_id: engramId } })
    supabase.functions.invoke("detect-gaps", { body: { engram_id: engramId, trigger_source_id: sourceId } })
    supabase.functions.invoke("lint-engram", { body: { engram_id: engramId } })
    setRecompiling(null)
    fetchData()
  }, [engramId, fetchData])

  const selected = selectedId ? allSources.find(s => s.id === selectedId) : null
  const selectedArticles = selected ? (articlesBySource.get(selected.id) ?? []) : []
  const selectedWordCount = selected ? wordCount(selected.content_md ?? "") : 0
  const selectedCharCount = selected ? (selected.content_md ?? "").length : 0

  // Compact preview for the collapsed widget card
  const preview = (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Sources</span>
        <span className="text-[9px] font-mono text-text-ghost tabular-nums">{totalCount}</span>
      </div>
      <div className="mt-2 space-y-1">
        {sources.length === 0 ? (
          <p className="font-mono text-[10px] text-text-ghost">No sources yet.</p>
        ) : sources.map((s) => {
          const domain = extractDomain(s.source_url)
          const typeLabel = s.source_type === "url" ? (domain?.includes("arxiv") ? "arxiv" : "url") : s.source_type
          const meta = s.metadata as Record<string, string> | null
          return (
            <div key={s.id}>
              <p className="text-[11px] text-text-primary truncate leading-tight">{s.title ?? s.source_type}</p>
              <p className="text-[9px] font-mono text-text-ghost truncate">
                {typeLabel}{meta?.author ? ` · ${meta.author}` : ""}{meta?.year ? ` · ${meta.year}` : ""}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <WidgetPanel
      id="sources"
      className="animate-slide-in-left border-l-border-emphasis"
      preview={preview}
    >
      {/* Detail view */}
      {selected ? (
        <div style={{ animation: "fade-in 200ms ease-out both" }}>
          <button
            onClick={() => { setSelectedId(null); setShowFullContent(false) }}
            className="mb-6 text-[10px] font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-120 cursor-pointer flex items-center gap-1.5"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to sources
          </button>

          {/* Title + status */}
          <div className="mb-1 flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusBgColor(selected.status)}`} />
            <span className="text-[10px] font-mono text-text-ghost uppercase tracking-wider">{selected.status}</span>
          </div>
          <h1 className="font-heading text-xl text-text-emphasis tracking-tight">{selected.title ?? "Untitled"}</h1>

          {/* Meta row */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono text-text-ghost">
            <span>{selected.source_type}</span>
            <span>{formatDate(selected.created_at)}</span>
            <span>{selectedWordCount.toLocaleString()} words</span>
            <span>{selectedCharCount.toLocaleString()} chars</span>
            <span>{selectedArticles.length} article{selectedArticles.length !== 1 ? "s" : ""}</span>
          </div>

          {selected.source_url && (
            <a href={selected.source_url} target="_blank" rel="noopener noreferrer" className="mt-2 block text-[10px] font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-120 truncate">
              {selected.source_url}
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
                        <span className="text-[10px] font-mono text-text-ghost">{a.article_type}</span>
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
          {selected.unresolved_questions && selected.unresolved_questions.length > 0 && (
            <div className="mt-10">
              <h2 className="font-heading text-xs text-text-ghost uppercase tracking-widest mb-4">Unresolved questions</h2>
              <ul className="space-y-2">
                {selected.unresolved_questions.map((q, i) => (
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
          <div className="mt-10 mb-4">
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
            {selected.content_md ? (
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
                  {selected.content_md}
                </p>
              </div>
            ) : (
              <p className="text-xs text-text-ghost">No content stored.</p>
            )}
          </div>
        </div>
      ) : (
        // List view
        <div>
          <div className="flex items-center gap-2 mb-6">
            <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Sources</span>
            <span className="text-[9px] font-mono text-text-ghost tabular-nums">{totalCount}</span>
          </div>
          {allSources.length === 0 ? (
            <p className="text-sm text-text-secondary">No sources yet. <Link href={`/app/${engramSlug}/feed`} className="hover:text-text-emphasis transition-colors duration-120">Feed one.</Link></p>
          ) : (
            <div className="space-y-1">
              {allSources.map((s) => {
                const domain = extractDomain(s.source_url)
                const typeLabel = s.source_type === "url" ? (domain?.includes("arxiv") ? "arxiv" : "url") : s.source_type
                const meta = s.metadata as Record<string, string> | null
                const related = articlesBySource.get(s.id) ?? []
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    className="w-full text-left group block py-3 -mx-3 px-3 hover:bg-surface-raised/50 transition-colors duration-120 cursor-pointer"
                  >
                    <div className="flex items-start gap-3">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${statusBgColor(s.status)}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-text-emphasis group-hover:text-text-bright transition-colors duration-120">{s.title ?? s.source_type}</p>
                        <p className="text-[10px] font-mono text-text-ghost mt-0.5">
                          {typeLabel}{meta?.author ? ` · ${meta.author}` : ""}{meta?.year ? ` · ${meta.year}` : ""} · {timeAgo(s.created_at)} · {related.length} article{related.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </WidgetPanel>
  )
}
