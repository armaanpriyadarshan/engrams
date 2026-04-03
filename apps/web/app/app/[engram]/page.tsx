"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import dynamic from "next/dynamic"
import { createClient } from "@/lib/supabase/client"
import { useGraphData } from "@/app/components/app/map/useGraphData"
import { useForceLayout } from "@/app/components/app/map/useForceLayout"
import SlidePanel from "@/app/components/app/SlidePanel"
import NodeCard from "@/app/components/app/NodeCard"
import AskPanel from "@/app/components/app/AskPanel"
import FeedPill from "@/app/components/app/FeedPill"
import CompilationToast from "@/app/components/app/CompilationToast"
import Link from "next/link"

const EngineGraph = dynamic(() => import("@/app/components/app/map/EngineGraph"), { ssr: false })

export default function EngramPage() {
  const params = useParams()
  const engramSlug = params.engram as string

  const [engramId, setEngramId] = useState<string | null>(null)
  const [askOpen, setAskOpen] = useState(false)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from("engrams")
      .select("id")
      .eq("slug", engramSlug)
      .single()
      .then(({ data }) => {
        if (data) setEngramId(data.id)
      })
  }, [engramSlug])

  const { data: graphData, loading } = useGraphData(engramId)
  const positions = useForceLayout(graphData, 1200, 800)

  const handleNodeClick = useCallback((slug: string) => {
    setSelectedSlug(slug)
  }, [])

  // Empty state
  if (!loading && graphData && graphData.nodes.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center relative">
        <p className="text-text-secondary text-sm">Nothing here yet.</p>
        <p className="mt-2 text-sm text-text-tertiary">Feed a source to begin.</p>
        {engramId && <FeedPill engramId={engramId} />}
        {engramId && <CompilationToast engramId={engramId} />}
      </div>
    )
  }

  return (
    <div className="w-full h-full relative overflow-hidden">
      {/* Map */}
      {graphData && positions ? (
        <EngineGraph
          data={graphData}
          positions={positions}
          engramSlug={engramSlug}
          onNodeClick={handleNodeClick}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <p className="text-xs font-mono text-text-ghost">Loading...</p>
        </div>
      )}

      {/* Stats overlay */}
      {graphData && (
        <div className="absolute top-0 left-0 right-0 px-4 py-2 pointer-events-none">
          <span className="text-[10px] font-mono text-text-ghost">
            {graphData.nodes.length} article{graphData.nodes.length !== 1 ? "s" : ""} &middot; {graphData.edges.length} connection{graphData.edges.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Node card — floating, draggable, left side */}
      {selectedSlug && engramId && (
        <NodeCard
          slug={selectedSlug}
          engramSlug={engramSlug}
          engramId={engramId}
          onClose={() => setSelectedSlug(null)}
        />
      )}

      {/* Feed pill — bottom center */}
      {engramId && <FeedPill engramId={engramId} />}

      {/* Ask button — bottom right */}
      <button
        onClick={() => setAskOpen(!askOpen)}
        className="absolute bottom-6 right-6 z-30 bg-surface-raised border border-border hover:border-border-emphasis px-4 py-2.5 text-xs font-mono text-text-secondary hover:text-text-emphasis transition-all duration-150 cursor-pointer"
      >
        Ask
      </button>

      {/* Ask slide panel — right side */}
      <SlidePanel isOpen={askOpen} onClose={() => setAskOpen(false)}>
        {engramId && <AskPanel engramId={engramId} engramSlug={engramSlug} />}
      </SlidePanel>

      {/* Compilation toast */}
      {engramId && <CompilationToast engramId={engramId} />}
    </div>
  )
}
