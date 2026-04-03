"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"

interface Article {
  slug: string
  title: string
  summary: string | null
  confidence: number | null
  article_type: string | null
  tags: string[] | null
  updated_at: string
}

interface ArticleSearchProps {
  engramId: string
  engramSlug: string
  initialArticles: Article[]
}

export default function ArticleSearch({ engramId, engramSlug, initialArticles }: ArticleSearchProps) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Article[] | null>(null)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!query.trim()) {
      setResults(null)
      return
    }

    const timeout = setTimeout(async () => {
      setSearching(true)
      const supabase = createClient()
      const { data } = await supabase
        .from("articles")
        .select("slug, title, summary, confidence, article_type, tags, updated_at")
        .eq("engram_id", engramId)
        .textSearch("fts", query, { type: "websearch" })
        .order("updated_at", { ascending: false })

      setResults(data ?? [])
      setSearching(false)
    }, 300)

    return () => clearTimeout(timeout)
  }, [query, engramId])

  const articles = results ?? initialArticles

  return (
    <>
      <div className="mb-6">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search articles"
          className="w-full bg-surface border border-border px-4 py-2.5 text-sm text-text-primary font-mono placeholder:text-text-ghost outline-none focus:border-border-emphasis transition-colors duration-[180ms]"
        />
      </div>

      {articles.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-text-secondary text-sm">
            {query.trim() ? "No articles match your search." : "Nothing here yet."}
          </p>
          {!query.trim() && (
            <p className="mt-2 text-sm text-text-tertiary">
              <Link href={`/app/${engramSlug}/feed`} className="text-text-secondary hover:text-text-emphasis transition-colors duration-150">
                Feed a source
              </Link>
              {" "}to begin.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {articles.map((a) => (
            <Link
              key={a.slug}
              href={`/app/${engramSlug}/article/${a.slug}`}
              className="block border border-border hover:border-border-emphasis bg-surface p-4 transition-colors duration-150"
            >
              <div className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 mt-2 rounded-full shrink-0" style={{
                  backgroundColor: (a.confidence ?? 0) > 0.8 ? "var(--color-confidence-high)"
                    : (a.confidence ?? 0) > 0.5 ? "var(--color-confidence-mid)" : "var(--color-confidence-low)",
                }} />
                <div>
                  <h2 className="font-heading text-sm text-text-emphasis">{a.title}</h2>
                  {a.summary && <p className="mt-1 text-xs text-text-tertiary leading-relaxed">{a.summary}</p>}
                  {a.tags && a.tags.length > 0 && (
                    <div className="mt-2 flex gap-2">
                      {a.tags.map((tag: string) => (
                        <span key={tag} className="font-mono text-[10px] text-text-ghost">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {searching && (
        <p className="mt-2 text-[10px] text-text-ghost font-mono">searching...</p>
      )}
    </>
  )
}
