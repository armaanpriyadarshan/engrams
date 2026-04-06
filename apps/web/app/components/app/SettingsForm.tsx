"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

const ACCENT_COLORS = [
  "#76808F", "#7A8F76", "#8F8A76", "#8F767A",
  "#8F8676", "#767E8F", "#7A768F", "#8F7686",
  "#6B8F76", "#8F6B6B",
]

interface Engram {
  id: string
  name: string
  slug: string
  description: string | null
  accent_color: string | null
  visibility: string | null
}

export default function SettingsForm({ engram }: { engram: Engram }) {
  const router = useRouter()
  const [name, setName] = useState(engram.name)
  const [description, setDescription] = useState(engram.description ?? "")
  const [accentColor, setAccentColor] = useState(engram.accent_color ?? "#76808F")
  const [visibility, setVisibility] = useState(engram.visibility ?? "private")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState("")
  const [deleting, setDeleting] = useState(false)

  const save = useCallback(async (updates: Record<string, unknown>) => {
    setSaving(true)
    setSaved(false)
    const supabase = createClient()
    await supabase.from("engrams").update(updates).eq("id", engram.id)
    setSaving(false)
    setSaved(true)
    router.refresh()
    setTimeout(() => setSaved(false), 2000)
  }, [engram.id, router])

  const handleDelete = useCallback(async () => {
    if (deleteConfirm !== engram.name) return
    setDeleting(true)
    const supabase = createClient()
    await supabase.from("engrams").delete().eq("id", engram.id)
    router.push("/app")
    router.refresh()
  }, [deleteConfirm, engram.id, engram.name, router])

  const origin = typeof window !== "undefined" ? window.location.origin : ""

  return (
    <div className="space-y-10">
      {/* Name + Description */}
      <div>
        <label className="text-[10px] font-mono text-text-tertiary uppercase tracking-widest">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => { if (name !== engram.name) save({ name }) }}
          className="mt-2 w-full bg-surface border border-border-emphasis px-4 py-3 text-sm text-text-primary outline-none focus:border-text-tertiary transition-colors duration-[180ms]"
        />

        <label className="mt-6 block text-[10px] font-mono text-text-tertiary uppercase tracking-widest">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => save({ description })}
          placeholder="What does this engram store"
          rows={3}
          className="mt-2 w-full bg-surface border border-border-emphasis px-4 py-3 text-sm text-text-primary placeholder:text-text-ghost outline-none focus:border-text-tertiary transition-colors duration-[180ms] resize-none"
        />

        <div className="mt-1 text-[10px] font-mono text-text-ghost">{engram.slug}</div>
      </div>

      {/* Accent Color */}
      <div>
        <label className="text-[10px] font-mono text-text-tertiary uppercase tracking-widest">Accent color</label>
        <div className="mt-3 flex gap-3">
          {ACCENT_COLORS.map((color) => (
            <button
              key={color}
              onClick={() => { setAccentColor(color); save({ accent_color: color }) }}
              className="w-6 h-6 rounded-full cursor-pointer transition-all duration-120"
              style={{
                backgroundColor: color,
                boxShadow: accentColor === color ? `0 0 0 2px var(--color-void), 0 0 0 4px ${color}` : "none",
              }}
            />
          ))}
        </div>
      </div>

      {/* Visibility */}
      <div>
        <label className="text-[10px] font-mono text-text-tertiary uppercase tracking-widest">Visibility</label>
        <div className="mt-3 space-y-2">
          {([
            { value: "private", label: "Private", desc: "Only you can access this engram.", disabled: false },
            { value: "shared", label: "Shared", desc: "Invite members to collaborate.", disabled: true },
            { value: "published", label: "Published", desc: "Anyone with the link can view the map and articles.", disabled: false },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                if (opt.disabled) return
                setVisibility(opt.value)
                save({ visibility: opt.value })
              }}
              disabled={opt.disabled}
              className={`w-full text-left border p-4 transition-colors duration-120 ${
                visibility === opt.value
                  ? "border-border-emphasis bg-surface-raised"
                  : opt.disabled
                    ? "border-border opacity-30 cursor-default"
                    : "border-border hover:border-border-emphasis cursor-pointer"
              }`}
            >
              <div className="text-xs text-text-emphasis">{opt.label}</div>
              <div className="mt-1 text-[10px] text-text-tertiary">
                {opt.desc}
                {opt.disabled && " Coming soon."}
              </div>
            </button>
          ))}
        </div>

        {visibility === "published" && (
          <div className="mt-4 border border-border p-4">
            <div className="text-[10px] font-mono text-text-tertiary uppercase tracking-widest mb-2">Public URL</div>
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono text-text-secondary flex-1 truncate">{origin}/e/{engram.slug}</code>
              <button
                onClick={() => navigator.clipboard.writeText(`${origin}/e/${engram.slug}`)}
                className="text-[10px] font-mono text-text-ghost hover:text-text-tertiary transition-colors duration-120 cursor-pointer shrink-0"
              >
                Copy
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Save status */}
      {(saving || saved) && (
        <p className={`text-[10px] font-mono ${saving ? "text-agent-active" : "text-text-ghost"}`}>
          {saving ? "Saving..." : "Saved."}
        </p>
      )}

      {/* Danger Zone */}
      <div className="border border-danger/30 p-6">
        <h2 className="text-xs text-danger font-medium mb-4">Danger zone</h2>
        <p className="text-xs text-text-tertiary mb-4">
          This will permanently delete this engram and all its articles, sources, and connections. This cannot be undone.
        </p>
        <input
          value={deleteConfirm}
          onChange={(e) => setDeleteConfirm(e.target.value)}
          placeholder={`Type "${engram.name}" to confirm`}
          className="w-full bg-surface border border-border px-4 py-2 text-xs text-text-primary placeholder:text-text-ghost outline-none focus:border-danger/50 transition-colors duration-[180ms] mb-3"
        />
        <button
          onClick={handleDelete}
          disabled={deleteConfirm !== engram.name || deleting}
          className="bg-danger/80 text-text-bright px-4 py-2 text-xs font-medium cursor-pointer hover:bg-danger disabled:opacity-30 disabled:cursor-default transition-colors duration-120"
        >
          {deleting ? "Deleting..." : "Delete engram"}
        </button>
      </div>
    </div>
  )
}
