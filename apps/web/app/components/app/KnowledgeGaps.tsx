"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"
import { WidgetPanel } from "./WidgetPanel"

interface Gap {
  id: string
  question: string
  evidence: string
  related_slugs: string[]
  source_refs: string[]
  confidence_context: string | null
  suggested_sources: string[]
  status: string
  created_at: string
}

interface RelatedArticle {
  slug: string
  title: string
  confidence: number
}

export default function KnowledgeGaps({ engramId, engramSlug }: { engramId: string; engramSlug: string }) {
  const [gaps, setGaps] = useState<Gap[]>([])
  const [articles, setArticles] = useState<RelatedArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [detecting, setDetecting] = useState(false)

  const loadGaps = useCallback(async () => {
    const supabase = createClient()
    const [gapsRes, articlesRes] = await Promise.all([
      supabase.from("knowledge_gaps").select("*").eq("engram_id", engramId).eq("status", "open").order("created_at", { ascending: false }),
      supabase.from("articles").select("slug, title, confidence").eq("engram_id", engramId),
    ])
    setGaps(gapsRes.data ?? [])
    setArticles(articlesRes.data ?? [])
    setLoading(false)
  }, [engramId])

  useEffect(() => { loadGaps() }, [loadGaps])

  const runDetection = useCallback(async () => {
    setDetecting(true)
    const supabase = createClient()
    await supabase.functions.invoke("detect-gaps", { body: { engram_id: engramId } })
    await loadGaps()
    setDetecting(false)
  }, [engramId, loadGaps])

  const getArticle = (slug: string) => articles.find(a => a.slug === slug)

  const preview = (
    <div className="px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Open questions</span>
        <span className="text-[9px] font-mono text-text-ghost">{loading ? "..." : gaps.length}</span>
      </div>
      {!loading && gaps.length === 0 && (
        <p className="mt-1.5 text-[10px] text-text-ghost">No open questions.</p>
      )}
      {!loading && gaps.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {gaps.slice(0, 4).map((gap) => (
            <p key={gap.id} className="text-[10px] text-text-tertiary leading-tight line-clamp-2">
              <span className="text-text-ghost mr-1">&ndash;</span>{gap.question}
            </p>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <WidgetPanel
      id="gaps"
      className="animate-slide-in-left border-l-border-emphasis"
      preview={preview}
    >
      <div className="flex items-center justify-between mb-4">
        <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Open Questions</span>
        <button
          onClick={(e) => { e.stopPropagation(); runDetection() }}
          disabled={detecting}
          className="text-[9px] font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-120 cursor-pointer disabled:opacity-30"
        >
          {detecting ? "Analyzing..." : "Detect"}
        </button>
      </div>

      {loading && <p className="text-xs text-text-ghost">Loading...</p>}

      {!loading && gaps.length === 0 && (
        <div>
          <p className="text-xs text-text-tertiary">No open research questions.</p>
          <p className="text-[10px] text-text-ghost mt-2">Gaps are detected automatically after compilation, or you can run detection manually.</p>
        </div>
      )}

      {!loading && gaps.length > 0 && (
        <div className="space-y-6">
          {gaps.map((gap) => (
            <div key={gap.id} className="border-b border-border/50 pb-5 last:border-0 last:pb-0">
              {/* Question */}
              <p className="text-sm text-text-emphasis leading-relaxed">{gap.question}</p>

              {/* Evidence */}
              <p className="text-[11px] text-text-secondary mt-2 leading-relaxed">{gap.evidence}</p>

              {/* Confidence context */}
              {gap.confidence_context && (
                <p className="text-[10px] font-mono text-confidence-mid mt-2">{gap.confidence_context}</p>
              )}

              {/* Related articles */}
              {gap.related_slugs.length > 0 && (
                <div className="mt-3">
                  <span className="text-[9px] font-mono text-text-ghost uppercase">Bordering articles</span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {gap.related_slugs.map(slug => {
                      const art = getArticle(slug)
                      return (
                        <Link
                          key={slug}
                          href={`/app/${engramSlug}/article/${slug}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-[10px] font-mono text-text-ghost hover:text-text-secondary border border-border/60 px-1.5 py-0.5 transition-colors duration-120 flex items-center gap-1.5"
                        >
                          <span>{art?.title ?? slug.replace(/-/g, " ")}</span>
                          {art && (
                            <span className={`text-[8px] ${art.confidence > 0.7 ? "text-confidence-high" : art.confidence > 0.4 ? "text-confidence-mid" : "text-confidence-low"}`}>
                              {Math.round(art.confidence * 100)}%
                            </span>
                          )}
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Suggested sources */}
              {gap.suggested_sources.length > 0 && (
                <div className="mt-3">
                  <span className="text-[9px] font-mono text-text-ghost uppercase">To fill this gap</span>
                  <div className="mt-1.5 space-y-1">
                    {gap.suggested_sources.map((s, i) => (
                      <p key={i} className="text-[10px] text-text-ghost">{s}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Action: research this question */}
              <Link
                href={`/app/${engramSlug}/ask?q=${encodeURIComponent(gap.question)}`}
                onClick={(e) => e.stopPropagation()}
                className="text-[10px] font-mono text-text-ghost hover:text-text-secondary border-b border-transparent hover:border-text-ghost transition-colors duration-120 mt-3 inline-block"
              >
                Research this question
              </Link>
            </div>
          ))}
        </div>
      )}
    </WidgetPanel>
  )
}
