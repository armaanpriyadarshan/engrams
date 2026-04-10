import type { SupabaseClient } from "@supabase/supabase-js"

// Fully delete an article and clean up its references so the graph stays
// consistent. Callers should rely on supabase realtime (articles/edges
// DELETE events) to update any mounted UI — this helper just performs the
// DB work.
export async function deleteArticle(
  supabase: SupabaseClient,
  engramId: string,
  slug: string,
) {
  // Remove edges touching this slug from either side
  await supabase.from("edges").delete().eq("engram_id", engramId).eq("from_slug", slug)
  await supabase.from("edges").delete().eq("engram_id", engramId).eq("to_slug", slug)

  // Strip the slug from related_slugs on any article that still links to it
  const { data: related } = await supabase
    .from("articles")
    .select("id, related_slugs")
    .eq("engram_id", engramId)
    .contains("related_slugs", [slug])

  for (const art of related ?? []) {
    const newSlugs = (art.related_slugs as string[]).filter((s) => s !== slug)
    await supabase.from("articles").update({ related_slugs: newSlugs }).eq("id", art.id)
  }

  // Delete the article itself
  await supabase.from("articles").delete().eq("engram_id", engramId).eq("slug", slug)

  // Keep the engram's article_count in sync with the actual row count
  const { count } = await supabase
    .from("articles")
    .select("id", { count: "exact", head: true })
    .eq("engram_id", engramId)

  await supabase.from("engrams").update({ article_count: count ?? 0 }).eq("id", engramId)
}
