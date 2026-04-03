"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

interface FeedPillProps {
  engramId: string
}

export default function FeedPill({ engramId }: FeedPillProps) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState<"url" | "text" | "file">("url")
  const [url, setUrl] = useState("")
  const [text, setText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState("")
  const [isDragging, setIsDragging] = useState(false)
  const pillRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!expanded) return
    const handleClick = (e: MouseEvent) => {
      if (pillRef.current && !pillRef.current.contains(e.target as Node)) {
        setExpanded(false)
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false)
    }
    window.addEventListener("mousedown", handleClick)
    window.addEventListener("keydown", handleEscape)
    return () => {
      window.removeEventListener("mousedown", handleClick)
      window.removeEventListener("keydown", handleEscape)
    }
  }, [expanded])

  const submit = useCallback(async (sourceType: string, content: string, title?: string) => {
    if (!content.trim()) return
    setSubmitting(true)
    setMessage("")

    const supabase = createClient()
    const { data: source, error } = await supabase.from("sources").insert({
      engram_id: engramId,
      source_type: sourceType,
      source_url: sourceType === "url" ? content.trim() : null,
      content_md: sourceType === "text" ? content.trim() : null,
      title: title ?? (sourceType === "url" ? content.trim() : content.trim().slice(0, 80)),
      status: "pending",
    }).select("id").single()

    if (error || !source) { setMessage("Failed."); setSubmitting(false); return }

    await supabase.rpc("increment_source_count", { eid: engramId })
    setMessage("Compiling...")
    setUrl(""); setText("")
    setSubmitting(false)

    const { data: result, error: compileError } = await supabase.functions.invoke("compile-source", {
      body: { source_id: source.id },
    })

    if (compileError) {
      setMessage("Compilation failed.")
    } else {
      const created = result?.articles_created ?? 0
      const updated = result?.articles_updated ?? 0
      setMessage(`${created} created. ${updated} updated.`)
      router.refresh()
      setTimeout(() => { setMessage(""); setExpanded(false) }, 3000)
    }
  }, [engramId, router])

  const handleFile = useCallback((file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase()
    if (ext !== "txt" && ext !== "md") {
      setMessage("TXT and MD only for now.")
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      if (content) submit("text", content, file.name.replace(/\.[^.]+$/, ""))
    }
    reader.readAsText(file)
  }, [submit])

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30" ref={pillRef}>
      {/* Collapsed pill */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="bg-surface-raised border border-border hover:border-border-emphasis px-5 py-2.5 text-xs font-mono text-text-secondary hover:text-text-emphasis transition-all duration-150 cursor-pointer whitespace-nowrap animate-fade-in"
        >
          + Feed source
        </button>
      )}

      {/* Expanded input area */}
      {expanded && (
      <div className="w-[480px] animate-fade-in">
      <div className="bg-surface-raised border border-border-emphasis p-4">
        <div className="flex gap-3 mb-3">
          {(["url", "text", "file"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`text-[10px] font-mono transition-colors duration-150 cursor-pointer uppercase ${
                activeTab === tab ? "text-text-emphasis" : "text-text-ghost hover:text-text-tertiary"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === "url" && (
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit("url", url) }}
              placeholder="Paste a URL"
              autoFocus
              className="flex-1 bg-surface border border-border px-3 py-2 text-xs text-text-primary font-mono placeholder:text-text-ghost outline-none focus:border-text-tertiary transition-colors duration-[180ms]"
            />
            <button
              onClick={() => submit("url", url)}
              disabled={submitting || !url.trim()}
              className="bg-text-primary text-void px-3 py-2 text-xs font-medium cursor-pointer hover:bg-text-emphasis disabled:opacity-30 disabled:cursor-default transition-colors duration-150 shrink-0"
            >
              Feed
            </button>
          </div>
        )}

        {activeTab === "text" && (
          <div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste text or notes"
              rows={3}
              autoFocus
              className="w-full bg-surface border border-border px-3 py-2 text-xs text-text-primary placeholder:text-text-ghost outline-none focus:border-text-tertiary transition-colors duration-[180ms] resize-none"
            />
            <button
              onClick={() => submit("text", text)}
              disabled={submitting || !text.trim()}
              className="mt-2 bg-text-primary text-void px-3 py-2 text-xs font-medium cursor-pointer hover:bg-text-emphasis disabled:opacity-30 disabled:cursor-default transition-colors duration-150"
            >
              Feed
            </button>
          </div>
        )}

        {activeTab === "file" && (
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragEnter={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault(); setIsDragging(false)
              const file = e.dataTransfer.files[0]
              if (file) handleFile(file)
            }}
            onClick={() => fileRef.current?.click()}
            className={`border border-dashed px-4 py-8 text-center cursor-pointer transition-all duration-200 ${
              isDragging ? "border-border-emphasis bg-surface-elevated" : "border-border hover:border-border-emphasis"
            }`}
          >
            <p className="text-xs text-text-tertiary">{isDragging ? "Drop to feed." : "Drop or click. TXT, MD."}</p>
            <input ref={fileRef} type="file" accept=".txt,.md" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = "" }} />
          </div>
        )}

        {message && (
          <p className={`mt-2 text-[10px] font-mono ${submitting ? "text-agent-active" : "text-text-tertiary"}`}>{message}</p>
        )}
      </div>
      </div>
      )}
    </div>
  )
}
