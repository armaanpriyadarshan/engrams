"use client"

// Flat RRF-ranked results list.
//
// Visual language matches the wiki view (660px reader column, thin borders,
// typographic hierarchy). Every row has a 2px left signal bar colored by the
// match signal: sage when BM25 matched, steel when vector matched, emphasis
// when both. That's the affordance — no tooltips, no legend, the color IS
// the signal. Users who don't care read titles only.

import Link from "next/link"
import { useEffect, useRef } from "react"
import type { HybridResult, MatchSignal } from "./useHybridSearch"
import { matchSignalOf } from "./useHybridSearch"
import { UpdatingDot } from "../UpdatingDot"

interface HybridResultsProps {
  engramSlug: string
  results: HybridResult[]
  activeIndex: number
  onActiveIndexChange: (i: number) => void
  searching: boolean
  error: string | null
  query: string
  /** Called when the user clicks or keyboard-enters a row. */
  onOpen?: (slug: string) => void
  /** Optional predicates for the "updating / just rewritten" dot. */
  isUpdating?: (slug: string) => boolean
  wasJustRewritten?: (slug: string) => boolean
}

// Signal bar colors. All reference existing engrams tokens.
const SIGNAL_COLOR: Record<MatchSignal, string> = {
  both: "var(--color-text-emphasis)",      // both rankers agreed
  bm25: "var(--color-confidence-high)",    // matched in prose (sage)
  vector: "var(--color-agent-active)",     // matched in meaning (steel)
}

export function HybridResults({
  engramSlug,
  results,
  activeIndex,
  onActiveIndexChange,
  searching,
  error,
  query,
  onOpen,
  isUpdating,
  wasJustRewritten,
}: HybridResultsProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // Scroll the active row into view when the user arrows past the fold.
  // `nearest` avoids the jarring full-scroll that `center` produces in
  // short lists.
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector<HTMLAnchorElement>(
      `[data-result-idx="${activeIndex}"]`,
    )
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [activeIndex])

  if (error) {
    return (
      <div className="py-8">
        <p className="text-sm text-danger">{error}</p>
        <p className="mt-1 text-xs text-text-tertiary">
          Try again, or search differently.
        </p>
      </div>
    )
  }

  if (!searching && results.length === 0) {
    return (
      <p className="text-sm text-text-ghost mt-4">
        No articles match &ldquo;{query}&rdquo;.
      </p>
    )
  }

  return (
    <div ref={listRef} className="space-y-1">
      {results.map((r, i) => {
        const signal = matchSignalOf(r)
        const isActive = i === activeIndex
        return (
          <Link
            key={r.slug}
            href={`/app/${engramSlug}/article/${r.slug}`}
            data-result-idx={i}
            onMouseEnter={() => onActiveIndexChange(i)}
            onClick={(e) => {
              if (onOpen) {
                // Let Link navigate — onOpen is informational only.
                onOpen(r.slug)
              }
            }}
            className={`group relative block py-3 pl-5 pr-3 -mx-3 transition-colors duration-120 ${
              isActive ? "bg-surface-raised/60" : "hover:bg-surface-raised/40"
            }`}
          >
            {/* 2px left signal bar — the only color on the row */}
            <span
              aria-hidden
              className="absolute left-0 top-3 bottom-3 w-[2px]"
              style={{
                backgroundColor: SIGNAL_COLOR[signal],
                opacity: isActive ? 1 : 0.55,
                transition: "opacity 120ms ease-out",
              }}
            />

            <div className="flex items-baseline justify-between gap-4">
              <h3
                className={`font-heading text-sm transition-colors duration-120 ${
                  isActive
                    ? "text-text-bright"
                    : "text-text-emphasis group-hover:text-text-bright"
                }`}
              >
                {r.title}
              </h3>
              <div className="flex items-center gap-2 shrink-0">
                <UpdatingDot
                  updating={isUpdating?.(r.slug) ?? false}
                  rewritten={wasJustRewritten?.(r.slug) ?? false}
                />
                {/* Rank badge — only shown when the gap between both ranks is
                    meaningful enough that it's worth telegraphing. */}
                <RankBadge result={r} />
                {/* Confidence dot, same visual language as the wiki list. */}
                <div
                  className="w-1 h-1 rounded-full shrink-0"
                  style={{
                    backgroundColor:
                      (r.confidence ?? 0) > 0.8
                        ? "var(--color-confidence-high)"
                        : (r.confidence ?? 0) > 0.5
                        ? "var(--color-confidence-mid)"
                        : "var(--color-confidence-low)",
                  }}
                />
              </div>
            </div>
            {r.summary && (
              <p className="mt-1 text-xs text-text-tertiary leading-[1.6] line-clamp-2">
                {r.summary}
              </p>
            )}
            {r.tags && r.tags.length > 0 && (
              <div className="mt-1.5 flex gap-1.5 flex-wrap">
                {r.tags.map((tag) => (
                  <span
                    key={tag}
                    className="font-mono text-[10px] text-text-ghost"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </Link>
        )
      })}
    </div>
  )
}

function RankBadge({ result }: { result: HybridResult }) {
  // Show the rank badge only when there's real signal to communicate.
  // Suppress when the result is mid-pack in both rankers — no one cares.
  const { bm25_rank, vector_rank } = result
  const hasBoth = bm25_rank > 0 && vector_rank > 0
  if (!hasBoth) return null
  // Only badge the top-3 overlap — that's the case where the user benefits
  // from knowing "both rankers picked this as top-of-list".
  const minRank = Math.min(bm25_rank, vector_rank)
  if (minRank > 3) return null
  return (
    <span className="font-mono text-[10px] text-text-ghost">
      both · {minRank}
    </span>
  )
}
