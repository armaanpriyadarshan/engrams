import { getSupabase, getUserId } from "./supabase.js";

export async function listEngrams() {
  const supabase = await getSupabase();
  const userId = getUserId();
  let query = supabase
    .from("engrams")
    .select("name, slug, article_count, source_count, description, visibility")
    .order("created_at", { ascending: true });

  if (userId) query = query.eq("owner_id", userId);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list engrams: ${error.message}`);
  return data ?? [];
}

export async function feedSource(params: {
  engram_slug: string;
  content: string;
  title?: string;
  source_type?: string;
}) {
  const supabase = await getSupabase();

  const { data: engram } = await supabase
    .from("engrams")
    .select("id")
    .eq("slug", params.engram_slug)
    .single();

  if (!engram) throw new Error(`Engram '${params.engram_slug}' not found`);

  const sourceType = params.source_type ?? "text";
  const { data: source, error } = await supabase
    .from("sources")
    .insert({
      engram_id: engram.id,
      source_type: sourceType,
      source_url: sourceType === "url" ? params.content : null,
      content_md: sourceType !== "url" ? params.content : null,
      title: params.title ?? params.content.slice(0, 80),
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !source) throw new Error(`Failed to create source: ${error?.message}`);

  await supabase.functions.invoke("compile-source", {
    body: { source_id: source.id },
  });

  return { source_id: source.id, status: "compiling" };
}

export async function askEngram(params: {
  engram_slug: string;
  question: string;
}) {
  const supabase = await getSupabase();

  const { data: engram } = await supabase
    .from("engrams")
    .select("id")
    .eq("slug", params.engram_slug)
    .single();

  if (!engram) throw new Error(`Engram '${params.engram_slug}' not found`);

  const { data, error } = await supabase.functions.invoke("ask-engram", {
    body: { engram_id: engram.id, question: params.question },
  });

  if (error) throw new Error(`Query failed: ${error.message}`);
  return data;
}

export async function searchArticles(params: {
  engram_slug: string;
  query: string;
}) {
  const supabase = await getSupabase();

  const { data: engram } = await supabase
    .from("engrams")
    .select("id")
    .eq("slug", params.engram_slug)
    .single();

  if (!engram) throw new Error(`Engram '${params.engram_slug}' not found`);

  const { data, error } = await supabase
    .from("articles")
    .select("slug, title, summary, confidence, article_type, tags")
    .eq("engram_id", engram.id)
    .textSearch("fts", params.query, { type: "websearch" })
    .limit(20);

  if (error) throw new Error(`Search failed: ${error.message}`);
  return data ?? [];
}

export async function readArticle(params: {
  engram_slug: string;
  article_slug: string;
}) {
  const supabase = await getSupabase();

  const { data: engram } = await supabase
    .from("engrams")
    .select("id")
    .eq("slug", params.engram_slug)
    .single();

  if (!engram) throw new Error(`Engram '${params.engram_slug}' not found`);

  const { data: article, error } = await supabase
    .from("articles")
    .select("title, slug, content_md, summary, confidence, article_type, tags, related_slugs, source_ids, updated_at")
    .eq("engram_id", engram.id)
    .eq("slug", params.article_slug)
    .single();

  if (error || !article) throw new Error(`Article '${params.article_slug}' not found`);

  const { data: backlinks } = await supabase
    .from("articles")
    .select("slug, title")
    .eq("engram_id", engram.id)
    .contains("related_slugs", [params.article_slug]);

  return { ...article, backlinks: backlinks ?? [] };
}

export async function listArticles(params: { engram_slug: string }) {
  const supabase = await getSupabase();

  const { data: engram } = await supabase
    .from("engrams")
    .select("id")
    .eq("slug", params.engram_slug)
    .single();

  if (!engram) throw new Error(`Engram '${params.engram_slug}' not found`);

  const { data, error } = await supabase
    .from("articles")
    .select("slug, title, summary, confidence, article_type, tags, updated_at")
    .eq("engram_id", engram.id)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(`Failed to list articles: ${error.message}`);
  return data ?? [];
}
