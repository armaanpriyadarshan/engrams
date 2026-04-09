"use client"

// LintFindingsPanel — live view of the engrams lint queue.
//
// Lives on the Stats page. Loads all active findings for the engram,
// subscribes to lint_findings via Supabase Realtime so the panel
// updates as compile-source fires deterministic lint in the
// background, and offers three actions per finding:
//
//   • expand    — reveal the detail text below the summary
//   • promote   — call promote-finding-to-rule, which distills the
//                 finding into a WHEN/CHECK/BECAUSE rule in
//                 prevention_rules and marks the finding resolved
//   • dismiss   — mark status='dismissed' so the finding drops off
//                 the panel without creating a rule
//
// Filter chips across the top collapse the list to one pass at a
// time. Counts next to each chip update live.
//
// Voice: this is the health surface the user opens to see what the
// compiler noticed. No scary red banners — findings are information,
// not errors. Severity is communicated via a thin colored left bar on
// each row (same language as the HybridResults match-signal bar).

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { RealtimeChannel } from "@supabase/supabase-js"

interface LintFinding {
  id: string
  engram_id: string
  finding_type: string
  severity: "info" | "warning" | "error"
  summary: string
  detail: string
  related_slugs: string[]
  fix_hint: string | null
  status: string
  created_at: string
}

interface LintFindingsPanelProps {
  engramId: string
  engramSlug: string
}

const SEVERITY_COLOR: Record<LintFinding["severity"], string> = {
  info: "var(--color-text-tertiary)",
  warning: "var(--color-confidence-mid)",
  error: "var(--color-danger)",
}

const PASS_META: Record<
  string,
  { label: string; description: string }
> = {
  completeness: {
    label: "completeness",
    description: "Missing content, summaries, or tags.",
  },
  orphans: {
    label: "orphans",
    description: "Articles with no inbound or outbound edges.",
  },
  connections: {
    label: "connections",
    description: "Prose mentions without [[wikilinks]].",
  },
  style: {
    label: "style",
    description: "First-person prose, filler phrases, voice drift.",
  },
  staleness: {
    label: "staleness",
    description: "Articles or their sources are over 90 days old.",
  },
  impute: {
    label: "impute",
    description: "Null confidence, null type, related_slugs drift.",
  },
  contradiction: {
    label: "contradiction",
    description: "Cross-article claims that cannot both be true.",
  },
  drift: {
    label: "drift",
    description: "Article content has drifted from its title.",
  },
  redundant: {
    label: "redundant",
    description: "Two articles cover the same ground.",
  },
}

type ActionPhase = "idle" | "promoting" | "dismissing" | "error"

