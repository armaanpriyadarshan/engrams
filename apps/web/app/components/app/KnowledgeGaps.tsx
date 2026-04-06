"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { WidgetPanel } from "./WidgetPanel"

interface Gap {
  type: "missing" | "low_confidence" | "orphan" | "thin_answer"
  slug?: string
  label: string
  detail: string
  actionLabel: string
  actionHref?: string
  sourceId?: string
}

export default function KnowledgeGaps({ engramId, engramSlug }: { engramId: string; engramSlug: string }) {
  const router = useRouter()
  const [gaps, setGaps] = useState<Gap[]>([])
  const [recompiling, setRecompiling] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()

    Promise.all([
      supabase.from("articles").select("slug, title, confidence, content_md, source_ids, related_slugs").eq("engram_id", engramId),
      supabase.from("edges").select("from_slug, to_slug").eq("engram_id", engramId),
      supabase.from("queries").select("question, answer_md, articles_consulted").eq("engram_id", engramId).eq("status", "completed"),
    ]).then(([articlesRes, edgesRes, queriesRes]) => {
      const articles = articlesRes.data ?? []
      const edges = edgesRes.data ?? []
      const queries = queriesRes.data ?? []
      const found: Gap[] = []
      const slugSet = new Set(articles.map(a => a.slug))

      // Missing articles: [[slug]] references to non-existent articles
      const wikiLinkPattern = /\[\[([^\]]+)\]\]/g
      for (const a of articles) {
        const content = a.content_md ?? ""
        let match
        while ((match = wikiLinkPattern.exec(content)) !== null) {
          const ref = match[1]
          if (!slugSet.has(ref)) {
            found.push({
              type: "missing",
              label: ref.replace(/-/g, " "),
              detail: `Referenced in "${a.title ?? a.slug}".`,
              actionLabel: "Research",
              actionHref: `/app/${engramSlug}/ask?q=${encodeURIComponent(ref.replace(/-/g, " "))}`,
            })
          }
        }
      }

      // Low confidence
      for (const a of articles) {
        if ((a.confidence ?? 0) < 0.5) {
          found.push({
            type: "low_confidence",
            slug: a.slug,
            label: a.title ?? a.slug,
            detail: `${Math.round((a.confidence ?? 0) * 100)}% confidence.`,
            actionLabel: "View article",
            actionHref: `/app/${engramSlug}/article/${a.slug}`,
          })
        }
      }

      // Orphans: articles with zero edges
      const connectedSlugs = new Set<string>()
      for (const e of edges) { connectedSlugs.add(e.from_slug); connectedSlugs.add(e.to_slug) }
      for (const a of articles) {
        if (!connectedSlugs.has(a.slug)) {
          const sourceIds = a.source_ids as string[] ?? []
          found.push({
            type: "orphan",
            slug: a.slug,
            label: a.title ?? a.slug,
            detail: "No connections to other articles.",
            actionLabel: sourceIds.length > 0 ? "Recompile" : "View article",
            actionHref: sourceIds.length > 0 ? undefined : `/app/${engramSlug}/article/${a.slug}`,
            sourceId: sourceIds[0],
          })
        }
      }

      // Thin answers
      for (const q of queries) {
        const consulted = q.articles_consulted as string[] ?? []
        const answerLen = (q.answer_md ?? "").length
        if (consulted.length === 0 || answerLen < 100) {
          found.push({
            type: "thin_answer",
            label: q.question,
            detail: consulted.length === 0 ? "No articles consulted." : "Answer was thin.",
            actionLabel: "Ask again",
            actionHref: `/app/${engramSlug}/ask?q=${encodeURIComponent(q.question)}`,
          })
        }
      }

      // Deduplicate
      const seen = new Set<string>()
      setGaps(found.filter(g => {
        const key = `${g.type}:${g.label}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }))
    })
  }, [engramId, engramSlug])

  const handleRecompile = useCallback(async (sourceId: string) => {
    setRecompiling(sourceId)
    const supabase = createClient()
    await supabase.functions.invoke("compile-source", { body: { source_id: sourceId } })
    supabase.functions.invoke("generate-embedding", { body: { engram_id: engramId } })
    setRecompiling(null)
    router.refresh()
  }, [engramId, router])

  const typeCounts = { missing: 0, low_confidence: 0, orphan: 0, thin_answer: 0 }
  for (const g of gaps) typeCounts[g.type]++

  const typeLabel: Record<string, string> = { missing: "Missing", low_confidence: "Low conf", orphan: "Orphan", thin_answer: "Thin" }
  const typeColor: Record<string, string> = { missing: "bg-confidence-low", low_confidence: "bg-confidence-mid", orphan: "bg-text-ghost", thin_answer: "bg-agent-active" }

  const summaryParts: string[] = []
  if (typeCounts.missing > 0) summaryParts.push(`${typeCounts.missing} missing`)
  if (typeCounts.low_confidence > 0) summaryParts.push(`${typeCounts.low_confidence} weak`)
  if (typeCounts.orphan > 0) summaryParts.push(`${typeCounts.orphan} orphan`)
  if (typeCounts.thin_answer > 0) summaryParts.push(`${typeCounts.thin_answer} thin`)

  const preview = (
    <div className="px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Gaps</span>
        <span className="text-[9px] font-mono text-text-ghost">{gaps.length}</span>
      </div>
      <p className="mt-1.5 text-[10px] text-text-ghost truncate">
        {gaps.length === 0 ? "No gaps found." : summaryParts.join(" · ")}
      </p>
    </div>
  )

  return (
    <WidgetPanel
      id="gaps"
      className="absolute bottom-3 left-3 max-w-[260px] animate-slide-in-left border-l-border-emphasis"
      preview={preview}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Knowledge Gaps</span>
        <span className="text-[9px] font-mono text-text-ghost">{gaps.length}</span>
      </div>

      {gaps.length === 0 && (
        <p className="text-xs text-text-tertiary mt-4">No gaps found. Your engram is healthy.</p>
      )}

      {/* Summary bar */}
      {gaps.length > 0 && <div className="flex gap-3 mb-6">
        {(["missing", "low_confidence", "orphan", "thin_answer"] as const).map(type => (
          typeCounts[type] > 0 && (
            <div key={type} className="flex items-center gap-1.5">
              <div className={`w-1 h-1 rounded-full ${typeColor[type]}`} />
              <span className="text-[10px] font-mono text-text-ghost">{typeCounts[type]} {typeLabel[type].toLowerCase()}</span>
            </div>
          )
        ))}
      </div>}

      {gaps.length > 0 && <div className="space-y-0">
        {gaps.map((gap, i) => (
          <div key={i} className="flex items-start gap-3 border-b border-border/50 py-3 first:pt-0 last:border-0">
            <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${typeColor[gap.type]}`} />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-text-secondary">{gap.label}</p>
              <p className="text-[10px] font-mono text-text-ghost mt-0.5">{gap.detail}</p>
              {gap.actionHref ? (
                <Link
                  href={gap.actionHref}
                  onClick={(e) => e.stopPropagation()}
                  className="text-[10px] font-mono text-text-ghost hover:text-text-secondary border-b border-transparent hover:border-text-ghost transition-colors duration-120 mt-1.5 inline-block"
                >
                  {gap.actionLabel}
                </Link>
              ) : gap.sourceId ? (
                <button
                  onClick={(e) => { e.stopPropagation(); handleRecompile(gap.sourceId!) }}
                  disabled={recompiling === gap.sourceId}
                  className="text-[10px] font-mono text-text-ghost hover:text-text-secondary border-b border-transparent hover:border-text-ghost transition-colors duration-120 mt-1.5 cursor-pointer disabled:opacity-30"
                >
                  {recompiling === gap.sourceId ? "Recompiling..." : gap.actionLabel}
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>}
    </WidgetPanel>
  )
}
