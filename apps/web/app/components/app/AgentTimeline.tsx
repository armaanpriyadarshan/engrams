"use client"

import { useEffect, useState, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"

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
    return `rgb(${Math.round(143)},${Math.round(118 + 20 * t)},${Math.round(122 - 4 * t)})`
  }
  const t = (c - 0.5) / 0.5
  return `rgb(${Math.round(143 - 21 * t)},${Math.round(138 + 5 * t)},${Math.round(118)})`
}

function timeAgo(date: string): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function AgentTimeline({ engramId, engramSlug }: { engramId: string; engramSlug: string }) {
  const router = useRouter()
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [articleCount, setArticleCount] = useState(0)
  const [sourceCount, setSourceCount] = useState(0)
  const [avgConfidence, setAvgConfidence] = useState(0)
  const [openQuestions, setOpenQuestions] = useState<string[]>([])
  const [voronoiCells, setVoronoiCells] = useState<{ article: ArticleCell; path: string }[]>([])
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()

    Promise.all([
      supabase.from("compilation_runs").select("id, trigger_type, status, articles_created, articles_updated, started_at").eq("engram_id", engramId).order("started_at", { ascending: false }).limit(5),
      supabase.from("articles").select("slug, title, confidence, content_md, source_ids", { count: "exact" }).eq("engram_id", engramId),
      supabase.from("sources").select("id", { count: "exact" }).eq("engram_id", engramId),
      supabase.from("engrams").select("config").eq("id", engramId).single(),
    ]).then(async ([runsRes, articlesRes, sourcesRes, engramRes]) => {
      if (runsRes.data) {
        setRuns(runsRes.data.map(d => ({
          id: d.id, agent_type: d.trigger_type, status: d.status,
          summary: d.status === "completed" ? `${d.articles_created} created, ${d.articles_updated} updated` : d.status === "running" ? "Compiling..." : d.status,
          started_at: d.started_at,
        })))
      }
      if (articlesRes.count) setArticleCount(articlesRes.count)
      if (articlesRes.data && articlesRes.data.length > 0) {
        setAvgConfidence(articlesRes.data.reduce((s, a) => s + (a.confidence ?? 0), 0) / articlesRes.data.length)

        // Build voronoi heatmap
        const cells: ArticleCell[] = articlesRes.data.map(a => ({
          slug: a.slug,
          title: a.title ?? a.slug,
          confidence: a.confidence ?? 0,
          weight: Math.max((a.content_md ?? "").split(/\s+/).length * Math.max((a.source_ids as string[] ?? []).length, 1), 100),
        }))

        try {
          // @ts-expect-error - no types
          const { voronoiTreemap } = await import("d3-voronoi-treemap")
          // @ts-expect-error - no types
          const { hierarchy } = await import("d3-hierarchy")
          const W = 200, H = 60
          // Rounded rectangle clip path for organic shape
          const r = 8, steps = 8
          const clipPoly: number[][] = []
          // Top-left corner
          for (let i = steps; i >= 0; i--) { const a = Math.PI / 2 + (Math.PI / 2) * (i / steps); clipPoly.push([r + r * Math.cos(a), r + r * Math.sin(a)]) }
          // Top-right corner
          for (let i = steps; i >= 0; i--) { const a = (Math.PI / 2) * (i / steps); clipPoly.push([W - r + r * Math.cos(a), r + r * Math.sin(a)]) }
          // Bottom-right corner
          for (let i = steps; i >= 0; i--) { const a = -(Math.PI / 2) * (1 - i / steps); clipPoly.push([W - r + r * Math.cos(a), H - r + r * Math.sin(a)]) }
          // Bottom-left corner
          for (let i = steps; i >= 0; i--) { const a = Math.PI + (Math.PI / 2) * (i / steps); clipPoly.push([r + r * Math.cos(a), H - r + r * Math.sin(a)]) }
          const root = hierarchy({ children: cells.map(c => ({ ...c, value: c.weight })) })
            .sum((d: { value?: number }) => d.value ?? 0)
          const treemap = voronoiTreemap().clip(clipPoly)
          treemap(root)
          const result: { article: ArticleCell; path: string }[] = []
          for (const leaf of root.leaves()) {
            const polygon = leaf.polygon
            if (!polygon || polygon.length < 3) continue
            result.push({
              article: leaf.data as ArticleCell,
              path: "M" + polygon.map((p: number[]) => `${p[0]},${p[1]}`).join("L") + "Z",
            })
          }
          setVoronoiCells(result)
        } catch { /* silently fail */ }
      }
      if (sourcesRes.count) setSourceCount(sourcesRes.count)
      const questions = (engramRes.data?.config as Record<string, unknown>)?.open_questions
      if (Array.isArray(questions)) setOpenQuestions(questions.slice(0, 3))
    })
  }, [engramId])

  const items = runs

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

  return (
    <div className="absolute top-3 right-3 z-30 max-w-[200px] pointer-events-auto space-y-2 animate-slide-in-right" style={{ animationDelay: "300ms" }}>
      {/* Activity */}
      <div className="bg-surface/80 backdrop-blur-md border border-border rounded-sm px-3 py-2.5">
        <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Activity</span>
        <div className="mt-2 space-y-1.5">
          {items.length === 0 ? (
            <p className="font-mono text-[10px] text-text-ghost">No activity yet.</p>
          ) : items.map((r) => (
            <div key={r.id} className="flex items-start gap-2">
              <div className={`w-1 h-1 rounded-full mt-1 shrink-0 ${statusColor(r.status)}`} />
              <div className="min-w-0">
                <span className="font-mono text-[10px] text-text-tertiary block truncate">
                  {typeLabel[r.agent_type] ?? r.agent_type} &middot; {r.summary}
                </span>
                <span className="font-mono text-[9px] text-text-ghost">{timeAgo(r.started_at)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="bg-surface/80 backdrop-blur-md border border-border rounded-sm px-3 py-2.5">
        <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Stats</span>

        {/* Stats — numbers on top, labels below */}
        <div className="mt-2 flex justify-between text-center">
          <div>
            <span className="block font-mono text-sm text-text-emphasis">{articleCount}</span>
            <span className="font-mono text-[8px] text-text-ghost">articles</span>
          </div>
          <div>
            <span className="block font-mono text-sm text-text-emphasis">{sourceCount}</span>
            <span className="font-mono text-[8px] text-text-ghost">sources</span>
          </div>
          <div>
            <span className={`block font-mono text-sm ${confColor}`}>
              {avgConfidence > 0 ? `${(avgConfidence * 100).toFixed(0)}%` : "—"}
            </span>
            <span className="font-mono text-[8px] text-text-ghost">avg conf</span>
          </div>
        </div>

        {/* Confidence heatmap */}
        {voronoiCells.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[8px] font-mono text-text-ghost">Confidence</span>
              <div className="relative group/info">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-ghost group-hover/info:text-text-tertiary transition-colors duration-120 cursor-pointer">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <div className="absolute right-0 top-4 z-50 w-44 bg-surface-raised border border-border p-2 text-[9px] text-text-secondary leading-relaxed opacity-0 pointer-events-none group-hover/info:opacity-100 group-hover/info:pointer-events-auto transition-opacity duration-120">
                  Each cell is an article. Size reflects depth. Color shows confidence: warm = lower, cool = higher.
                </div>
              </div>
            </div>
            <div className="relative">
              <svg viewBox="0 0 200 60" className="w-full" style={{ height: "60px" }}>
                {voronoiCells.map(({ article, path }) => (
                  <path
                    key={article.slug}
                    d={path}
                    fill={confidenceColor(article.confidence)}
                    fillOpacity={hoveredSlug === article.slug ? 0.8 : 0.35}
                    stroke={hoveredSlug === article.slug ? "var(--color-border-emphasis)" : "var(--color-border)"}
                    strokeWidth={hoveredSlug === article.slug ? "1" : "0.5"}
                    className="cursor-pointer"
                    style={{ transition: "fill-opacity 120ms ease-out, stroke 120ms ease-out, stroke-width 120ms ease-out" }}
                    onMouseEnter={() => setHoveredSlug(article.slug)}
                    onMouseLeave={() => setHoveredSlug(null)}
                    onClick={() => router.push(`/app/${engramSlug}/article/${article.slug}`)}
                  />
                ))}
              </svg>
            </div>
            {hoveredSlug && (() => {
              const cell = voronoiCells.find(c => c.article.slug === hoveredSlug)
              if (!cell) return null
              return (
                <p className="mt-1 text-[8px] font-mono text-text-tertiary truncate">
                  {cell.article.title} · {Math.round(cell.article.confidence * 100)}%
                </p>
              )
            })()}
          </div>
        )}

        {/* Open questions */}
        {openQuestions.length > 0 && (
          <div className="mt-2.5 pt-2 border-t border-border">
            <span className="text-[8px] font-mono text-text-ghost">Open questions</span>
            <div className="mt-1 space-y-1">
              {openQuestions.map((q, i) => (
                <p key={i} className="text-[10px] text-text-tertiary leading-tight">
{q}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
