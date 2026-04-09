"use client"

// PromptsSection — user-editable overrides for the compile-source prompts.
//
// Philosophy: prompts are the product surface that actually determines
// output quality. Making them editable is the highest-leverage agency
// users can have over their own engram. But we need to protect the
// JSON contract that compile-source depends on, so only the "guidance"
// block is editable — the persona header and output-format spec live
// in the edge function and are always composed around the user's body.
//
// Interaction:
//   • Each template is a collapsed card showing [Default] or [Custom]
//     and the first line of the active body.
//   • Click to expand into an editor — a wide monospace textarea
//     showing the current active body (or the default as placeholder
//     if no override yet).
//   • Save stores a new active row and archives the previous active
//     row for the same (engram, name) — atomic upsert via two writes.
//   • Reset archives the active override so the default takes over.
//   • The textarea shows a subtle "unsaved" marker when its content
//     differs from the stored body. Saving clears it.

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import {
  PROMPT_DEFAULTS,
  TEMPLATE_META,
  TEMPLATE_NAMES,
  type TemplateName,
} from "@/lib/prompt-defaults"

interface TemplateRow {
  id: string
  engram_id: string
  name: TemplateName
  body: string
  status: "active" | "archived"
  version: number
  updated_at: string
}

interface PromptsSectionProps {
  engramId: string
}

type LoadState = "idle" | "loading" | "ready" | "error"

