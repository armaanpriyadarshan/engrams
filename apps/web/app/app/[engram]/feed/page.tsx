"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { createSnapshot } from "@/lib/snapshots"

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("")
}

export default function FeedPage() {
  const params = useParams()
  const router = useRouter()
  const engramSlug = params.engram as string

  const [url, setUrl] = useState("")
  const [text, setText] = useState("")
  const [activeTab, setActiveTab] = useState<"url" | "text" | "file">("url")
  const [submitting, setSubmitting] = useState(false)
  const [compiling, setCompiling] = useState(false)
  const [message, setMessage] = useState("")
  const [isDragging, setIsDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null)

  // Cleanup subscription on unmount
  useEffect(() => {
    return () => {
      channelRef.current?.unsubscribe()
    }
  }, [])

  const subscribeToCompilation = useCallback((supabase: ReturnType<typeof createClient>, sourceId: string, engramId: string) => {
    setCompiling(true)
    setMessage("Source added. Compiling...")

    const channel = supabase
      .channel(`compilation-${sourceId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "compilation_runs",
        filter: `source_id=eq.${sourceId}`,
      }, async (payload) => {
        const run = payload.new as any
        const stage = run.log?.stage

        if (run.status === "completed") {
          const created = run.articles_created ?? 0
          const updated = run.articles_updated ?? 0
          const edges = run.edges_created ?? 0
          setMessage(`Compilation complete. ${created} created. ${updated} updated. ${edges} connections found.`)
          setCompiling(false)
          channel.unsubscribe()
          channelRef.current = null
          await createSnapshot(supabase, engramId, "feed", `${created} created. ${updated} updated.`, {
            articles_created: created,
            articles_updated: updated,
            edges_created: edges,
          }, sourceId)
          supabase.functions.invoke("generate-embedding", { body: { engram_id: engramId } })
          supabase.functions.invoke("detect-gaps", { body: { engram_id: engramId, trigger_source_id: sourceId } })
          supabase.functions.invoke("lint-engram", { body: { engram_id: engramId } })
          router.refresh()
        } else if (run.status === "failed") {
          const error = run.log?.error ?? "Compilation failed."
          setMessage(error)
          setCompiling(false)
          channel.unsubscribe()
          channelRef.current = null
        } else if (stage === "fetching") {
          setMessage("Fetching content...")
        } else if (stage === "compiling") {
          setMessage("Compiling...")
        } else if (stage === "writing") {
          setMessage("Writing articles...")
        }
      })
      .subscribe()

    channelRef.current = channel
  }, [router])

  const triggerCompilation = useCallback((supabase: ReturnType<typeof createClient>, sourceId: string, engramId: string) => {
    subscribeToCompilation(supabase, sourceId, engramId)
    // Fire and forget — progress comes via Realtime
    supabase.functions.invoke("compile-source", { body: { source_id: sourceId } })
  }, [subscribeToCompilation])

  const submit = useCallback(async (sourceType: string, content: string, title?: string) => {
    if (!content.trim()) return
    setSubmitting(true)
    setMessage("")

    const supabase = createClient()

    const { data: engram } = await supabase
      .from("engrams")
      .select("id")
      .eq("slug", engramSlug)
      .single()

    if (!engram) { setMessage("Engram not found."); setSubmitting(false); return }

    // --- Dedup checks ---
    if (sourceType === "url") {
      const { data: existing } = await supabase
        .from("sources")
        .select("id")
        .eq("engram_id", engram.id)
        .eq("source_url", content.trim())
        .limit(1)
        .maybeSingle()

      if (existing) {
        await supabase.from("sources").update({
          content_md: null,
          status: "pending",
        }).eq("id", existing.id)
        setUrl("")
        setSubmitting(false)
        setMessage("Source updated. Recompiling...")
        triggerCompilation(supabase, existing.id, engram.id)
        return
      }
    } else {
      // Text or file
      const hash = await sha256(content.trim())
      const sourceTitle = title ?? content.trim().slice(0, 80)

      // Check by filename/title first (for files)
      if (title) {
        const { data: existing } = await supabase
          .from("sources")
          .select("id, content_hash")
          .eq("engram_id", engram.id)
          .eq("title", title)
          .limit(1)
          .maybeSingle()

        if (existing) {
          if (existing.content_hash === hash) {
            setMessage("This content has not changed.")
            setSubmitting(false)
            return
          }
          // Same file, new content — update and recompile
          await supabase.from("sources").update({
            content_md: content.trim(),
            content_hash: hash,
            status: "pending",
          }).eq("id", existing.id)
          setText("")
          setSubmitting(false)
          setMessage("Source updated. Recompiling...")
          triggerCompilation(supabase, existing.id, engram.id)
          return
        }
      } else {
        // Pure text — check by content hash
        const { data: existing } = await supabase
          .from("sources")
          .select("id")
          .eq("engram_id", engram.id)
          .eq("content_hash", hash)
          .limit(1)
          .maybeSingle()

        if (existing) {
          setMessage("This content has already been fed.")
          setSubmitting(false)
          return
        }
      }

      // New source — insert with hash
      const { data: source, error } = await supabase.from("sources").insert({
        engram_id: engram.id,
        source_type: sourceType,
        source_url: null,
        content_md: content.trim(),
        content_hash: hash,
        title: sourceTitle,
        status: "pending",
      }).select("id").single()

      if (error || !source) {
        setMessage("Failed to add source.")
        setSubmitting(false)
        return
      }

      setUrl("")
      setText("")
      setSubmitting(false)
      triggerCompilation(supabase, source.id, engram.id)
      return
    }

    // New URL source — insert without hash (content not fetched yet)
    const { data: source, error } = await supabase.from("sources").insert({
      engram_id: engram.id,
      source_type: sourceType,
      source_url: content.trim(),
      content_md: null,
      title: content.trim(),
      status: "pending",
    }).select("id").single()

    if (error || !source) {
      setMessage("Failed to add source.")
      setSubmitting(false)
      return
    }

    setUrl("")
    setText("")
    setSubmitting(false)
    triggerCompilation(supabase, source.id, engram.id)
  }, [engramSlug, triggerCompilation])

  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
    const name = file.name.replace(/\.[^.]+$/, "")
    const binaryFormats = ["pdf", "docx", "pptx", "xlsx"]

    if (binaryFormats.includes(ext)) {
      setSubmitting(true)
      setMessage("Parsing...")
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      let binary = ""
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      const base64 = btoa(binary)

      const supabase = createClient()
      const { data: parsed, error: parseError } = await supabase.functions.invoke("parse-file", {
        body: { file_base64: base64, filename: file.name, format: ext },
      })

      if (parseError || !parsed?.content) {
        setMessage("Could not parse file.")
        setSubmitting(false)
        return
      }

      setSubmitting(false)
      submit("text", parsed.content, name)
    } else {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        if (content) submit("text", content, name)
      }
      reader.readAsText(file)
    }
  }, [submit])

  const tabs = [
    { id: "url" as const, label: "URL" },
    { id: "text" as const, label: "Text" },
    { id: "file" as const, label: "File" },
  ]

  return (
    <div className="max-w-xl mx-auto px-6 py-10">
      <h1 className="font-heading text-lg text-text-emphasis mb-8">Feed</h1>

      <div className="flex gap-4 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`text-xs font-mono transition-colors duration-120 cursor-pointer ${
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
            disabled={submitting || compiling || !url.trim()}
            className="mt-4 bg-text-primary text-void px-5 py-2.5 text-sm font-medium cursor-pointer hover:bg-text-emphasis disabled:opacity-30 disabled:cursor-default transition-colors duration-120"
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
            disabled={submitting || compiling || !text.trim()}
            className="mt-4 bg-text-primary text-void px-5 py-2.5 text-sm font-medium cursor-pointer hover:bg-text-emphasis disabled:opacity-30 disabled:cursor-default transition-colors duration-120"
          >
            {submitting ? "Adding..." : "Feed"}
          </button>
        </div>
      )}

      {activeTab === "file" && (
        <div>
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragEnter={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragging(false)
              const file = e.dataTransfer.files[0]
              if (file) handleFile(file)
            }}
            onClick={() => fileRef.current?.click()}
            className={`border border-dashed px-6 py-16 text-center cursor-pointer transition-all duration-180 ease-out ${
              isDragging
                ? "border-border-emphasis bg-surface-raised"
                : "border-border hover:border-border-emphasis"
            }`}
          >
            <p className={`text-sm ${isDragging ? "text-text-secondary" : "text-text-tertiary"}`}>
              {isDragging ? "Drop to feed." : "Drop a file or click to choose."}
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.pdf,.docx,.pptx,.xlsx,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
              e.target.value = ""
            }}
          />
          <p className="mt-3 text-[10px] font-mono text-text-ghost">PDF, DOCX, PPTX, TXT, MD, CSV</p>
        </div>
      )}

      {message && (
        <p className={`mt-4 text-xs ${compiling ? "text-agent-active" : "text-text-tertiary"}`}>{message}</p>
      )}
    </div>
  )
}
