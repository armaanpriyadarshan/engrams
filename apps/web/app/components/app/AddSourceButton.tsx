"use client"

import { useState, useRef, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { createSnapshot } from "@/lib/snapshots"

type FeedTab = "url" | "text" | "file"

export default function AddSourceButton({ engramId }: { engramId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<FeedTab>("url")
  const [url, setUrl] = useState("")
  const [text, setText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setUrl("")
    setText("")
    setMessage(null)
  }

  const close = () => {
    setOpen(false)
    reset()
  }

  const feed = useCallback(async (sourceType: string, content: string, title: string) => {
    if (submitting) return
    setSubmitting(true)
    setMessage(null)

    const supabase = createClient()
    const { data: source, error } = await supabase.from("sources").insert({
      engram_id: engramId,
      source_type: sourceType,
      source_url: sourceType === "url" ? content : null,
      content_md: sourceType !== "url" ? content : null,
      title,
      status: "pending",
    }).select("id").single()

    if (error || !source) {
      setMessage({ type: "err", text: "Failed to add source." })
      setSubmitting(false)
      return
    }

    await supabase.rpc("increment_source_count", { eid: engramId })
    setMessage({ type: "ok", text: "Compiling..." })
    reset()

    // Trigger compilation
    const { data: result, error: compileError } = await supabase.functions.invoke("compile-source", {
      body: { source_id: source.id },
    })

    if (compileError) {
      setMessage({ type: "err", text: "Source added. Compilation failed." })
    } else {
      const created = result?.articles_created ?? 0
      const updated = result?.articles_updated ?? 0
      setMessage({ type: "ok", text: `${created} created. ${updated} updated.` })
      await createSnapshot(supabase, engramId, "feed", `${created} created. ${updated} updated.`, {
        articles_created: created,
        articles_updated: updated,
      }, source.id)
      // Generate embeddings + detect gaps in background
      supabase.functions.invoke("generate-embedding", { body: { engram_id: engramId } })
      supabase.functions.invoke("detect-gaps", { body: { engram_id: engramId, trigger_source_id: source.id } })
      router.refresh()
    }
    setSubmitting(false)
  }, [engramId, submitting, router])

  const submitUrl = () => {
    const trimmed = url.trim()
    if (!trimmed) return
    feed("url", trimmed, trimmed)
  }

  const submitText = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    feed("text", trimmed, trimmed.slice(0, 80))
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    for (const file of Array.from(files)) {
      const content = await file.text()
      const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
      const type = ["pdf"].includes(ext) ? "pdf" : ["md", "txt", "csv", "json"].includes(ext) ? "text" : "file"
      await feed(type, content, file.name)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  const tabs: { id: FeedTab; label: string; icon: React.ReactNode }[] = [
    {
      id: "url", label: "URL",
      icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>,
    },
    {
      id: "text", label: "Text",
      icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>,
    },
    {
      id: "file", label: "File",
      icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>,
    },
  ]

  if (!open) {
    return (
      <div className="absolute top-[52px] left-1/2 -translate-x-1/2 z-30 pointer-events-auto animate-slide-in-up" style={{ animationDelay: "250ms" }}>
        <button
          onClick={() => setOpen(true)}
          className="bg-surface/80 backdrop-blur-md border border-border-emphasis hover:border-text-tertiary rounded-sm px-4 py-2 flex items-center gap-2 text-xs text-text-secondary hover:text-text-emphasis transition-all duration-150 cursor-pointer"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Feed
        </button>
      </div>
    )
  }

  return (
    <div className="absolute top-[52px] left-1/2 -translate-x-1/2 z-30 pointer-events-auto w-full max-w-md px-4">
      <div className="bg-surface/95 backdrop-blur-md border border-border-emphasis rounded-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div className="flex gap-3">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setMessage(null) }}
                className={`flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors duration-150 cursor-pointer ${
                  tab === t.id ? "text-text-emphasis" : "text-text-ghost hover:text-text-tertiary"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
          <button onClick={close} className="text-text-ghost hover:text-text-tertiary transition-colors duration-150 cursor-pointer">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          {tab === "url" && (
            <div className="flex gap-2">
              <input
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitUrl(); if (e.key === "Escape") close() }}
                placeholder="https://"
                className="flex-1 bg-surface border border-border px-3 py-2 text-xs text-text-primary placeholder:text-text-ghost outline-none focus:border-border-emphasis transition-colors duration-150"
              />
              <button
                onClick={submitUrl}
                disabled={submitting || !url.trim()}
                className="bg-text-primary text-void px-4 py-2 text-xs font-medium cursor-pointer hover:bg-text-emphasis disabled:opacity-20 disabled:cursor-default transition-colors duration-150 shrink-0"
              >
                {submitting ? "..." : "Feed"}
              </button>
            </div>
          )}

          {tab === "text" && (
            <div>
              <textarea
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") close() }}
                placeholder="Paste text, notes, or content..."
                rows={5}
                className="w-full bg-surface border border-border px-3 py-2 text-xs text-text-primary placeholder:text-text-ghost outline-none focus:border-border-emphasis transition-colors duration-150 resize-none leading-relaxed"
              />
              <div className="flex justify-between items-center mt-2">
                <span className="text-[10px] font-mono text-text-ghost">
                  {text.length > 0 ? `${text.length} chars` : ""}
                </span>
                <button
                  onClick={submitText}
                  disabled={submitting || !text.trim()}
                  className="bg-text-primary text-void px-4 py-2 text-xs font-medium cursor-pointer hover:bg-text-emphasis disabled:opacity-20 disabled:cursor-default transition-colors duration-150"
                >
                  {submitting ? "..." : "Feed"}
                </button>
              </div>
            </div>
          )}

          {tab === "file" && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={`border border-dashed px-4 py-8 text-center cursor-pointer transition-colors duration-150 ${
                dragOver ? "border-text-tertiary bg-surface-raised" : "border-border hover:border-border-emphasis"
              }`}
            >
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,.md,.txt,.csv,.json,.docx,.pptx"
                onChange={(e) => handleFiles(e.target.files)}
                className="hidden"
              />
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-text-ghost mb-2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <p className="text-xs text-text-tertiary">Drop files or click to browse</p>
              <p className="text-[10px] text-text-ghost mt-1">PDF, MD, TXT, CSV, JSON, DOCX, PPTX</p>
            </div>
          )}

          {/* Message */}
          {message && (
            <p className={`mt-2 text-[10px] font-mono ${message.type === "ok" ? "text-confidence-high" : "text-danger"}`}>
              {message.text}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
