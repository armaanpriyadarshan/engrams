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

      {/* List view */}
      {view === "list" && graphData && (
        <div className="max-w-3xl mx-auto px-6 py-10 h-full overflow-y-auto" style={{ animation: "fade-in 300ms ease-out both" }}>
          <div className="space-y-2">
            {graphData.nodes.map((node) => (
              <Link
                key={node.slug}
                href={`/app/${engramSlug}/article/${node.slug}`}
                className="block border border-border hover:border-border-emphasis bg-surface p-4 transition-colors duration-150"
              >
                <div className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 mt-2 rounded-full shrink-0" style={{
                    backgroundColor: node.confidence > 0.8 ? "var(--color-confidence-high)"
                      : node.confidence > 0.5 ? "var(--color-confidence-mid)" : "var(--color-confidence-low)",
                  }} />
                  <div>
                    <h2 className="font-heading text-sm text-text-emphasis">{node.title}</h2>
                    {node.summary && <p className="mt-1 text-xs text-text-tertiary leading-relaxed">{node.summary}</p>}
                    {node.tags.length > 0 && (
                      <div className="mt-2 flex gap-2">
                        {node.tags.map((tag) => (
                          <span key={tag} className="font-mono text-[10px] text-text-ghost">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            ))}
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