export default function PromptsSection({ engramId }: PromptsSectionProps) {
  const [active, setActive] = useState<Record<TemplateName, TemplateRow | null>>({
    summarize_source: null,
    write_concept: null,
  })
  const [loadState, setLoadState] = useState<LoadState>("idle")
  const [loadError, setLoadError] = useState<string | null>(null)

  // Refresh active rows from the DB.
  const refresh = useCallback(async () => {
    setLoadState("loading")
    setLoadError(null)
    const supabase = createClient()
    const { data, error } = await supabase
      .from("prompt_templates")
      .select("id, engram_id, name, body, status, version, updated_at")
      .eq("engram_id", engramId)
      .eq("status", "active")

    if (error) {
      setLoadError(error.message)
      setLoadState("error")
      return
    }

    const next: Record<TemplateName, TemplateRow | null> = {
      summarize_source: null,
      write_concept: null,
    }
    for (const row of (data ?? []) as TemplateRow[]) {
      if (TEMPLATE_NAMES.includes(row.name)) next[row.name] = row
    }
    setActive(next)
    setLoadState("ready")
  }, [engramId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <section className="mt-16 pt-10 border-t border-border">
      <h2 className="font-heading text-base text-text-emphasis">Prompts</h2>
      <p className="mt-2 text-[13px] text-text-tertiary leading-[1.6] max-w-lg">
        Shape how this engram compiles. Each template is the guidance
        block the LLM sees — the output format and response contract are
        fixed, but style, voice, and content rules are yours. Saved
        overrides take effect on the next compile.
      </p>

      {loadState === "loading" && (
        <p className="mt-6 text-xs text-text-ghost font-mono">loading templates…</p>
      )}

      {loadState === "error" && (
        <p className="mt-6 text-xs text-danger font-mono">{loadError}</p>
      )}

      {loadState === "ready" && (
        <div className="mt-8 space-y-10">
          {TEMPLATE_NAMES.map((name) => (
            <TemplateEditor
              key={name}
              name={name}
              engramId={engramId}
              activeRow={active[name]}
              onSaved={refresh}
            />
          ))}
        </div>
      )}
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────

interface TemplateEditorProps {
  name: TemplateName
  engramId: string
  activeRow: TemplateRow | null
  onSaved: () => void
}

type EditorPhase = "idle" | "saving" | "saved" | "error"

function TemplateEditor({ name, engramId, activeRow, onSaved }: TemplateEditorProps) {
  const meta = TEMPLATE_META[name]
  const defaultBody = PROMPT_DEFAULTS[name]

  // What the user is currently editing. Initialized to the active body
  // (or the default if no override). Tracked separately from activeRow
  // so we can detect unsaved changes.
  const [draft, setDraft] = useState<string>(activeRow?.body ?? defaultBody)
  const [phase, setPhase] = useState<EditorPhase>("idle")
  const [error, setError] = useState<string | null>(null)

  // If the active row changes (e.g. after save+refresh), reset the draft
  // to mirror the new active body.
  useEffect(() => {
    setDraft(activeRow?.body ?? defaultBody)
  }, [activeRow, defaultBody])

  const isCustom = activeRow !== null
  const baselineBody = activeRow?.body ?? defaultBody
  const dirty = draft !== baselineBody
  const empty = draft.trim().length === 0

  const save = useCallback(async () => {
    if (!dirty || empty) return
    setPhase("saving")
    setError(null)
    const supabase = createClient()

    // Upsert pattern: archive prior active, insert new active. Two writes
    // in sequence — the partial unique index enforces that we never end
    // up with two active rows for the same (engram, name).
    if (activeRow) {
      const { error: archErr } = await supabase
        .from("prompt_templates")
        .update({ status: "archived", updated_at: new Date().toISOString() })
        .eq("id", activeRow.id)
      if (archErr) {
        setError(archErr.message)
        setPhase("error")
        return
      }
    }

    const nextVersion = (activeRow?.version ?? 0) + 1
    const { error: insertErr } = await supabase
      .from("prompt_templates")
      .insert({
        engram_id: engramId,
        name,
        body: draft,
        status: "active",
        version: nextVersion,
      })
    if (insertErr) {
      setError(insertErr.message)
      setPhase("error")
      return
    }

    setPhase("saved")
    onSaved()
    // Return to idle after a short "saved" flash.
    setTimeout(() => setPhase("idle"), 2_000)
  }, [draft, dirty, empty, activeRow, engramId, name, onSaved])

  const reset = useCallback(async () => {
    if (!activeRow) return
    setPhase("saving")
    setError(null)
    const supabase = createClient()
    const { error: archErr } = await supabase
      .from("prompt_templates")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", activeRow.id)
    if (archErr) {
      setError(archErr.message)
      setPhase("error")
      return
    }
    setDraft(defaultBody)
    setPhase("saved")
    onSaved()
    setTimeout(() => setPhase("idle"), 2_000)
  }, [activeRow, defaultBody, onSaved])

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="font-heading text-sm text-text-emphasis">{meta.label}</h3>
            <StatusBadge isCustom={isCustom} dirty={dirty} phase={phase} />
          </div>
          <p className="mt-1 text-[12px] text-text-tertiary leading-[1.5]">
            {meta.description}
          </p>
        </div>
      </div>

      <div className="relative">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault()
              save()
            }
          }}
          placeholder={defaultBody}
          rows={Math.max(10, Math.min(24, draft.split("\n").length + 2))}
          disabled={phase === "saving"}
          spellCheck={false}
          className="w-full bg-surface border border-border focus:border-text-tertiary px-4 py-3 font-mono text-[12px] leading-[1.55] text-text-primary placeholder:text-text-ghost outline-none resize-none transition-colors duration-120 disabled:opacity-60"
        />
      </div>

      {/* Action row */}
      <div className="mt-3 flex items-center gap-4">
        <button
          onClick={save}
          disabled={!dirty || empty || phase === "saving"}
          className="font-mono text-[10px] tracking-widest uppercase text-text-secondary hover:text-text-emphasis disabled:opacity-30 disabled:cursor-default transition-colors duration-120 cursor-pointer"
        >
          {phase === "saving" ? "saving..." : "save"}
        </button>
        {isCustom && (
          <button
            onClick={reset}
            disabled={phase === "saving"}
            className="font-mono text-[10px] tracking-widest uppercase text-text-ghost hover:text-text-tertiary disabled:opacity-30 transition-colors duration-120 cursor-pointer"
            title="Archive this override — the default will take over"
          >
            reset to default
          </button>
        )}
        <span className="font-mono text-[10px] text-text-ghost ml-auto">
          <kbd className="border border-border px-1 py-px">⌘↵</kbd> to save
        </span>
      </div>

      {error && (
        <p className="mt-2 text-[11px] text-danger font-mono">{error}</p>
      )}
    </div>
  )
}

// Small typographic status marker. Tiny but load-bearing: it tells the
// user at a glance whether the engram is running a custom override, a
// dirty draft, or the built-in default.
function StatusBadge({
  isCustom,
  dirty,
  phase,
}: {
  isCustom: boolean
  dirty: boolean
  phase: EditorPhase
}) {
  if (phase === "saved") {
    return (
      <span className="font-mono text-[9px] tracking-widest uppercase text-confidence-high">
        saved
      </span>
    )
  }
  if (dirty) {
    return (
      <span className="font-mono text-[9px] tracking-widest uppercase text-confidence-mid">
        unsaved
      </span>
    )
  }
  if (isCustom) {
    return (
      <span className="font-mono text-[9px] tracking-widest uppercase text-text-secondary">
        custom
      </span>
    )
  }
  return (
    <span className="font-mono text-[9px] tracking-widest uppercase text-text-ghost">
      default
    </span>
  )
}
