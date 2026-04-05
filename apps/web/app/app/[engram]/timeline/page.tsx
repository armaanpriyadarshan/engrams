import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import TimelineView from "@/app/components/app/TimelineView"

export default async function TimelinePage({ params }: { params: Promise<{ engram: string }> }) {
  const { engram: engramSlug } = await params
  const supabase = await createClient()

  const { data: engram } = await supabase
    .from("engrams")
    .select("id")
    .eq("slug", engramSlug)
    .single()

  if (!engram) notFound()

  // Fetch snapshots
  const { data: snapshots } = await supabase
    .from("engram_snapshots")
    .select("id, snapshot_number, trigger_type, summary, diff, created_at")
    .eq("engram_id", engram.id)
    .order("snapshot_number", { ascending: false })

  // Also fetch legacy events (sources, runs, queries) for engrams without snapshots
  const [sourcesResult, runsResult, queriesResult] = await Promise.all([
    supabase.from("sources").select("id, title, source_type, created_at").eq("engram_id", engram.id),
    supabase.from("compilation_runs").select("id, status, articles_created, articles_updated, edges_created, started_at").eq("engram_id", engram.id).eq("status", "completed"),
    supabase.from("queries").select("id, question, created_at").eq("engram_id", engram.id).eq("status", "completed"),
  ])

  const legacyEvents = []
  for (const s of sourcesResult.data ?? []) {
    legacyEvents.push({ timestamp: s.created_at, type: "feed" as const, summary: `Fed: "${s.title ?? s.source_type}"` })
  }
  for (const r of runsResult.data ?? []) {
    const parts: string[] = []
    if (r.articles_created) parts.push(`${r.articles_created} created`)
    if (r.articles_updated) parts.push(`${r.articles_updated} updated`)
    if (r.edges_created) parts.push(`${r.edges_created} connections`)
    legacyEvents.push({ timestamp: r.started_at, type: "feed" as const, summary: `Compiled: ${parts.join(", ") || "no changes"}` })
  }
  for (const q of queriesResult.data ?? []) {
    legacyEvents.push({ timestamp: q.created_at, type: "query_fileback" as const, summary: `Asked: "${q.question}"` })
  }
  legacyEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <h1 className="font-heading text-lg text-text-emphasis mb-8">Timeline</h1>
        <TimelineView
          snapshots={(snapshots ?? []).map(s => ({
            id: s.id,
            snapshotNumber: s.snapshot_number,
            triggerType: s.trigger_type,
            summary: s.summary,
            diff: s.diff as Record<string, unknown>,
            createdAt: s.created_at,
          }))}
          legacyEvents={legacyEvents}
          engramId={engram.id}
          engramSlug={engramSlug}
        />
      </div>
    </div>
  )
}
