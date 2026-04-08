"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import ArticleContent from "./ArticleContent"
import Link from "next/link"

interface Turn {
  id: string
  question: string
  answer: string
  articlesConsulted: string[]
  followups: string[]
  streaming: boolean
  errored: boolean
}

export default function AskBar({ engramId, engramSlug }: { engramId: string; engramSlug: string }) {
  const [query, setQuery] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [minimized, setMinimized] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Auto-scroll the conversation as new content streams in
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns])

  const handleSubmit = useCallback(async (q?: string) => {
    const text = (q ?? query).trim()
    if (!text) return

    // NOTE: no `submitting` guard here — if a previous turn is still
    // streaming, we abort it (via the abortController below) and start
    // the new one immediately. The old reader loop will see ctrl.signal
    // aborted and bail out; its turn's streaming flag gets cleared.
    setSubmitting(true)
    setQuery("")
    setMinimized(false)

    // Build history from prior turns to give the model conversation context
    const history: Array<{ role: string; content: string }> = []
    for (const t of turns) {
      if (!t.errored) {
        history.push({ role: "user", content: t.question })
        history.push({ role: "assistant", content: t.answer })
      }
    }

    // Append a new turn placeholder with a stable id so async updates
    // below can target it by id instead of "last turn" — which can race
    // with followup submissions and stream updates from aborted fetches.
    const turnId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const newTurn: Turn = {
      id: turnId,
      question: text,
      answer: "",
      articlesConsulted: [],
      followups: [],
      streaming: true,
      errored: false,
    }
    setTurns(prev => [...prev, newTurn])

    const patchTurn = (updater: (t: Turn) => Turn) => {
      setTurns(prev => prev.map((t) => t.id === turnId ? updater(t) : t))
    }

    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const supabase = createClient()
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token ?? ""
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

      const resp = await fetch(`${supabaseUrl}/functions/v1/ask-engram`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({
          engram_id: engramId,
          question: text,
          history,
        }),
        signal: ctrl.signal,
      })

      if (!resp.ok || !resp.body) {
        patchTurn((t) => ({ ...t, answer: "Query failed. Try again.", streaming: false, errored: true }))
        setSubmitting(false)
        return
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        if (ctrl.signal.aborted) break
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith("data: ")) continue
          const payload = trimmed.slice(6)
          try {
            const event = JSON.parse(payload)
            if (event.type === "delta") {
              patchTurn((t) => ({ ...t, answer: t.answer + event.text }))
            } else if (event.type === "articles") {
              patchTurn((t) => ({ ...t, articlesConsulted: event.slugs }))
            } else if (event.type === "followups") {
              patchTurn((t) => ({ ...t, followups: event.followups }))
            } else if (event.type === "done") {
              patchTurn((t) => ({ ...t, streaming: false }))
            } else if (event.type === "error") {
              patchTurn((t) => ({ ...t, answer: t.answer || event.message, streaming: false, errored: true }))
            }
          } catch { /* ignore parse errors on partial chunks */ }
        }
      }

      // Stream ended without an explicit done event — clear streaming flag
      patchTurn((t) => t.streaming ? { ...t, streaming: false } : t)
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") {
        // User abandoned this turn by asking a followup. Mark it done so
        // the pulsing cursor stops on the old row.
        patchTurn((t) => t.streaming ? { ...t, streaming: false } : t)
        return
      }
      patchTurn((t) => ({ ...t, answer: "Query failed. Try again.", streaming: false, errored: true }))
    } finally {
      // Only clear abortRef if we're still the current controller. If a
      // followup has already started a new controller, don't stomp it.
      if (abortRef.current === ctrl) {
        abortRef.current = null
        setSubmitting(false)
      }
    }
  }, [query, turns, engramId])

  const clear = () => {
    if (abortRef.current) abortRef.current.abort()
    setTurns([])
    setQuery("")
    setMinimized(false)
  }

  const hasConversation = turns.length > 0

  // Minimized pill — shows turn count, click to expand
  if (minimized && hasConversation) {
    return (
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[60] pointer-events-auto">
        <button
          onClick={() => setMinimized(false)}
          className="bg-surface/90 backdrop-blur-md border border-border-emphasis rounded-sm px-4 py-2 flex items-center gap-3 text-[10px] font-mono text-text-secondary hover:text-text-emphasis transition-colors duration-120 cursor-pointer"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Conversation · {turns.length} turn{turns.length !== 1 ? "s" : ""}
        </button>
      </div>
    )
  }

  return (
    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[60] w-full max-w-xl px-6 pointer-events-auto animate-slide-in-down" style={{ animationDelay: "400ms" }}>
      <div className="bg-surface/90 backdrop-blur-md border border-border-emphasis rounded-sm overflow-hidden">
        {hasConversation && (
          <>
            {/* Header with minimize/clear */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border">
              <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">
                Conversation · {turns.length} turn{turns.length !== 1 ? "s" : ""}
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setMinimized(true)}
                  className="text-[10px] font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-120 cursor-pointer"
                  title="Minimize (keeps conversation)"
                >
                  Minimize
                </button>
                <button
                  onClick={clear}
                  className="text-[10px] font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-120 cursor-pointer"
                  title="Clear conversation"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Turns */}
            <div ref={scrollRef} className="max-h-[50vh] overflow-y-auto scrollbar-hidden">
              {turns.map((turn, i) => (
                <div key={i} className={`px-4 py-3 ${i > 0 ? "border-t border-border/50" : ""}`}>
                  {/* User question */}
                  <p className="text-[11px] font-mono text-text-ghost uppercase tracking-wider mb-1.5">You</p>
                  <p className="text-xs text-text-emphasis leading-[1.6] mb-3">{turn.question}</p>

                  {/* Assistant answer */}
                  <p className="text-[11px] font-mono text-text-ghost uppercase tracking-wider mb-1.5">Engram</p>
                  {turn.answer ? (
                    <div className="prose-engram leading-[1.6] text-xs text-text-secondary">
                      <ArticleContent contentMd={turn.answer} engramSlug={engramSlug} />
                      {turn.streaming && <span className="inline-block w-1.5 h-3 bg-text-secondary/60 align-baseline ml-0.5 animate-pulse" />}
                    </div>
                  ) : (
                    <p className="text-xs text-text-ghost font-mono">
                      Thinking<span className="inline-flex w-4"><span className="animate-loading-dots" /></span>
                    </p>
                  )}

                  {/* Articles consulted */}
                  {turn.articlesConsulted.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="text-[9px] font-mono text-text-ghost uppercase tracking-wider">Sources</span>
                      {turn.articlesConsulted.map((slug) => (
                        <Link
                          key={slug}
                          href={`/app/${engramSlug}/article/${slug}`}
                          className="text-[10px] font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-120"
                        >
                          {slug.replace(/-/g, " ")}
                        </Link>
                      ))}
                    </div>
                  )}

                  {/* Followups — only on the last turn, only when not streaming */}
                  {i === turns.length - 1 && !turn.streaming && turn.followups.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/50">
                      <p className="text-[9px] font-mono text-text-ghost uppercase tracking-wider mb-2">Continue</p>
                      <div className="flex flex-col gap-1.5">
                        {turn.followups.map((f, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleSubmit(f)}
                            disabled={submitting}
                            className="text-left text-xs text-text-tertiary hover:text-text-emphasis transition-colors duration-120 cursor-pointer disabled:opacity-30 disabled:cursor-default"
                          >
                            → {f}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Input */}
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
            placeholder={hasConversation ? "Ask a followup..." : "Ask your engram anything..."}
            className="flex-1 bg-transparent px-3 py-3 text-sm text-text-primary placeholder:text-text-ghost outline-none"
          />
          <button
            onClick={() => handleSubmit()}
            disabled={submitting || !query.trim()}
            className="px-4 py-3 text-text-tertiary hover:text-text-emphasis disabled:opacity-20 transition-colors duration-120 cursor-pointer"
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
