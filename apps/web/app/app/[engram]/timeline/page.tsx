import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"

interface TimelineEvent {
  timestamp: string
  type: "feed" | "compile" | "query"
  description: string
}

export default async function TimelinePage({ params }: { params: Promise<{ engram: string }> }) {
  const { engram: engramSlug } = await params
  const supabase = await createClient()

  const { data: engram } = await supabase
    .from("engrams")
    .select("id")
    .eq("slug", engramSlug)
    .single()

  if (!engram) notFound()

  const [sourcesResult, runsResult, queriesResult] = await Promise.all([
    supabase.from("sources").select("id, title, source_type, created_at").eq("engram_id", engram.id),
    supabase.from("compilation_runs").select("id, status, articles_created, articles_updated, edges_created, started_at").eq("engram_id", engram.id).eq("status", "completed"),
    supabase.from("queries").select("id, question, created_at").eq("engram_id", engram.id).eq("status", "completed"),
  ])

  const events: TimelineEvent[] = []

  for (const s of sourcesResult.data ?? []) {
    events.push({
      timestamp: s.created_at,
      type: "feed",
      description: `Fed source: "${s.title ?? s.source_type}"`,
    })
  }

  for (const r of runsResult.data ?? []) {
    const parts: string[] = []
    if (r.articles_created) parts.push(`${r.articles_created} created`)
    if (r.articles_updated) parts.push(`${r.articles_updated} updated`)
    if (r.edges_created) parts.push(`${r.edges_created} connections`)
    events.push({
      timestamp: r.started_at,
      type: "compile",
      description: `Compiled: ${parts.join(", ") || "no changes"}`,
    })
  }

  for (const q of queriesResult.data ?? []) {
    events.push({
      timestamp: q.created_at,
      type: "query",
      description: `Asked: "${q.question}"`,
    })
  }

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  const formatTime = (d: string) => {
    const date = new Date(d)
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
      " " + date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  }

  const typeColors: Record<string, string> = {
    feed: "bg-text-secondary",
    compile: "bg-confidence-high",
    query: "bg-agent-active",
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <h1 className="font-heading text-lg text-text-emphasis mb-8">Timeline</h1>

      {events.length === 0 ? (
        <p className="text-sm text-text-secondary">No activity yet.</p>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[72px] top-2 bottom-2 w-px bg-border" />

          <div className="space-y-6">
            {events.map((event, i) => (
              <div key={i} className="flex items-start gap-4">
                <span className="text-[10px] font-mono text-text-ghost w-16 shrink-0 text-right pt-0.5">
                  {formatTime(event.timestamp)}
                </span>
                <div className="relative">
                  <div className={`w-2 h-2 rounded-full mt-1 ${typeColors[event.type] ?? "bg-text-ghost"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{event.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
