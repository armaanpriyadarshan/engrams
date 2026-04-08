"use client"

// Hybrid search bar — input + tag chips + keyboard affordances.
//
// Design targets:
//  • Typography-first: the input is a hairline-underlined field, no box chrome.
//  • Chips sit below the input as a thin optional strip. Hidden entirely when
//    the engram has no tag vocabulary — no empty row.
//  • `/` from anywhere in the page focuses this input (unless another input
//    is focused). `Esc` clears or unfocuses. Up/Down/Enter are handled by
//    the parent via onKeyNavigate.
//  • No spinner glyph — a thin hairline below the field pulses via CSS when
//    searching. One moving part.

import { useEffect, useRef } from "react"

interface HybridSearchBarProps {
  query: string
  onQueryChange: (q: string) => void
  onClear: () => void

  tagVocabulary: { tag: string; count: number }[]
  activeTags: Set<string>
  onToggleTag: (tag: string) => void
  onClearTags: () => void

  searching: boolean
  embedded: boolean
  resultCount: number | null

  /**
   * Called when the user presses up / down / enter while the input is
   * focused. Parent owns the active-index state so it can also update on
   * mouse hover over a specific result.
   */
  onKeyNavigate: (key: "up" | "down" | "enter" | "escape") => void
}

const MAX_CHIPS = 10

export function HybridSearchBar({
  query,
  onQueryChange,
  onClear,
  tagVocabulary,
  activeTags,
  onToggleTag,
  onClearTags,
  searching,
  embedded,
  resultCount,
  onKeyNavigate,
}: HybridSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  // Global `/` focus shortcut. Intentionally only swallows the keystroke when
  // the current focus is NOT inside an editable field — typing a slash in a
  // normal textarea should still insert a slash.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (!target) return
      const tag = target.tagName
      const editable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (target as HTMLElement).isContentEditable
      if (editable) return
      e.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const chips = tagVocabulary.slice(0, MAX_CHIPS)
  const hasActiveTags = activeTags.size > 0
  const showChips = chips.length > 0

  return (
    <div className="mb-8">
      {/* Input row */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              onKeyNavigate("down")
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              onKeyNavigate("up")
            } else if (e.key === "Enter") {
              e.preventDefault()
              onKeyNavigate("enter")
            } else if (e.key === "Escape") {
              e.preventDefault()
              if (query) {
                onClear()
              } else {
                inputRef.current?.blur()
              }
              onKeyNavigate("escape")
            }
          }}
          placeholder="Search"
          spellCheck={false}
          className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-ghost outline-none pb-3 border-b border-border focus:border-text-tertiary transition-colors duration-120"
        />
        {/* Pulsing underline — visible only while a request is in flight.
            Absolutely positioned over the bottom border, 1px high. */}
        <div
          className="pointer-events-none absolute bottom-0 left-0 right-0 h-px overflow-hidden"
          aria-hidden
        >
          <div
            className="h-px bg-text-secondary"
            style={{
              opacity: searching ? 1 : 0,
              transform: searching ? "scaleX(1)" : "scaleX(0)",
              transformOrigin: "left center",
              transition: searching
                ? "transform 600ms ease-out, opacity 120ms ease-out"
                : "opacity 300ms ease-out 200ms, transform 0ms 300ms",
            }}
          />
        </div>

        {/* Keyboard hint + result meta — right-aligned mono metadata. */}
        <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-3 pointer-events-none">
          {resultCount !== null && query.trim() && (
            <span className="font-mono text-[10px] text-text-ghost">
              {resultCount} {resultCount === 1 ? "result" : "results"}
              {!embedded && " · bm25"}
            </span>
          )}
          {!query && (
            <span className="font-mono text-[10px] text-text-ghost">
              <kbd className="border border-border px-1 py-px">/</kbd>
            </span>
          )}
        </div>
      </div>

      {/* Tag chip strip */}
      {showChips && (
        <div className="mt-4 flex items-center gap-1.5 flex-wrap">
          {chips.map(({ tag, count }) => {
            const active = activeTags.has(tag)
            return (
              <button
                key={tag}
                onClick={() => onToggleTag(tag)}
                className={`group font-mono text-[10px] px-2 py-0.5 border transition-colors duration-120 cursor-pointer ${
                  active
                    ? "border-text-tertiary text-text-emphasis"
                    : "border-border text-text-ghost hover:border-border-emphasis hover:text-text-tertiary"
                }`}
                title={`${count} article${count === 1 ? "" : "s"}`}
              >
                {tag}
              </button>
            )
          })}
          {hasActiveTags && (
            <button
              onClick={onClearTags}
              className="font-mono text-[10px] px-2 py-0.5 text-text-ghost hover:text-text-tertiary transition-colors duration-120 cursor-pointer"
            >
              clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}
