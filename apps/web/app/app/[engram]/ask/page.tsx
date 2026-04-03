"use client"

import { useState, useCallback, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"
import ArticleContent from "@/app/components/app/ArticleContent"

interface QueryResult {
  query_id: string
  answer_md: string
  articles_consulted: string[]
  suggested_followups: string[]
}

interface PastQuery {
  id: string
  question: string
  answer_md: string | null
  articles_consulted: string[]
  suggested_followups: string[]
  created_at: string
}

export default function AskPage() {
  const params = useParams()
  const router = useRouter()
  const engramSlug = params.engram as string

  const [question, setQuestion] = useState("")
  const [asking, setAsking] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState("")
  const [engramId, setEngramId] = useState<string | null>(null)
  const [history, setHistory] = useState<PastQuery[]>([])
  const [filing, setFiling] = useState(false)
  const [filedSlug, setFiledSlug] = useState<string | null>(null)

  // Resolve engram ID + load history
  useEffect(() => {
    const supabase = createClient()
    supabase
      .from("engrams")
      .select("id")
      .eq("slug", engramSlug)
      .single()
      .then(({ data }) => {
        if (data) {
          setEngramId(data.id)
          // Load query history
          supabase
            .from("queries")
            .select("id, question, answer_md, articles_consulted, suggested_followups, created_at")
            .eq("engram_id", data.id)
            .eq("status", "completed")
            .order("created_at", { ascending: false })
            .limit(10)
            .then(({ data: queries }) => setHistory(queries ?? []))
        }
      })
  }, [engramSlug])

  const ask = useCallback(async (q?: string) => {
    const queryText = q ?? question
    if (!queryText.trim() || !engramId) return

    setAsking(true)
    setResult(null)
    setError("")
    setFiledSlug(null)

    const supabase = createClient()
    const { data, error: fnError } = await supabase.functions.invoke("ask-engram", {
      body: { engram_id: engramId, question: queryText },
    })

    if (fnError || !data) {
      setError("Query failed. Try again.")
      setAsking(false)
      return
    }

    setResult(data)
    setAsking(false)

    // Refresh history
    const { data: queries } = await supabase
      .from("queries")
      .select("id, question, answer_md, articles_consulted, suggested_followups, created_at")
      .eq("engram_id", engramId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(10)
    setHistory(queries ?? [])
  }, [question, engramId])

  const fileAsArticle = useCallback(async () => {
    if (!result?.answer_md || !engramId) return
    setFiling(true)

    const supabase = createClient()
    const slug = question
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60)

    await supabase.from("articles").insert({
      engram_id: engramId,
      slug: `query-${slug}`,
      title: question,
      summary: result.answer_md.slice(0, 200),
      content_md: result.answer_md,
      confidence: 0.7,
      article_type: "query_result",
      tags: ["query"],
      source_ids: [],
      related_slugs: result.articles_consulted,
    })

    // Update article count
    const { count } = await supabase
      .from("articles")
      .select("id", { count: "exact", head: true })
      .eq("engram_id", engramId)

    await supabase
      .from("engrams")
      .update({ article_count: count ?? 0 })
      .eq("id", engramId)

    setFiledSlug(`query-${slug}`)
    setFiling(false)
    router.refresh()
  }, [result, engramId, question, router])

  const loadPastQuery = (q: PastQuery) => {
    setQuestion(q.question)
    setResult({
      query_id: q.id,
      answer_md: q.answer_md ?? "",
      articles_consulted: q.articles_consulted ?? [],
      suggested_followups: q.suggested_followups ?? [],
    })
    setError("")
    setFiledSlug(null)
  }

  return (
    <div className="max-w-[660px] mx-auto px-6 py-10">
      <h1 className="font-heading text-lg text-text-emphasis mb-8">Ask</h1>

      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask()
        }}
        placeholder="Ask a question about this engram"
        rows={3}
        className="w-full bg-surface border border-border-emphasis px-4 py-3 text-sm text-text-primary placeholder:text-text-ghost outline-none focus:border-text-tertiary transition-colors duration-[180ms] resize-none"
      />

      <div className="mt-4 flex items-center gap-4">
        <button
          onClick={() => ask()}
          disabled={asking || !question.trim()}
          className="bg-text-primary text-void px-5 py-2.5 text-sm font-medium cursor-pointer hover:bg-text-emphasis disabled:opacity-30 disabled:cursor-default transition-colors duration-150"
        >
          {asking ? "Researching..." : "Ask"}
        </button>
        {asking && (
          <span className="text-xs font-mono text-agent-active">Consulting articles...</span>
        )}
      </div>

      {error && (
        <p className="mt-4 text-xs text-danger">{error}</p>
      )}

      {result && (
        <div className="mt-8 border-t border-border pt-8">
          <div className="prose-engram leading-[1.65] text-[15px] text-text-primary">
            <ArticleContent contentMd={result.answer_md} engramSlug={engramSlug} />
          </div>

          {result.articles_consulted.length > 0 && (
            <div className="mt-8 border-t border-border pt-6">
              <h2 className="text-xs text-text-tertiary uppercase tracking-widest font-mono mb-3">Articles consulted</h2>
              <div className="space-y-1">
                {result.articles_consulted.map((slug) => (
                  <Link
                    key={slug}
                    href={`/app/${engramSlug}/article/${slug}`}
                    className="block text-sm text-text-secondary hover:text-text-emphasis transition-colors duration-150"
                  >
                    {slug.replace(/-/g, " ")}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {result.suggested_followups.length > 0 && (
            <div className="mt-6 border-t border-border pt-6">
              <h2 className="text-xs text-text-tertiary uppercase tracking-widest font-mono mb-3">Follow up</h2>
              <div className="space-y-2">
                {result.suggested_followups.map((followup, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setQuestion(followup)
                      ask(followup)
                    }}
                    className="block text-sm text-text-secondary hover:text-text-emphasis transition-colors duration-150 cursor-pointer text-left"
                  >
                    {followup}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 border-t border-border pt-6">
            {filedSlug ? (
              <Link
                href={`/app/${engramSlug}/article/${filedSlug}`}
                className="text-xs font-mono text-text-tertiary hover:text-text-emphasis transition-colors duration-150"
              >
                Filed as article. View.
              </Link>
            ) : (
              <button
                onClick={fileAsArticle}
                disabled={filing}
                className="text-xs font-mono text-text-tertiary hover:text-text-emphasis transition-colors duration-150 cursor-pointer"
              >
                {filing ? "Filing..." : "File as article"}
              </button>
            )}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-12 border-t border-border pt-8">
          <h2 className="text-xs text-text-tertiary uppercase tracking-widest font-mono mb-4">Previous questions</h2>
          <div className="space-y-2">
            {history.map((q) => (
              <button
                key={q.id}
                onClick={() => loadPastQuery(q)}
                className="block text-sm text-text-secondary hover:text-text-emphasis transition-colors duration-150 cursor-pointer text-left truncate w-full"
              >
                {q.question}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
