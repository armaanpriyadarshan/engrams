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
  similarity?: number
}

interface ArticleSearchProps {
  engramId: string
  engramSlug: string
  initialArticles: Article[]
}

type SearchMode = "text" | "semantic"

export default function ArticleSearch({ engramId, engramSlug, initialArticles }: ArticleSearchProps) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Article[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [mode, setMode] = useState<SearchMode>("text")

  useEffect(() => {
    if (!query.trim()) {
      setResults(null)
      return
    }

    const timeout = setTimeout(async () => {
      setSearching(true)
      const supabase = createClient()

      if (mode === "semantic") {
        // Semantic search via edge function
        const { data, error } = await supabase.functions.invoke("semantic-search", {
          body: { engram_id: engramId, query: query.trim(), limit: 10 },
        })

        if (error || !data?.results) {
          // Fallback to text search
          const { data: textData } = await supabase
            .from("articles")
            .select("slug, title, summary, confidence, article_type, tags, updated_at")
            .eq("engram_id", engramId)
            .textSearch("fts", query, { type: "websearch" })
            .order("updated_at", { ascending: false })
          setResults(textData ?? [])
        } else {
          setResults(data.results.map((r: { slug: string; title: string; summary: string | null; confidence: number | null; article_type: string | null; tags: string[] | null; updated_at: string; similarity: number }) => ({
            slug: r.slug,
            title: r.title,
            summary: r.summary,
            confidence: r.confidence,
            article_type: r.article_type,
            tags: r.tags,
            updated_at: r.updated_at,
            similarity: r.similarity,
          })))
        }
      } else {
        // Text search
        const { data } = await supabase
          .from("articles")
          .select("slug, title, summary, confidence, article_type, tags, updated_at")
          .eq("engram_id", engramId)
          .textSearch("fts", query, { type: "websearch" })
          .order("updated_at", { ascending: false })
        setResults(data ?? [])
      }

      setSearching(false)
    }, 300)

    return () => clearTimeout(timeout)
  }, [query, engramId, mode])

  const articles = results ?? initialArticles

  return (
    <>
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search articles"
            className="flex-1 bg-surface border border-border px-4 py-2.5 text-sm text-text-primary font-mono placeholder:text-text-ghost outline-none focus:border-border-emphasis transition-colors duration-[180ms]"
          />
          <div className="flex bg-surface border border-border">
            <button
              onClick={() => setMode("text")}
              className={`px-2.5 py-2 text-[10px] font-mono uppercase tracking-wider cursor-pointer transition-colors duration-120 ${
                mode === "text" ? "text-text-emphasis bg-surface-raised" : "text-text-ghost hover:text-text-tertiary"
              }`}
            >
              Text
            </button>
            <button
              onClick={() => setMode("semantic")}
              className={`px-2.5 py-2 text-[10px] font-mono uppercase tracking-wider cursor-pointer transition-colors duration-120 ${
                mode === "semantic" ? "text-text-emphasis bg-surface-raised" : "text-text-ghost hover:text-text-tertiary"
              }`}
            >
              Semantic
            </button>
          </div>
        </div>
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
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="font-heading text-sm text-text-emphasis">{a.title}</h2>
                    {a.similarity != null && (
                      <span className="text-[10px] font-mono text-text-ghost shrink-0">
                        {Math.round(a.similarity * 100)}% match
                      </span>
                    )}
                  </div>
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
