import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import VoronoiHeatmap from "@/app/components/app/VoronoiHeatmap"
import LintFindingsPanel from "@/app/components/app/LintFindingsPanel"
import HealthCheckPanel from "@/app/components/app/HealthCheckPanel"
import { computeEngramHealth } from "@/lib/engram-health"

export default async function StatsPage({ params }: { params: Promise<{ engram: string }> }) {
  const { engram: engramSlug } = await params
  const supabase = await createClient()

  const { data: engram } = await supabase
    .from("engrams")
    .select("id, name")
    .eq("slug", engramSlug)
    .single()

  if (!engram) notFound()

  // Fetch everything the page needs in parallel. The articles query
  // returns embedding presence via a non-null check so we don't have to
  // load thousands of 1536-dim vectors into the Next.js server runtime —
  // we only need to know IF each article has one.
  const [articlesResult, sourcesResult, edgesResult, unembeddedResult, openGapsResult, lintErrorsResult] = await Promise.all([
    supabase.from("articles").select("slug, title, confidence, tags, article_type, updated_at, content_md, source_ids").eq("engram_id", engram.id),
    supabase.from("sources").select("id", { count: "exact", head: true }).eq("engram_id", engram.id),
    supabase.from("edges").select("id", { count: "exact", head: true }).eq("engram_id", engram.id),
    supabase.from("articles").select("slug", { count: "exact", head: true }).eq("engram_id", engram.id).is("embedding", null),
    supabase.from("knowledge_gaps").select("id", { count: "exact", head: true }).eq("engram_id", engram.id).eq("status", "open"),
    supabase.from("lint_findings").select("id", { count: "exact", head: true }).eq("engram_id", engram.id).eq("status", "open").eq("severity", "error"),
  ])

  const articles = articlesResult.data ?? []
  const sourceCount = sourcesResult.count ?? 0
  const edgeCount = edgesResult.count ?? 0
  const unembeddedCount = unembeddedResult.count ?? 0
  const openGaps = openGapsResult.count ?? 0
  const openLintErrors = lintErrorsResult.count ?? 0
  const articleCount = articles.length

  const health = computeEngramHealth({
    articles: articles.map((a) => ({
      content_md: a.content_md ?? null,
      updated_at: a.updated_at,
      source_ids: (a.source_ids as string[] | null) ?? null,
    })),
    edges_count: edgeCount,
    unembedded_count: unembeddedCount,
    open_gaps: openGaps,
    open_lint_errors: openLintErrors,
  })

  // Tag distribution
  const tagCounts = new Map<string, number>()
  for (const a of articles) {
    for (const tag of a.tags ?? []) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    }
  }
  const sortedTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1])
  const maxTagCount = sortedTags[0]?.[1] ?? 1

  // Article type distribution
  const typeCounts = new Map<string, number>()
  for (const a of articles) {
    const t = a.article_type ?? "unknown"
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1)
  }

  const stats = [
    { label: "Articles", value: String(articleCount) },
    { label: "Sources", value: String(sourceCount) },
    { label: "Health", value: String(health.score) },
    { label: "Connections", value: String(edgeCount) },
  ]

  // Grade color token — the Health stat gets a per-grade tint so the
  // number also reads at a glance from across the room.
  const gradeColor: Record<typeof health.grade, string> = {
    excellent: "var(--color-confidence-high)",
    good: "var(--color-confidence-high)",
    fair: "var(--color-confidence-mid)",
    poor: "var(--color-confidence-mid)",
    critical: "var(--color-danger)",
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-hidden">
    <div className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="font-heading text-lg text-text-emphasis mb-8">Stats</h1>

      {/* Stat boxes */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {stats.map((s) => {
          const isHealth = s.label === "Health"
          return (
            <div key={s.label} className="border border-border p-4">
              <div
                className="font-mono text-2xl text-text-emphasis"
                style={isHealth ? { color: gradeColor[health.grade] } : undefined}
              >
                {s.value}
              </div>
              <div className="mt-1 text-[10px] font-mono text-text-tertiary uppercase tracking-widest">{s.label}</div>
            </div>
          )
        })}
      </div>

      {/* Health breakdown — only shown when there are penalties to explain */}
      {articleCount > 0 && (
        <div className="mb-10 border-l border-border pl-4">
          <div className="flex items-baseline gap-3 mb-2">
            <span
              className="text-[10px] font-mono uppercase tracking-widest"
              style={{ color: gradeColor[health.grade] }}
            >
              {health.grade}
            </span>
            <span className="text-[10px] font-mono text-text-ghost">
              {health.breakdown.length === 0
                ? "No issues detected."
                : `${health.breakdown.length} deduction${health.breakdown.length === 1 ? "" : "s"} from 100`}
            </span>
          </div>
          {health.breakdown.length > 0 && (
            <ul className="space-y-1.5">
              {health.breakdown.map((p) => (
                <li key={p.id} className="flex items-baseline gap-3 text-[11px]">
                  <span className="font-mono text-text-ghost tabular-nums w-8 shrink-0 text-right">{p.penalty}</span>
                  <span className="font-mono text-text-secondary w-40 shrink-0">{p.label}</span>
                  <span className="text-text-tertiary leading-relaxed">{p.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Confidence map */}
      {articleCount > 0 && (
        <div className="mb-10">
          <VoronoiHeatmap
            engramSlug={engramSlug}
            articles={articles.map((a) => ({
              slug: a.slug,
              title: a.title ?? a.slug,
              confidence: a.confidence ?? 0,
              wordCount: (a.content_md ?? "").split(/\s+/).length,
              sourceCount: (a.source_ids as string[] ?? []).length,
            }))}
          />
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

      {/* Lint findings */}
      <LintFindingsPanel engramId={engram.id} engramSlug={engramSlug} />

      {/* Doctor */}
      <HealthCheckPanel engramId={engram.id} />
    </div>
    </div>
  )
}