export default function LintFindingsPanel({ engramId, engramSlug }: LintFindingsPanelProps) {
  const [findings, setFindings] = useState<LintFinding[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activePass, setActivePass] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [actionPhase, setActionPhase] = useState<Record<string, ActionPhase>>({})
  const [actionError, setActionError] = useState<Record<string, string>>({})
  const [linting, setLinting] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const supabase = createClient()
    const { data, error } = await supabase
      .from("lint_findings")
      .select("id, engram_id, finding_type, severity, summary, detail, related_slugs, fix_hint, status, created_at")
      .eq("engram_id", engramId)
      .eq("status", "open")
      .order("severity", { ascending: false })
      .order("created_at", { ascending: false })
    if (error) {
      setLoadError(error.message)
      setLoading(false)
      return
    }
    setFindings((data ?? []) as LintFinding[])
    setLoading(false)
  }, [engramId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Realtime: apply every INSERT/UPDATE/DELETE on lint_findings for
  // this engram. INSERTs with status=open append; UPDATEs can flip a
  // row to resolved/dismissed which removes it from the list.
  useEffect(() => {
    const supabase = createClient()
    let channel: RealtimeChannel | null = null
    channel = supabase
      .channel(`lint-findings-${engramId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "lint_findings",
          filter: `engram_id=eq.${engramId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as LintFinding | null
          if (!row) return
          if (payload.eventType === "DELETE") {
            setFindings((prev) => prev.filter((f) => f.id !== row.id))
            return
          }
          setFindings((prev) => {
            const exists = prev.some((f) => f.id === row.id)
            if (row.status === "open") {
              if (exists) return prev.map((f) => (f.id === row.id ? row : f))
              return [row, ...prev]
            }
            // Any non-open status → drop from panel
            if (exists) return prev.filter((f) => f.id !== row.id)
            return prev
          })
        },
      )
      .subscribe()
    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [engramId])

  const filtered = useMemo(() => {
    if (!activePass) return findings
    return findings.filter((f) => f.finding_type === activePass)
  }, [findings, activePass])

  // Chip vocabulary derived from current findings. Counts update live.
  const passCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of findings) {
      counts.set(f.finding_type, (counts.get(f.finding_type) ?? 0) + 1)
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  }, [findings])

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const runLint = useCallback(
    async (mode: "deterministic" | "full") => {
      setLinting(true)
      const supabase = createClient()
      await supabase.functions.invoke("lint-engram", {
        body: { engram_id: engramId, mode },
      })
      setLinting(false)
      // Realtime will push the new rows; also refresh as a safety net.
      refresh()
    },
    [engramId, refresh],
  )

  const promote = useCallback(async (findingId: string) => {
    setActionPhase((prev) => ({ ...prev, [findingId]: "promoting" }))
    setActionError((prev) => {
      const next = { ...prev }
      delete next[findingId]
      return next
    })
    const supabase = createClient()
    const { error } = await supabase.functions.invoke("promote-finding-to-rule", {
      body: { finding_id: findingId },
    })
    if (error) {
      setActionPhase((prev) => ({ ...prev, [findingId]: "error" }))
      setActionError((prev) => ({ ...prev, [findingId]: error.message ?? "Failed to promote" }))
      return
    }
    // Realtime will drop the row; no further state changes needed.
    setActionPhase((prev) => ({ ...prev, [findingId]: "idle" }))
  }, [])

  const dismiss = useCallback(async (findingId: string) => {
    setActionPhase((prev) => ({ ...prev, [findingId]: "dismissing" }))
    const supabase = createClient()
    const { error } = await supabase
      .from("lint_findings")
      .update({
        status: "dismissed",
        resolved_reason: "dismissed",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", findingId)
    if (error) {
      setActionPhase((prev) => ({ ...prev, [findingId]: "error" }))
      setActionError((prev) => ({ ...prev, [findingId]: error.message ?? "Failed to dismiss" }))
      return
    }
    setActionPhase((prev) => ({ ...prev, [findingId]: "idle" }))
  }, [])

  return (
    <section className="mt-16">
      {/* Header */}
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h2 className="font-heading text-base text-text-emphasis">Findings</h2>
        <div className="flex items-center gap-4">
          <button
            onClick={() => runLint("deterministic")}
            disabled={linting}
            className="font-mono text-[10px] tracking-widest uppercase text-text-ghost hover:text-text-tertiary disabled:opacity-30 transition-colors duration-120 cursor-pointer"
            title="Re-run deterministic passes"
          >
            {linting ? "scanning..." : "scan"}
          </button>
          <button
            onClick={() => runLint("full")}
            disabled={linting}
            className="font-mono text-[10px] tracking-widest uppercase text-text-ghost hover:text-text-tertiary disabled:opacity-30 transition-colors duration-120 cursor-pointer"
            title="Re-run deterministic + semantic (LLM) passes"
          >
            {linting ? "scanning..." : "deep scan"}
          </button>
        </div>
      </div>
      <p className="text-[13px] text-text-tertiary leading-[1.6] max-w-lg mb-6">
        Quality issues the compiler noticed. Deterministic passes run after
        every compile. Deep scan adds cross-article semantic checks.
      </p>

      {/* Chip row */}
      {passCounts.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-6">
          <button
            onClick={() => setActivePass(null)}
            className={`font-mono text-[10px] px-2 py-0.5 border transition-colors duration-120 cursor-pointer ${
              activePass === null
                ? "border-text-tertiary text-text-emphasis"
                : "border-border text-text-ghost hover:border-border-emphasis hover:text-text-tertiary"
            }`}
          >
            all · {findings.length}
          </button>
          {passCounts.map(([pass, count]) => (
            <button
              key={pass}
              onClick={() => setActivePass(pass === activePass ? null : pass)}
              className={`font-mono text-[10px] px-2 py-0.5 border transition-colors duration-120 cursor-pointer ${
                activePass === pass
                  ? "border-text-tertiary text-text-emphasis"
                  : "border-border text-text-ghost hover:border-border-emphasis hover:text-text-tertiary"
              }`}
              title={PASS_META[pass]?.description}
            >
              {PASS_META[pass]?.label ?? pass} · {count}
            </button>
          ))}
        </div>
      )}

      {/* States */}
      {loading && (
        <p className="text-xs text-text-ghost font-mono">loading...</p>
      )}
      {loadError && (
        <p className="text-xs text-danger font-mono">{loadError}</p>
      )}
      {!loading && !loadError && filtered.length === 0 && (
        <p className="text-sm text-text-ghost">
          {findings.length === 0
            ? "Nothing to note. The engram is clean."
            : "No findings match the current filter."}
        </p>
      )}

      {/* Findings list */}
      <div className="space-y-1">
        {filtered.map((f) => {
          const isExpanded = expandedIds.has(f.id)
          const phase = actionPhase[f.id] ?? "idle"
          const err = actionError[f.id]
          const signal = SEVERITY_COLOR[f.severity]
          return (
            <div
              key={f.id}
              className="group relative py-3 pl-5 pr-3 -mx-3 border-b border-border/40 last:border-0 hover:bg-surface-raised/30 transition-colors duration-120"
            >
              {/* Severity signal bar */}
              <span
                aria-hidden
                className="absolute left-0 top-3 bottom-3 w-[2px]"
                style={{ backgroundColor: signal, opacity: 0.55 }}
              />

              <div className="flex items-baseline justify-between gap-4">
                <button
                  onClick={() => toggleExpand(f.id)}
                  className="text-left flex-1 min-w-0"
                >
                  <h3 className="font-heading text-sm text-text-emphasis group-hover:text-text-bright transition-colors duration-120">
                    {f.summary}
                  </h3>
                </button>
                <span className="font-mono text-[10px] text-text-ghost shrink-0">
                  {PASS_META[f.finding_type]?.label ?? f.finding_type}
                </span>
              </div>

              {isExpanded && (
                <div
                  className="mt-2 text-[13px] text-text-tertiary leading-[1.6]"
                  style={{ animation: "fade-in 200ms ease-out both" }}
                >
                  <p>{f.detail}</p>
                  {f.fix_hint && (
                    <p className="mt-2 font-mono text-[11px] text-text-ghost">
                      <span className="mr-2">hint</span>
                      {f.fix_hint}
                    </p>
                  )}
                  {f.related_slugs.length > 0 && (
                    <div className="mt-2 flex gap-1.5 flex-wrap">
                      {f.related_slugs.slice(0, 6).map((slug) => (
                        <a
                          key={slug}
                          href={`/app/${engramSlug}/article/${slug}`}
                          className="font-mono text-[10px] text-text-ghost border border-border px-1.5 py-0.5 hover:text-text-tertiary hover:border-border-emphasis transition-colors duration-120"
                        >
                          {slug}
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-4">
                    <button
                      onClick={() => promote(f.id)}
                      disabled={phase === "promoting"}
                      className="font-mono text-[10px] tracking-widest uppercase text-text-secondary hover:text-text-emphasis disabled:opacity-30 transition-colors duration-120 cursor-pointer"
                      title="Distill into a prevention rule and resolve the finding"
                    >
                      {phase === "promoting" ? "distilling..." : "promote to rule"}
                    </button>
                    <button
                      onClick={() => dismiss(f.id)}
                      disabled={phase === "dismissing"}
                      className="font-mono text-[10px] tracking-widest uppercase text-text-ghost hover:text-text-tertiary disabled:opacity-30 transition-colors duration-120 cursor-pointer"
                    >
                      {phase === "dismissing" ? "dismissing..." : "dismiss"}
                    </button>
                  </div>
                  {err && (
                    <p className="mt-2 text-[11px] text-danger font-mono">{err}</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
