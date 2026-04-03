"use client"

import { useState, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"
import ArticleContent from "./ArticleContent"

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

interface AskPanelProps {
  engramId: string
  engramSlug: string
  prefill?: string
}

export default function AskPanel({ engramId, engramSlug, prefill }: AskPanelProps) {
  const router = useRouter()
  const [question, setQuestion] = useState(prefill ?? "")
  const [asking, setAsking] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState("")
  const [history, setHistory] = useState<PastQuery[]>([])
  const [filing, setFiling] = useState(false)
  const [fileStatus, setFileStatus] = useState("")

  useEffect(() => {
    if (prefill) setQuestion(prefill)
  }, [prefill])

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from("queries")
      .select("id, question, answer_md, articles_consulted, suggested_followups, created_at")
      .eq("engram_id", engramId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => setHistory(data ?? []))
  }, [engramId])

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

    if (!source) { setFileStatus("Filing failed."); setFiling(false); return }

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

    if (fnError || !data) { setError("Query failed. Try again."); setAsking(false); return }

    setResult(data)
    setAsking(false)

    if (data.answer_md && data.answer_md.length > 300) {
      compileAnswer(data.answer_md, queryText)
    }

    const { data: queries } = await supabase
      .from("queries")
      .select("id, question, answer_md, articles_consulted, suggested_followups, created_at")
      .eq("engram_id", engramId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(10)
    setHistory(queries ?? [])
  }, [question, engramId, compileAnswer])

  return (
    <div>
      <h2 className="font-heading text-lg text-text-emphasis mb-4">Ask</h2>

      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask() }}
        placeholder="Ask a question"
        rows={2}
        className="w-full bg-surface border border-border-emphasis px-3 py-2 text-sm text-text-primary placeholder:text-text-ghost outline-none focus:border-text-tertiary transition-colors duration-[180ms] resize-none"
      />

      <button
        onClick={() => ask()}
        disabled={asking || !question.trim()}
        className="mt-2 bg-text-primary text-void px-4 py-2 text-xs font-medium cursor-pointer hover:bg-text-emphasis disabled:opacity-30 disabled:cursor-default transition-colors duration-150"
      >
        {asking ? "Researching..." : "Ask"}
      </button>

      {asking && <p className="mt-2 text-[10px] font-mono text-agent-active">Consulting articles...</p>}
      {error && <p className="mt-2 text-[10px] text-danger">{error}</p>}

      {result && (
        <div className="mt-4 border-t border-border pt-4">
          <div className="prose-engram leading-[1.6] text-[13px] text-text-primary">
            <ArticleContent contentMd={result.answer_md} engramSlug={engramSlug} />
          </div>

          {result.articles_consulted.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <h3 className="text-[10px] text-text-tertiary uppercase tracking-widest font-mono mb-2">Consulted</h3>
              <div className="space-y-0.5">
                {result.articles_consulted.map((slug) => (
                  <Link key={slug} href={`/app/${engramSlug}/article/${slug}`}
                    className="block text-xs text-text-secondary hover:text-text-emphasis transition-colors duration-150">
                    {slug.replace(/-/g, " ")}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {result.suggested_followups.length > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              <h3 className="text-[10px] text-text-tertiary uppercase tracking-widest font-mono mb-2">Follow up</h3>
              {result.suggested_followups.map((f, i) => (
                <button key={i} onClick={() => { setQuestion(f); ask(f) }}
                  className="block text-xs text-text-secondary hover:text-text-emphasis transition-colors duration-150 cursor-pointer text-left mb-1">
                  {f}
                </button>
              ))}
            </div>
          )}

          {fileStatus ? (
            <p className={`mt-3 text-[10px] font-mono ${filing ? "text-agent-active" : "text-text-tertiary"}`}>{fileStatus}</p>
          ) : (
            <button onClick={() => compileAnswer(result.answer_md, question)} disabled={filing}
              className="mt-3 text-[10px] font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-150 cursor-pointer">
              File as article
            </button>
          )}
        </div>
      )}

      {history.length > 0 && !result && (
        <div className="mt-6 border-t border-border pt-4">
          <h3 className="text-[10px] text-text-tertiary uppercase tracking-widest font-mono mb-2">Previous</h3>
          {history.slice(0, 5).map((q) => (
            <button key={q.id} onClick={() => {
              setQuestion(q.question)
              setResult({ query_id: q.id, answer_md: q.answer_md ?? "", articles_consulted: q.articles_consulted ?? [], suggested_followups: q.suggested_followups ?? [] })
              setFileStatus("")
            }}
              className="block text-xs text-text-secondary hover:text-text-emphasis transition-colors duration-150 cursor-pointer text-left truncate w-full mb-1">
              {q.question}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
