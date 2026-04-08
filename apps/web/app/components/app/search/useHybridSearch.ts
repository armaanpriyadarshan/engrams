"use client"

// Hybrid search hook.
//
// Owns: debounced fetch against the hybrid-search edge function, active tag
// AND-filter, result list, keyboard activeIndex, embedded/fallback signal.
//
// Doesn't own: what the page renders. The page decides whether to show flat
// hybrid results or a grouped sections view based on whether `query` is set.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"

export interface HybridResult {
  slug: string
  title: string
  summary: string | null
  confidence: number | null
  article_type: string | null
  tags: string[] | null
  updated_at: string
  bm25_rank: number
  vector_rank: number
  rrf_score: number
}

export type MatchSignal = "both" | "bm25" | "vector"

export function matchSignalOf(r: HybridResult): MatchSignal {
  if (r.bm25_rank > 0 && r.vector_rank > 0) return "both"
  if (r.bm25_rank > 0) return "bm25"
  return "vector"
}

interface UseHybridSearchOptions {
  engramId: string | null
  /**
   * All article nodes currently loaded for the engram — used purely to
   * derive the tag vocabulary that powers the chip filter. Not used as
   * a fallback data source (fallback goes through the BM25-only path
   * on the server side).
   */
  allTags: string[]
  /** How many results to ask for. Defaults to 20. */
  limit?: number
  /** How long to wait after the last keystroke before firing the request. */
  debounceMs?: number
}

export interface UseHybridSearchReturn {
  query: string
  setQuery: (q: string) => void
  clear: () => void

  results: HybridResult[] | null
  searching: boolean
  error: string | null
  /**
   * True when the server embedded the query and used hybrid fusion.
   * False means we fell back to BM25-only (e.g. OPENAI_API_KEY missing).
   */
  embedded: boolean

  /** Top-N tag vocabulary, sorted by descending frequency. */
  tagVocabulary: { tag: string; count: number }[]
  activeTags: Set<string>
  toggleTag: (tag: string) => void
  clearTags: () => void

  /** Keyboard navigation over the current result list. */
  activeIndex: number
  setActiveIndex: (i: number) => void
  moveActiveBy: (delta: number) => void
}

export function useHybridSearch({
  engramId,
  allTags,
  limit = 20,
  debounceMs = 200,
}: UseHybridSearchOptions): UseHybridSearchReturn {
  const [query, setQueryRaw] = useState("")
  const [results, setResults] = useState<HybridResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [embedded, setEmbedded] = useState(true)
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set())
  const [activeIndex, setActiveIndex] = useState(0)

  // Latest-wins: store the most recent request token so earlier, slower
  // responses don't overwrite a fresher result set. Protects against the
  // classic debounced-fetch race where typing "foo" then "foob" could
  // land "foo" results after "foob".
  const reqToken = useRef(0)

  const setQuery = useCallback((q: string) => {
    setQueryRaw(q)
    setActiveIndex(0)
  }, [])

  const clear = useCallback(() => {
    setQueryRaw("")
    setResults(null)
    setError(null)
    setActiveIndex(0)
  }, [])

  const toggleTag = useCallback((tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
    setActiveIndex(0)
  }, [])

  const clearTags = useCallback(() => setActiveTags(new Set()), [])

  // Derive tag vocabulary with counts. Stable sort: descending by count,
  // then ascending by name for ties, so the chip order is deterministic.
  const tagVocabulary = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of allTags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  }, [allTags])

  const trimmed = query.trim()
  const hasQuery = trimmed.length >= 2
  const activeTagsKey = useMemo(() => Array.from(activeTags).sort().join("\u0001"), [activeTags])

  useEffect(() => {
    if (!engramId) return
    if (!hasQuery) {
      setResults(null)
      setSearching(false)
      setError(null)
      return
    }

    const token = ++reqToken.current
    setSearching(true)
    setError(null)

    const timer = setTimeout(async () => {
      try {
        const supabase = createClient()
        const filter_tags = activeTags.size > 0 ? Array.from(activeTags) : null
        const { data, error: fnError } = await supabase.functions.invoke("hybrid-search", {
          body: {
            engram_id: engramId,
            query: trimmed,
            limit,
            filter_tags,
          },
        })

        if (token !== reqToken.current) return // stale
        if (fnError) {
          setError(fnError.message ?? "Search failed")
          setResults([])
          setEmbedded(true)
        } else {
          setResults((data?.results as HybridResult[]) ?? [])
          setEmbedded(data?.embedded ?? true)
        }
      } catch (e) {
        if (token !== reqToken.current) return
        setError(e instanceof Error ? e.message : String(e))
        setResults([])
      } finally {
        if (token === reqToken.current) setSearching(false)
      }
    }, debounceMs)

    return () => clearTimeout(timer)
  }, [engramId, trimmed, hasQuery, activeTagsKey, activeTags, limit, debounceMs])

  const moveActiveBy = useCallback(
    (delta: number) => {
      if (!results || results.length === 0) return
      setActiveIndex((prev) => {
        const next = prev + delta
        if (next < 0) return 0
        if (next >= results.length) return results.length - 1
        return next
      })
    },
    [results],
  )

  return {
    query,
    setQuery,
    clear,
    results,
    searching,
    error,
    embedded,
    tagVocabulary,
    activeTags,
    toggleTag,
    clearTags,
    activeIndex,
    setActiveIndex,
    moveActiveBy,
  }
}
