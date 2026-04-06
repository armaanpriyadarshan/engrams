import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import SourcesList from "@/app/components/app/SourcesList"

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
    .select("id, title, source_type, source_url, content_md, status, created_at, metadata")
    .eq("engram_id", engram.id)
    .order("created_at", { ascending: false })

  const { data: articles } = await supabase
    .from("articles")
    .select("slug, title, source_ids")
    .eq("engram_id", engram.id)

  return (
    <div className="h-full overflow-y-auto scrollbar-hidden">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <SourcesList
          sources={(sources ?? []).map(s => ({
            id: s.id,
            title: s.title,
            sourceType: s.source_type,
            sourceUrl: s.source_url,
            contentPreview: (s.content_md ?? "").slice(0, 300),
            status: s.status,
            createdAt: s.created_at,
            metadata: s.metadata as Record<string, string> | null,
          }))}
          articles={(articles ?? []).map(a => ({
            slug: a.slug,
            title: a.title,
            sourceIds: a.source_ids as string[] ?? [],
          }))}
          engramId={engram.id}
          engramSlug={engramSlug}
        />
      </div>
    </div>
  )
}
