import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import Link from "next/link"

export default async function EngramPage({ params }: { params: Promise<{ engram: string }> }) {
  const { engram: engramSlug } = await params
  const supabase = await createClient()

  const { data: engram } = await supabase
    .from("engrams")
    .select("*")
    .eq("slug", engramSlug)
    .single()

  if (!engram) notFound()

  const { data: articles } = await supabase
    .from("articles")
    .select("slug, title, summary, confidence, article_type, tags, updated_at")
    .eq("engram_id", engram.id)
    .order("updated_at", { ascending: false })

  const { data: sources } = await supabase
    .from("sources")
    .select("id, title, source_type, status, created_at")
    .eq("engram_id", engram.id)
    .order("created_at", { ascending: false })
    .limit(5)

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: engram.accent_color }} />
        <h1 className="font-heading text-xl text-text-emphasis">{engram.name}</h1>
      </div>

      {(!articles || articles.length === 0) ? (
        <div className="py-20 text-center">
          <p className="text-text-secondary">Nothing here yet.</p>
          <p className="mt-2 text-sm text-text-tertiary">
            <Link href={`/app/${engramSlug}/feed`} className="text-text-secondary hover:text-text-emphasis transition-colors duration-150">
              Feed a source
            </Link>
            {" "}to begin.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {articles.map((a) => (
            <Link
              key={a.slug}
              href={`/app/${engramSlug}/article/${a.slug}`}
              className="block border border-border hover:border-border-emphasis bg-surface p-4 transition-colors duration-150"
            >
              <div className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 mt-2 rounded-full shrink-0" style={{
                  backgroundColor: (a.confidence ?? 0) > 0.8 ? "var(--color-confidence-high)"
                    : (a.confidence ?? 0) > 0.5 ? "var(--color-confidence-mid)" : "var(--color-confidence-low)",
                }} />
                <div>
                  <h2 className="font-heading text-sm text-text-emphasis">{a.title}</h2>
                  {a.summary && <p className="mt-1 text-xs text-text-tertiary leading-relaxed">{a.summary}</p>}
                  {a.tags && a.tags.length > 0 && (
                    <div className="mt-2 flex gap-2">
                      {a.tags.map((tag: string) => (
                        <span key={tag} className="font-mono text-[10px] text-text-ghost">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {sources && sources.length > 0 && (
        <div className="mt-12 border-t border-border pt-8">
          <h2 className="text-xs text-text-tertiary uppercase tracking-widest font-mono mb-4">Recent sources</h2>
          <div className="space-y-2">
            {sources.map((s) => (
              <div key={s.id} className="flex items-center gap-3 text-xs">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  s.status === "compiled" ? "bg-confidence-high"
                    : s.status === "processing" ? "bg-agent-active"
                    : s.status === "failed" ? "bg-danger"
                    : "bg-text-ghost"
                }`} />
                <span className="text-text-secondary truncate">{s.title ?? s.source_type}</span>
                <span className="text-text-ghost font-mono ml-auto shrink-0">{s.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
