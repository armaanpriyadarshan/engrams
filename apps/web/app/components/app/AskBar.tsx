"use client"

import { useState, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import ArticleContent from "./ArticleContent"
import Link from "next/link"

export default function AskBar({ engramId, engramSlug }: { engramId: string; engramSlug: string }) {
  const [query, setQuery] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [answer, setAnswer] = useState("")
  const [articlesConsulted, setArticlesConsulted] = useState<string[]>([])
  const [followups, setFollowups] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = async (q?: string) => {
    const text = q ?? query
    if (!text.trim() || submitting) return
    setSubmitting(true)
    setAnswer("")
    setArticlesConsulted([])
    setFollowups([])

    const supabase = createClient()
    const { data, error } = await supabase.functions.invoke("ask-engram", {
      body: { engram_id: engramId, question: text.trim() },
    })

    if (error || !data) {
      setAnswer("Query failed. Try again.")
    } else {
      setAnswer(data.answer_md ?? "No answer.")
      setArticlesConsulted(data.articles_consulted ?? [])
      setFollowups(data.suggested_followups ?? [])
    }
    setSubmitting(false)
  }

  const clear = () => {
    setAnswer("")
    setQuery("")
    setArticlesConsulted([])
    setFollowups([])
  }

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 w-full max-w-xl px-6 pointer-events-auto animate-slide-in-down" style={{ animationDelay: "400ms" }}>
      <div className="bg-surface/90 backdrop-blur-md border border-border-emphasis rounded-sm overflow-hidden">
        {answer && (
          <div className="px-4 py-3 border-b border-border max-h-[40vh] overflow-y-auto">
            <div className="prose-engram leading-[1.6] text-xs text-text-secondary">
              <ArticleContent contentMd={answer} engramSlug={engramSlug} />
            </div>
            {articlesConsulted.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {articlesConsulted.map((slug) => (
                  <Link key={slug} href={`/app/${engramSlug}/article/${slug}`}
                    className="text-[10px] font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-150">
                    {slug.replace(/-/g, " ")}
                  </Link>
                ))}
              </div>
            )}
            {followups.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {followups.map((f, i) => (
                  <button key={i} onClick={() => { setQuery(f); handleSubmit(f) }}
                    className="text-[10px] text-text-ghost hover:text-text-tertiary transition-colors duration-150 cursor-pointer">
                    {f}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={clear}
              className="mt-2 text-[10px] font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-150 cursor-pointer"
            >
              Clear
            </button>
          </div>
        )}
        <div className="flex items-center">
          <div className="pl-4 text-text-ghost">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmit() }}
            placeholder="Ask your engram anything..."
            className="flex-1 bg-transparent px-3 py-3 text-sm text-text-primary placeholder:text-text-ghost outline-none"
          />
          <button
            onClick={() => handleSubmit()}
            disabled={submitting || !query.trim()}
            className="px-4 py-3 text-text-tertiary hover:text-text-emphasis disabled:opacity-20 transition-colors duration-150 cursor-pointer"
          >
            {submitting ? (
              <span className="text-[10px] font-mono text-agent-active">...</span>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
