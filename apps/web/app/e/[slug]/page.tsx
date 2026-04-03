"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import dynamic from "next/dynamic"
import { createClient } from "@/lib/supabase/client"
import { useGraphData } from "@/app/components/app/map/useGraphData"
import { useForceLayout } from "@/app/components/app/map/useForceLayout"
import NodeCard from "@/app/components/app/NodeCard"

const EngineGraph = dynamic(() => import("@/app/components/app/map/EngineGraph"), { ssr: false })

export default function PublishedMapPage() {
  const params = useParams()
  const slug = params.slug as string

  const [engramId, setEngramId] = useState<string | null>(null)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from("engrams")
      .select("id")
      .eq("slug", slug)
      .eq("visibility", "published")
      .single()
      .then(({ data }) => {
        if (data) setEngramId(data.id)
      })
  }, [slug])

  const { data: graphData, loading } = useGraphData(engramId)
  const positions = useForceLayout(graphData, 1200, 800)

  const handleNodeClick = useCallback((nodeSlug: string) => {
    setSelectedSlug(nodeSlug)
  }, [])

  if (loading || !graphData || !positions) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <p className="text-xs font-mono text-text-ghost">
          {loading ? "Loading..." : "No articles in this engram."}
        </p>
      </div>
    )
  }

  return (
    <div className="absolute inset-0">
      <EngineGraph
        data={graphData}
        positions={positions}
        engramSlug={slug}
        onNodeClick={handleNodeClick}
      />

      <div className="absolute top-0 left-0 right-0 px-4 py-2 pointer-events-none">
        <span className="text-[10px] font-mono text-text-ghost">
          {graphData.nodes.length} article{graphData.nodes.length !== 1 ? "s" : ""} &middot; {graphData.edges.length} connection{graphData.edges.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Node card — same as main app, but with published link prefix */}
      {selectedSlug && engramId && (
        <NodeCard
          slug={selectedSlug}
          engramSlug={slug}
          engramId={engramId}
          onClose={() => setSelectedSlug(null)}
          linkPrefix={`/e/${slug}`}
        />
      )}
    </div>
  )
}
