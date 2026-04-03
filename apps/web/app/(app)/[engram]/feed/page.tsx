"use client"

import { useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

export default function FeedPage() {
  const params = useParams()
  const router = useRouter()
  const engramSlug = params.engram as string

  const [url, setUrl] = useState("")
  const [text, setText] = useState("")
  const [activeTab, setActiveTab] = useState<"url" | "text">("url")
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState("")

  const submit = useCallback(async (sourceType: string, content: string, title?: string) => {
    if (!content.trim()) return
    setSubmitting(true)
    setMessage("")

    const supabase = createClient()

    // Get engram ID from slug
    const { data: engram } = await supabase
      .from("engrams")
      .select("id")
      .eq("slug", engramSlug)
      .single()

    if (!engram) { setMessage("Engram not found."); setSubmitting(false); return }

    const { error } = await supabase.from("sources").insert({
      engram_id: engram.id,
      source_type: sourceType,
      source_url: sourceType === "url" ? content.trim() : null,
      content_md: sourceType === "text" ? content.trim() : null,
      title: title ?? (sourceType === "url" ? content.trim() : content.trim().slice(0, 80)),
      status: "pending",
    })

    if (error) {
      setMessage("Failed to add source.")
    } else {
      // Increment source count
      await supabase.rpc("increment_source_count", { eid: engram.id })
      setMessage("Source added.")
      setUrl("")
      setText("")
      router.refresh()
    }
    setSubmitting(false)
  }, [engramSlug, router])

  const tabs = [
    { id: "url" as const, label: "URL" },
    { id: "text" as const, label: "Text" },
  ]

  return (
    <div className="max-w-xl mx-auto px-6 py-10">
      <h1 className="font-heading text-lg text-text-emphasis mb-8">Feed</h1>

      <div className="flex gap-4 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`text-xs font-mono transition-colors duration-150 cursor-pointer ${
              activeTab === tab.id ? "text-text-emphasis" : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "url" && (
        <div>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit("url", url) }}
            placeholder="Paste a URL"
            className="w-full bg-surface border border-border-emphasis px-4 py-3 text-sm text-text-primary font-mono placeholder:text-text-ghost outline-none focus:border-text-tertiary transition-colors duration-[180ms]"
          />
          <button
            onClick={() => submit("url", url)}
            disabled={submitting || !url.trim()}
            className="mt-4 bg-text-primary text-void px-5 py-2.5 text-sm font-medium cursor-pointer hover:bg-text-emphasis disabled:opacity-30 disabled:cursor-default transition-colors duration-150"
          >
            {submitting ? "Adding..." : "Feed"}
          </button>
        </div>
      )}

      {activeTab === "text" && (
        <div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste text, notes, or content"
            rows={8}
            className="w-full bg-surface border border-border-emphasis px-4 py-3 text-sm text-text-primary placeholder:text-text-ghost outline-none focus:border-text-tertiary transition-colors duration-[180ms] resize-none"
          />
          <button
            onClick={() => submit("text", text)}
            disabled={submitting || !text.trim()}
            className="mt-4 bg-text-primary text-void px-5 py-2.5 text-sm font-medium cursor-pointer hover:bg-text-emphasis disabled:opacity-30 disabled:cursor-default transition-colors duration-150"
          >
            {submitting ? "Adding..." : "Feed"}
          </button>
        </div>
      )}

      {message && (
        <p className="mt-4 text-xs text-text-tertiary">{message}</p>
      )}
    </div>
  )
}
