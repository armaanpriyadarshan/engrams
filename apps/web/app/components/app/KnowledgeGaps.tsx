"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"
import { WidgetPanel } from "./WidgetPanel"

interface Gap {
  type: "missing" | "low_confidence" | "orphan" | "thin_answer"
  label: string
  detail: string
  action: { label: string; href: string }
}

export default function KnowledgeGaps({ engramId, engramSlug }: { engramId: string; engramSlug: string }) {
  const [gaps, setGaps] = useState<Gap[]>([])

  useEffect(() => {
    const supabase = createClient()

    Promise.all([
      supabase.from("articles").select("slug, title, confidence, content_md, related_slugs").eq("engram_id", engramId),
      supabase.from("edges").select("from_slug, to_slug").eq("engram_id", engramId),
      supabase.from("queries").select("question, answer_md, articles_consulted").eq("engram_id", engramId).eq("status", "completed"),
    ]).then(([articlesRes, edgesRes, queriesRes]) => {
      const articles = articlesRes.data ?? []
      const edges = edgesRes.data ?? []
      const queries = queriesRes.data ?? []
      const found: Gap[] = []
      const slugSet = new Set(articles.map(a => a.slug))

      const wikiLinkPattern = /\[\[([^\]]+)\]\]/g
      for (const a of articles) {
        const content = a.content_md ?? ""
        let match
        while ((match = wikiLinkPattern.exec(content)) !== null) {
          const ref = match[1]
          if (!slugSet.has(ref)) {
            found.push({ type: "missing", label: ref.replace(/-/g, " "), detail: `Referenced in "${a.title ?? a.slug}" but no article exists.`, action: { label: "Research", href: `/app/${engramSlug}/ask?q=${encodeURIComponent(ref.replace(/-/g, " "))}` } })
          }
        }
      }

      for (const a of articles) {
        if ((a.confidence ?? 0) < 0.5) {
          found.push({ type: "low_confidence", label: a.title ?? a.slug, detail: `${Math.round((a.confidence ?? 0) * 100)}% confidence.`, action: { label: "Strengthen", href: `/app/${engramSlug}/feed` } })
        }
      }

      const connectedSlugs = new Set<string>()
      for (const e of edges) { connectedSlugs.add(e.from_slug); connectedSlugs.add(e.to_slug) }
      for (const a of articles) {
        if (!connectedSlugs.has(a.slug)) {
          found.push({ type: "orphan", label: a.title ?? a.slug, detail: "No connections to other articles.", action: { label: "Connect", href: `/app/${engramSlug}/feed` } })
        }
      }

      for (const q of queries) {
        const consulted = q.articles_consulted as string[] ?? []
        const answerLen = (q.answer_md ?? "").length
        if (consulted.length === 0 || answerLen < 100) {
          found.push({ type: "thin_answer", label: q.question, detail: consulted.length === 0 ? "No articles consulted." : "Answer was thin.", action: { label: "Ask again", href: `/app/${engramSlug}/ask?q=${encodeURIComponent(q.question)}` } })
        }
      }

      const seen = new Set<string>()
      setGaps(found.filter(g => { const key = `${g.type}:${g.label}`; if (seen.has(key)) return false; seen.add(key); return true }))
    })
  }, [engramId, engramSlug])

  if (gaps.length === 0) return null

  const typeLabel: Record<string, string> = { missing: "Missing", low_confidence: "Low conf", orphan: "Orphan", thin_answer: "Thin" }
  const typeColor: Record<string, string> = { missing: "bg-confidence-low", low_confidence: "bg-confidence-mid", orphan: "bg-text-ghost", thin_answer: "bg-agent-active" }

  const preview = (
    <div className="px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Gaps</span>
        <span className="text-[9px] font-mono text-text-ghost">{gaps.length}</span>
      </div>
      <p className="mt-1.5 text-[10px] text-text-tertiary truncate">{gaps[0].label}</p>
    </div>
  )

  return (
    <WidgetPanel
      id="gaps"
      origin={{ bottom: "12px", right: "12px", width: "200px" }}
      className="animate-slide-in-right border-r-border-emphasis"
      preview={preview}
    >
      <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Knowledge Gaps</span>
      <p className="text-[10px] font-mono text-text-ghost mt-1 mb-6">{gaps.length} found</p>
      <div className="space-y-4">
        {gaps.map((gap, i) => (
          <div key={i} className="flex items-start gap-3 border-b border-border/50 pb-4 last:border-0">
            <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${typeColor[gap.type]}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text-secondary">{gap.label}</p>
              <p className="text-[10px] font-mono text-text-ghost mt-0.5">{typeLabel[gap.type]} · {gap.detail}</p>
              <Link href={gap.action.href} className="text-[10px] font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-120 mt-1 inline-block">
                {gap.action.label} &rarr;
              </Link>
            </div>
          </div>
        ))}
      </div>
    </WidgetPanel>
  )
}
