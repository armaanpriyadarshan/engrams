"use client"

import { useEffect, useState } from "react"
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
}

interface ArticleRef {
  slug: string
  title: string
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

export default function SourceTree({ engramId, engramSlug }: { engramId: string; engramSlug: string }) {
  const [sources, setSources] = useState<Source[]>([])
  const [allSources, setAllSources] = useState<Source[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [articleRefs, setArticleRefs] = useState<ArticleRef[]>([])


  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from("sources").select("id, title, source_type, source_url, status, created_at, metadata").eq("engram_id", engramId).order("created_at", { ascending: false }).limit(6),
      supabase.from("sources").select("id, title, source_type, source_url, status, created_at, metadata").eq("engram_id", engramId).order("created_at", { ascending: false }),
      supabase.from("sources").select("id", { count: "exact" }).eq("engram_id", engramId),
      supabase.from("articles").select("slug, title, source_ids").eq("engram_id", engramId),
    ]).then(([sourcesRes, allSourcesRes, countRes, articlesRes]) => {
      if (sourcesRes.data) setSources(sourcesRes.data)
      if (allSourcesRes.data) setAllSources(allSourcesRes.data)
      if (countRes.count) setTotalCount(countRes.count)
      if (articlesRes.data) setArticleRefs(articlesRes.data.map(a => ({ slug: a.slug, title: a.title ?? a.slug, source_ids: a.source_ids as string[] ?? [] })))
    })
  }, [engramId])

  const getArticlesForSource = (sourceId: string) =>
    articleRefs.filter(a => a.source_ids.includes(sourceId))

  const preview = (
    <div className="px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Sources</span>
        <span className="text-[9px] font-mono text-text-ghost">{totalCount}</span>
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
      className="absolute top-3 left-3 max-w-[260px] animate-slide-in-left border-l-border-emphasis"
      preview={preview}
    >
      <div className="flex items-center justify-between mb-6">
        <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Sources</span>
        <span className="text-[9px] font-mono text-text-ghost">{totalCount}</span>
      </div>
      {allSources.length === 0 ? (
        <p className="text-sm text-text-secondary">No sources yet. <Link href={`/app/${engramSlug}/feed`} className="hover:text-text-emphasis transition-colors duration-120">Feed one.</Link></p>
      ) : (
        <div className="space-y-5">
          {allSources.map((s) => {
            const domain = extractDomain(s.source_url)
            const typeLabel = s.source_type === "url" ? (domain?.includes("arxiv") ? "arxiv" : "url") : s.source_type
            const meta = s.metadata as Record<string, string> | null
            const related = getArticlesForSource(s.id)
            return (
              <div key={s.id} className="border-b border-border/50 pb-5 last:border-0 last:pb-0">
                <p className="text-sm text-text-primary">{s.title ?? s.source_type}</p>
                <p className="text-[10px] font-mono text-text-ghost mt-0.5">
                  {typeLabel}{meta?.author ? ` · ${meta.author}` : ""}{meta?.year ? ` · ${meta.year}` : ""} · {timeAgo(s.created_at)}
                </p>
                {related.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {related.map(a => (
                      <Link
                        key={a.slug}
                        href={`/app/${engramSlug}/article/${a.slug}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[10px] font-mono text-text-ghost hover:text-text-secondary border border-border/60 px-1.5 py-0.5 transition-colors duration-120"
                      >
                        {a.title}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </WidgetPanel>
  )
}
