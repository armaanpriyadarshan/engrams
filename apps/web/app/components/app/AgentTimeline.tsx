"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { WidgetPanel } from "./WidgetPanel"
import VoronoiHeatmap from "./VoronoiHeatmap"

interface AgentRun {
  id: string
  agent_type: string
  status: string
  summary: string | null
  detail: Record<string, unknown> | null
  started_at: string
  finished_at?: string | null
  duration_ms?: number | null
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

// htop-style duration: ticks while running, frozen once finished.
function formatDuration(run: AgentRun, nowMs: number): string {
  let ms: number
  if (run.status === "running") {
    ms = nowMs - new Date(run.started_at).getTime()
  } else if (typeof run.duration_ms === "number") {
    ms = run.duration_ms
  } else {
    return ""
  }
  if (ms < 0) ms = 0
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem === 0 ? `${m}m` : `${m}m${rem}s`
}

// Pulls a short "target" string from the run's detail jsonb. Different
// agent_types populate different keys, so we try a cascade of known names.
function getTarget(run: AgentRun): string {
  const d = (run.detail ?? {}) as Record<string, unknown>
  const candidates = [
    d.source_title,
    d.article_title,
    d.filename,
    d.service_name,
    d.question,
    d.engram_name,
  ]
  for (const v of candidates) {
    if (typeof v === "string" && v.length > 0) return v
  }
  return run.agent_type
}

const AGENT_TYPE_SHORT: Record<string, string> = {
  compile: "compile",
  lint: "lint",
  gaps: "gaps",
  embed: "embed",
  sync: "sync",
  parse_file: "parse",
  user_edit: "edit",
  ask: "ask",
}

// For sorting: running runs pinned to the top, then newest-first.
function sortByState(runs: AgentRun[]): AgentRun[] {
  return [...runs].sort((a, b) => {
    if (a.status === "running" && b.status !== "running") return -1
    if (b.status === "running" && a.status !== "running") return 1
    return new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  })
}

export default function AgentTimeline({ engramId, engramSlug }: { engramId: string; engramSlug: string }) {
  const router = useRouter()
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [allRuns, setAllRuns] = useState<AgentRun[]>([])
  const [sourceCount, setSourceCount] = useState(0)
  const [edgeCount, setEdgeCount] = useState(0)
  const [avgConfidence, setAvgConfidence] = useState(0)
  const [openQuestions, setOpenQuestions] = useState<string[]>([])
  const [voronoiCells, setVoronoiCells] = useState<{ article: ArticleCell; path: string }[]>([])
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null)
  const [articles, setArticles] = useState<{ slug: string; title: string; confidence: number; wordCount: number; sourceCount: number }[]>([])
  // Ticks every second ONLY while at least one run is in the running
  // state, so running durations visibly climb like htop but idle widgets
  // don't re-render pointlessly.
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  const hasRunning = runs.some((r) => r.status === "running") || allRuns.some((r) => r.status === "running")
  useEffect(() => {
    if (!hasRunning) return
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [hasRunning])

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from("agent_runs").select("id, agent_type, status, summary, detail, started_at").eq("engram_id", engramId).order("started_at", { ascending: false }).limit(5),
      supabase.from("agent_runs").select("id, agent_type, status, summary, detail, started_at").eq("engram_id", engramId).order("started_at", { ascending: false }).limit(50),
      supabase.from("articles").select("slug, title, confidence, content_md, source_ids", { count: "exact" }).eq("engram_id", engramId),
      supabase.from("sources").select("id", { count: "exact" }).eq("engram_id", engramId),
      supabase.from("edges").select("id", { count: "exact" }).eq("engram_id", engramId),
      supabase.from("engrams").select("config").eq("id", engramId).single(),
    ]).then(async ([runsRes, allRunsRes, articlesRes, sourcesRes, edgesRes, engramRes]) => {
      const mapRun = (d: AgentRun): AgentRun => ({
        id: d.id,
        agent_type: d.agent_type,
        status: d.status,
        summary: d.summary ?? (d.status === "running" ? "Running..." : d.status),
        detail: d.detail,
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

  // Live-subscribe to agent_runs so new/updated rows stream into the widget
  useEffect(() => {
    if (!engramId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`agent-runs-${engramId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agent_runs", filter: `engram_id=eq.${engramId}` },
        (payload) => {
          const row = payload.new as AgentRun
          setRuns((prev) => [row, ...prev].slice(0, 5))
          setAllRuns((prev) => [row, ...prev].slice(0, 50))
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "agent_runs", filter: `engram_id=eq.${engramId}` },
        (payload) => {
          const row = payload.new as AgentRun
          setRuns((prev) => prev.map((r) => r.id === row.id ? row : r))
          setAllRuns((prev) => prev.map((r) => r.id === row.id ? row : r))
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [engramId])

  const typeLabel: Record<string, string> = {
    compile: "Compiled",
    lint: "Linted",
    gaps: "Checked gaps",
    embed: "Indexed",
    sync: "Synced",
    parse_file: "Parsed",
    user_edit: "Edited",
    ask: "Asked",
  }
  const stratigraphyStatusColor = (s: string) =>
    s === "completed" ? "bg-confidence-high"
      : s === "running" ? "bg-agent-active"
        : s === "failed" ? "bg-danger"
          : "bg-text-ghost"
  const confColor = avgConfidence > 0.8 ? "text-confidence-high" : avgConfidence > 0.5 ? "text-confidence-mid" : "text-confidence-low"

  // Split runs by state so the preview and expanded view can render
  // "active" (running) above "recent" (completed/failed).
  const activePreview = runs.filter((r) => r.status === "running")
  const recentPreview = runs.filter((r) => r.status !== "running").slice(0, 4)
  const activeAll = allRuns.filter((r) => r.status === "running")
  const recentAll = allRuns.filter((r) => r.status !== "running")
  const runningCount = allRuns.filter((r) => r.status === "running").length

  // Active process card — visually prominent. Left accent bar in
  // agent-active color, two-line layout (type + duration on top,
  // target on the second line), subtle pulse on the dot.
  const renderActiveCard = (r: AgentRun, expanded: boolean) => {
    const type = AGENT_TYPE_SHORT[r.agent_type] ?? r.agent_type
    const target = getTarget(r)
    const duration = formatDuration(r, nowMs)
    return (
      <div
        key={r.id}
        className={`relative border-l-2 border-agent-active pl-3 ${expanded ? "py-1.5" : "py-1"}`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-1 h-1 rounded-full bg-agent-active animate-pulse shrink-0" />
            <span className={`font-mono uppercase tracking-wider ${expanded ? "text-[10px]" : "text-[9px]"} text-text-emphasis`}>
              {type}
            </span>
          </div>
          {duration && (
            <span className={`font-mono text-agent-active tabular-nums shrink-0 ${expanded ? "text-[10px]" : "text-[9px]"}`}>
              {duration}
            </span>
          )}
        </div>
        <p className={`font-mono ${expanded ? "text-[11px]" : "text-[10px]"} text-text-secondary truncate leading-tight mt-0.5`}>
          {target !== r.agent_type ? target : "working..."}
        </p>
      </div>
    )
  }

  // Stratigraphy row — chronological timeline with a vertical rail
  // and a status dot per row. Used for completed/failed runs.
  const renderStratigraphyRow = (r: AgentRun, expanded: boolean) => {
    const errorDetail = (r.detail as { error?: string } | null)?.error
    const isFailed = r.status === "failed"
    return (
      <div key={r.id} className={`relative ${expanded ? "pb-4" : "pb-2.5"} last:pb-0`}>
        <div className={`absolute -left-4 top-[5px] w-1.5 h-1.5 rounded-full ${stratigraphyStatusColor(r.status)}`} style={{ transform: "translateX(-50%)" }} />
        <p
          className={`${expanded ? "text-[11px]" : "text-[10px]"} leading-tight ${isFailed ? "text-danger" : "text-text-secondary"} truncate`}
          title={errorDetail ?? undefined}
        >
          <span className="text-text-tertiary">{typeLabel[r.agent_type] ?? r.agent_type}</span>
          {" · "}
          {r.summary}
        </p>
        <span className={`font-mono ${expanded ? "text-[10px]" : "text-[9px]"} text-text-ghost`}>
          {timeAgo(r.started_at)}
        </span>
      </div>
    )
  }

  const activityPreview = (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Activity</span>
        <span className="text-[9px] font-mono text-text-ghost tabular-nums">
          {runningCount > 0 ? `${runningCount} active` : allRuns.length}
        </span>
      </div>
      {activePreview.length === 0 && recentPreview.length === 0 ? (
        <p className="mt-2 font-mono text-[10px] text-text-ghost">idle</p>
      ) : (
        <>
          {activePreview.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {activePreview.slice(0, 3).map((r) => renderActiveCard(r, false))}
            </div>
          )}
          {recentPreview.length > 0 && (
            <div className={`${activePreview.length > 0 ? "mt-3 pt-3 border-t border-border" : "mt-2"} relative pl-4`}>
              <div className="absolute left-0 top-1 bottom-1 w-px bg-border" />
              {recentPreview.map((r) => renderStratigraphyRow(r, false))}
            </div>
          )}
        </>
      )}
    </div>
  )

  const statsPreview = (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Stats</span>
        <span className="text-[9px] font-mono text-text-ghost tabular-nums">{articles.length}</span>
      </div>
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
    </div>
  )

  // Activity widget sits at top-right, Stats widget sits below it (~120px down)
  return (
    <div className="absolute top-3 right-3 z-30 space-y-2 w-[200px] pointer-events-auto" style={{ animationDelay: "300ms" }}>
      <WidgetPanel
        id="activity"
        className="border-r-border-emphasis"
        preview={activityPreview}
      >
        <div className="flex items-center gap-2 mb-5">
          <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Activity</span>
          <span className="text-[9px] font-mono text-text-ghost tabular-nums">
            {runningCount > 0 ? `${runningCount} active · ${allRuns.length}` : allRuns.length}
          </span>
        </div>

        {allRuns.length === 0 ? (
          <p className="text-sm text-text-secondary">idle</p>
        ) : (
          <div className="space-y-5">
            {/* Active section */}
            {activeAll.length > 0 && (
              <div>
                <span className="text-[9px] font-mono text-text-ghost tracking-wider uppercase">Active</span>
                <div className="mt-2 space-y-2">
                  {activeAll.map((r) => renderActiveCard(r, true))}
                </div>
              </div>
            )}

            {/* Recent stratigraphy */}
            {recentAll.length > 0 && (
              <div>
                <span className="text-[9px] font-mono text-text-ghost tracking-wider uppercase block mb-2">Recent</span>
                <div className="relative pl-4">
                  <div className="absolute left-0 top-1 bottom-1 w-px bg-border-emphasis" />
                  {recentAll.map((r) => renderStratigraphyRow(r, true))}
                </div>
              </div>
            )}
          </div>
        )}
      </WidgetPanel>

      <WidgetPanel
        id="stats"
        className="border-r-border-emphasis"
        preview={statsPreview}
      >
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Stats</span>
          <span className="text-[9px] font-mono text-text-ghost tabular-nums">{articles.length}</span>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3">
          <div className="border border-border p-3"><div className="font-mono text-lg text-text-emphasis">{sourceCount}</div><div className="text-[9px] font-mono text-text-ghost uppercase mt-0.5">Sources</div></div>
          <div className="border border-border p-3"><div className="font-mono text-lg text-text-emphasis">{edgeCount}</div><div className="text-[9px] font-mono text-text-ghost uppercase mt-0.5">Links</div></div>
          <div className="border border-border p-3"><div className={`font-mono text-lg ${confColor}`}>{avgConfidence > 0 ? `${(avgConfidence * 100).toFixed(0)}%` : "—"}</div><div className="text-[9px] font-mono text-text-ghost uppercase mt-0.5">Avg conf</div></div>
        </div>
        {articles.length > 0 && <div className="mt-6"><VoronoiHeatmap articles={articles} engramSlug={engramSlug} /></div>}
        {articles.length > 0 && (
          <div className="mt-6 pt-4 border-t border-border">
            <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Articles</span>
            <div className="mt-3 space-y-1">
              {articles.sort((a, b) => b.confidence - a.confidence).map(a => (
                <Link
                  key={a.slug}
                  href={`/app/${engramSlug}/article/${a.slug}`}
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center justify-between py-1.5 text-xs text-text-secondary hover:text-text-emphasis transition-colors duration-120"
                >
                  <span className="truncate">{a.title}</span>
                  <span className="text-[10px] font-mono text-text-ghost shrink-0 ml-2">{Math.round(a.confidence * 100)}%</span>
                </Link>
              ))}
            </div>
          </div>
        )}
        {openQuestions.length > 0 && (
          <div className="mt-6 pt-4 border-t border-border">
            <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Open questions</span>
            <div className="mt-3 space-y-2">{openQuestions.map((q, i) => <p key={i} className="text-xs text-text-secondary leading-relaxed">{q}</p>)}</div>
          </div>
        )}
      </WidgetPanel>
    </div>
  )
}
