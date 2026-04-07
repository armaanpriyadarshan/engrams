"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useGraphData, type GraphNode, type GraphData } from "@/app/components/app/map/useGraphData"
import { useForceLayout } from "@/app/components/app/map/useForceLayout"
import GraphFilters, { type GraphFilterState } from "@/app/components/app/map/GraphFilters"
import NodeCard from "@/app/components/app/NodeCard"
import CompilationToast from "@/app/components/app/CompilationToast"
import SourceTree from "@/app/components/app/SourceTree"
import ViewToggle, { type ViewMode } from "@/app/components/app/ViewToggle"
import AddSourceButton from "@/app/components/app/AddSourceButton"
import AgentTimeline from "@/app/components/app/AgentTimeline"
import AskBar from "@/app/components/app/AskBar"
import KnowledgeGaps from "@/app/components/app/KnowledgeGaps"
import IntegrationsSection from "@/app/components/app/IntegrationsSection"
import { WidgetPanelProvider, usePanelContext } from "@/app/components/app/WidgetPanel"
import { createSnapshot } from "@/lib/snapshots"

function HideWhenPanelOpen({ children }: { children: React.ReactNode }) {
  const { openId } = usePanelContext()
  return (
    <div style={{ opacity: openId ? 0 : 1, pointerEvents: openId ? "none" : "auto", transition: "opacity 180ms ease-out" }}>
      {children}
    </div>
  )
}

