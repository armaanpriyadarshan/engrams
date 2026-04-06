import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import Link from "next/link"

export default async function SourcesPage({ params }: { params: Promise<{ engram: string }> }) {
  const { engram: engramSlug } = await params
  const supabase = await createClient()

  const { data: engram } = await supabase
    .from("engrams")
    .select("id")
    .eq("slug", engramSlug)
    .single()

  if (!engram) notFound()

  const { data: sources } = await supabase
    .from("sources")
    .select("id, title, source_type, source_url, status, created_at")
    .eq("engram_id", engram.id)
    .order("created_at", { ascending: false })

  // Get all articles to compute reverse provenance
  const { data: articles } = await supabase
    .from("articles")
    .select("slug, title, source_ids")
    .eq("engram_id", engram.id)

  // Build source → articles map
  const sourceArticles = new Map<string, { slug: string; title: string }[]>()
  for (const article of articles ?? []) {
    for (const sid of article.source_ids ?? []) {
      const list = sourceArticles.get(sid) ?? []
      list.push({ slug: article.slug, title: article.title })
      sourceArticles.set(sid, list)
    }
  }

  const formatDate = (d: string) => {
    const date = new Date(d)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="font-heading text-lg text-text-emphasis mb-8">Sources</h1>

      {(!sources || sources.length === 0) ? (
        <p className="text-sm text-text-secondary">No sources yet.</p>
      ) : (
        <div className="space-y-1">
          {sources.map((s) => {
            const produced = sourceArticles.get(s.id) ?? []
            return (
              <div key={s.id} className="border border-border hover:border-border-emphasis p-4 transition-colors duration-120">
                <div className="flex items-center gap-3">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    s.status === "compiled" ? "bg-confidence-high"
                      : s.status === "processing" ? "bg-agent-active"
                      : s.status === "failed" ? "bg-danger"
                      : "bg-text-ghost"
                  }`} />
                  <span className="text-sm text-text-primary truncate flex-1">{s.title ?? "Untitled"}</span>
                  <span className="text-[10px] font-mono text-text-ghost shrink-0">{s.source_type}</span>
                  <span className="text-[10px] font-mono text-text-ghost shrink-0">{formatDate(s.created_at)}</span>
                  <span className="text-[10px] font-mono text-text-ghost shrink-0">{s.status}</span>
                </div>
                {produced.length > 0 && (
                  <div className="mt-2 ml-4.5 pl-3 border-l border-border">
                    <span className="text-[10px] font-mono text-text-ghost">Produced {produced.length} article{produced.length !== 1 ? "s" : ""}:</span>
                    <div className="mt-1 space-y-0.5">
                      {produced.map((a) => (
                        <Link
                          key={a.slug}
                          href={`/app/${engramSlug}/article/${a.slug}`}
                          className="block text-xs text-text-secondary hover:text-text-emphasis transition-colors duration-120"
                        >
                          {a.title}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
