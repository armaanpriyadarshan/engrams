"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

interface AgentRun {
  id: string
  agent_type: string
  status: string
  summary: string | null
  started_at: string
}

function timeAgo(date: string): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function AgentTimeline({ engramId }: { engramId: string }) {
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [articleCount, setArticleCount] = useState(0)
  const [sourceCount, setSourceCount] = useState(0)
  const [avgConfidence, setAvgConfidence] = useState(0)
  const [confBuckets, setConfBuckets] = useState<number[]>([0, 0, 0, 0, 0])
  const [openQuestions, setOpenQuestions] = useState<string[]>([])

  useEffect(() => {
    const supabase = createClient()

    supabase
      .from("compilation_runs")
      .select("id, trigger_type, status, articles_created, articles_updated, started_at")
      .eq("engram_id", engramId)
      .order("started_at", { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (data) {
          setRuns(data.map(d => ({
            id: d.id,
            agent_type: d.trigger_type,
            status: d.status,
            summary: d.status === "completed"
              ? `${d.articles_created} created, ${d.articles_updated} updated`
              : d.status === "running" ? "Compiling..." : d.status,
            started_at: d.started_at,
          })))
        }
      })

    supabase.from("articles").select("confidence", { count: "exact" }).eq("engram_id", engramId)
      .then(({ data, count }) => {
        if (count) setArticleCount(count)
        if (data && data.length > 0) {
          setAvgConfidence(data.reduce((s, a) => s + (a.confidence ?? 0), 0) / data.length)
          // Confidence distribution: 5 buckets [0-0.2, 0.2-0.4, 0.4-0.6, 0.6-0.8, 0.8-1.0]
          const buckets = [0, 0, 0, 0, 0]
          data.forEach(a => {
            const idx = Math.min(Math.floor((a.confidence ?? 0) * 5), 4)
            buckets[idx]++
          })
          setConfBuckets(buckets)
        }
      })

    supabase.from("sources").select("id", { count: "exact" }).eq("engram_id", engramId)
      .then(({ count }) => { if (count) setSourceCount(count) })

    // Open questions from engram config
    supabase.from("engrams").select("config").eq("id", engramId).single()
      .then(({ data }) => {
        const questions = (data?.config as Record<string, unknown>)?.open_questions
        if (Array.isArray(questions)) setOpenQuestions(questions.slice(0, 3))
      })
  }, [engramId])

  const items = runs.length > 0 ? runs : [
    { id: "p1", agent_type: "compiler", status: "completed", summary: "4 articles created", started_at: new Date(Date.now() - 120000).toISOString() },
    { id: "p2", agent_type: "linter", status: "completed", summary: "1 gap found", started_at: new Date(Date.now() - 3600000).toISOString() },
    { id: "p3", agent_type: "feed", status: "completed", summary: "2 sources ingested", started_at: new Date(Date.now() - 10800000).toISOString() },
  ]

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
    <div className="absolute top-3 right-3 z-30 max-w-[200px] pointer-events-auto space-y-2">
      {/* Activity */}
      <div className="bg-surface/80 backdrop-blur-md border border-border rounded-sm px-3 py-2.5">
        <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Activity</span>
        <div className="mt-2 space-y-1.5">
          {items.map((r) => (
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

      {/* Health */}
      <div className="bg-surface/80 backdrop-blur-md border border-border rounded-sm px-3 py-2.5">
        <span className="text-[9px] font-mono text-text-ghost tracking-widest uppercase">Health</span>

        {/* Stat boxes */}
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <div className="border border-border rounded-sm px-2 py-1.5 text-center">
            <span className="block font-mono text-sm text-text-emphasis">{articleCount}</span>
            <span className="font-mono text-[8px] text-text-ghost">articles</span>
          </div>
          <div className="border border-border rounded-sm px-2 py-1.5 text-center">
            <span className="block font-mono text-sm text-text-emphasis">{sourceCount}</span>
            <span className="font-mono text-[8px] text-text-ghost">sources</span>
          </div>
          <div className="border border-border rounded-sm px-2 py-1.5 text-center">
            <span className={`block font-mono text-sm ${confColor}`}>
              {avgConfidence > 0 ? `${(avgConfidence * 100).toFixed(0)}%` : "—"}
            </span>
            <span className="font-mono text-[8px] text-text-ghost">avg conf</span>
          </div>
        </div>

        {/* Confidence distribution */}
        <div className="mt-2.5">
          <span className="text-[8px] font-mono text-text-ghost">Confidence distribution</span>
          <div className="flex gap-px mt-1 h-3">
            {confBuckets.map((count, i) => {
              const colors = ["bg-confidence-low", "bg-confidence-low", "bg-confidence-mid", "bg-confidence-mid", "bg-confidence-high"]
              const maxCount = Math.max(...confBuckets, 1)
              return (
                <div key={i} className="flex-1 flex flex-col justify-end">
                  <div
                    className={`${colors[i]} rounded-[1px] transition-all duration-500`}
                    style={{ height: `${(count / maxCount) * 100}%`, minHeight: count > 0 ? 1 : 0 }}
                  />
                </div>
              )
            })}
          </div>
          <div className="flex justify-between mt-0.5">
            <span className="text-[7px] font-mono text-text-ghost">0</span>
            <span className="text-[7px] font-mono text-text-ghost">1</span>
          </div>
        </div>

        {/* Open questions */}
        {openQuestions.length > 0 && (
          <div className="mt-2.5 pt-2 border-t border-border">
            <span className="text-[8px] font-mono text-text-ghost">Open questions</span>
            <div className="mt-1 space-y-1">
              {openQuestions.map((q, i) => (
                <p key={i} className="text-[10px] text-text-tertiary leading-tight">{q}</p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
