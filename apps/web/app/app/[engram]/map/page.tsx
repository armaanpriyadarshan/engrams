"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import dynamic from "next/dynamic"
import { createClient } from "@/lib/supabase/client"
import { useGraphData } from "@/app/components/app/map/useGraphData"
import { useForceLayout } from "@/app/components/app/map/useForceLayout"

const EngineGraph = dynamic(() => import("@/app/components/app/map/EngineGraph"), { ssr: false })

export default function MapPage() {
  const params = useParams()
  const engramSlug = params.engram as string
  const [engramId, setEngramId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from("engrams")
      .select("id")
      .eq("slug", engramSlug)
      .single()
      .then(({ data }) => setEngramId(data?.id ?? null))
  }, [engramSlug])

  const { data, loading } = useGraphData(engramId)
  const layoutResult = useForceLayout(data, 1200, 800, engramId)

  if (loading || !data || !layoutResult) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <p className="text-xs font-mono text-text-ghost">
          {loading ? "Loading graph..." : "No articles yet. Feed sources to see the map."}
        </p>
      </div>
    )
  }

  const { positions, meta: layoutMeta } = layoutResult

  return (
    <div className="w-full h-full relative">
      <EngineGraph data={data} positions={positions} layoutMeta={layoutMeta} engramSlug={engramSlug} />
      <div className="absolute top-0 left-0 right-0 px-4 py-2 bg-void/80 backdrop-blur-sm pointer-events-none">
        <span className="text-[10px] font-mono text-text-ghost">
          {data.nodes.length} articles &middot; {data.edges.length} connections
        </span>
      </div>
    </div>
  )
}
