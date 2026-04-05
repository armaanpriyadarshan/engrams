"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { usePanelContext } from "./WidgetPanel"
import VoronoiHeatmap from "./VoronoiHeatmap"

interface AgentRun {
  id: string
  agent_type: string
  status: string
  summary: string | null
  started_at: string
}

interface ArticleCell {
  slug: string
  title: string
  confidence: number
  weight: number
}

function confidenceColor(c: number): string {
  if (c < 0.5) {
    const t = c / 0.5
    return `rgb(${Math.round(180 - 30 * t)},${Math.round(90 + 60 * t)},${Math.round(95 - 10 * t)})`
  }
  const t = (c - 0.5) / 0.5
  return `rgb(${Math.round(150 - 60 * t)},${Math.round(150 + 30 * t)},${Math.round(85 + 40 * t)})`
}

function timeAgo(date: string): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function FullWindowPanel({ isOpen, close, children }: { isOpen: boolean; close: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-40"
      style={{ opacity: isOpen ? 1 : 0, pointerEvents: isOpen ? "auto" : "none", transition: "opacity 250ms cubic-bezier(0.16, 1, 0.3, 1)" }}
    >
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={close} />
      <div
        className="absolute inset-0 flex items-stretch justify-center"
        style={{ transform: isOpen ? "scale(1)" : "scale(0.97)", transition: "transform 250ms cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        <div className="w-full max-w-3xl h-full overflow-y-auto scrollbar-hidden relative">
          <div className="sticky top-0 z-10 flex justify-end p-4">
            <button onClick={close} className="bg-surface/80 backdrop-blur-md border border-border rounded-sm p-2 text-text-ghost hover:text-text-tertiary transition-colors duration-120 cursor-pointer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
          <div className="px-6 pb-12">{children}</div>
        </div>
      </div>
    </div>
  )
}

export default function AgentTimeline({ engramId, engramSlug }: { engramId: string; engramSlug: string }) {
  const router = useRouter()
  const { openId, toggle, close } = usePanelContext()
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [allRuns, setAllRuns] = useState<AgentRun[]>([])
  const [sourceCount, setSourceCount] = useState(0)
  const [edgeCount, setEdgeCount] = useState(0)
  const [avgConfidence, setAvgConfidence] = useState(0)
  const [openQuestions, setOpenQuestions] = useState<string[]>([])
  const [voronoiCells, setVoronoiCells] = useState<{ article: ArticleCell; path: string }[]>([])
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null)
  const [articles, setArticles] = useState<{ slug: string; title: string; confidence: number; wordCount: number; sourceCount: number }[]>([])

  useEffect(() => {
    const supabase = createClient()

    Promise.all([
      supabase.from("compilation_runs").select("id, trigger_type, status, articles_created, articles_updated, started_at").eq("engram_id", engramId).order("started_at", { ascending: false }).limit(5),
      supabase.from("compilation_runs").select("id, trigger_type, status, articles_created, articles_updated, started_at").eq("engram_id", engramId).order("started_at", { ascending: false }).limit(50),
      supabase.from("articles").select("slug, title, confidence, content_md, source_ids", { count: "exact" }).eq("engram_id", engramId),
      supabase.from("sources").select("id", { count: "exact" }).eq("engram_id", engramId),
      supabase.from("edges").select("id", { count: "exact" }).eq("engram_id", engramId),
      supabase.from("engrams").select("config").eq("id", engramId).single(),
    ]).then(async ([runsRes, allRunsRes, articlesRes, sourcesRes, edgesRes, engramRes]) => {
      const mapRun = (d: any) => ({
        id: d.id, agent_type: d.trigger_type, status: d.status,
        summary: d.status === "completed" ? `${d.articles_created} created, ${d.articles_updated} updated` : d.status === "running" ? "Compiling..." : d.status,
        started_at: d.started_at,
      })
      if (runsRes.data) setRuns(runsRes.data.map(mapRun))
      if (allRunsRes.data) setAllRuns(allRunsRes.data.map(mapRun))

      if (articlesRes.data && articlesRes.data.length > 0) {
        setAvgConfidence(articlesRes.data.reduce((s, a) => s + (a.confidence ?? 0), 0) / articlesRes.data.length)
        setArticles(articlesRes.data.map(a => ({
          slug: a.slug, title: a.title ?? a.slug, confidence: a.confidence ?? 0,
          wordCount: (a.content_md ?? "").split(/\s+/).length,
          sourceCount: (a.source_ids as string[] ?? []).length,
        })))

        // Build voronoi heatmap for preview
        const cells: ArticleCell[] = articlesRes.data.map(a => ({
          slug: a.slug, title: a.title ?? a.slug, confidence: a.confidence ?? 0,
          weight: Math.max((a.content_md ?? "").split(/\s+/).length * Math.max((a.source_ids as string[] ?? []).length, 1), 100),
        }))

        try {
          // @ts-expect-error - no types
          const { voronoiTreemap } = await import("d3-voronoi-treemap")
          // @ts-expect-error - no types
          const { hierarchy } = await import("d3-hierarchy")
          const W = 200, H = 60, r = 8, steps = 8
          const clipPoly: number[][] = []
          for (let i = steps; i >= 0; i--) { const a = Math.PI / 2 + (Math.PI / 2) * (i / steps); clipPoly.push([r + r * Math.cos(a), r + r * Math.sin(a)]) }
          for (let i = steps; i >= 0; i--) { const a = (Math.PI / 2) * (i / steps); clipPoly.push([W - r + r * Math.cos(a), r + r * Math.sin(a)]) }
          for (let i = steps; i >= 0; i--) { const a = -(Math.PI / 2) * (1 - i / steps); clipPoly.push([W - r + r * Math.cos(a), H - r + r * Math.sin(a)]) }
          for (let i = steps; i >= 0; i--) { const a = Math.PI + (Math.PI / 2) * (i / steps); clipPoly.push([r + r * Math.cos(a), H - r + r * Math.sin(a)]) }
          const root = hierarchy({ children: cells.map(c => ({ ...c, value: c.weight })) }).sum((d: { value?: number }) => d.value ?? 0)
          voronoiTreemap().clip(clipPoly)(root)
          const result: { article: ArticleCell; path: string }[] = []
          for (const leaf of root.leaves()) {
            const polygon = leaf.polygon
            if (!polygon || polygon.length < 3) continue
            result.push({ article: leaf.data as ArticleCell, path: "M" + polygon.map((p: number[]) => `${p[0]},${p[1]}`).join("L") + "Z" })
          }
          setVoronoiCells(result)
        } catch { /* silently fail */ }
      }
      if (sourcesRes.count) setSourceCount(sourcesRes.count)
      if (edgesRes.count) setEdgeCount(edgesRes.count)
      const questions = (engramRes.data?.config as Record<string, unknown>)?.open_questions
      if (Array.isArray(questions)) setOpenQuestions(questions.slice(0, 3))
    })
  }, [engramId])

  const typeLabel: Record<string, string> = {
    feed: "Fed", compiler: "Compiled", linter: "Linted", freshener: "Freshened",
    discoverer: "Discovered", deep: "Deep compile", targeted: "Targeted", lint: "Linted",
  }

  const statusColor = (status: string) => {
    if (status === "completed") return "bg-confidence-high"
    if (status === "running") return "bg-agent-active"
    if (status === "failed") return "bg-danger"
    return "bg-text-ghost"
  }

  const confColor = avgConfidence > 0.8 ? "text-confidence-high" : avgConfidence > 0.5 ? "text-confidence-mid" : "text-confidence-low"
  const anyOpen = openId !== null

  return (
    <>
      {/* Preview widgets — clicking anywhere opens the panel */}
      <div
        className="absolute top-3 right-3 z-30 max-w-[200px] pointer-events-auto space-y-2 animate-slide-in-right"
        style={{
          animationDelay: "300ms",
          opacity: anyOpen ? 0 : 1,
          pointerEvents: anyOpen ? "none" : "auto",
          transition: "opacity 180ms ease-out",
        }}
      >
        {/* Activity preview — entire card clickable */}
        <div onClick={() => toggle("activity")} className="bg-surface/80 backdrop-blur-md border border-border rounded-sm px-3 py-2.5 cursor-pointer">
          <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Activity</span>
          <div className="mt-2 space-y-1.5">
            {runs.length === 0 ? (
              <p className="font-mono text-[10px] text-text-ghost">No activity yet.</p>
            ) : runs.map((r) => (
              <div key={r.id} className="flex items-start gap-2">
                <div className={`w-1 h-1 rounded-full mt-1 shrink-0 ${statusColor(r.status)}`} />
                <div className="min-w-0">
                  <span className="font-mono text-[10px] text-text-tertiary block truncate">{typeLabel[r.agent_type] ?? r.agent_type} &middot; {r.summary}</span>
                  <span className="font-mono text-[9px] text-text-ghost">{timeAgo(r.started_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Stats preview — entire card clickable */}
        <div onClick={() => toggle("stats")} className="bg-surface/80 backdrop-blur-md border border-border rounded-sm px-3 py-2.5 cursor-pointer">
          <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Stats</span>
          <div className="mt-2 flex justify-between text-center">
            <div><span className="block font-mono text-sm text-text-emphasis">{sourceCount}</span><span className="font-mono text-[8px] text-text-ghost">sources</span></div>
            <div><span className="block font-mono text-sm text-text-emphasis">{edgeCount}</span><span className="font-mono text-[8px] text-text-ghost">links</span></div>
            <div><span className={`block font-mono text-sm ${confColor}`}>{avgConfidence > 0 ? `${(avgConfidence * 100).toFixed(0)}%` : "—"}</span><span className="font-mono text-[8px] text-text-ghost">avg conf</span></div>
          </div>
          {voronoiCells.length > 0 && (
            <div className="mt-3">
              <span className="text-[8px] font-mono text-text-ghost">Confidence</span>
              <svg viewBox="0 0 200 60" className="w-full mt-1.5" style={{ height: "60px" }}>
                {voronoiCells.map(({ article, path }) => (
                  <path key={article.slug} d={path} fill={confidenceColor(article.confidence)}
                    fillOpacity={hoveredSlug === article.slug ? 0.9 : 0.55}
                    stroke={hoveredSlug === article.slug ? "var(--color-border-emphasis)" : "var(--color-border)"}
                    strokeWidth={hoveredSlug === article.slug ? "1" : "0.5"}
                    style={{ transition: "fill-opacity 120ms ease-out, stroke 120ms ease-out" }}
                    onMouseEnter={(e) => { e.stopPropagation(); setHoveredSlug(article.slug) }}
                    onMouseLeave={() => setHoveredSlug(null)}
                  />
                ))}
              </svg>
              {hoveredSlug && (() => {
                const cell = voronoiCells.find(c => c.article.slug === hoveredSlug)
                return cell ? <p className="mt-1 text-[8px] font-mono text-text-tertiary truncate">{cell.article.title} · {Math.round(cell.article.confidence * 100)}%</p> : null
              })()}
            </div>
          )}
          {openQuestions.length > 0 && (
            <div className="mt-2.5 pt-2 border-t border-border">
              <span className="text-[8px] font-mono text-text-ghost">Open questions</span>
              <div className="mt-1 space-y-1">
                {openQuestions.map((q, i) => <p key={i} className="text-[10px] text-text-tertiary leading-tight">{q}</p>)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Activity — full window */}
      <FullWindowPanel isOpen={openId === "activity"} close={close}>
        <h2 className="font-heading text-lg text-text-emphasis mb-6">Activity</h2>
        {allRuns.length === 0 ? (
          <p className="text-sm text-text-secondary">No activity yet.</p>
        ) : (
          <div className="relative">
            <div className="absolute left-[2px] top-2 bottom-2 w-px bg-border-emphasis" />
            <div className="space-y-4">
              {allRuns.map((r) => (
                <div key={r.id} className="flex items-start gap-3">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${statusColor(r.status)}`} />
                  <div className="min-w-0">
                    <p className="text-[13px] text-text-secondary">{typeLabel[r.agent_type] ?? r.agent_type} · {r.summary}</p>
                    <span className="text-[10px] font-mono text-text-ghost">{timeAgo(r.started_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </FullWindowPanel>

      {/* Stats — full window */}
      <FullWindowPanel isOpen={openId === "stats"} close={close}>
        <h2 className="font-heading text-lg text-text-emphasis mb-6">Stats</h2>
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="border border-border p-4"><div className="font-mono text-2xl text-text-emphasis">{sourceCount}</div><div className="mt-1 text-[10px] font-mono text-text-ghost uppercase">Sources</div></div>
          <div className="border border-border p-4"><div className="font-mono text-2xl text-text-emphasis">{edgeCount}</div><div className="mt-1 text-[10px] font-mono text-text-ghost uppercase">Links</div></div>
          <div className="border border-border p-4"><div className={`font-mono text-2xl ${confColor}`}>{avgConfidence > 0 ? `${(avgConfidence * 100).toFixed(0)}%` : "—"}</div><div className="mt-1 text-[10px] font-mono text-text-ghost uppercase">Avg conf</div></div>
        </div>
        {articles.length > 0 && <VoronoiHeatmap articles={articles} engramSlug={engramSlug} />}
        {openQuestions.length > 0 && (
          <div className="mt-8">
            <h3 className="text-xs text-text-tertiary uppercase tracking-widest font-mono mb-3">Open questions</h3>
            <div className="space-y-2">
              {openQuestions.map((q, i) => <p key={i} className="text-sm text-text-secondary">{q}</p>)}
            </div>
          </div>
        )}
      </FullWindowPanel>
    </>
  )
}