function useDropZone(engramId: string | null) {
  const [dropping, setDropping] = useState(false)
  const [dropMessage, setDropMessage] = useState("")
  const dragCounter = useRef(0)
  const router = useRouter()

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current++
    if (dragCounter.current === 1) setDropping(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) setDropping(false)
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current = 0
    setDropping(false)
    if (!engramId) return

    const supabase = createClient()

    // Handle dropped URL text
    const droppedUrl = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain")
    if (!e.dataTransfer.files.length && droppedUrl && droppedUrl.startsWith("http")) {
      setDropMessage("Compiling...")
      const { data: source } = await supabase.from("sources").insert({
        engram_id: engramId, source_type: "url",
        source_url: droppedUrl, title: droppedUrl, status: "pending",
      }).select("id").single()
      if (source) {
        await supabase.rpc("increment_source_count", { eid: engramId })
        const { data: result } = await supabase.functions.invoke("compile-source", { body: { source_id: source.id } })
        const created = result?.articles_created ?? 0
        const updated = result?.articles_updated ?? 0
        setDropMessage(`${created} created. ${updated} updated.`)
        await createSnapshot(supabase, engramId, "feed", `${created} created. ${updated} updated.`, { articles_created: created, articles_updated: updated }, source.id)
        supabase.functions.invoke("generate-embedding", { body: { engram_id: engramId } })
        supabase.functions.invoke("detect-gaps", { body: { engram_id: engramId, trigger_source_id: source.id } })
        supabase.functions.invoke("lint-engram", { body: { engram_id: engramId } })
      } else {
        setDropMessage("Failed.")
      }
      setTimeout(() => setDropMessage(""), 3000)
      router.refresh()
      return
    }

    // Handle dropped files
    const files = e.dataTransfer.files
    if (!files || files.length === 0) return

    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
      const name = file.name.replace(/\.[^.]+$/, "")
      const binaryFormats = ["pdf", "docx", "pptx", "xlsx"]

      let content: string
      if (binaryFormats.includes(ext)) {
        setDropMessage("Parsing...")
        const buffer = await file.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        let binary = ""
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        const { data: parsed, error } = await supabase.functions.invoke("parse-file", {
          body: { file_base64: btoa(binary), filename: file.name, format: ext },
        })
        if (error || !parsed?.content) { setDropMessage("Could not parse file."); setTimeout(() => setDropMessage(""), 2000); continue }
        content = parsed.content
      } else {
        content = await file.text()
      }

      setDropMessage("Compiling...")
      const { data: source } = await supabase.from("sources").insert({
        engram_id: engramId, source_type: "text",
        content_md: content, title: name, status: "pending",
      }).select("id").single()

      if (!source) { setDropMessage("Failed."); setTimeout(() => setDropMessage(""), 2000); continue }

      await supabase.rpc("increment_source_count", { eid: engramId })
      const { data: result } = await supabase.functions.invoke("compile-source", { body: { source_id: source.id } })
      const created = result?.articles_created ?? 0
      const updated = result?.articles_updated ?? 0
      setDropMessage(`${created} created. ${updated} updated.`)

      await createSnapshot(supabase, engramId, "feed", `${created} created. ${updated} updated.`, { articles_created: created, articles_updated: updated }, source.id)
      supabase.functions.invoke("generate-embedding", { body: { engram_id: engramId } })
      supabase.functions.invoke("detect-gaps", { body: { engram_id: engramId, trigger_source_id: source.id } })
      supabase.functions.invoke("lint-engram", { body: { engram_id: engramId } })
    }
    setTimeout(() => setDropMessage(""), 3000)
    router.refresh()
  }, [engramId, router])

  return { dropping, dropMessage, onDragEnter, onDragLeave, onDragOver, handleDrop }
}

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
  const [view, setView] = useState<ViewMode>("graph")
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [nodeMenu, setNodeMenu] = useState<NodeMenu | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [graphFilters, setGraphFilters] = useState<GraphFilterState>({ types: new Set(), minConfidence: 0, searchQuery: "" })
  const { dropping, dropMessage, onDragEnter, onDragLeave, onDragOver, handleDrop } = useDropZone(engramId)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from("engrams")
      .select("id, description")
      .eq("slug", engramSlug)
      .limit(1)
      .then(({ data }) => {
        if (data && data[0]) {
          setEngramId(data[0].id)
          setEngramDescription(data[0].description)
        }
      })
  }, [engramSlug])

  useEffect(() => {
    if (!nodeMenu) return
    const close = () => setNodeMenu(null)
    window.addEventListener("click", close)
    return () => window.removeEventListener("click", close)
  }, [nodeMenu])

  const { data: graphData, loading, error: graphError } = useGraphData(engramId)
  const positions = useForceLayout(graphData, 1200, 800)

  // Compute which nodes pass the filter
  const nodeVisible = useMemo(() => {
    if (!graphData) return null
    const vis = new Uint8Array(graphData.nodes.length)
    const q = graphFilters.searchQuery.toLowerCase()

    for (let i = 0; i < graphData.nodes.length; i++) {
      const n = graphData.nodes[i]
      const typeOk = graphFilters.types.size === 0 || graphFilters.types.has(n.articleType)
      const confOk = n.confidence >= graphFilters.minConfidence
      const searchOk = !q || n.title.toLowerCase().includes(q) || n.tags.some(t => t.toLowerCase().includes(q))
      vis[i] = (typeOk && confOk && searchOk) ? 1 : 0
    }
    return vis
  }, [graphData, graphFilters])

  const visibleNodeCount = nodeVisible ? nodeVisible.reduce((s, v) => s + v, 0) : (graphData?.nodes.length ?? 0)

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
      <WidgetPanelProvider>
      <div
        className="w-full h-full flex flex-col items-center justify-center relative"
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={handleDrop}
      >
        {dropping && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-void/60 pointer-events-none">
            <p className="text-sm text-text-secondary">Drop to feed.</p>
          </div>
        )}
        {dropMessage && !dropping && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
            <p className="text-xs font-mono text-agent-active bg-surface/90 backdrop-blur-md border border-border px-4 py-2 rounded-sm">{dropMessage}</p>
          </div>
        )}
        <p className="text-text-secondary text-sm">Nothing here yet.</p>
        <p className="mt-2 text-sm text-text-tertiary">Paste a URL, drop a file, or click Feed to begin.</p>
        <div className="mt-6 flex gap-3">
          <Link href={`/app/${engramSlug}/feed`} className="bg-surface border border-border-emphasis px-4 py-2 text-xs text-text-secondary hover:text-text-emphasis hover:border-text-tertiary transition-all duration-120">
            Feed a source
          </Link>
          <Link href={`/app/${engramSlug}/ask`} className="bg-surface border border-border px-4 py-2 text-xs text-text-ghost hover:text-text-secondary transition-all duration-120">
            Ask a question
          </Link>
        </div>
        {engramId && <AddSourceButton engramId={engramId} />}
        {engramId && <CompilationToast engramId={engramId} />}
      </div>
      </WidgetPanelProvider>
    )
  }

  return (
    <WidgetPanelProvider>
    <div
      className="w-full h-full relative"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={handleDrop}
    >
      {/* Drop overlay */}
      {dropping && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-void/60 pointer-events-none">
          <p className="text-sm text-text-secondary">Drop to feed.</p>
        </div>
      )}
      {dropMessage && !dropping && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <p className="text-xs font-mono text-agent-active bg-surface/90 backdrop-blur-md border border-border px-4 py-2 rounded-sm">{dropMessage}</p>
        </div>
      )}

      {/* Graph view */}
      {view === "graph" && (
        graphData && positions ? (
          <div className="w-full h-full" style={{ animation: "graph-ignite 1.2s ease-out both" }}>
            <EngineGraph
              data={graphData}
              positions={positions}
              engramSlug={engramSlug}
              onNodeClick={handleNodeClick}
              nodeVisible={nodeVisible}
            />
            <GraphFilters
              filters={graphFilters}
              onChange={setGraphFilters}
              totalNodes={graphData.nodes.length}
              visibleNodes={visibleNodeCount}
            />
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {graphError ? (
              <p className="text-xs font-mono text-danger">{graphError}</p>
            ) : (
              <p className="text-xs font-mono text-text-ghost">Loading<span className="inline-flex w-4"><span className="animate-loading-dots" /></span></p>
            )}
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
                className="w-full bg-transparent text-sm text-text-secondary placeholder:text-text-ghost outline-none pb-3 border-b border-border focus:border-text-tertiary transition-colors duration-120"
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
                                <span key={tag} className="font-mono text-[10px] text-text-ghost border border-border px-2 py-0.5">{tag}</span>
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

      {/* Connect view */}
      {view === "connect" && engramId && (
        <div className="h-full overflow-y-auto scrollbar-hidden bg-void">
          <div className="max-w-[660px] mx-auto px-6 pt-16 pb-32">
            <IntegrationsSection engramId={engramId} engramSlug={engramSlug} />
          </div>
        </div>
      )}

      {/* ── Overlay layout ── */}

      {view === "graph" && engramId && (
        <div className="absolute top-3 left-3 z-30 space-y-2 w-[260px] pointer-events-auto">
          <SourceTree engramId={engramId} engramSlug={engramSlug} />
          <KnowledgeGaps engramId={engramId} engramSlug={engramSlug} />
        </div>
      )}

      <HideWhenPanelOpen>
        <ViewToggle onViewChange={setView} />
        {view === "graph" && engramId && <AddSourceButton engramId={engramId} />}
      </HideWhenPanelOpen>
      {view === "graph" && engramId && <AgentTimeline engramId={engramId} engramSlug={engramSlug} />}
      {view === "graph" && engramId && <AskBar engramId={engramId} engramSlug={engramSlug} />}

      {/* Node context menu */}
      {nodeMenu && (
        <div
          className="fixed z-50 bg-surface-raised border border-border-emphasis min-w-[160px] animate-fade-in"
          style={{ left: nodeMenu.x, top: nodeMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={openArticle}
            className="block w-full text-left px-4 py-2.5 text-xs text-text-secondary hover:text-text-emphasis hover:bg-surface-elevated transition-colors duration-120 cursor-pointer"
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
    </WidgetPanelProvider>
  )
}
