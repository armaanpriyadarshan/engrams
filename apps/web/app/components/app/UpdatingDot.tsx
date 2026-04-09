"use client"

// UpdatingDot — a tiny breathing dot used next to article titles while a
// propagation rewrite is in flight, and a brief "rewritten" mono label
// that fades in when the rewrite completes.
//
// The dot reuses the existing pulse-dot animation from globals.css so it
// stays in the same rhythm as the Feed/activity indicators.

interface UpdatingDotProps {
  updating: boolean
  rewritten: boolean
  /** Alignment helper for inline use next to titles. Defaults to baseline. */
  verticalAlign?: "baseline" | "middle"
}

export function UpdatingDot({ updating, rewritten, verticalAlign = "baseline" }: UpdatingDotProps) {
  if (!updating && !rewritten) return null

  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{ verticalAlign }}
      aria-live="polite"
    >
      {updating && (
        <span
          className="inline-block w-[5px] h-[5px] rounded-full bg-agent-active animate-pulse-dot"
          aria-label="updating"
          title="Rewriting this article from its sources"
        />
      )}
      {!updating && rewritten && (
        <span
          className="font-mono text-[9px] text-confidence-high tracking-wider uppercase"
          style={{ animation: "fade-in-only 300ms ease-out both" }}
          aria-label="rewritten"
        >
          rewritten
        </span>
      )}
    </span>
  )
}
