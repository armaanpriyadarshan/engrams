"use client"

// CorrectionForm — the "note a correction" affordance on the article reader.
//
// Philosophy: corrections are the user teaching the compiler. The voice
// matters:
//   • Not "report" (adversarial — feels like filing a complaint)
//   • Not "fix" (imperative — puts work on the user)
//   • "Note a correction" is passive, quiet, sage-like.
//
// The interaction is fully inline:
//   1. A hairline "note a correction" link sits in the article meta row
//   2. Click expands a small form below the meta row with a textarea
//      + optional tag chips. Nothing pops up, nothing pushes content
//      around except locally.
//   3. Submit fires add-prevention-rule. A thin pulsing underline
//      on the textarea + "distilling rule..." mono label signal the
//      LLM call. No spinner.
//   4. On success, the form collapses back to a brief preview of the
//      filed rule (WHEN/CHECK/BECAUSE) that fades after ~6s, then
//      returns to the idle link state.
//   5. On error, a danger-colored inline message stays visible so the
//      user can retry.
//
// Why this is nicer than a modal:
//   • No context switch — the article stays where it is, the form
//     unfolds in place.
//   • The preview of the distilled rule is the confirmation — the user
//     sees exactly what the compiler will remember, and can tell
//     whether it captured what they meant.

import { useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"

type Phase = "idle" | "open" | "submitting" | "filed" | "error"

interface FiledRule {
  id: string
  when_condition: string
  check_condition: string
  because: string
  tags: string[]
}

interface CorrectionFormProps {
  engramId: string
  articleSlug: string
  /** Existing article tags — pre-populate the chip row. */
  articleTags?: string[]
}

const FILED_FADE_MS = 6_000

export function CorrectionForm({
  engramId,
  articleSlug,
  articleTags = [],
}: CorrectionFormProps) {
  const [phase, setPhase] = useState<Phase>("idle")
  const [correction, setCorrection] = useState("")
  const [activeTags, setActiveTags] = useState<Set<string>>(() => new Set())
  const [filedRule, setFiledRule] = useState<FiledRule | null>(null)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Focus the textarea when the form opens.
  useEffect(() => {
    if (phase === "open") textareaRef.current?.focus()
  }, [phase])

  // Auto-dismiss the filed preview after a short read window, then
  // return to the idle link state without clearing local form state
  // so the user can continue noting more if they want.
  useEffect(() => {
    if (phase !== "filed") return
    const timer = setTimeout(() => {
      setPhase("idle")
      setFiledRule(null)
      setCorrection("")
      setActiveTags(new Set())
    }, FILED_FADE_MS)
    return () => clearTimeout(timer)
  }, [phase])

  const toggleTag = (tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  const submit = async () => {
    if (!correction.trim()) return
    setPhase("submitting")
    setError(null)

    try {
      const supabase = createClient()
      const { data, error: fnErr } = await supabase.functions.invoke(
        "add-prevention-rule",
        {
          body: {
            engram_id: engramId,
            article_slug: articleSlug,
            correction_text: correction.trim(),
            tags: Array.from(activeTags),
          },
        },
      )

      if (fnErr) throw new Error(fnErr.message ?? "Rule could not be filed")
      if (!data?.rule) throw new Error("Rule could not be filed")

      setFiledRule(data.rule as FiledRule)
      setPhase("filed")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase("error")
    }
  }

  if (phase === "idle") {
    return (
      <button
        onClick={() => setPhase("open")}
        className="font-mono text-[10px] text-text-ghost hover:text-text-tertiary transition-colors duration-120 cursor-pointer"
        title="File a prevention rule the compiler will remember"
      >
        note a correction
      </button>
    )
  }

  if (phase === "filed" && filedRule) {
    return (
      <div
        className="mt-4 border-l-2 border-confidence-high pl-4 py-2"
        style={{ animation: "fade-in 300ms ease-out both" }}
      >
        <div className="font-mono text-[10px] text-confidence-high tracking-widest uppercase mb-2">
          filed as rule
        </div>
        <div className="text-[13px] text-text-primary leading-[1.6] space-y-1">
          <div>
            <span className="font-mono text-text-ghost text-[10px] mr-2">when</span>
            {filedRule.when_condition}
          </div>
          <div>
            <span className="font-mono text-text-ghost text-[10px] mr-2">check</span>
            {filedRule.check_condition}
          </div>
          <div className="text-text-secondary">
            <span className="font-mono text-text-ghost text-[10px] mr-2">because</span>
            {filedRule.because}
          </div>
        </div>
        {filedRule.tags.length > 0 && (
          <div className="mt-2 flex gap-1.5 flex-wrap">
            {filedRule.tags.map((t) => (
              <span
                key={t}
                className="font-mono text-[10px] text-text-ghost border border-border px-1.5 py-0.5"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        <p className="mt-2 text-[10px] font-mono text-text-ghost">
          will shape future compiles of this engram
        </p>
      </div>
    )
  }

  // phase is open | submitting | error
  const submitting = phase === "submitting"
  const suggestedTags = [...new Set([...articleTags, "correction"])].slice(0, 6)

  return (
    <div
      className="mt-4 border-l-2 border-border pl-4 py-1"
      style={{ animation: "fade-in 200ms ease-out both" }}
    >
      <div className="font-mono text-[10px] text-text-ghost tracking-widest uppercase mb-3">
        note a correction
      </div>

      <div className="relative">
        <textarea
          ref={textareaRef}
          value={correction}
          onChange={(e) => setCorrection(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter submits. Plain Enter adds a newline.
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault()
              submit()
            }
            if (e.key === "Escape") {
              e.preventDefault()
              setPhase("idle")
            }
          }}
          placeholder="What's wrong or missing? Describe the correction in plain prose."
          rows={3}
          disabled={submitting}
          spellCheck={false}
          className="w-full bg-transparent text-[13px] text-text-primary placeholder:text-text-ghost outline-none resize-none pb-2 border-b border-border focus:border-text-tertiary transition-colors duration-120 disabled:opacity-60"
        />
        <div
          className="pointer-events-none absolute bottom-0 left-0 right-0 h-px overflow-hidden"
          aria-hidden
        >
          <div
            className="h-px bg-text-secondary"
            style={{
              opacity: submitting ? 1 : 0,
              transform: submitting ? "scaleX(1)" : "scaleX(0)",
              transformOrigin: "left center",
              transition: submitting
                ? "transform 800ms ease-out, opacity 120ms ease-out"
                : "opacity 200ms ease-out",
            }}
          />
        </div>
      </div>

      {/* Suggested tag chips */}
      {suggestedTags.length > 0 && (
        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          <span className="font-mono text-[10px] text-text-ghost mr-1">tags</span>
          {suggestedTags.map((tag) => {
            const active = activeTags.has(tag)
            return (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                disabled={submitting}
                className={`font-mono text-[10px] px-1.5 py-0.5 border transition-colors duration-120 cursor-pointer ${
                  active
                    ? "border-text-tertiary text-text-emphasis"
                    : "border-border text-text-ghost hover:border-border-emphasis hover:text-text-tertiary"
                }`}
              >
                {tag}
              </button>
            )
          })}
        </div>
      )}

      {/* Action row */}
      <div className="mt-4 flex items-center gap-4">
        <button
          onClick={submit}
          disabled={!correction.trim() || submitting}
          className="font-mono text-[10px] tracking-widest uppercase text-text-secondary hover:text-text-emphasis disabled:opacity-30 disabled:cursor-default transition-colors duration-120 cursor-pointer"
        >
          {submitting ? "distilling rule..." : "file rule"}
        </button>
        <button
          onClick={() => {
            setPhase("idle")
            setError(null)
          }}
          disabled={submitting}
          className="font-mono text-[10px] text-text-ghost hover:text-text-tertiary disabled:opacity-30 transition-colors duration-120 cursor-pointer"
        >
          cancel
        </button>
        <span className="font-mono text-[10px] text-text-ghost ml-auto">
          <kbd className="border border-border px-1 py-px">⌘↵</kbd> to submit
        </span>
      </div>

      {error && (
        <p className="mt-3 text-[11px] text-danger font-mono">
          {error}
        </p>
      )}
    </div>
  )
}
