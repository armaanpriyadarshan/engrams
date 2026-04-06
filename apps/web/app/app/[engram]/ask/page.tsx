"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { createSnapshot } from "@/lib/snapshots"
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
  const searchParams = useSearchParams()
  const engramSlug = params.engram as string
  const prefillQ = searchParams.get("q")
  const autoAsked = useRef(false)

  const [question, setQuestion] = useState(prefillQ ?? "")
  const [asking, setAsking] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState("")
  const [engramId, setEngramId] = useState<string | null>(null)
  const [history, setHistory] = useState<PastQuery[]>([])
  const [filing, setFiling] = useState(false)
  const [fileStatus, setFileStatus] = useState("")

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

  const compileAnswer = useCallback(async (answerMd: string, questionText: string) => {
    if (!answerMd || !engramId) return
    setFiling(true)
    setFileStatus("Filing into knowledge base...")

    const supabase = createClient()

    const { data: source } = await supabase.from("sources").insert({
      engram_id: engramId,
      source_type: "query_answer",
      content_md: answerMd,
      title: questionText,
      status: "pending",
    }).select("id").single()

    if (!source) {
      setFileStatus("Filing failed.")
      setFiling(false)
      return
    }

    await supabase.rpc("increment_source_count", { eid: engramId })

    const { data: compileResult, error: compileError } = await supabase.functions.invoke("compile-source", {
      body: { source_id: source.id },
    })

    if (compileError) {
      setFileStatus("Filing failed.")
    } else {
      const created = compileResult?.articles_created ?? 0
      const updated = compileResult?.articles_updated ?? 0
      setFileStatus(`Compiled. ${created} created. ${updated} updated.`)
      await createSnapshot(supabase, engramId, "query_fileback", `${created} created. ${updated} updated.`, {
        articles_created: created,
        articles_updated: updated,
      }, source.id)
      supabase.functions.invoke("generate-embedding", { body: { engram_id: engramId } })
      supabase.functions.invoke("detect-gaps", { body: { engram_id: engramId, trigger_source_id: source.id } })
      router.refresh()
    }
    setFiling(false)
  }, [engramId, router])

  const ask = useCallback(async (q?: string) => {
    const queryText = q ?? question
    if (!queryText.trim() || !engramId) return

    setAsking(true)
    setResult(null)
    setError("")
    setFileStatus("")

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

    // Auto-file substantial answers through the compilation engine
    if (data.answer_md && data.answer_md.length > 300) {
      compileAnswer(data.answer_md, queryText)
    }

    // Refresh history
    const { data: queries } = await supabase
      .from("queries")
      .select("id, question, answer_md, articles_consulted, suggested_followups, created_at")
      .eq("engram_id", engramId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(10)
    setHistory(queries ?? [])
  }, [question, engramId, compileAnswer])

  // Auto-submit if ?q= param is present
  useEffect(() => {
    if (prefillQ && engramId && !autoAsked.current) {
      autoAsked.current = true
      ask(prefillQ)
    }
  }, [prefillQ, engramId, ask])

  const loadPastQuery = (q: PastQuery) => {
    setQuestion(q.question)
    setResult({
      query_id: q.id,
      answer_md: q.answer_md ?? "",
      articles_consulted: q.articles_consulted ?? [],
      suggested_followups: q.suggested_followups ?? [],
    })
    setError("")
    setFileStatus("")
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
            {fileStatus ? (
              <span className={`text-xs font-mono ${filing ? "text-agent-active" : "text-text-tertiary"}`}>
                {fileStatus}
              </span>
            ) : (
              <button
                onClick={() => compileAnswer(result.answer_md, question)}
                disabled={filing}
                className="text-xs font-mono text-text-tertiary hover:text-text-emphasis transition-colors duration-150 cursor-pointer"
              >
                File as article
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
