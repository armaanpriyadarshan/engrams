import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import Link from "next/link"
import ArticleSearch from "@/app/components/app/ArticleSearch"
import CompilationToast from "@/app/components/app/CompilationToast"

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

      <ArticleSearch
        engramId={engram.id}
        engramSlug={engramSlug}
        initialArticles={articles ?? []}
      />

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
      <CompilationToast engramId={engram.id} />
    </div>
  )
}
