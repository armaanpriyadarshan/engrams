"use client"

// HealthCheckPanel — the "doctor" surface.
//
// Calls the health-check edge function on mount and whenever the user
// hits "re-check", displays the list of checks with a status dot per
// row. Each check expands on click to reveal its detail and optional
// fix_hint. A compact one-line summary at the top aggregates the
// state ("healthy", "2 warnings", "3 issues").
//
// Design intent: this is not a dashboard; it's a quiet diagnostic
// surface. No big red banners. The status dot is the only color on
// each row, sized to the same scale as the confidence dots elsewhere
// in the app. A user who has nothing to worry about should see a
// quiet vertical list of green dots and move on.

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

type Status = "pass" | "warn" | "fail"

interface HealthCheck {
  id: string
  label: string
  status: Status
  detail: string
  fix_hint?: string
}

interface HealthCheckResponse {
  checks: HealthCheck[]
  summary: { pass: number; warn: number; fail: number }
}

interface HealthCheckPanelProps {
  engramId: string
}

const STATUS_COLOR: Record<Status, string> = {
  pass: "var(--color-confidence-high)",
  warn: "var(--color-confidence-mid)",
  fail: "var(--color-danger)",
}

const STATUS_LABEL: Record<Status, string> = {
  pass: "pass",
  warn: "warn",
  fail: "fail",
}

export default function HealthCheckPanel({ engramId }: HealthCheckPanelProps) {
  const [data, setData] = useState<HealthCheckResponse | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())

  const run = useCallback(async () => {
    setRunning(true)
    setError(null)
    const supabase = createClient()
    const { data: result, error: fnErr } = await supabase.functions.invoke(
      "health-check",
      { body: { engram_id: engramId } },
    )
    if (fnErr) {
      setError(fnErr.message ?? "Health check failed")
      setRunning(false)
      return
    }
    setData(result as HealthCheckResponse)
    setRunning(false)
  }, [engramId])

  useEffect(() => {
    run()
  }, [run])

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const summaryLine = (() => {
    if (!data) return null
    const { pass, warn, fail } = data.summary
    if (fail > 0) {
      return { text: `${fail} issue${fail === 1 ? "" : "s"}`, color: STATUS_COLOR.fail }
    }
    if (warn > 0) {
      return { text: `${warn} warning${warn === 1 ? "" : "s"}`, color: STATUS_COLOR.warn }
    }
    return { text: `healthy · ${pass} checks`, color: STATUS_COLOR.pass }
  })()

  return (
    <section className="mt-16">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h2 className="font-heading text-base text-text-emphasis">Diagnostics</h2>
        <button
          onClick={run}
          disabled={running}
          className="font-mono text-[10px] tracking-widest uppercase text-text-ghost hover:text-text-tertiary disabled:opacity-30 transition-colors duration-120 cursor-pointer"
        >
          {running ? "checking..." : "re-check"}
        </button>
      </div>
      <p className="text-[13px] text-text-tertiary leading-[1.6] max-w-lg mb-6">
        Infra-level checks for this engram. Verifies provider connectivity,
        schema, coverage, and queue liveness. The aggregate Health score
        at the top of the page is the content-level view; this is the plumbing.
      </p>

      {summaryLine && (
        <div className="flex items-center gap-2 mb-6">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: summaryLine.color }}
            aria-hidden
          />
          <span
            className="font-mono text-[11px] tracking-widest uppercase"
            style={{ color: summaryLine.color }}
          >
            {summaryLine.text}
          </span>
        </div>
      )}

      {error && (
        <p className="text-xs text-danger font-mono">{error}</p>
      )}

      {data && (
        <div className="space-y-1">
          {data.checks.map((c) => {
            const isExpanded = expandedIds.has(c.id)
            const color = STATUS_COLOR[c.status]
            return (
              <div
                key={c.id}
                className="group py-3 -mx-3 px-3 border-b border-border/40 last:border-0 hover:bg-surface-raised/30 transition-colors duration-120"
              >
                <button
                  onClick={() => toggleExpand(c.id)}
                  className="w-full flex items-center justify-between gap-4 text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                      aria-hidden
                    />
                    <h3 className="font-heading text-sm text-text-emphasis group-hover:text-text-bright transition-colors duration-120 truncate">
                      {c.label}
                    </h3>
                  </div>
                  <span
                    className="font-mono text-[10px] tracking-widest uppercase shrink-0"
                    style={{ color }}
                  >
                    {STATUS_LABEL[c.status]}
                  </span>
                </button>
                {isExpanded && (
                  <div
                    className="mt-2 ml-4 text-[13px] text-text-tertiary leading-[1.6]"
                    style={{ animation: "fade-in 200ms ease-out both" }}
                  >
                    <p>{c.detail}</p>
                    {c.fix_hint && (
                      <p className="mt-2 font-mono text-[11px] text-text-ghost">
                        <span className="mr-2">hint</span>
                        {c.fix_hint}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
