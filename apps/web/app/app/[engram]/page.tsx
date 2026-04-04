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
  const [view, setView] = useState<"graph" | "wiki">("graph")
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [nodeMenu, setNodeMenu] = useState<NodeMenu | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from("engrams")
      .select("id")
      .eq("slug", engramSlug)
      .single()
      .then(({ data }) => { if (data) setEngramId(data.id) })
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
          <div className="max-w-[660px] mx-auto px-6 pt-16 pb-32">
            {/* Wiki header */}
            <div className="mb-10 border-b border-border pb-6">
              <p className="text-xs font-mono text-text-ghost">
                {graphData.nodes.length} articles &middot; {graphData.edges.length} connections
              </p>
            </div>

            {/* Table of contents */}
            {wikiSections.length > 1 && (
              <nav className="mb-12">
                <h2 className="font-heading text-xs text-text-ghost uppercase tracking-widest mb-3">Contents</h2>
                <ol className="space-y-1">
                  {wikiSections.map(([type, nodes]) => (
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

            {/* Sections grouped by article type */}
            <div className="space-y-16">
              {wikiSections.map(([type, nodes]) => (
                <section key={type} id={`section-${type}`}>
                  {wikiSections.length > 1 && (
                    <h2 className="font-heading text-xs text-text-ghost uppercase tracking-widest mb-6 border-b border-border/50 pb-2">
                      {type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ")}
                    </h2>
                  )}
                  <div className="space-y-10">
                    {nodes.map((node) => {
                      const connections = connectionMap.get(node.slug) ?? []
                      return (
                        <article key={node.slug} className="group">
                          <Link
                            href={`/app/${engramSlug}/article/${node.slug}`}
                            className="inline-block"
                          >
                            <h3 className="font-heading text-base text-text-emphasis group-hover:text-text-bright transition-colors duration-120">
                              {node.title}
                            </h3>
                          </Link>

                          {node.tags.length > 0 && (
                            <div className="mt-1.5 flex gap-2 flex-wrap">
                              {node.tags.map((tag) => (
                                <span key={tag} className="font-mono text-[10px] text-text-ghost">{tag}</span>
                              ))}
                            </div>
                          )}

                          {node.summary && (
                            <p className="mt-3 text-sm text-text-secondary leading-[1.65]">{node.summary}</p>
                          )}

                          {node.contentMd && (
                            <div className="mt-3 text-sm text-text-tertiary leading-[1.65] whitespace-pre-line">
                              {truncateContent(node.contentMd, 600)}
                            </div>
                          )}

                          {connections.length > 0 && (
                            <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] font-mono text-text-ghost">linked to</span>
                              {connections.slice(0, 5).map((title) => (
                                <span key={title} className="text-[10px] font-mono text-text-ghost border border-border/60 px-1.5 py-0.5">
                                  {title}
                                </span>
                              ))}
                              {connections.length > 5 && (
                                <span className="text-[10px] font-mono text-text-ghost">+{connections.length - 5}</span>
                              )}
                            </div>
                          )}

                          <div className="mt-3 flex items-center gap-3">
                            <div className="flex items-center gap-1.5">
                              <div className="w-1 h-1 rounded-full" style={{
                                backgroundColor: node.confidence > 0.8 ? "var(--color-confidence-high)"
                                  : node.confidence > 0.5 ? "var(--color-confidence-mid)" : "var(--color-confidence-low)",
                              }} />
                              <span className="text-[10px] font-mono text-text-ghost">
                                {Math.round(node.confidence * 100)}%
                              </span>
                            </div>
                            <Link
                              href={`/app/${engramSlug}/article/${node.slug}`}
                              className="text-[10px] font-mono text-text-ghost hover:text-text-secondary transition-colors duration-120"
                            >
                              read full article
                            </Link>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
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
