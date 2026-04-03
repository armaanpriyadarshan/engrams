"use client"

import { useState, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"

export default function AddSourceButton({ engramId }: { engramId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    if (!url.trim() || submitting) return
    setSubmitting(true)
    const supabase = createClient()
    await supabase.from("sources").insert({
      engram_id: engramId,
      source_type: url.startsWith("http") ? "url" : "text",
      source_url: url.startsWith("http") ? url.trim() : null,
      content_md: url.startsWith("http") ? null : url.trim(),
      title: url.trim().slice(0, 80),
      status: "pending",
    })
    await supabase.rpc("increment_source_count", { eid: engramId })
    setUrl("")
    setOpen(false)
    setSubmitting(false)
    router.refresh()
  }

  if (open) {
    return (
      <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
        <div className="bg-surface/90 backdrop-blur-md border border-border-emphasis rounded-sm flex items-center gap-0">
          <input
            ref={inputRef}
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setOpen(false) }}
            placeholder="URL or text"
            className="bg-transparent px-3 py-2 text-xs text-text-primary placeholder:text-text-ghost outline-none w-64"
          />
          <button
            onClick={submit}
            disabled={submitting || !url.trim()}
            className="px-3 py-2 text-xs text-text-tertiary hover:text-text-emphasis disabled:opacity-30 transition-colors duration-150 cursor-pointer border-l border-border"
          >
            Feed
          </button>
          <button
            onClick={() => setOpen(false)}
            className="px-2 py-2 text-text-ghost hover:text-text-tertiary transition-colors duration-150 cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
      <button
        onClick={() => setOpen(true)}
        className="bg-surface/80 backdrop-blur-md border border-border-emphasis hover:border-text-tertiary rounded-sm px-4 py-2 flex items-center gap-2 text-xs text-text-secondary hover:text-text-emphasis transition-all duration-150 cursor-pointer"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Add source
      </button>
    </div>
  )
}
