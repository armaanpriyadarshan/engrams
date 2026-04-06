"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import ArticleContent from "./ArticleContent"

interface ArticlePreviewProps {
  slug: string
  engramSlug: string
  engramId: string
}

interface Article {
  title: string
  summary: string | null
  content_md: string
  confidence: number | null
  article_type: string | null
  tags: string[] | null
  related_slugs: string[] | null
  source_ids: string[] | null
}

export default function ArticlePreview({ slug, engramSlug, engramId }: ArticlePreviewProps) {
  const [article, setArticle] = useState<Article | null>(null)
  const [backlinks, setBacklinks] = useState<{ slug: string; title: string }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const supabase = createClient()

    Promise.all([
      supabase
        .from("articles")
        .select("title, summary, content_md, confidence, article_type, tags, related_slugs, source_ids")
        .eq("engram_id", engramId)
        .eq("slug", slug)
        .single(),
      supabase
        .from("articles")
        .select("slug, title")
        .eq("engram_id", engramId)
        .contains("related_slugs", [slug]),
    ]).then(([articleRes, backlinksRes]) => {
      setArticle(articleRes.data)
      setBacklinks(backlinksRes.data ?? [])
      setLoading(false)
    })
  }, [slug, engramId])

  if (loading) {
    return <p className="text-xs font-mono text-text-ghost">Loading...</p>
  }

  if (!article) {
    return <p className="text-xs font-mono text-text-ghost">Article not found.</p>
  }

  return (
    <div>
      <Link
        href={`/app/${engramSlug}/article/${slug}`}
        className="text-[10px] font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-120"
      >
        Open full article &rarr;
      </Link>

      <h2 className="font-heading text-xl text-text-emphasis mt-3 leading-tight">{article.title}</h2>

      {article.summary && (
        <p className="mt-2 text-sm text-text-secondary leading-relaxed">{article.summary}</p>
      )}

      <div className="mt-2 flex items-center gap-3 text-[10px] font-mono text-text-ghost">
        {article.article_type && <span>{article.article_type}</span>}
        {article.confidence != null && (
          <>
            <span>&middot;</span>
            <span>confidence {(article.confidence * 100).toFixed(0)}%</span>
          </>
        )}
        {article.tags && article.tags.length > 0 && (
          <>
            <span>&middot;</span>
            {article.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </>
        )}
      </div>

      <div className="mt-6 border-t border-border pt-6">
        <div className="prose-engram leading-[1.65] text-[14px] text-text-primary">
          <ArticleContent contentMd={article.content_md} engramSlug={engramSlug} />
        </div>
      </div>

      {backlinks.length > 0 && (
        <div className="mt-6 border-t border-border pt-4">
          <h3 className="text-[10px] text-text-tertiary uppercase tracking-widest font-mono mb-2">Backlinks</h3>
          <div className="space-y-1">
            {backlinks.map((b) => (
              <span
                key={b.slug}
                className="block text-xs text-text-secondary"
              >
                {b.title}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
