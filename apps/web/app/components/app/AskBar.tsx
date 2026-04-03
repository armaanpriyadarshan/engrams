"use client"

import { useState, useRef } from "react"
import { createClient } from "@/lib/supabase/client"

export default function AskBar({ engramId, engramSlug }: { engramId: string; engramSlug: string }) {
  const [query, setQuery] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [answer, setAnswer] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = async () => {
    if (!query.trim() || submitting) return
    setSubmitting(true)
    setAnswer("")

    const supabase = createClient()
    // Store the query
    await supabase.from("queries").insert({
      engram_id: engramId,
      user_id: (await supabase.auth.getUser()).data.user?.id,
      prompt: query.trim(),
    })

    // For now, show a placeholder response
    setAnswer("Thinking... (compilation engine will process this)")
    setSubmitting(false)
  }

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 w-full max-w-xl px-6 pointer-events-auto animate-slide-in-down" style={{ animationDelay: "400ms" }}>
      <div className="bg-surface/90 backdrop-blur-md border border-border-emphasis rounded-sm overflow-hidden">
        {answer && (
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs text-text-secondary leading-relaxed">{answer}</p>
            <button
              onClick={() => { setAnswer(""); setQuery("") }}
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
            onClick={handleSubmit}
            disabled={submitting || !query.trim()}
            className="px-4 py-3 text-text-tertiary hover:text-text-emphasis disabled:opacity-20 transition-colors duration-150 cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
