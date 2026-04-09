"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"

export interface GraphNode {
  slug: string
  title: string
  summary: string | null
  confidence: number
  depth: number // normalized 0-1, based on word count × source count
  tags: string[]
  articleType: string
  contentMd: string | null
}

export interface GraphEdge {
  sourceIdx: number
  targetIdx: number
  weight: number
  relation: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  slugToIndex: Map<string, number>
}

export function useGraphData(engramId: string | null) {
  const [data, setData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!engramId) return

    const fetch = async () => {
      setLoading(true)
      setError(null)
      const supabase = createClient()

      // Exclude article_type='summary' — summaries are internal intermediate
      // artifacts from the two-pass compiler (Pass A output). They're
      // reachable by direct URL for debugging but should never appear in
      // the wiki sections list or the knowledge graph.
      const [articlesResult, edgesResult] = await Promise.all([
        supabase
          .from("articles")
          .select("slug, title, summary, confidence, article_type, tags, source_ids, related_slugs, content_md")
          .eq("engram_id", engramId)
          .neq("article_type", "summary"),
        supabase
          .from("edges")
          .select("from_slug, to_slug, relation, weight")
          .eq("engram_id", engramId),
      ])

      if (articlesResult.error || edgesResult.error) {
        setError("Could not load graph data.")
        setLoading(false)
        return
      }

      const articles = articlesResult.data ?? []
      const dbEdges = edgesResult.data ?? []

      // Build nodes
      const slugToIndex = new Map<string, number>()
      let maxDepth = 1

      const nodes: GraphNode[] = articles.map((a, i) => {
        slugToIndex.set(a.slug, i)
        const wordCount = (a.content_md ?? "").split(/\s+/).length
        const sourceCount = Math.max((a.source_ids ?? []).length, 1)
        const rawDepth = wordCount * sourceCount
        if (rawDepth > maxDepth) maxDepth = rawDepth
        return {
          slug: a.slug,
          title: a.title,
          summary: a.summary,
          confidence: a.confidence ?? 0.5,
          depth: rawDepth,
          tags: a.tags ?? [],
          articleType: a.article_type ?? "concept",
          contentMd: a.content_md ?? null,
        }
      })

      // Normalize depth
      for (const node of nodes) {
        node.depth = Math.min(node.depth / maxDepth, 1)
      }

      // Build edges strictly from the DB edges table — single source of truth.
      // (Implicit edges from related_slugs were inflating the count beyond
      // what's actually persisted, causing displayed metrics to mismatch
      // what the graph renders.)
      const edgeSet = new Set<string>()
      const edges: GraphEdge[] = []

      for (const e of dbEdges) {
        const si = slugToIndex.get(e.from_slug)
        const ti = slugToIndex.get(e.to_slug)
        if (si === undefined || ti === undefined) continue
        const key = `${Math.min(si, ti)}-${Math.max(si, ti)}`
        if (edgeSet.has(key)) continue
        edgeSet.add(key)
        edges.push({ sourceIdx: si, targetIdx: ti, weight: e.weight ?? 0.5, relation: e.relation ?? "related" })
      }

      setData({ nodes, edges, slugToIndex })
      setLoading(false)
    }

    fetch()
  }, [engramId, refreshKey])

  // Subscribe to articles, edges, and compilation_runs so graph refreshes
  // on compilations, deletes, and any other changes
  useEffect(() => {
    if (!engramId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`graph-refresh-${engramId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "compilation_runs", filter: `engram_id=eq.${engramId}` },
        (payload) => {
          if ((payload.new as { status?: string }).status === "completed") {
            setRefreshKey((k) => k + 1)
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "articles", filter: `engram_id=eq.${engramId}` },
        () => { setRefreshKey((k) => k + 1) }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "edges", filter: `engram_id=eq.${engramId}` },
        () => { setRefreshKey((k) => k + 1) }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [engramId])

  return { data, loading, error }
}
