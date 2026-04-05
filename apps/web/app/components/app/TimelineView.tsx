"use client"

import { useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"

interface Snapshot {
  id: string
  snapshotNumber: number
  triggerType: string
  summary: string
  diff: Record<string, unknown>
  createdAt: string
}

interface LegacyEvent {
  timestamp: string
  type: string
  summary: string
}

interface TimelineViewProps {
  snapshots: Snapshot[]
  legacyEvents: LegacyEvent[]
  engramId: string
  engramSlug: string
}

type FilterType = "all" | "feed" | "query_fileback" | "agent" | "rollback"

const typeColors: Record<string, string> = {
  feed: "bg-text-secondary",
  query_fileback: "bg-text-tertiary",
  agent: "bg-agent-active",
  rollback: "bg-danger",
  manual: "bg-text-primary",
}

const typeLabels: Record<string, string> = {
  feed: "FEED",
  query_fileback: "QUERY",
  agent: "AGENT",
  rollback: "ROLLBACK",
  manual: "MANUAL",
}

function formatTime(d: string): string {
  const date = new Date(d)
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " " + date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
}

export default function TimelineView({ snapshots, legacyEvents, engramId, engramSlug }: TimelineViewProps) {
  const router = useRouter()
  const [filter, setFilter] = useState<FilterType>("all")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)

  const useSnapshots = snapshots.length > 0
  const filters: { id: FilterType; label: string }[] = [
    { id: "all", label: "All" },
    { id: "feed", label: "Feeds" },
    { id: "query_fileback", label: "Queries" },
    { id: "agent", label: "Agents" },
    { id: "rollback", label: "Rollbacks" },
  ]

  const filteredSnapshots = filter === "all"
    ? snapshots
    : snapshots.filter(s => s.triggerType === filter)

  const filteredLegacy = filter === "all"
    ? legacyEvents
    : legacyEvents.filter(e => e.type === filter)

  const handleRestore = useCallback(async (snapshotId: string) => {
    if (!confirm("This will restore your engram to this point. A snapshot of the current state will be saved first.")) return
    setRestoring(snapshotId)

    const supabase = createClient()

    // Fetch the snapshot data
    const { data: snapshot } = await supabase
      .from("engram_snapshots")
      .select("data, snapshot_number")
      .eq("id", snapshotId)
      .single()

    if (!snapshot) { setRestoring(null); return }

    const snapData = snapshot.data as { articles: Record<string, unknown>[]; edges: Record<string, unknown>[]; sources: Record<string, unknown>[] }

    // Save current state as rollback snapshot first
    const { data: latest } = await supabase
      .from("engram_snapshots")
      .select("snapshot_number")
      .eq("engram_id", engramId)
      .order("snapshot_number", { ascending: false })
      .limit(1)
      .single()

    const nextNumber = (latest?.snapshot_number ?? 0) + 1

    const [curArticles, curEdges, curSources] = await Promise.all([
      supabase.from("articles").select("*").eq("engram_id", engramId),
      supabase.from("edges").select("*").eq("engram_id", engramId),
      supabase.from("sources").select("*").eq("engram_id", engramId),
    ])

    await supabase.from("engram_snapshots").insert({
      engram_id: engramId,
      snapshot_number: nextNumber,
      trigger_type: "rollback",
      summary: `Rolled back to snapshot #${snapshot.snapshot_number}.`,
      data: { articles: curArticles.data ?? [], edges: curEdges.data ?? [], sources: curSources.data ?? [] },
      diff: {},
    })

    // Delete current articles and edges, then insert from snapshot
    await supabase.from("edges").delete().eq("engram_id", engramId)
    await supabase.from("articles").delete().eq("engram_id", engramId)

    if (snapData.articles?.length > 0) {
      await supabase.from("articles").insert(snapData.articles)
    }
    if (snapData.edges?.length > 0) {
      await supabase.from("edges").insert(snapData.edges)
    }

    // Update engram counts
    await supabase.from("engrams").update({
      article_count: snapData.articles?.length ?? 0,
    }).eq("id", engramId)

    setRestoring(null)
    router.refresh()
  }, [engramId, router])

  // Empty state
  if (!useSnapshots && legacyEvents.length === 0) {
    return <p className="text-sm text-text-secondary">No activity yet.</p>
  }

  return (
    <div>
      {/* Filters */}
      {useSnapshots && (
        <div className="flex gap-2 mb-8">
          {filters.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 transition-colors duration-120 cursor-pointer ${
                filter === f.id ? "text-text-emphasis bg-surface-raised" : "text-text-ghost hover:text-text-tertiary"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Now marker */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-[72px] text-right">
          <span className="text-[10px] font-mono text-text-ghost">now</span>
        </div>
        <div className="relative">
          <div className="w-1.5 h-1.5 rounded-full bg-text-emphasis" />
        </div>
        <span className="text-[10px] font-mono text-text-ghost">{formatTime(new Date().toISOString())}</span>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-[78px] top-0 bottom-0 w-px bg-border-emphasis" />

        <div className="space-y-0">
          {useSnapshots ? (
            filteredSnapshots.map((snap) => {
              const isExpanded = expandedId === snap.id
              const diff = snap.diff as { articles_added?: string[]; articles_updated?: { slug: string }[]; articles_removed?: string[]; edges_added?: unknown[]; edges_removed?: unknown[] }

              return (
                <div key={snap.id} className="group">
                  <div
                    className="flex items-start gap-3 py-3 cursor-pointer hover:bg-surface-raised/30 transition-colors duration-120 -mx-3 px-3"
                    onClick={() => setExpandedId(isExpanded ? null : snap.id)}
                  >
                    <span className="text-[10px] font-mono text-text-ghost w-[60px] shrink-0 text-right pt-0.5">
                      {formatTime(snap.createdAt)}
                    </span>
                    <div className="relative mt-1">
                      <div className={`w-1.5 h-1.5 rounded-full ${typeColors[snap.triggerType] ?? "bg-text-ghost"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-text-secondary">{snap.summary}</p>
                      <span className="text-[10px] font-mono text-text-ghost uppercase">{typeLabels[snap.triggerType] ?? snap.triggerType}</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRestore(snap.id) }}
                      className="text-[9px] font-mono text-text-ghost hover:text-danger opacity-0 group-hover:opacity-100 transition-all duration-120 cursor-pointer shrink-0"
                      disabled={restoring === snap.id}
                    >
                      {restoring === snap.id ? "..." : "Restore"}
                    </button>
                  </div>

                  {/* Expanded diff */}
                  {isExpanded && (
                    <div className="ml-[84px] mb-4 pl-3 border-l border-border text-[11px] space-y-1.5" style={{ animation: "fade-in-only 120ms ease-out both" }}>
                      {(diff.articles_added?.length ?? 0) > 0 && (
                        <div>
                          <span className="font-mono text-[9px] text-text-ghost uppercase">Added</span>
                          {diff.articles_added!.map((slug, i) => (
                            <p key={i} className="text-confidence-high">{String(slug).replace(/-/g, " ")}</p>
                          ))}
                        </div>
                      )}
                      {(diff.articles_updated?.length ?? 0) > 0 && (
                        <div>
                          <span className="font-mono text-[9px] text-text-ghost uppercase">Updated</span>
                          {diff.articles_updated!.map((item, i) => (
                            <p key={i} className="text-text-secondary">{(typeof item === "string" ? item : item.slug).replace(/-/g, " ")}</p>
                          ))}
                        </div>
                      )}
                      {(diff.articles_removed?.length ?? 0) > 0 && (
                        <div>
                          <span className="font-mono text-[9px] text-text-ghost uppercase">Removed</span>
                          {diff.articles_removed!.map((slug, i) => (
                            <p key={i} className="text-confidence-low">{String(slug).replace(/-/g, " ")}</p>
                          ))}
                        </div>
                      )}
                      {Object.keys(diff).length === 0 && (
                        <p className="text-text-ghost">No detailed diff available.</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          ) : (
            // Legacy events (pre-snapshot)
            filteredLegacy.map((event, i) => (
              <div key={i} className="flex items-start gap-3 py-3">
                <span className="text-[10px] font-mono text-text-ghost w-[60px] shrink-0 text-right pt-0.5">
                  {formatTime(event.timestamp)}
                </span>
                <div className="relative mt-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${typeColors[event.type] ?? "bg-text-ghost"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-text-secondary">{event.summary}</p>
                  <span className="text-[10px] font-mono text-text-ghost uppercase">{typeLabels[event.type] ?? event.type}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
