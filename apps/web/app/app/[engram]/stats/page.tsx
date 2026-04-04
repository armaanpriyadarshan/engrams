import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"

export default async function StatsPage({ params }: { params: Promise<{ engram: string }> }) {
  const { engram: engramSlug } = await params
  const supabase = await createClient()

  const { data: engram } = await supabase
    .from("engrams")
    .select("id, name")
    .eq("slug", engramSlug)
    .single()

  if (!engram) notFound()

  const [articlesResult, sourcesResult, edgesResult] = await Promise.all([
    supabase.from("articles").select("confidence, tags, article_type, updated_at").eq("engram_id", engram.id),
    supabase.from("sources").select("id", { count: "exact", head: true }).eq("engram_id", engram.id),
    supabase.from("edges").select("id", { count: "exact", head: true }).eq("engram_id", engram.id),
  ])

  const articles = articlesResult.data ?? []
  const sourceCount = sourcesResult.count ?? 0
  const edgeCount = edgesResult.count ?? 0
  const articleCount = articles.length

  // Stats
  const avgConfidence = articleCount > 0
    ? articles.reduce((sum, a) => sum + (a.confidence ?? 0), 0) / articleCount
    : 0

  const now = new Date()
  const staleThreshold = 30 * 24 * 60 * 60 * 1000 // 30 days
  const staleCount = articles.filter((a) => now.getTime() - new Date(a.updated_at).getTime() > staleThreshold).length
  const stalenessPercent = articleCount > 0 ? (staleCount / articleCount) * 100 : 0

  // Tag distribution
  const tagCounts = new Map<string, number>()
  for (const a of articles) {
    for (const tag of a.tags ?? []) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    }
  }
  const sortedTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1])
  const maxTagCount = sortedTags[0]?.[1] ?? 1

  // Confidence distribution
  const confBuckets = [
    { label: "0-30%", min: 0, max: 0.3, color: "bg-confidence-low", count: 0 },
    { label: "30-50%", min: 0.3, max: 0.5, color: "bg-confidence-low", count: 0 },
    { label: "50-70%", min: 0.5, max: 0.7, color: "bg-confidence-mid", count: 0 },
    { label: "70-90%", min: 0.7, max: 0.9, color: "bg-confidence-high", count: 0 },
    { label: "90-100%", min: 0.9, max: 1.01, color: "bg-confidence-high", count: 0 },
  ]
  for (const a of articles) {
    const c = a.confidence ?? 0
    for (const bucket of confBuckets) {
      if (c >= bucket.min && c < bucket.max) { bucket.count++; break }
    }
  }

  // Article type distribution
  const typeCounts = new Map<string, number>()
  for (const a of articles) {
    const t = a.article_type ?? "unknown"
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1)
  }

  const stats = [
    { label: "Articles", value: articleCount },
    { label: "Sources", value: sourceCount },
    { label: "Confidence", value: `${(avgConfidence * 100).toFixed(0)}%` },
    { label: "Connections", value: edgeCount },
  ]

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="font-heading text-lg text-text-emphasis mb-8">Stats</h1>

      {/* Stat boxes */}
      <div className="grid grid-cols-4 gap-4 mb-10">
        {stats.map((s) => (
          <div key={s.label} className="border border-border p-4">
            <div className="font-mono text-2xl text-text-emphasis">{s.value}</div>
            <div className="mt-1 text-[10px] font-mono text-text-tertiary uppercase tracking-widest">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Confidence distribution */}
      {articleCount > 0 && (
        <div className="mb-10">
          <h2 className="text-xs text-text-tertiary uppercase tracking-widest font-mono mb-4">Confidence distribution</h2>
          <div className="space-y-2">
            {confBuckets.map((bucket) => (
              <div key={bucket.label} className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-text-ghost w-12 shrink-0">{bucket.label}</span>
                <div className="flex-1 h-2 bg-surface-raised">
                  <div
                    className={`h-full ${bucket.color} transition-all duration-300`}
                    style={{ width: `${articleCount > 0 ? (bucket.count / articleCount) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-text-ghost w-6 text-right">{bucket.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tag distribution */}
      {sortedTags.length > 0 && (
        <div className="mb-10">
          <h2 className="text-xs text-text-tertiary uppercase tracking-widest font-mono mb-4">Tags</h2>
          <div className="space-y-2">
            {sortedTags.slice(0, 15).map(([tag, count]) => (
              <div key={tag} className="flex items-center gap-3">
                <span className="text-xs font-mono text-text-secondary w-32 truncate shrink-0">{tag}</span>
                <div className="flex-1 h-1.5 bg-surface-raised">
                  <div
                    className="h-full bg-border-emphasis transition-all duration-300"
                    style={{ width: `${(count / maxTagCount) * 100}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-text-ghost w-6 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Article types */}
      {typeCounts.size > 0 && (
        <div>
          <h2 className="text-xs text-text-tertiary uppercase tracking-widest font-mono mb-4">Article types</h2>
          <div className="space-y-1">
            {[...typeCounts.entries()].map(([type, count]) => (
              <div key={type} className="flex items-center gap-3 text-xs">
                <span className="font-mono text-text-secondary">{type}</span>
                <span className="font-mono text-text-ghost">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
