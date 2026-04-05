"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useParams } from "next/navigation"
import dynamic from "next/dynamic"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useGraphData, type GraphNode } from "@/app/components/app/map/useGraphData"
import { useForceLayout } from "@/app/components/app/map/useForceLayout"
import NodeCard from "@/app/components/app/NodeCard"
import CompilationToast from "@/app/components/app/CompilationToast"
import SourceTree from "@/app/components/app/SourceTree"
import ViewToggle from "@/app/components/app/ViewToggle"
import AddSourceButton from "@/app/components/app/AddSourceButton"
import AgentTimeline from "@/app/components/app/AgentTimeline"
import AskBar from "@/app/components/app/AskBar"

const EngineGraph = dynamic(() => import("@/app/components/app/map/EngineGraph"), { ssr: false })

function truncateContent(md: string, maxLen: number): string {
  // Strip markdown headings and clean up for preview
  const cleaned = md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (cleaned.length <= maxLen) return cleaned
  const truncated = cleaned.slice(0, maxLen)
  const lastSpace = truncated.lastIndexOf(" ")
  return (lastSpace > maxLen * 0.8 ? truncated.slice(0, lastSpace) : truncated) + "..."
}

interface NodeMenu {
  slug: string
  x: number
  y: number
}

export default function EngramPage() {
  const params = useParams()
  const engramSlug = params.engram as string

  const [engramId, setEngramId] = useState<string | null>(null)
  const [engramDescription, setEngramDescription] = useState<string | null>(null)
  const [view, setView] = useState<"graph" | "wiki">("graph")
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [nodeMenu, setNodeMenu] = useState<NodeMenu | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from("engrams")
      .select("id, description")
      .eq("slug", engramSlug)
      .single()
      .then(({ data }) => {
        if (data) {
          setEngramId(data.id)
          setEngramDescription(data.description)
        }
      })
  }, [engramSlug])

  useEffect(() => {
    if (!nodeMenu) return
    const close = () => setNodeMenu(null)
    window.addEventListener("click", close)
    return () => window.removeEventListener("click", close)
  }, [nodeMenu])

  const { data: graphData, loading } = useGraphData(engramId)
  const positions = useForceLayout(graphData, 1200, 800)

  // Group articles by type for wiki view
  const wikiSections = useMemo(() => {
    if (!graphData) return []
    const groups = new Map<string, GraphNode[]>()
    for (const node of graphData.nodes) {
      const type = node.articleType || "concept"
      if (!groups.has(type)) groups.set(type, [])
      groups.get(type)!.push(node)
    }
    // Sort each group by confidence descending, then by title
    for (const nodes of groups.values()) {
      nodes.sort((a, b) => b.confidence - a.confidence || a.title.localeCompare(b.title))
    }
    // Sort sections: concepts first, then alphabetically
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === "concept") return -1
      if (b === "concept") return 1
      return a.localeCompare(b)
    })
  }, [graphData])

  // Filter articles by search query
  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return wikiSections
    const q = searchQuery.toLowerCase()
    return wikiSections
      .map(([type, nodes]) => {
        const filtered = nodes.filter(
          (n) =>
            n.title.toLowerCase().includes(q) ||
            n.summary?.toLowerCase().includes(q) ||
            n.tags.some((t) => t.toLowerCase().includes(q))
        )
        return [type, filtered] as [string, GraphNode[]]
      })
      .filter(([, nodes]) => nodes.length > 0)
  }, [wikiSections, searchQuery])

  // Build a map of slug -> connected article titles for cross-references
  const connectionMap = useMemo(() => {
    if (!graphData) return new Map<string, string[]>()
    const map = new Map<string, string[]>()
    for (const edge of graphData.edges) {
      const srcNode = graphData.nodes[edge.sourceIdx]
      const tgtNode = graphData.nodes[edge.targetIdx]
      if (!srcNode || !tgtNode) continue
      if (!map.has(srcNode.slug)) map.set(srcNode.slug, [])
      if (!map.has(tgtNode.slug)) map.set(tgtNode.slug, [])
      map.get(srcNode.slug)!.push(tgtNode.title)
      map.get(tgtNode.slug)!.push(srcNode.title)
    }
    return map
  }, [graphData])

  const handleNodeClick = useCallback((slug: string, x: number, y: number) => {
    setNodeMenu({ slug, x, y })
  }, [])

  const openArticle = useCallback(() => {
    if (!nodeMenu) return
    setSelectedSlug(nodeMenu.slug)
    setNodeMenu(null)
  }, [nodeMenu])

  // Empty state
  if (!loading && graphData && graphData.nodes.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center relative">
        <p className="text-text-secondary text-sm">Nothing here yet.</p>
        <p className="mt-2 text-sm text-text-tertiary">Add a source to begin.</p>
        {engramId && <AddSourceButton engramId={engramId} />}
        {engramId && <CompilationToast engramId={engramId} />}
      </div>
    )
  }

  return (
    <div className="w-full h-full relative">
      {/* Graph view */}
      {view === "graph" && (
        graphData && positions ? (
          <div className="w-full h-full" style={{ animation: "graph-ignite 1.2s ease-out both" }}>
            <EngineGraph
              data={graphData}
              positions={positions}
              engramSlug={engramSlug}
              onNodeClick={handleNodeClick}
            />
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <p className="text-xs font-mono text-text-ghost">Loading<span className="inline-flex w-4"><span className="animate-loading-dots" /></span></p>
          </div>
        )
      )}

      {/* Wiki view */}
      {view === "wiki" && graphData && (
        <div className="h-full overflow-y-auto scrollbar-hidden" style={{ animation: "fade-in 300ms ease-out both" }}>
          <div className="max-w-[660px] mx-auto px-6 pt-28 pb-32">
            {/* Search */}
            <div className="mb-8">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-full bg-transparent text-sm text-text-secondary placeholder:text-text-ghost outline-none pb-3 border-b border-border focus:border-text-tertiary transition-colors duration-150"
              />
            </div>

            {/* Engram summary */}
            {engramDescription && !searchQuery && (
              <div className="mb-12 border-l-2 border-border pl-5 py-3">
                <p className="text-sm text-text-tertiary leading-[1.65]">
                  {engramDescription}
                  {" "}{graphData.nodes.length} articles compiled from {graphData.edges.length} connections.
                </p>
              </div>
            )}

            {/* Table of contents */}
            {!searchQuery && filteredSections.length > 1 && (
              <nav className="mb-12">
                <h2 className="font-heading text-xs text-text-ghost uppercase tracking-widest mb-3">Contents</h2>
                <ol className="space-y-1">
                  {filteredSections.map(([type, nodes]) => (
                    <li key={type}>
                      <a
                        href={`#section-${type}`}
                        className="text-sm text-text-secondary hover:text-text-emphasis transition-colors duration-120"
                      >
                        {type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ")}
                        <span className="text-text-ghost ml-2 font-mono text-[10px]">{nodes.length}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            )}

            {/* Articles */}
            <div className="space-y-16">
              {filteredSections.map(([type, nodes]) => (
                <section key={type} id={`section-${type}`}>
                  {filteredSections.length > 1 && (
                    <h2 className="font-heading text-xs text-text-ghost uppercase tracking-widest mb-6 border-b border-border/50 pb-2">
                      {type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ")}
                    </h2>
                  )}
                  <div className="space-y-1">
                    {nodes.map((node) => {
                      const connections = connectionMap.get(node.slug) ?? []
                      return (
                        <Link
                          key={node.slug}
                          href={`/app/${engramSlug}/article/${node.slug}`}
                          className="group block py-3 -mx-3 px-3 hover:bg-surface-raised/50 transition-colors duration-120"
                        >
                          <div className="flex items-baseline justify-between gap-4">
                            <h3 className="font-heading text-sm text-text-emphasis group-hover:text-text-bright transition-colors duration-120">
                              {node.title}
                            </h3>
                            <div className="flex items-center gap-2 shrink-0">
                              {connections.length > 0 && (
                                <span className="text-[10px] font-mono text-text-ghost">
                                  {connections.length} link{connections.length !== 1 ? "s" : ""}
                                </span>
                              )}
                              <div className="w-1 h-1 rounded-full shrink-0" style={{
                                backgroundColor: node.confidence > 0.8 ? "var(--color-confidence-high)"
                                  : node.confidence > 0.5 ? "var(--color-confidence-mid)" : "var(--color-confidence-low)",
                              }} />
                            </div>
                          </div>
                          {node.summary && (
                            <p className="mt-1 text-xs text-text-tertiary leading-[1.6] line-clamp-2">{node.summary}</p>
                          )}
                          {node.tags.length > 0 && (
                            <div className="mt-1.5 flex gap-1.5 flex-wrap">
                              {node.tags.map((tag) => (
                                <span key={tag} className="font-mono text-[10px] text-text-ghost border border-border rounded-full px-2 py-0.5">{tag}</span>
                              ))}
                            </div>
                          )}
                        </Link>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>

            {/* No results */}
            {searchQuery && filteredSections.length === 0 && (
              <p className="text-sm text-text-ghost mt-4">No articles match &ldquo;{searchQuery}&rdquo;</p>
            )}
          </div>
        </div>
      )}

      {/* ── Overlay layout ── */}

      {engramId && <SourceTree engramId={engramId} />}

      <ViewToggle onViewChange={setView} />
      {engramId && <AddSourceButton engramId={engramId} />}
      {engramId && <AgentTimeline engramId={engramId} />}

      {/* Bottom center: ask bar */}
      {engramId && <AskBar engramId={engramId} engramSlug={engramSlug} />}

      {/* Node context menu */}
      {nodeMenu && (
        <div
          className="fixed z-50 bg-surface-raised border border-border-emphasis py-1 min-w-[160px] animate-fade-in"
          style={{ left: nodeMenu.x, top: nodeMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={openArticle}
            className="block w-full text-left px-4 py-2 text-xs text-text-secondary hover:text-text-emphasis hover:bg-surface-elevated transition-colors duration-150 cursor-pointer"
          >
            Open article
          </button>
        </div>
      )}

      {/* Node card */}
      {selectedSlug && engramId && (
        <NodeCard
          slug={selectedSlug}
          engramSlug={engramSlug}
          engramId={engramId}
          onClose={() => setSelectedSlug(null)}
        />
      )}

      {/* Compilation toast */}
      {engramId && <CompilationToast engramId={engramId} />}
    </div>
  )
}
