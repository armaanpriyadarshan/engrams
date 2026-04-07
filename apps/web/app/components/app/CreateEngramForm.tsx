"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

const ACCENT_COLORS = [
  "#76808F", "#7A8F76", "#8F8A76", "#8F767A",
  "#8F8676", "#767E8F", "#7A768F", "#8F7686",
  "#6B8F76", "#8F6B6B",
]

type SourceMode = "none" | "url" | "text"

interface CreateEngramFormProps {
  userId: string
  variant?: "page" | "modal"
  onCancel?: () => void
  onCreated?: (slug: string) => void
}

export default function CreateEngramForm({ userId, variant = "page", onCancel, onCreated }: CreateEngramFormProps) {
  const router = useRouter()
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [accentColor, setAccentColor] = useState(ACCENT_COLORS[0])
  const [sourceMode, setSourceMode] = useState<SourceMode>("none")
  const [sourceValue, setSourceValue] = useState("")
  const [creating, setCreating] = useState(false)
  const [status, setStatus] = useState("")

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed || creating) return
    setCreating(true)
    setStatus("Forming engram...")

    const supabase = createClient()
    const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")

    const { data: engram, error } = await supabase
      .from("engrams")
      .insert({
        owner_id: userId,
        name: trimmed,
        slug,
        description: description.trim() || null,
        accent_color: accentColor,
      })
      .select("id, slug")
      .single()

    if (error || !engram) {
      setStatus(error?.code === "23505" ? "An engram with this name already exists." : "Could not form engram.")
      setCreating(false)
      return
    }

    // Optionally feed first source
    const sourceText = sourceValue.trim()
    if (sourceMode !== "none" && sourceText) {
      setStatus("Feeding first source...")
      const { data: source } = await supabase.from("sources").insert({
        engram_id: engram.id,
        source_type: sourceMode === "url" ? "url" : "text",
        source_url: sourceMode === "url" ? sourceText : null,
        content_md: sourceMode === "text" ? sourceText : null,
        title: sourceMode === "url" ? sourceText : sourceText.slice(0, 80),
        status: "pending",
      }).select("id").single()

      if (source) {
        await supabase.rpc("increment_source_count", { eid: engram.id })
        setStatus("Compiling...")
        await supabase.functions.invoke("compile-source", { body: { source_id: source.id } })
        supabase.functions.invoke("generate-embedding", { body: { engram_id: engram.id } })
        supabase.functions.invoke("detect-gaps", { body: { engram_id: engram.id, trigger_source_id: source.id } })
        supabase.functions.invoke("lint-engram", { body: { engram_id: engram.id } })
      }
    }

    if (onCreated) onCreated(engram.slug)
    router.push(`/app/${engram.slug}`)
    router.refresh()
  }, [name, description, accentColor, sourceMode, sourceValue, creating, userId, router, onCreated])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleCreate()
    if (e.key === "Escape" && onCancel) onCancel()
  }

  const isModal = variant === "modal"

  return (
    <div onKeyDown={onKeyDown} className="space-y-7">
      {/* Name */}
      <div>
        <label className="text-[10px] font-mono text-text-ghost tracking-widest uppercase">Name</label>
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => { setName(e.target.value); if (status) setStatus("") }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.metaKey) { e.preventDefault(); handleCreate() } }}
          placeholder="e.g. Quantum Mechanics, Side Project, Philosophy of Mind"
          className="mt-2 w-full bg-surface border border-border-emphasis px-3 py-2.5 text-sm text-text-primary placeholder:text-text-ghost outline-none focus:border-text-tertiary transition-colors duration-[180ms]"
        />
      </div>

      {/* Accent color */}
      <div>
        <label className="text-[10px] font-mono text-text-ghost tracking-widest uppercase">Accent color</label>
        <div className="mt-3 flex gap-3 flex-wrap">
          {ACCENT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setAccentColor(color)}
              className="w-5 h-5 rounded-full cursor-pointer transition-all duration-120"
              style={{
                backgroundColor: color,
                boxShadow: accentColor === color ? `0 0 0 2px var(--color-void), 0 0 0 4px ${color}` : "none",
              }}
            />
          ))}
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="text-[10px] font-mono text-text-ghost tracking-widest uppercase">Description <span className="text-text-ghost normal-case">— optional</span></label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this engram will store. Helps the compiler understand context."
          rows={2}
          className="mt-2 w-full bg-surface border border-border px-3 py-2.5 text-sm text-text-primary placeholder:text-text-ghost outline-none focus:border-border-emphasis transition-colors duration-[180ms] resize-none"
        />
      </div>

      {/* First source */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-mono text-text-ghost tracking-widest uppercase">First source <span className="text-text-ghost normal-case">— optional</span></label>
          <div className="flex gap-1">
            {(["none", "url", "text"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setSourceMode(m)}
                className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 transition-colors duration-120 cursor-pointer ${
                  sourceMode === m ? "text-text-emphasis bg-surface-raised" : "text-text-ghost hover:text-text-tertiary"
                }`}
              >
                {m === "none" ? "Skip" : m}
              </button>
            ))}
          </div>
        </div>

        {sourceMode === "url" && (
          <input
            value={sourceValue}
            onChange={(e) => setSourceValue(e.target.value)}
            placeholder="https://"
            className="mt-2 w-full bg-surface border border-border px-3 py-2.5 text-sm text-text-primary placeholder:text-text-ghost outline-none focus:border-border-emphasis transition-colors duration-[180ms] font-mono"
          />
        )}
        {sourceMode === "text" && (
          <textarea
            value={sourceValue}
            onChange={(e) => setSourceValue(e.target.value)}
            placeholder="Paste a passage, notes, or any text to seed the wiki."
            rows={4}
            className="mt-2 w-full bg-surface border border-border px-3 py-2.5 text-sm text-text-primary placeholder:text-text-ghost outline-none focus:border-border-emphasis transition-colors duration-[180ms] resize-none"
          />
        )}
        {sourceMode === "none" && (
          <p className="mt-2 text-[11px] text-text-ghost leading-relaxed">
            You can feed sources after creating. Drop files, paste text, or add URLs anywhere on the engram page.
          </p>
        )}
      </div>

      {/* Capabilities preview */}
      <div className="pt-5 border-t border-border">
        <span className="text-[10px] font-mono text-text-ghost tracking-widest uppercase">What you get</span>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
          {[
            { title: "Compile", desc: "LLM extracts concepts into linked articles" },
            { title: "Ask", desc: "Query and get cited answers" },
            { title: "Map", desc: "3D knowledge graph you can explore" },
            { title: "Gaps", desc: "Detects unanswered research questions" },
          ].map((f) => (
            <div key={f.title} className="min-w-0">
              <span className="text-[11px] text-text-secondary">{f.title}</span>
              <span className="text-[10px] text-text-ghost"> &middot; {f.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Status + Actions */}
      <div className={`flex items-center ${isModal ? "justify-between" : "justify-end"} gap-3 pt-2`}>
        {status && (
          <p className={`text-[11px] font-mono ${status.includes("Could not") || status.includes("already exists") ? "text-danger" : "text-agent-active"} flex-1 truncate`}>
            {status}
          </p>
        )}
        {!status && isModal && <span className="flex-1" />}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-[11px] font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-120 cursor-pointer px-2 py-2"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating || !name.trim()}
          className="bg-text-primary text-void px-5 py-2.5 text-xs font-medium cursor-pointer hover:bg-text-emphasis disabled:opacity-20 disabled:cursor-default transition-colors duration-120"
        >
          {creating ? "Forming..." : sourceMode !== "none" && sourceValue.trim() ? "Form & feed" : "Form engram"}
        </button>
      </div>
    </div>
  )
}
